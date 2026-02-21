# sehen-sah-gesehen

Simple German irregular verb trainer (Web + CLI) using Supabase.

## FSRS (Spaced Repetition)
- This project uses **FSRS** (Free Spaced Repetition Scheduler).
- FSRS is a modern spaced-repetition algorithm that predicts when you are likely to forget and schedules the next review at the right time.
- In this app, FSRS is applied per form:
  - `(user_id, verb_id, target_form)`
  - so `infinitive`, `praeteritum`, and `partizip2` are tracked independently.

### Why It Is Good
- More efficient than fixed intervals:
  - You review less often while keeping high retention.
- Personalized scheduling:
  - Intervals adapt to your actual recall quality.
- Better long-term memory:
  - Easy cards are delayed longer, weak cards return sooner.

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
