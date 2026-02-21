#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <path-to-lexicon.sqlite> [output-sql-path]"
  exit 1
fi

DB_PATH="$1"
OUT_PATH="${2:-web/supabase/seed_verbs.sql}"

if [ ! -f "$DB_PATH" ]; then
  echo "SQLite DB not found: $DB_PATH"
  exit 1
fi

mkdir -p "$(dirname "$OUT_PATH")"

{
  echo "-- Generated from $DB_PATH on $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "begin;"
  echo "truncate table public.verbs;"

  sqlite3 "$DB_PATH" <<'SQL'
.mode list
.separator ""
select
  'insert into public.verbs (id, infinitive, praeteritum, partizip2, english_meaning, korean_meaning, verb_level) values (' ||
  quote(id) || ', ' ||
  quote(coalesce(infinitive, '')) || ', ' ||
  quote(coalesce(praeteritum, '')) || ', ' ||
  quote(coalesce(partizip2, '')) || ', ' ||
  quote(trim(replace(replace(replace(coalesce(english_meaning, ''), '[', ''), ']', ''), '"', ''))) || ', ' ||
  quote(coalesce(korean_meaning, '')) || ', ' ||
  quote(coalesce(verb_level, '')) ||
  ');'
from verbs
where coalesce(id, '') <> '';
SQL

  echo "commit;"
} > "$OUT_PATH"

echo "Wrote: $OUT_PATH"
