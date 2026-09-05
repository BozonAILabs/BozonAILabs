# Bank statement converter

Vite on Vercel is the client. Supabase Auth, private Storage, Postgres, pgmq, Cron and Edge Functions are the backend. No Vercel API or worker handles statements.

## Run locally

Use the Bozon stack on API port 56321, DB port 56322 and Vite port 5174. This machine uses the dedicated `bozon-local` Docker network; pass `--network-id bozon-local` to Supabase start/reset/functions commands. Never reset another project's stack.

1. Start Supabase and apply the repository migrations. The format-agnostic migration removes the bank allowlist and advances the API contract to version 2. The existing enabled/off setting remains in place.
2. Set `landing-page/.env.local` from `.env.example` with the local API URL and public key from `supabase status`. Keep secret/service-role keys out of the frontend. The enabled flag defaults on when configuration is present; `false` is an emergency off switch.
3. Set `supabase/functions/.env.local` with an actual `MISTRAL_API_KEY`, random `CONVERTER_WORKER_TOKEN`, and exact `ALLOWED_ORIGINS` including `http://127.0.0.1:5174`. Start `supabase functions serve --network-id bozon-local --env-file supabase/functions/.env.local`. Local Edge runtime uses `policy = "per_worker"` so background dispatch survives the upload response.
4. Set Vault `converter_worker_url` to `http://kong:8000/functions/v1/converter-worker` and `converter_worker_token` to the same Edge token. The minute Cron recovers interrupted work and runs cleanup.
5. Run `npm --prefix landing-page run dev -- --host 127.0.0.1 --port 5174`.
6. Open the converter and enter name, email and practice name. The form creates an anonymous Supabase session only on submission. Local `config.toml` enables anonymous sign-ins. No password, provider redirect or email confirmation is needed. Email is a contact field on the private profile, never an authentication credential or lookup key for another session's files.


## Verification

- `./scripts/check.sh`: engine/type checks, build, nine mocked browser regression tests and dependency audit.
- `cat supabase/tests/converter.sql | docker exec -i supabase_db_BozonAILabs psql -U postgres -d postgres`: DB access, lifecycle, quota and concurrency invariants.
- `python3 scripts/test-local-api.py`: real local API/Storage/Auth tests with manually injected extraction checkpoints. Set `LOCAL_MANUAL_WORKER=true` for this harness, then remove it and restart functions afterward. Production ignores this localhost-only flag. The harness restores disabled settings afterward; restore `enabled=true` before manual use.
- `deno run --allow-write=.local scripts/create-converter-fixture.ts --boundary --unknown-bank`, then `node landing-page/scripts/live-converter.mjs`: opt-in billed live test with actual Mistral, Auth, uploads, Storage, queue and Edge workers. No API responses or successful checkpoints are mocked. It verifies an eight-page/two-chunk PDF, exact transactions, a saved correction, actual workbook/CSV contents, mobile layout and deletion. Synthetic fixtures and output files stay in ignored `.local/`.
- `deno run --allow-env --allow-net=api.mistral.ai scripts/smoke-ocr.ts --boundary`: isolated provider diagnostic, not a substitute for the full flow.

The eight-page browser-to-download test verifies continuation across pages 6/7 exactly once. This establishes pipeline behavior; it does not certify every real bank format. The live test starts at the contact form in a fresh browser and creates a real anonymous session; it does not inject credentials or mock authentication.

## Contract and lifecycle

`supabase/functions/_shared/statement.ts` owns the versioned integer-pence statement format and checks. `shared/statement.ts` re-exports it to browser/tests. Statement summaries and transaction arrays are the inputs for future completeness/comparison tools. Those tools are not built here.

`converter-api` actions: capabilities; account; profile; followup; create; upload (PDF body with id query); get; source; edit (id, revision, statement); export (id, revision, format, acknowledged); delete. User identity is obtained from Auth, never request body. All JSON responses and PDFs are no-store. Browser Storage access is denied. Edits preserve account metadata and original source-page references; original extraction remains separate from corrections.

Create claims the user's single active slot. Upload is claimed once, bounded and parsed server-side; finalise hashes the file, reuses an unexpired result where possible, reserves pages under a user advisory lock and enqueues atomically. An unexpired duplicate requires at least one remaining page to initiate upload, but does not charge pages again. Existing results remain downloadable at zero allowance. Finalised uploads wake the worker immediately with `EdgeRuntime.waitUntil`; each successful partial checkpoint wakes the next chunk. Minute Cron is the durable recovery path, not the primary start mechanism. Workers download private PDF bytes and send an inline document to Mistral, so no external provider must reach Docker-local URLs. Each worker request consumes one queue chunk, with 180-second visibility and three attempts per chunk. Six owned pages with preceding and following context keep requests at most eight pages and allow wrapped descriptions to cross page boundaries. Original page references determine ownership; no transaction is silently deduplicated. Readable rows from incomplete chunks are checkpointed with immutable extraction-quality flags. Missing/uncertain pages remain visible even if balances match. Provider transport/malformed-response failures retry; incompatible account metadata, non-GBP/mixed ledgers, non-statements and zero usable rows fail without fabricating output.

Checkpointing checks a lease token, job state and expiry under the same user lock. Completion charges once; failures/deletion release only unconsumed reservations. Queues contain job IDs only. No financial content goes in operational logs/events. Mistral raw annotations, normalised original and current corrections live in `conversion_content`, guarded by the parent expiry. The browser clears loaded content at expiry/sign-out; copies already downloaded cannot be revoked.

The worker first clears expired/abandoned payloads and removes their Storage objects. Tombstones are swept repeatedly for 48 hours to cover upload/delete races; cleanup runs in bounded batches ordered by oldest check to prevent starvation. Unfinished uploads expire after 15 minutes. The database closes access at expiry even if a cleanup invocation fails. The sweep also finds Storage objects without a conversion row after 15 minutes, including Auth-account deletion orphans. Account deletion remains a restricted operator workflow, not a browser endpoint.

## Deployment

Code stays on the feature branch and PR until merged. The GitHub integrations deploy migrations/functions and the Vercel frontend independently when merged to main; they are not an atomic deployment.

1. The existing Vercel integration synchronizes Production-only `NEXT_PUBLIC_SUPABASE_*` values. `vite.config.ts` explicitly maps only URL, publishable key and legacy anon key to the corresponding Vite variables. No broad environment exposure or manual duplicated public keys are needed.
2. Provision Mistral and worker secrets in Supabase Edge, plus exact allowed frontend origins. Set the Vault worker URL/token to the hosted function URL and same token. These credentials are runtime configuration, not Git files.
3. Enable anonymous sign-ins in Bozon's Supabase Auth settings. Google/Apple remain disabled. Email confirmation is not part of this flow. Auth configuration is ignored by the production GitHub integration by default, so dashboard configuration is a separate one-time setup (completed for Bozon).
4. API version 2 accepts unfamiliar bank names and varying layouts; scope is one English-language GBP current-account statement. Keep the frontend, API and migration contract aligned. Incomplete extraction produces a clearly labelled partial review; incompatible currency/account scope produces help without an export.
5. Previews can work with explicitly configured isolated Supabase credentials; the prior blanket preview disable is removed. The current production-only integration does not automatically provide a preview backend.
6. Verify deployed migration/function versions, secret names, capability response, contact-form session creation, a completed conversion and downloaded values before calling the public site live. For rollback, set the frontend off switch or DB `enabled=false`; preserve in-flight data and quota ledgers.

Operators can grant extra pages from restricted SQL: `select public.converter_grant('<user uuid>', 20, 'Workflow review completed');`. This function is not executable by browsers or service-role workers; record the authenticated operator separately if using a shared SQL login. Lead review joins self-reported profile emails to follow-up requests and minimal usage events, never financial content.

## Format coverage and results

No bank list, bank credentials or per-bank parser is required. Bank names are descriptive metadata, not admission criteria. The extractor recognises varying debit/credit columns, signed amounts and CR/DR notation. It uses booked GBP amounts, never an original foreign amount or an inferred exchange-rate conversion. The OCR schema checks ledger currencies separately from foreign purchase information.

The canonical statement carries optional `extraction` metadata: completeness, unreadable page numbers and uncertain page numbers. The original remains immutable when transactions are edited. The three outcomes are:

- Checks pass: review, Excel and Xero CSV (acknowledge absent balances where required).
- Needs attention: readable/editable rows remain visible, with source/page warnings. Excel uses a partial filename and sheet plus a Checks warning when extraction is incomplete. Xero is blocked by unresolved issues; matching balances and acknowledgements cannot override incomplete source extraction.
- Cannot extract: no finished spreadsheet. A specific explanation and help request are available; reserved pages are returned.

Malformed/transport responses retry within the existing bounded queue. Terminal rejections use `converter_reject`, which checks the active lease before changing state/releasing quota. Failed PDFs stay private until the original expiry/deletion so users can choose to share them for help. This does not extend the 24-hour retention period.

Test real, consented/redacted layouts against an independently prepared expected ledger before claiming reliable coverage. Synthetic fixtures verify the pipeline, not every bank's actual formats. Include scans, wrapped descriptions, repeated rows, missing pages and negative balances.

Additional live scenarios:

- Generate `--unknown-bank --partial`, then run `CONVERTER_LIVE_SCENARIO=partial node landing-page/scripts/live-converter.mjs` to verify unreadable amounts, partial workbook, blocked Xero, help consent and deletion revocation.
- To test a PDF with no text layer, generate it with `deno run --allow-write=.local --allow-read=.local --allow-run=pdftoppm scripts/create-converter-fixture.ts --unknown-bank --scanned`, then run the normal live harness. This optional test requires Poppler.
- Generate `--unknown-bank --non-gbp`, then run `CONVERTER_LIVE_SCENARIO=unsupported node landing-page/scripts/live-converter.mjs` to verify out-of-scope rejection and help without sharing.

## Help requests and operator follow-up

`help` is an authenticated API action with a conversion ID and required boolean `share_statement`. The server resolves ownership and uses the existing private profile. It stores one idempotent request per visitor/conversion in `converter_help_requests`. Checking the optional sharing box is separate from requesting contact. Subsequent requests can revoke or update sharing; deleting/expiring a conversion revokes it. Browser users cannot insert requests directly or read another visitor's requests.

Requests are saved for manual follow-up in Supabase; this flow does not send email or create an external ticket. To review requests, use restricted operator SQL to join `converter_help_requests` to `converter_profiles` for name/email/practice and `conversions` for status/error. Do not fetch the file/rows unless **all** of these are true: `share_statement`, `statement_access_until > now()`, `conversions.expires_at > now()`, and state is `review` or `failed`. The user-requested purpose is help with that statement and workflow integration. No public URL, separate copy or extended retention is created.

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
