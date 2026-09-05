import { AppError, db, removeObject, wakeWorker } from '../_shared/runtime.ts';
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
    if (Date.parse(job.expires_at) <= Date.now()) return Response.json({ expired: true });
    // Send the private file itself: external OCR cannot reach local Docker storage URLs.
    const { data, error: downloadError } = await client.storage.from('statements').download(
      job.object_path,
    );
    if (downloadError || !data) throw new Error('STORAGE');
    const bytes = new Uint8Array(await data.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    const chunk = await extract(
      `data:application/pdf;base64,${btoa(binary)}`,
      job.next_page,
      job.pages,
      key,
    );
    let final = null;
    if (chunk.through === job.pages) {
      final = combine([...(job.chunks as Chunk[]), chunk], job.pages);
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
    if (!final) wakeWorker();
    return Response.json({ processed: true });
  } catch (error) {
    const code = error instanceof AppError ? error.code : error instanceof Error &&
        ['STORAGE', 'CHECKPOINT'].includes(error.message)
      ? error.message
      : 'PROCESSING_FAILED';
    if (
      ['UNSUPPORTED_STATEMENT', 'UNSUPPORTED_CURRENCY', 'INCONSISTENT_STATEMENT', 'NO_TRANSACTIONS']
        .includes(code)
    ) {
      const { error: rejectError } = await client.rpc('converter_reject', {
        jid: job.id,
        token: job.lease,
        mid: job.msg_id,
        reason: code,
      });
      if (!rejectError) return Response.json({ rejected: true });
    }
    console.error('converter_worker_failed', code);
    // Queue visibility and bounded claim attempts recover this job. Never log document/provider payloads.
    return Response.json({ retry: true }, { status: 503 });
  }
});
