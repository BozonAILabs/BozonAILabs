# Bank statement converter

Vite on Vercel is the client. Supabase Auth, private Storage, Postgres, pgmq, Cron and Edge Functions are the backend. No Vercel API or worker handles statements.

## Run locally

Use the Bozon stack on API port 56321, DB port 56322 and Vite port 5174. This machine uses the dedicated `bozon-local` Docker network; pass `--network-id bozon-local` to Supabase start/reset/functions commands. Never reset another project's stack.

1. Start Supabase and apply the repository migrations. The scope migration enables the initial NatWest scope. The `validated_banks` column is the legacy name for the operational allowlist, not certification of every bank layout.
2. Set `landing-page/.env.local` from `.env.example` with the local API URL and public key from `supabase status`. Keep secret/service-role keys out of the frontend. The enabled flag defaults on when configuration is present; `false` is an emergency off switch.
3. Set `supabase/functions/.env.local` with an actual `MISTRAL_API_KEY`, random `CONVERTER_WORKER_TOKEN`, and exact `ALLOWED_ORIGINS` including `http://127.0.0.1:5174`. Start `supabase functions serve --network-id bozon-local --env-file supabase/functions/.env.local`. Local Edge runtime uses `policy = "per_worker"` so background dispatch survives the upload response.
4. Set Vault `converter_worker_url` to `http://kong:8000/functions/v1/converter-worker` and `converter_worker_token` to the same Edge token. The minute Cron recovers interrupted work and runs cleanup.
5. Run `npm --prefix landing-page run dev -- --host 127.0.0.1 --port 5174`.
6. Open the converter and enter name, email and practice name. The form creates an anonymous Supabase session only on submission. Local `config.toml` enables anonymous sign-ins. No password, provider redirect or email confirmation is needed. Email is a contact field on the private profile, never an authentication credential or lookup key for another session's files.


## Verification

- `./scripts/check.sh`: engine/type checks, build, seven mocked browser regression tests and dependency audit.
- `cat supabase/tests/converter.sql | docker exec -i supabase_db_BozonAILabs psql -U postgres -d postgres`: DB access, lifecycle, quota and concurrency invariants.
- `python3 scripts/test-local-api.py`: real local API/Storage/Auth tests with manually injected extraction checkpoints. Set `LOCAL_MANUAL_WORKER=true` for this harness, then remove it and restart functions afterward. Production ignores this localhost-only flag. The harness restores disabled settings afterward; restore the intended local bank allowlist before manual use.
- `deno run --allow-write=.local scripts/create-converter-fixture.ts --boundary`, then `node landing-page/scripts/live-converter.mjs`: opt-in billed live test with actual Mistral, Auth, uploads, Storage, queue and Edge workers. No API responses or successful checkpoints are mocked. It verifies an eight-page/two-chunk PDF, exact transactions, a saved correction, actual workbook/CSV contents, mobile layout and deletion. Synthetic fixtures and output files stay in ignored `.local/`.
- `deno run --allow-env --allow-net=api.mistral.ai scripts/smoke-ocr.ts --boundary`: isolated provider diagnostic, not a substitute for the full flow.

The eight-page browser-to-download test verifies continuation across pages 6/7 exactly once. This establishes pipeline behavior; it does not certify every real NatWest format. The live test starts at the contact form in a fresh browser and creates a real anonymous session; it does not inject credentials or mock authentication.

## Contract and lifecycle

`supabase/functions/_shared/statement.ts` owns the versioned integer-pence statement format and checks. `shared/statement.ts` re-exports it to browser/tests. Statement summaries and transaction arrays are the inputs for future completeness/comparison tools. Those tools are not built here.

`converter-api` actions: capabilities; account; profile; followup; create; upload (PDF body with id query); get; source; edit (id, revision, statement); export (id, revision, format, acknowledged); delete. User identity is obtained from Auth, never request body. All JSON responses and PDFs are no-store. Browser Storage access is denied. Edits preserve account metadata and original source-page references; original extraction remains separate from corrections.

Create claims the user's single active slot. Upload is claimed once, bounded and parsed server-side; finalise hashes the file, reuses an unexpired result where possible, reserves pages under a user advisory lock and enqueues atomically. An unexpired duplicate requires at least one remaining page to initiate upload, but does not charge pages again. Existing results remain downloadable at zero allowance. Finalised uploads wake the worker immediately with `EdgeRuntime.waitUntil`; each successful partial checkpoint wakes the next chunk. Minute Cron is the durable recovery path, not the primary start mechanism. Workers download private PDF bytes and send an inline document to Mistral, so no external provider must reach Docker-local URLs. Each worker request consumes one queue chunk, with 180-second visibility and three attempts per chunk. Six owned pages with preceding and following context keep requests at most eight pages and allow wrapped descriptions to cross page boundaries. Original page references determine ownership; no transaction is silently deduplicated. Incomplete chunks are retried before checkpointing; exhausted retries and conflicting metadata fail without fabricating output.

Checkpointing checks a lease token, job state and expiry under the same user lock. Completion charges once; failures/deletion release only unconsumed reservations. Queues contain job IDs only. No financial content goes in operational logs/events. Mistral raw annotations, normalised original and current corrections live in `conversion_content`, guarded by the parent expiry. The browser clears loaded content at expiry/sign-out; copies already downloaded cannot be revoked.

The worker first clears expired/abandoned/failed payloads and removes their Storage objects. Tombstones are swept repeatedly for 48 hours to cover upload/delete races; cleanup runs in bounded batches ordered by oldest check to prevent starvation. Unfinished uploads expire after 15 minutes. The database closes access at expiry even if a cleanup invocation fails. The sweep also finds Storage objects without a conversion row after 15 minutes, including Auth-account deletion orphans. Account deletion remains a restricted operator workflow, not a browser endpoint.

## Deployment

Code stays on the feature branch and PR until merged. The GitHub integrations deploy migrations/functions and the Vercel frontend independently when merged to main; they are not an atomic deployment.

1. The existing Vercel integration synchronizes Production-only `NEXT_PUBLIC_SUPABASE_*` values. `vite.config.ts` explicitly maps only URL, publishable key and legacy anon key to the corresponding Vite variables. No broad environment exposure or manual duplicated public keys are needed.
2. Provision Mistral and worker secrets in Supabase Edge, plus exact allowed frontend origins. Set the Vault worker URL/token to the hosted function URL and same token. These credentials are runtime configuration, not Git files.
3. Enable anonymous sign-ins in Bozon's Supabase Auth settings. Google/Apple remain disabled. Email confirmation is not part of this flow. Auth configuration is ignored by the production GitHub integration by default, so dashboard configuration is a separate one-time setup (completed for Bozon).
4. The scope migration enables the initial NatWest scope. Keep the bank allowlist aligned with the stated product scope and expand using real redacted/consented fixtures. Unsupported or incomplete extraction fails instead of fabricating a spreadsheet.
5. Previews can work with explicitly configured isolated Supabase credentials; the prior blanket preview disable is removed. The current production-only integration does not automatically provide a preview backend.
6. Verify deployed migration/function versions, secret names, capability response, contact-form session creation, a completed conversion and downloaded values before calling the public site live. For rollback, set the frontend off switch or DB `enabled=false`; preserve in-flight data and quota ledgers.

Operators can grant extra pages from restricted SQL: `select public.converter_grant('<user uuid>', 20, 'Workflow review completed');`. This function is not executable by browsers or service-role workers; record the authenticated operator separately if using a shared SQL login. Lead review joins self-reported profile emails to follow-up requests and minimal usage events, never financial content.

## Extending bank coverage

Synthetic tests establish pipeline behavior. Evaluate additional real, consented/redacted digital and scanned formats against an independently prepared expected ledger before expanding claims. Include wrapped descriptions, ambiguous dates, missing pages, repeated rows and negative balances. Record fixture consent, model version, expected ledger and observed results privately; never commit real financial files. A passing balance alone does not establish extraction accuracy.

The repository skill `.codex/skills/converter-delivery/SKILL.md` documents delivery, verification and reuse of this engine for future tools.

## References

- https://supabase.com/docs/guides/deployment/branching/github-integration
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://docs.mistral.ai/studio/document-processing/annotations
- https://docs.mistral.ai/models/ocr-4-0

## Contact gate and session privacy

Name, email and practice are required in both the interface and API. The DB stores email separately from Auth; it is unverified. The optional role column preserves legacy profiles but is not collected. Two visitors may enter the same email and still receive different anonymous identities, private files and quotas. The server never retrieves an old session by email. Existing profiles without an email must complete the form before a new upload.

The 50-page allowance is per private browser identity. Clearing browser data or ending a session loses access to its results and can create a fresh allowance. No verified-email or per-person quota is claimed. The page-limit message and workflow contact action appear only when the allowance is exhausted or an upload would exceed it. Follow-up consent remains a separate explicit checkbox after export.
