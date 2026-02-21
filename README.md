# sehen-sah-gesehen

Simple German irregular verb trainer (Web + CLI) using Supabase.

## Structure
- `web/`: web app UI
- `cli/src/`: CLI app source (TypeScript)
- `shared/`: logic shared by web and CLI
- `api/config.js`: runtime config endpoint for web app
- `web/supabase/`: schema and seed SQL

## Shared Logic
- `shared/quiz-logic.js`
  - answer normalization
  - response-time grading (`Easy/Good/Hard`)

## Web
- Entry: `web/index.html`
- Deploy on Vercel
- Uses Supabase via `api/config.js`

## CLI
```bash
npm install
npm run build
npm start
```

Optional question count:
```bash
node dist/cli/index.js 20
```

## Supabase Setup
Run in SQL editor:
1. `web/supabase/schema.sql`
2. `web/supabase/seed_verbs.sql`

Auth setup:
- Enable Google provider
- Add redirect URLs:
  - `https://<your-vercel-domain>/`
  - `http://127.0.0.1:54321/auth/callback`

## Security
- `anon` key is safe for client usage
- never expose `service_role` key
