#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
deno task check
deno task test
npm --prefix landing-page run build
npm --prefix landing-page run test:browser
npm --prefix landing-page audit --audit-level=moderate
