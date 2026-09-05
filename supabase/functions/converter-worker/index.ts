import { db, removeObject } from '../_shared/runtime.ts';
import { type Chunk, combine, extract } from '../_shared/extraction.ts';
import { checkStatement } from '../_shared/statement.ts';
Deno.serve(async (req) => {
  const secret = Deno.env.get('CONVERTER_WORKER_TOKEN');
  if (req.method !== 'POST' || !secret || req.headers.get('x-worker-token') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }
  const client = db();
  const { data: expired, error: cleanupError } = await client.rpc('converter_cleanup');
  if (cleanupError) return new Response('Cleanup unavailable', { status: 503 });
  for (const object of expired ?? []) await removeObject(object.object_path, object.id);
  const key = Deno.env.get('MISTRAL_API_KEY');
  if (!key) return new Response('Processing not configured', { status: 503 });
  const { data: job, error } = await client.rpc('converter_claim');
  if (error) return new Response('Queue unavailable', { status: 503 });
  if (!job) return Response.json({ idle: true });
  try {
    const ttl = Math.min(120, Math.floor((Date.parse(job.expires_at) - Date.now()) / 1000));
    if (ttl < 1) return Response.json({ expired: true });
    const { data, error: signError } = await client.storage.from('statements').createSignedUrl(
      job.object_path,
      ttl,
    );
    if (signError || !data) throw new Error('STORAGE');
    const chunk = await extract(data.signedUrl, job.next_page, job.pages, key);
    let final = null;
    if (chunk.through === job.pages) {
      final = combine([...(job.chunks as Chunk[]), chunk], job.pages);
      const { data: settings } = await client.from('converter_settings').select('validated_banks')
        .single();
      if (!settings?.validated_banks.includes(final.bank)) throw new Error('UNVALIDATED_BANK');
      checkStatement(final);
    }
    const { error: saveError } = await client.rpc('converter_checkpoint', {
      jid: job.id,
      token: job.lease,
      mid: job.msg_id,
      chunk,
      final_result: final,
    });
    if (saveError) throw new Error('CHECKPOINT');
    return Response.json({ processed: true });
  } catch {
    // Queue visibility and bounded claim attempts recover this job. Never log document/provider payloads.
    return Response.json({ retry: true }, { status: 503 });
  }
});
