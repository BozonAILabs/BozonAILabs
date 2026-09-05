# Bozon AI Labs

We are an AI SAAS business. The first businesses we want to serve are accountants.
We want to create a strategy for accountants to reach out to us to help them remove the manual inefficiencies of their businesses.

## Target Location

We are based in London and want to focus on the United Kingdom and Europe market.

---

# Supabase

- **Local Development** — Hosted locally on Docker. Run `supabase status` to get the current instance's API URL, keys, and DB connection string.
- **Supabase MCP** — Connects to the remote Supabase project. Read-only — use it to inspect production schema, not to apply changes.
- **Migrations** — Files in `supabase/migrations/` are automatically applied when pushing to GitHub.
- **Edge Functions** — Files in `supabase/functions/` are automatically deployed when pushing to GitHub. Run locally with `supabase functions serve`.
- **Vercel and Supabase integration** - Supabase keeps environment variables up to date in each connected Vercel project.

```bash
# Examples
ssh supabase.sh ls /supabase/docs/guides/          # list sections first to pick a scope
ssh supabase.sh grep -rl 'auth' /supabase/docs/
ssh supabase.sh cat /supabase/docs/guides/auth/passwords.md
ssh supabase.sh find /supabase/docs/guides/database -name '*.md'
```
