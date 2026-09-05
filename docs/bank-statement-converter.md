# Bank statement converter

Vite on Vercel is the client. Supabase Auth, private Storage, Postgres, pgmq, Cron and Edge Functions are the backend. No Vercel API or worker handles statements.

## Run locally

1. `supabase start` at the repository root. Local API/DB use ports 56321/56322 to avoid other projects. If Docker address pools are exhausted, create a non-overlapping dedicated network and pass `--network-id <name>` to **every** Supabase start/reset command.
2. Copy `landing-page/.env.example` to `.env.local` in that directory and use the local publishable key from `supabase status`. Never use production credentials in previews or local development.
3. Copy `supabase/functions/.env.example` to `.env.local`. Set the Mistral key and a random worker token. `supabase functions serve --env-file supabase/functions/.env.local`.
4. Configure local Google and Apple providers and callbacks. The UI checks that both providers are enabled before showing sign-in. A local API test harness may enable `ALLOW_LOCAL_TEST_AUTH=true`; it is additionally constrained to the local API host.
5. `cd landing-page && npm ci && npm run dev`.
6. `./scripts/check.sh` (13 engine and 6 browser tests), `python3 scripts/test-local-api.py` with the documented local-only test auth flag, `cat supabase/tests/converter.sql | docker exec -i supabase_db_BozonAILabs psql -U postgres -d postgres`.

To exercise Mistral without real statements, set MISTRAL_API_KEY only in the process environment and run `deno run --allow-env --allow-net=api.mistral.ai scripts/smoke-ocr.ts --boundary`. This is an opt-in billed provider smoke with synthetic PDFs; the ordinary test suite never calls Mistral. The live single-page and two-chunk continuation checks passed during implementation. Do not mark a bank validated based on synthetic data.

## Contract and lifecycle

`supabase/functions/_shared/statement.ts` owns the versioned integer-pence statement format and checks. `shared/statement.ts` re-exports it to browser/tests. Statement summaries and transaction arrays are the inputs for future completeness/comparison tools. Those tools are not built here.

`converter-api` actions: capabilities; account; profile; followup; create; upload (PDF body with id query); get; source; edit (id, revision, statement); export (id, revision, format, acknowledged); delete. User identity is obtained from Auth, never request body. All JSON responses and PDFs are no-store. Browser Storage access is denied. Edits preserve account metadata and original source-page references; original extraction remains separate from corrections.

Create claims the user's single active slot. Upload is claimed once, bounded and parsed server-side; finalise hashes the file, reuses an unexpired result where possible, reserves pages under a user advisory lock and enqueues atomically. An unexpired duplicate requires at least one remaining page to initiate upload, but does not charge pages again. Existing results remain downloadable at zero allowance. Each worker request consumes one queue chunk, with 180-second visibility and three attempts per chunk. Six owned pages with preceding and following context keep requests at most eight pages and allow wrapped descriptions to cross page boundaries. Original page references determine ownership; no transaction is silently deduplicated. Conflicting metadata and incomplete extraction fail for review by the team rather than fabricate output.

Checkpointing checks a lease token, job state and expiry under the same user lock. Completion charges once; failures/deletion release only unconsumed reservations. Queues contain job IDs only. No financial content goes in operational logs/events. Mistral raw annotations, normalised original and current corrections live in `conversion_content`, guarded by the parent expiry. The browser clears loaded content at expiry/sign-out; copies already downloaded cannot be revoked.

The worker first clears expired/abandoned/failed payloads and removes their Storage objects. Tombstones are swept repeatedly for 48 hours to cover upload/delete races; cleanup runs in bounded batches ordered by oldest check to prevent starvation. Unfinished uploads expire after 15 minutes. The database closes access at expiry even if a cleanup invocation fails. The sweep also finds Storage objects without a conversion row after 15 minutes, including Auth-account deletion orphans. Account deletion remains a restricted operator workflow, not a browser endpoint.

## Deployment and release gates

This PR adds a **disabled** tool. Merging deploys code/migrations through the existing integrations, not an automatically approved public launch. Nothing in this branch modifies production or OAuth credentials.

1. In Supabase's Vercel integration set public prefix to `VITE_`, retain Production-only sync. Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) are present. Never expose a secret/service role key. `VERCEL_ENV=preview` forces the UI disabled even if frontend environment variables accidentally exist.
2. Provision `MISTRAL_API_KEY` from the user's protected key file as a Supabase Edge secret (never commit it), plus a random `CONVERTER_WORKER_TOKEN` and exact comma-separated `ALLOWED_ORIGINS`.
3. Configure Google and Apple in Supabase Auth. Register `https://<project>.supabase.co/auth/v1/callback` with providers, set site URL and allow the site's `/auth/callback`. Apple web OAuth requires a Services ID and secret rotation every six months. Test cancellation, missing names and relay emails.
4. In restricted SQL console create Vault secrets `converter_worker_url` (full converter-worker function URL) and `converter_worker_token` (same token as Edge secret). The pre-installed minute Cron schedule is inert without them. Verify the worker is callable only with this token and observe a completed job.
5. Validate real, consented/redacted formats for each bank. Set `converter_settings.validated_banks` to **only passing banks**, then `enabled=true`. Empty bank allowlist prevents uploads. Both provider configuration checks and backend capability/version checks must pass.
6. Set `VITE_CONVERTER_ENABLED=true` in production and redeploy **after** backend migration/functions/cron tests. Keep previews disabled until isolated Supabase preview branches are enabled.
7. Verify the migration version, deployed functions, runtime secret names (not values), final Vercel commit and smoke-test the live route before calling launch complete. Deployments are independent, not atomic. Future DB/API changes must remain backwards compatible; disable the flag for rollback, do not drop tables with in-flight jobs.

Operators can grant extra pages from restricted SQL: `select public.converter_grant('<user uuid>', 20, 'Workflow review completed');`. This function is not executable by browsers or service-role workers; record the authenticated operator separately if using a shared SQL login. Lead review joins profiles/Auth emails to follow-up requests and minimal usage events, never financial content.

## Evidence required before launch

The repository tests cover synthetic transactions, malformed PDFs, arithmetic and access/lifecycle invariants. They **do not certify support for any bank**. Obtain redacted/consented digital and scanned examples for Barclays, HSBC, Lloyds, NatWest and Monzo. Include multipage tables, wrap/continuation at pages 6/7 and 12/13, ambiguous dates, missing pages, repeated rows and negative balances. Have an independent expected ledger and require exact dates/amounts/no missing or extra transactions for export-ready fixtures. Damaged fixtures must fail or report issues. Record bank format/version, fixture consent, expected ledger, model version, checks and result in a restricted fixture register; never commit real financial files.

Verify Mistral account processing terms/retention/region and Supabase backup retention before launch. The UI promises access expiry and active-storage cleanup, not immediate deletion from all backups/provider systems. OAuth credentials and real-bank fixtures must be supplied/configured outside the PR. No automated sales outreach exists.

## References

- https://supabase.com/docs/guides/deployment/branching/github-integration
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/auth/social-login/auth-apple
- https://docs.mistral.ai/studio/document-processing/annotations
- https://docs.mistral.ai/models/ocr-4-0
