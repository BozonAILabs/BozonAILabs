import { createClient } from '@supabase/supabase-js';
import { assert, assertEquals } from '@std/assert';
import { PDFDocument } from 'pdf-lib';
const url = Deno.env.get('LOCAL_SUPABASE_URL')!;
if (new URL(url).hostname !== '127.0.0.1') {
  throw new Error('Local tests must never run on a hosted project');
}
const key = Deno.env.get('LOCAL_SUPABASE_SERVICE_KEY')!,
  anon = Deno.env.get('LOCAL_SUPABASE_ANON_KEY')!;
const admin = createClient(url, key, { auth: { persistSession: false } });
const users: { id: string; token: string; client: ReturnType<typeof createClient> }[] = [];
const call = async (
  user: number,
  action: string,
  body: unknown = {},
  file?: Uint8Array,
  id?: string,
) => {
  const response = await fetch(
    `${url}/functions/v1/converter-api?action=${action}${id ? '&id=' + id : ''}`,
    {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${users[user].token}`,
        'Content-Type': file ? 'application/pdf' : 'application/json',
      },
      body: file ?? JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/pdf')
      ? await response.arrayBuffer()
      : await response.json(),
  };
};
try {
  await admin.from('converter_settings').update({ enabled: true, validated_banks: ['NatWest'] }).eq(
    'id',
    true,
  );
  for (let i = 0; i < 2; i++) {
    const email = `converter-test-${crypto.randomUUID()}@example.test`,
      password = crypto.randomUUID();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const client = createClient(url, anon, { auth: { persistSession: false } });
    const { data: session, error: loginError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (loginError) throw loginError;
    users.push({ id: data.user.id, token: session.session!.access_token, client });
    assertEquals(
      (await call(i, 'profile', {
        name: 'Test',
        practice: 'Synthetic Practice',
        role: 'Accountant',
      })).status,
      200,
    );
  }
  const simultaneous = await Promise.all([call(0, 'create'), call(0, 'create')]);
  assertEquals(simultaneous.filter((r) => r.status === 200).length, 1);
  const jid = simultaneous.find((r) => r.status === 200)!.data.id;
  assertEquals((await call(1, 'get', { id: jid })).status, 404);
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const upload = await call(0, 'upload', {}, bytes, jid);
  assertEquals(upload.status, 200);
  assertEquals((await call(0, 'account')).data.remaining, 49);
  assertEquals((await call(0, 'upload', {}, bytes, jid)).status, 400);
  assertEquals((await call(0, 'get', { id: jid })).data.state, 'queued');
  const { data: objects, error: objectsError } = await users[1].client.storage.from('statements')
    .list(users[0].id);
  assert(!objects?.length);
  assertEquals(objectsError, null);
  const { data: rows } = await users[1].client.from('conversions').select('*');
  assertEquals(rows, []);
  const { error: forbidden } = await users[0].client.rpc('converter_command', {
    op: 'account',
    uid: users[1].id,
  });
  assert(forbidden);
  // Claim/checkpoint emulate a successful provider result; the actual provider has a separate live synthetic test.
  const { data: job, error: claimError } = await admin.rpc('converter_claim');
  if (claimError) throw claimError;
  assertEquals(job.id, jid);
  const statement = {
    bank: 'NatWest',
    currency: 'GBP',
    account: 'synthetic',
    start: '2026-01-01',
    end: '2026-01-31',
    opening: 100,
    closing: 0,
    transactions: [{
      date: '2026-01-02',
      description: 'Synthetic debit',
      amount: -100,
      balance: 0,
      page: 1,
    }],
  };
  const { error: checkpointError } = await admin.rpc('converter_checkpoint', {
    jid,
    token: job.lease,
    mid: job.msg_id,
    chunk: {},
    final_result: statement,
  });
  if (checkpointError) throw checkpointError;
  assertEquals((await call(0, 'source', { id: jid })).status, 200);
  const edited = structuredClone(statement);
  edited.transactions[0].description = 'Corrected description';
  assertEquals(
    (await call(0, 'edit', { id: jid, revision: 0, statement: edited })).data.revision,
    1,
  );
  assertEquals((await call(0, 'edit', { id: jid, revision: 0, statement: edited })).status, 409);
  assertEquals((await call(0, 'export', { id: jid, revision: 1, format: 'xero' })).status, 200);
  assertEquals((await call(0, 'account')).data.remaining, 49);
  const next = await call(0, 'create');
  const reused = await call(0, 'upload', {}, bytes, next.data.id);
  assertEquals(reused.data.id, jid);
  assertEquals(reused.data.reused, true);
  assertEquals((await call(0, 'followup')).status, 200);
  assertEquals((await call(0, 'delete', { id: jid })).status, 200);
  assertEquals((await call(0, 'source', { id: jid })).status, 400);
  const { data: content } = await admin.from('conversion_content').select('*').eq('job_id', jid);
  assertEquals(content, []);
  const worker = await fetch(`${url}/functions/v1/converter-worker`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${users[0].token}` },
  });
  assertEquals(worker.status, 401);
  await worker.text();
  console.log(
    'Local API integration passed: concurrent create, two-user isolation, PDF upload, duplicate rejection/reuse, quota, edits, export, deletion and worker auth.',
  );
} finally {
  for (const u of users) {
    const { data: jobs } = await admin.from('conversions').select('object_path').eq(
      'user_id',
      u.id,
    );
    if (jobs?.length) await admin.storage.from('statements').remove(jobs.map((j) => j.object_path));
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from('converter_settings').update({ enabled: false, validated_banks: [] }).eq(
    'id',
    true,
  );
}
