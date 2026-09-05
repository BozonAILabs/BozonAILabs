---
version: 1
slug: "landing-page-tools-bank-statement-converter-html"
primary_target: "landing-page/tools/bank-statement-converter.html"
related_targets: ["landing-page/src/converter.ts","landing-page/src/converter.css","landing-page/src/converter-client.ts","landing-page/auth/callback.html"]
---

## Scope and mode
Operate: /tools/bank-statement-converter and OAuth callback. Existing Bozon identity is fixed.

## Job
UK accountants turn one PDF statement into editable transactions, check against the source, download Excel or Xero CSV, and optionally request workflow help.

## Structure
Concise introduction and gated workbench lead to a full-width source/table review. Desktop uses split panes; mobile switches source and rows. Keep body at 16–18px and controls at 16px. Financial data stays out of URLs and analytics.

## Constraints
50 lifetime pages; 20-page/10MB PDF; one active job; Google and Apple sign-in; practice profile; 24-hour access. No invented bank support or savings claims. Preview is disabled. Production unlock requires real-bank fixtures, both OAuth providers and verified backend. The reviewed implementation is a functional engine with a controlled launch, not live validation of all proposed banks.
