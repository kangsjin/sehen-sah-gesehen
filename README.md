# sehen-sah-gesehen

A console-based German irregular verb trainer with per-form FSRS scheduling.

## What It Does
- Trains German verb forms: `infinitive`, `praeteritum`, `partizip2`
- Uses a table-style quiz in terminal
- Tracks progress per user
- Schedules reviews with `ts-fsrs`
- Stores lexicon and learning data in separate SQLite files

## Project Structure
- `src/index.ts`: app entrypoint
- `src/repository.ts`: DB schema, queries, persistence
- `src/fsrs-engine.ts`: `ts-fsrs` integration
- `src/ui.ts`: CLI prompts and table rendering
- `src/db.ts`: sqlite3 command wrapper
- `src/types.ts`: shared types
- `db/lexicon.sqlite`: verb dictionary data
- `db/learning.sqlite`: user/login/review/scheduling data
- `db/schema_user_fsrs.sql`: schema reference/migration SQL

## Requirements
- Node.js 18+
- `sqlite3` CLI installed and available in PATH

## Install
```bash
cd /Users/kang/Developer/sehen-sah-gesehen
npm install
```

## Run
Build TypeScript:
```bash
npm run build
```

Start app:
```bash
npm start
```

Optional question count:
```bash
node dist/index.js 20
```

## Login Flow
On startup:
- Existing users are shown in a table (`Last Login`, `Known`, `Weak`, `Due`)
- Choose by number, or
- Press `n` to create a new user

## Quiz Flow
- One form is hidden with `?` in a row:
  - `Infinitive`
  - `Praeteritum`
  - `Partizip2`
- Enter answer and press Enter
- If correct, recall quality is auto-graded by response time:
  - `<= 3s` = `Easy`
  - `<= 8s` = `Good`
  - `> 8s` = `Hard`
- If incorrect, correct answer is shown in red
- Type `q` during quiz to quit

## FSRS Notes
- Scheduler: `ts-fsrs`
- Unit of scheduling: `(user_id, verb_id, target_form)`
- So each verb has 3 independent cards per user

## Database Overview
`db/learning.sqlite` main tables:
- `users`
- `user_metadata`
- `user_cards`
- `review_logs`

`db/lexicon.sqlite` main tables:
- `verbs`
- `sources`
- `verb_sources`

## Development
Build only:
```bash
npm run build
```

Run build + app:
```bash
npm run dev
```

## Notes
- `node_modules/` and `dist/` are git-ignored.
- `db/learning.sqlite` is user state and can be reset without touching lexicon data.
