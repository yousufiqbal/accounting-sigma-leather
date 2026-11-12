# Sigma Accounts

Single-admin accounting panel for Sigma Leather. Design and rules: see [SPEC.md](SPEC.md).

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it:
   - `DATABASE_URL` / `DATABASE_AUTH_TOKEN` — from Turso (`turso db show <db> --url`, `turso db tokens create <db>`). `file:local.db` works for local dev.
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (plain text, min 10 chars) — your login.
   - `npm run gen-secrets` → paste the two printed lines (`SESSION_SECRET`, `CRON_SECRET`).
   - `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `POSTEX_TOKEN`.
3. `npm run db:push` — creates tables.
4. `npm run dev` → http://localhost:5173 → sign in → **Settings** shows live connection checks.

## Scripts

| Command               | What                            |
| --------------------- | ------------------------------- |
| `npm run dev`         | Dev server                      |
| `npm run check`       | Type check                      |
| `npm run db:push`     | Apply schema to the database    |
| `npm run db:studio`   | Browse the database             |
| `npm run gen-secrets` | Generate session + cron secrets |

## Conventions

- Money is integer **paisa** everywhere (`#lib/money.ts`).
- Months are `YYYY-MM` in Asia/Karachi (`#lib/month.ts`); the global month lives in the `?m=` query param.
- UI: shadcn-svelte components only; status colors are tokens in `src/routes/layout.css` (`success`, `danger`, `warning`, `info`, `excluded`).

## Deploy (Vercel)

1. Push this repo to GitHub, then in Vercel: **Add New → Project → import the repo**. Framework is detected (SvelteKit, `adapter-vercel`).
2. **Settings → Environment Variables**: add every key from your local `.env`
   (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`,
   `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`, `POSTEX_TOKEN`). Never commit `.env`.
3. Deploy. Crons in `vercel.json` run daily (UTC): Shopify orders → products → stock check at 20:30 (01:30 PKT),
   PostEx sync at 21:00 (02:00 PKT). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
4. Check **Settings** page in the deployed app: Turso, Shopify and PostEx should all be green.

Sync-heavy routes set `maxDuration: 300`. The database is the same Turso database used locally.
