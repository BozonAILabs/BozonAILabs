import {
  AppError,
  command,
  db,
  origins,
  readLimited,
  removeObject,
  user,
  wakeWorker,
} from '../_shared/runtime.ts';
import { type Chunk, combine, validatePdf } from '../_shared/extraction.ts';
import {
  API_VERSION,
  assertStatement,
  checkStatement,
  isIncomplete,
  transactionEdits,
  xeroCsv,
} from '../_shared/statement.ts';
// Authorize before reading private checkpoints and re-check expiry/deletion after the read.
async function resultFor(actor: string, id: string, through?: number) {
  const job = await command('get', actor, id);
  if (
    through !== undefined && (!Number.isInteger(through) || through < 0 || through > job.next_page)
  ) {
    throw new AppError('REVISION', 409);
  }
  let statement = job.content?.corrected ?? null;
  let extractedPages = job.next_page;
  if (!statement || (through !== undefined && through < job.pages)) {
    const { data, error } = await db().from('conversion_content').select('chunks').eq('job_id', id)
      .maybeSingle();
    if (error) throw new AppError('REQUEST_FAILED');
    const chunks = (data?.chunks ?? []).filter((c: Chunk) =>
      c.through <= (through ?? job.next_page)
    );
    extractedPages = chunks.at(-1)?.through ?? 0;
    statement = null;
    if (chunks.some((c: Chunk) => c.statement?.transactions.length)) {
      statement = combine(chunks, extractedPages);
      statement.extraction = { ...statement.extraction!, complete: false };
    }
  }
  await command('get', actor, id);
  return {
    ...job,
    extracted_pages: extractedPages,
    content: statement ? { corrected: statement } : null,
  };
}

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
        format_agnostic: true,
        currency: 'GBP',
        language: 'English',
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
        else wakeWorker();
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
      for (const k of ['name', 'practice', 'email']) {
        if (
          typeof body[k] !== 'string' || !body[k].trim() ||
          body[k].length > ({ name: 120, practice: 180, email: 254 }[k] ?? 80)
        ) throw new AppError('PROFILE_REQUIRED');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
        throw new AppError('PROFILE_REQUIRED');
      }
      return json(
        await command('profile', actor.id, null, {
          name: body.name.trim(),
          practice: body.practice.trim(),
          email: body.email.trim().toLowerCase(),
        }),
      );
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) {
      throw new AppError('NOT_FOUND');
    }
    if (action === 'help') {
      if (typeof body.share_statement !== 'boolean') throw new AppError('INVALID_CONSENT');
      return json(
        await command('help', actor.id, body.id, { share_statement: body.share_statement }),
      );
    }
    if (action === 'get') return json(await resultFor(actor.id, body.id));
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
      const statement = transactionEdits(current, body.statement);
      return json({
        ...await command('edit', actor.id, body.id, { revision: body.revision, statement }),
        checks: checkStatement(statement),
      });
    }
    if (action === 'export') {
      if (!['excel', 'xero'].includes(body.format)) throw new AppError('FORMAT');
      const j = await resultFor(actor.id, body.id, body.extracted_pages);
      let statement = j.content?.corrected;
      if (!statement?.transactions.length) throw new AppError('NO_TRANSACTIONS');
      // Downloads use the visible snapshot without overwriting saved corrections.
      if (body.statement) {
        try {
          statement = transactionEdits(statement, body.statement);
        } catch {
          throw new AppError('INVALID_EDIT');
        }
      } else if (j.revision !== body.revision) throw new AppError('REVISION', 409);
      assertStatement(statement);
      const inProgress = ['queued', 'processing', 'uploading'].includes(j.state) ||
        j.extracted_pages < j.pages && j.state === 'review';
      const files = body.format === 'xero' ? xeroCsv(statement) : null;
      // Completed exports retain the existing event. Interim downloads do not change job state or quota.
      if (j.state === 'review') await command('export', actor.id, body.id, { format: body.format });
      else await command('get', actor.id, body.id);
      return json({
        statement,
        incomplete: isIncomplete(statement),
        in_progress: inProgress,
        files,
      });
    }
    throw new AppError('NOT_FOUND', 404);
  } catch (error) {
    return json(
      { error: error instanceof AppError ? error.code : 'REQUEST_FAILED' },
      error instanceof AppError ? error.status : 400,
    );
  }
});
