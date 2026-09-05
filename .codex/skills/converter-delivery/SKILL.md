---
name: converter-delivery
description: Implement, extend, configure and verify Bozon AI Labs' bank statement converter and its reusable document-processing engine. Use for converter functionality, extraction, exports, deployment readiness or a new tool sharing this engine; not for unrelated marketing-page edits.
---

# Deliver a working converter

The outcome is an accountant entering their details, submitting a real in-scope PDF, reviewing extracted transactions and downloading a usable file. A landing page, mocked review, passing isolated tests or disabled feature flag does not fulfill an implementation request.

Resolve paths from this repository root, not the skill directory. Read `docs/bank-statement-converter.md` for setup and current limits. Use the existing Supabase skill for product documentation and the Postgres skill before database changes.

## User flow and boundaries

- Public route: `/tools/bank-statement-converter`. The gate collects name, email and practice name; it creates a Supabase anonymous session on submission. No Google/Apple sign-in, password, role question or email confirmation.
- Email is self-reported contact information. Never use it to look up or restore another session's files. Distinct sessions entering the same email must remain isolated by `auth.uid()`.
- Preserve sessions across reloads. Ending the session or clearing browser data loses result access. The 50-page allowance belongs to the private browser identity and can be reset by clearing it; do not describe it as an enforced lifetime-per-person limit.
- Contact details do not constitute a sales follow-up request. Workflow contact uses an explicit mailto CTA without a follow-up checkbox.
- Upload one PDF, one account/statement, English GBP current-account scope. Enforce 10 MB, 20 pages, 50 free pages per private browser identity and one active conversion server-side. Accept unfamiliar bank names; the document scope is one English GBP current-account statement, not a bank-name allowlist.
- Show progress, resume recent jobs, then display the source beside editable dates, descriptions and signed amounts. Preserve original extraction and page references.
- Save corrections with a revision check. Downloads include current visible edits without requiring a save, and never overwrite saved corrections. Allow Excel and Xero CSV whenever rows exist, including incomplete extraction and interim checkpoints; split large CSVs. Show incomplete-extraction details as bullet points naming the row, page and missing fields where known. Do not invent locations when the provider only reports general incompleteness. Never show balance/date-range/duplicate diagnostics or a review checkbox. Preserve blanks and all rows. Label partial and in-progress downloads honestly.
- Sign-out clears financial UI state. Deletion and 24-hour expiry remove access immediately; scheduled cleanup handles active storage. Do not promise removal from provider systems or backups without evidence.

## Architecture to preserve

Vercel serves the Vite frontend. Supabase owns Auth, private Storage, Postgres, pgmq, Cron and Edge Functions. No Vercel statement-processing backend.

- `landing-page/src/converter.ts`: interface, review, exports and session races.
- `landing-page/src/converter-client.ts`: authenticated API calls and availability.
- `supabase/functions/converter-api/index.ts`: authenticate, validate/upload, read/edit/export/delete.
- `supabase/functions/converter-worker/index.ts`: private PDF download, actual Mistral extraction, checkpoint.
- `supabase/functions/_shared/extraction.ts`: six owned pages plus adjacent context; page ownership prevents boundary duplicates.
- `supabase/functions/_shared/statement.ts`: versioned canonical statement, integer pence, validation and export checks. `shared/statement.ts` re-exports it for clients.
- `supabase/functions/_shared/runtime.ts`: ownership checks and prompt worker dispatch.
- `supabase/migrations/`: quotas, leases, idempotent charging, private content, queue, expiry, cleanup and Cron.

Upload must enqueue atomically and wake the worker. Successful partial checkpoints wake the next chunk. Cron provides recovery if a request is interrupted; `waitUntil` is not a durable queue. Local Edge runtime must use `policy = "per_worker"` for background dispatch.

Send private PDF bytes to OCR as an inline document. An external provider cannot fetch a Docker-local signed Storage URL. Keep the provider key and worker token in Edge secrets, never frontend variables, logs or source control.

For another use case, consume the canonical statement through ownership-checked APIs. Reuse ingestion, extraction, quota accounting, retries and retention. Keep use-case-specific comparisons or missing-record logic separate from extraction. Do not make speculative new tools part of a narrow converter fix.

## Delivery workflow

1. Inspect branch, PR and actual runtime state. Preserve the requested branch/PR scope. Distinguish local, preview and production.
2. Check public Auth settings, capability response, public environment-variable names, migrations, function secrets and Cron configuration. Inspect names/status without printing credentials. Anonymous sign-ins must be enabled in the target Supabase project; do not reconfigure social providers or other projects.
3. Implement a complete usable slice. Avoid accumulating hidden launch flags or treating broad real-bank certification as a reason to deliver only a trailer. Narrow the supported scope and describe test evidence honestly.
4. Run `./scripts/check.sh` and relevant DB/API invariant tests from the runbook. Ordinary browser tests mock APIs; they verify interface behavior, not extraction.
5. With the configured local stack and an actual Mistral key, generate a synthetic PDF using `deno run --allow-write=.local scripts/create-converter-fixture.ts --boundary` and run `node landing-page/scripts/live-converter.mjs`. This opt-in test incurs OCR usage. It starts in a fresh browser at the contact form and traverses real anonymous Auth, API, Storage, queue, worker and provider without injecting successful checkpoints. Verify downloaded workbook cells/CSV, saved corrections, reload persistence, mobile fit and deletion.
6. Run the local API isolation suite with two real anonymous identities submitting the same email. The second identity must not read the first identity's content or Storage objects. Validate missing/invalid contact data before uploads and reject unauthenticated API calls.
7. Enable anonymous sign-ins in Bozon's hosted Auth settings if not already enabled. The production GitHub integration does not sync general Auth settings by default. Keep Google/Apple disabled unless the user changes the product requirement.
8. Inspect browser output at desktop and mobile sizes and open the usable route in the in-app browser. Confirm the source PDF and actual downloads, not only button visibility.
9. Update the runbook, commit and push within the user's authorized scope. Report what works, the evidence, PR/deployment state and any specific remaining configuration. Do not equate a Git push with successful deployment of both independent platforms.

## Important configuration traps

- Supabase's Vercel integration may expose `NEXT_PUBLIC_` names. This Vite project explicitly maps only the public URL, publishable key and legacy anon key. Never expose the entire environment or service-role keys.
- Use isolated backend credentials for previews. A hardcoded rule disabling every preview prevents verification; explicit environment configuration is the boundary.
- `VITE_CONVERTER_ENABLED=false` is an emergency off switch, not a default requirement for manually launching every environment.
- `LOCAL_MANUAL_WORKER` is a localhost-only test control. Manual worker mode is for API invariant tests that inject checkpoints; disable it for real full-flow verification.
- Synthetic successful extraction is evidence of a functioning pipeline, not proof of accuracy across every real bank layout. Record the scope and evidence separately.

## Partial results and help

- Unknown bank names are accepted. Never reintroduce an allowlist as an accuracy substitute. Keep single-account, English-language, single-currency GBP scope. Original foreign purchase amounts are not the booked GBP debit/credit.
- `extraction.complete`, unreadable pages and uncertain pages are immutable source-quality metadata. Partial results remain downloadable in both formats; accounting diagnostics never block export. Preserve usable rows; never fabricate missing transactions. Show completed checkpoint rows even if later processing fails. Zero rows have no download. Processing rows are read-only and downloads say extraction is still in progress.
- The interface uses one Contact us mailto CTA for workflow integration. Do not reintroduce sharing or follow-up checkboxes. The legacy help API and historical consent records remain subject to ownership, expiry and deletion restrictions; no file is attached by the CTA.
- Repeated requests update consent idempotently. Deletion and expiry revoke sharing. Failed PDFs keep the existing 24-hour expiry so the visitor can request help; no extra retention/copy is created.
- Operator access requires current sharing consent, a live request access window, a live conversion expiry and non-deleted/non-expired state. Follow the runbook; do not treat a historical consent flag alone as access permission.
- Run the complete, partial and unsupported live scenarios plus API tests for download ownership, checkpoint snapshots, visible edits, expiry and deletion. Preserve legacy consent isolation/revocation tests.
