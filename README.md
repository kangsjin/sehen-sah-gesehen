> ℹ️ This source code was built 100% with Codex.

# sehen-sah-gesehen

A German irregular verb trainer with FSRS scheduling (CLI + Web both use Supabase).

## Core Features
- Trains `infinitive`, `praeteritum`, `partizip2`
- One hidden form (`?`) in table-style quiz
- Per-user scheduling unit: `(user_id, verb_id, target_form)`
- Auto recall grade by response speed:
  - `<= 3s` => `Easy`
  - `<= 8s` => `Good`
  - `> 8s` => `Hard`

## CLI App (TypeScript, Supabase)
- Entry: `/Users/kang/Developer/sehen-sah-gesehen/src/index.ts`
- Uses Google OAuth login and Supabase (`user_cards`, `review_logs`)
- No local config file is required for end users
- CLI loads Supabase runtime config from: `https://sehen-sah-gesehen.vercel.app/api/config`
- Optional override with env vars:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `APP_CONFIG_URL` (custom config endpoint)

Run:
```bash
cd /Users/kang/Developer/sehen-sah-gesehen
npm install
npm run build
npm start
```

For CLI Google login callback, add this redirect URL in Supabase:
- `http://127.0.0.1:54321/auth/callback`

## React Web App (Vercel + Supabase)
- Web files:
  - `/Users/kang/Developer/sehen-sah-gesehen/web/index.html`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/app.js`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/styles.css`
- Runtime config endpoint:
  - `/Users/kang/Developer/sehen-sah-gesehen/api/config.js`
- Supabase SQL:
  - `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/schema.sql`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/seed_verbs.sql` (generated)
- Runtime deps loaded via CDN: `react`, `react-dom`, `htm`, `@supabase/supabase-js`, `ts-fsrs`
- Shared quiz logic (used by both CLI and Web): `/Users/kang/Developer/sehen-sah-gesehen/web/shared/quiz-logic.js`

### Vercel Environment Variables
Set these in Vercel project settings:
- `SUPABASE_URL` = `https://<your-project>.supabase.co`
- `SUPABASE_ANON_KEY` = Supabase `anon public` key

The app loads them at runtime from `/api/config`.

### Supabase Setup
1. Run `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/schema.sql` in Supabase SQL editor.
2. Load verbs data by running `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/seed_verbs.sql`.
3. In Supabase Auth, enable Google provider.
4. In Supabase `Authentication -> URL Configuration`, add:
   - `https://<your-vercel-domain>/`
   - `http://localhost:4173`

### If You Provide Your Own SQLite DB (verbs seed)
Generate seed SQL from your DB:
```bash
cd /Users/kang/Developer/sehen-sah-gesehen
./web/supabase/build_seed_sql.sh /absolute/path/to/your_lexicon.sqlite web/supabase/seed_verbs.sql
```
Then run the generated `seed_verbs.sql` in Supabase SQL editor.

### Deploy on Vercel
1. Import this repo in Vercel.
2. `vercel.json` already rewrites `/` to `/web/index.html`.
3. Set Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
4. Deploy.
5. Open app and sign in with Google.

## Supabase Table Design
- `public.verbs`: shared verb dictionary (provided by you)
- `public.user_cards`: per-user FSRS state per form
- `public.review_logs`: per-user review history
  - includes `client_source` (`web` or `cli`)
- `public.init_user_cards(uuid)`: initializes missing cards for the logged-in user

## Notes
- CLI and Web both use Supabase (shared service DB).
- `db/learning.sqlite` remains only as legacy local artifact.
