import {
  AppError,
  command,
  db,
  origins,
  readLimited,
  removeObject,
  user,
} from '../_shared/runtime.ts';
import { validatePdf } from '../_shared/extraction.ts';
import { API_VERSION, assertStatement, checkStatement, xeroCsv } from '../_shared/statement.ts';
Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origins().includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && !origins().includes(origin)) return json({ error: 'ORIGIN' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);
  try {
    const action = new URL(req.url).searchParams.get('action') ?? '';
    if (action === 'capabilities') {
      const { data, error } = await db().from('converter_settings').select('*').single();
      return json({
        version: API_VERSION,
        enabled: !error && data?.enabled === true && data?.api_version === API_VERSION &&
          !!Deno.env.get('MISTRAL_API_KEY') &&
          !!Deno.env.get('CONVERTER_WORKER_TOKEN'),
        banks: data?.validated_banks ?? [],
      });
    }
    const actor = await user(req);
    if (action === 'upload') {
      const jid = new URL(req.url).searchParams.get('id');
      if (!jid) throw new AppError('NOT_FOUND');
      const job = await command('begin_upload', actor.id, jid);
      if (job.state !== 'uploading') throw new AppError('STATE');
      try {
        if (req.headers.get('content-type') !== 'application/pdf') {
          throw new AppError('INVALID_PDF');
        }
        const length = Number(req.headers.get('content-length'));
        if (length > 10485760) throw new AppError('FILE_TOO_LARGE');
        // Bound streamed bytes even when Content-Length is missing or untrusted.
        const reader = req.body?.getReader();
        if (!reader) throw new AppError('INVALID_PDF');
        const parts: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 10485760) {
            await reader.cancel();
            throw new AppError('FILE_TOO_LARGE');
          }
          parts.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const p of parts) {
          bytes.set(p, offset);
          offset += p.length;
        }
        const pages = await validatePdf(bytes);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
        const { error } = await db().storage.from('statements').upload(job.object_path, bytes, {
          contentType: 'application/pdf',
          upsert: false,
        });
        if (error) throw new AppError('UPLOAD_FAILED');
        const result = await command('finalize', actor.id, jid, { pages, hash });
        if (result.reused) await removeObject(job.object_path, jid);
        return json(result);
      } catch (error) {
        await command('fail', actor.id, jid, {
          code: error instanceof AppError ? error.code : 'UPLOAD_FAILED',
        }).catch(() => {});
        await removeObject(job.object_path, jid);
        throw error;
      }
    }
    const raw = new TextDecoder().decode(await readLimited(req, 2_000_000));
    if (raw.length > 2_000_000) throw new AppError('REQUEST_TOO_LARGE');
    const body = raw ? JSON.parse(raw) : {};
    if (['account', 'create', 'followup'].includes(action)) {
      return json(await command(action, actor.id));
    }
    if (action === 'profile') {
      for (const k of ['name', 'practice', 'role']) {
        if (
          typeof body[k] !== 'string' || !body[k].trim() ||
          body[k].length > ({ name: 120, practice: 180, role: 80 }[k] ?? 80)
        ) throw new AppError('PROFILE_REQUIRED');
      }
      return json(
        await command('profile', actor.id, null, {
          name: body.name.trim(),
          practice: body.practice.trim(),
          role: body.role.trim(),
        }),
      );
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      throw new AppError('NOT_FOUND');
    }
    if (action === 'get') return json(await command('get', actor.id, body.id));
    if (action === 'delete') {
      const j = await command('delete', actor.id, body.id);
      await removeObject(j.object_path, body.id);
      return json({ deleted: true });
    }
    if (action === 'source') {
      const j = await command('get', actor.id, body.id);
      const { data, error } = await db().storage.from('statements').download(j.object_path);
      if (error || !data) throw new AppError('SOURCE_UNAVAILABLE');
      // Re-check after storage fetch so a concurrent deletion/expiry cannot yield new access.
      await command('get', actor.id, body.id);
      return new Response(data, {
        headers: {
          ...headers,
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="statement.pdf"',
        },
      });
    }
    if (action === 'edit') {
      assertStatement(body.statement);
      if (!Number.isInteger(body.revision)) throw new AppError('REVISION', 409);
      const original = await command('get', actor.id, body.id);
      // Source ownership and account identity are immutable; corrections target transaction fields only.
      const current = original.content?.corrected;
      if (!current || body.statement.transactions.length !== current.transactions.length) {
        throw new AppError('INVALID_EDIT');
      }
      const statement = {
        ...current,
        transactions: body.statement.transactions.map((t: Record<string, unknown>, i: number) => ({
          ...current.transactions[i],
          date: t.date,
          description: t.description,
          amount: t.amount,
        })),
      };
      return json({
        ...await command('edit', actor.id, body.id, { revision: body.revision, statement }),
        checks: checkStatement(statement),
      });
    }
    if (action === 'export') {
      const j = await command('get', actor.id, body.id);
      const statement = j.content?.corrected;
      if (!statement || j.revision !== body.revision) throw new AppError('REVISION', 409);
      assertStatement(statement);
      if (!['excel', 'xero'].includes(body.format)) throw new AppError('FORMAT');
      const files = body.format === 'xero' ? xeroCsv(statement, body.acknowledged === true) : null;
      await command('export', actor.id, body.id, { format: body.format });
      return json({ statement, checks: checkStatement(statement), files });
    }
    throw new AppError('NOT_FOUND', 404);
  } catch (error) {
    return json(
      { error: error instanceof AppError ? error.code : 'REQUEST_FAILED' },
      error instanceof AppError ? error.status : 400,
    );
  }
});
