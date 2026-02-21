> ℹ️ This source code was built 100% with Codex.

# sehen-sah-gesehen

A German irregular verb trainer with FSRS scheduling.

## Core Features
- Trains `infinitive`, `praeteritum`, `partizip2`
- One hidden form (`?`) in table-style quiz
- Per-user scheduling unit: `(user_id, verb_id, target_form)`
- Auto recall grade by response speed:
  - `<= 3s` => `Easy`
  - `<= 8s` => `Good`
  - `> 8s` => `Hard`

## CLI App (TypeScript)
- Entry: `/Users/kang/Developer/sehen-sah-gesehen/src/index.ts`
- Build:
```bash
cd /Users/kang/Developer/sehen-sah-gesehen
npm install
npm run build
```
- Run:
```bash
npm start
```

## Databases (Local CLI)
- Lexicon: `/Users/kang/Developer/sehen-sah-gesehen/db/lexicon.sqlite`
- Learning: `/Users/kang/Developer/sehen-sah-gesehen/db/learning.sqlite`

## React Web App (Vercel + Supabase)
- Web files:
  - `/Users/kang/Developer/sehen-sah-gesehen/web/index.html`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/app.js`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/styles.css`
- Supabase SQL:
  - `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/schema.sql`
  - `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/seed_verbs.sql` (generated)
- Runtime deps loaded via CDN: `react`, `react-dom`, `htm`, `@supabase/supabase-js`, `ts-fsrs`
- Create `/Users/kang/Developer/sehen-sah-gesehen/web/config.js` from `/Users/kang/Developer/sehen-sah-gesehen/web/config.example.js` and set your Supabase values

### Supabase Setup
1. Run `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/schema.sql` in Supabase SQL editor.
2. Load verbs data by running `/Users/kang/Developer/sehen-sah-gesehen/web/supabase/seed_verbs.sql`.
3. In Supabase Auth, enable Google provider.
4. Add redirect URL:
   - `https://<your-vercel-domain>/`

### If You Provide Your Own SQLite DB (verbs seed) (verbs seed)
Generate seed SQL from your DB:
```bash
cd /Users/kang/Developer/sehen-sah-gesehen
./web/supabase/build_seed_sql.sh /absolute/path/to/your_lexicon.sqlite web/supabase/seed_verbs.sql
```
Then run the generated `seed_verbs.sql` in Supabase SQL editor.

### Deploy on Vercel
1. Import this repo in Vercel.
2. `vercel.json` already rewrites `/` to `/web/index.html`.
3. Deploy.
4. Set  with your Supabase URL/anon key, deploy, then sign in with Google.

## Supabase Table Design
- `public.verbs`: shared verb dictionary (provided by you)
- `public.user_cards`: per-user FSRS state per form
- `public.review_logs`: per-user review history
- `public.init_user_cards(uuid)`: initializes missing cards for the logged-in user

## Notes
- `db/learning.sqlite` is local runtime state for CLI mode.
- Web mode uses Supabase (shared service DB), not local SQLite.
