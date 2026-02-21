# sehen-sah-gesehen

Simple German irregular verb trainer.

## What It Is
- Web app + CLI
- Google login (Supabase Auth)
- FSRS scheduling per form (`infinitive`, `praeteritum`, `partizip2`)

## Tech
- Supabase (Auth + Postgres)
- Vercel (web deployment)
- TypeScript (CLI)

## Web
- Entry: `web/index.html`
- Runtime config endpoint: `api/config.js`

## CLI
```bash
npm install
npm run build
npm start
```

## Supabase
Run SQL in order:
1. `web/supabase/schema.sql`
2. `web/supabase/seed_verbs.sql`

## Note
- Use `anon` key for client-side.
- Never expose `service_role` key.
