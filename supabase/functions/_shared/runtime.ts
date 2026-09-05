import { createClient } from '@supabase/supabase-js';
export const db = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export class AppError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}
export async function command(
  op: string,
  uid: string,
  jid: string | null = null,
  args: unknown = {},
) {
  const { data, error } = await db().rpc('converter_command', { op, uid, jid, args });
  if (error) {
    const code = [
      'UNAVAILABLE',
      'PROFILE_REQUIRED',
      'ALLOWANCE',
      'RATE_LIMIT',
      'ACTIVE_JOB',
      'NOT_FOUND',
      'EXPIRED',
      'STATE',
      'REVISION',
      'PAGES',
    ].find((c) => error.message.includes(c));
    throw new AppError(
      code ?? 'REQUEST_FAILED',
      code === 'NOT_FOUND' ? 404 : code === 'REVISION' ? 409 : 400,
    );
  }
  return data;
}
export function origins() {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://127.0.0.1:5173,http://localhost:5173').split(
    ',',
  );
}
export async function user(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) throw new AppError('SIGN_IN', 401);
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new AppError('SIGN_IN', 401);
  // OAuth identities come from the Auth server, never user-editable metadata.
  if (
    !data.user.identities?.some((i) => ['google', 'apple'].includes(i.provider)) &&
    !(Deno.env.get('ALLOW_LOCAL_TEST_AUTH') === 'true' &&
      ['kong', '127.0.0.1', 'localhost', 'supabase_kong_BozonAILabs'].includes(
        new URL(Deno.env.get('SUPABASE_URL')!).hostname,
      ))
  ) throw new AppError('SOCIAL_LOGIN_REQUIRED', 403);
  return data.user;
}
export async function removeObject(path: string, id: string | null) {
  const { error } = await db().storage.from('statements').remove([path]);
  if (!error && id) {
    await db().from('conversions').update({
      storage_deleted: true,
      storage_checked_at: new Date().toISOString(),
    }).eq('id', id);
  }
}

export async function readLimited(req: Request, limit: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length')) > limit) throw new AppError('REQUEST_TOO_LARGE');
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new AppError('REQUEST_TOO_LARGE');
    }
    parts.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
