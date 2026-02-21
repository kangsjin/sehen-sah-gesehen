import { LEARNING_DB_PATH, LEXICON_DB_PATH } from './config';
import { queryRows, runSql, sqlEscape, tableColumns } from './db';
import type { DbState, DueCard, PersistResult, UserSummary } from './types';
import { fsrsStateToDb, nextFsrsCard } from './fsrs-engine';

function formatSqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function parseDateOrNull(s: string): Date | undefined {
  if (!s) return undefined;
  const dt = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt;
}

export function ensureFsrsSchema(): void {
  runSql(
    LEARNING_DB_PATH,
    `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS user_metadata (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_cards (
      user_id TEXT NOT NULL,
      verb_id TEXT NOT NULL,
      target_form TEXT NOT NULL CHECK (target_form IN ('infinitive', 'praeteritum', 'partizip2')),
      due_at TEXT NOT NULL DEFAULT (datetime('now')),
      stability REAL NOT NULL DEFAULT 0.0,
      difficulty REAL NOT NULL DEFAULT 5.0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'new',
      last_review_at TEXT,
      next_interval_days REAL NOT NULL DEFAULT 0.0,
      total_reviews INTEGER NOT NULL DEFAULT 0,
      correct_reviews INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (user_id, verb_id, target_form)
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      verb_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      scheduled_days REAL NOT NULL,
      elapsed_days REAL NOT NULL,
      stability REAL NOT NULL,
      difficulty REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_cards_due ON user_cards(user_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs(user_id, reviewed_at DESC);
  `
  );

  const logCols = new Set(tableColumns(LEARNING_DB_PATH, 'review_logs'));
  if (!logCols.has('target_form')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN target_form TEXT DEFAULT '';`);
  if (!logCols.has('user_input')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN user_input TEXT DEFAULT '';`);
  if (!logCols.has('answer_expected')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN answer_expected TEXT DEFAULT '';`);
}

export function ensureUser(userId: string): void {
  const uid = sqlEscape(userId);

  runSql(
    LEARNING_DB_PATH,
    `
    INSERT OR IGNORE INTO users(user_id, created_at, last_login_at, metadata_json)
    VALUES (${uid}, datetime('now'), datetime('now'), '{}');
    UPDATE users SET last_login_at = datetime('now') WHERE user_id = ${uid};
  `
  );

  runSql(
    LEARNING_DB_PATH,
    `
    ATTACH DATABASE ${sqlEscape(LEXICON_DB_PATH)} AS lx;
    INSERT OR IGNORE INTO user_cards (
      user_id, verb_id, target_form, due_at, stability, difficulty, reps, lapses,
      state, last_review_at, next_interval_days, total_reviews, correct_reviews, metadata_json
    )
    SELECT ${uid}, v.id, f.target_form, datetime('now'), 0.0, 5.0, 0, 0,
           'new', NULL, 0.0, 0, 0, '{}'
    FROM lx.verbs v
    CROSS JOIN (
      SELECT 'infinitive' AS target_form
      UNION ALL SELECT 'praeteritum'
      UNION ALL SELECT 'partizip2'
    ) f;
    DETACH DATABASE lx;
  `
  );
}

export function listUsers(): UserSummary[] {
  const rows = queryRows(
    LEARNING_DB_PATH,
    `
    SELECT
      u.user_id,
      COALESCE(u.last_login_at, ''),
      COALESCE(a.known_count, 0),
      COALESCE(a.weak_count, 0),
      COALESCE(a.due_count, 0)
    FROM users u
    LEFT JOIN (
      SELECT
        user_id,
        SUM(
          CASE
            WHEN total_reviews >= 2 AND stability >= 7.0 AND state = 'review' THEN 1
            ELSE 0
          END
        ) AS known_count,
        SUM(
          CASE
            WHEN total_reviews > 0 AND (state = 'learning' OR lapses > correct_reviews) THEN 1
            ELSE 0
          END
        ) AS weak_count,
        SUM(
          CASE
            WHEN datetime(due_at) <= datetime('now') THEN 1
            ELSE 0
          END
        ) AS due_count
      FROM user_cards
      GROUP BY user_id
    ) a ON a.user_id = u.user_id
    ORDER BY datetime(u.last_login_at) DESC, u.user_id ASC;
  `
  );

  return rows
    .filter((r) => r[0])
    .map((r) => ({
      userId: r[0],
      lastLoginAt: r[1] || '',
      knownCount: Number(r[2] || 0),
      weakCount: Number(r[3] || 0),
      dueCount: Number(r[4] || 0),
    }));
}

export function loadDueCards(userId: string, limit: number): DueCard[] {
  const uid = sqlEscape(userId);
  const rows = queryRows(
    LEARNING_DB_PATH,
    `
    ATTACH DATABASE ${sqlEscape(LEXICON_DB_PATH)} AS lx;
    SELECT
      v.id,
      v.infinitive,
      v.praeteritum,
      v.partizip2,
      COALESCE(v.english_meaning, '[]'),
      uc.target_form,
      CASE uc.target_form
        WHEN 'infinitive' THEN v.infinitive
        WHEN 'praeteritum' THEN v.praeteritum
        WHEN 'partizip2' THEN v.partizip2
        ELSE ''
      END AS answer,
      uc.stability,
      uc.difficulty,
      uc.reps,
      uc.lapses,
      uc.state,
      COALESCE(uc.last_review_at, ''),
      COALESCE(uc.due_at, ''),
      COALESCE(uc.next_interval_days, 0)
    FROM user_cards uc
    JOIN lx.verbs v ON v.id = uc.verb_id
    WHERE uc.user_id = ${uid}
      AND datetime(uc.due_at) <= datetime('now')
      AND uc.target_form IN ('infinitive', 'praeteritum', 'partizip2')
    ORDER BY datetime(uc.due_at) ASC, RANDOM()
    LIMIT ${Math.max(1, limit)};
    DETACH DATABASE lx;
  `
  );

  return rows.map((r) => {
    let english: string[] = [];
    try {
      english = JSON.parse(r[4] || '[]') as string[];
    } catch {
      english = [];
    }

    return {
      verbId: r[0],
      infinitive: r[1],
      praeteritum: r[2],
      partizip2: r[3],
      english,
      targetForm: (r[5] as DueCard['targetForm']) || 'infinitive',
      answer: r[6],
      stability: Number(r[7] || 0),
      difficulty: Number(r[8] || 5),
      reps: Number(r[9] || 0),
      lapses: Number(r[10] || 0),
      state: (r[11] as DbState) || 'new',
      lastReviewAt: r[12] || '',
      dueAt: r[13] || '',
      nextIntervalDays: Number(r[14] || 0),
    };
  });
}

export function persistReview(userId: string, card: DueCard, userInput: string, grade: 1 | 2 | 3 | 4): PersistResult {
  const rating = grade;
  const correct = grade > 1 ? 1 : 0;
  const now = new Date();

  const next = nextFsrsCard({
    due: parseDateOrNull(card.dueAt) ?? now,
    stability: Number(card.stability || 0),
    difficulty: Number(card.difficulty || 5),
    reps: Number(card.reps || 0),
    lapses: Number(card.lapses || 0),
    dbState: card.state,
    lastReview: parseDateOrNull(card.lastReviewAt),
    nextIntervalDays: Number(card.nextIntervalDays || 0),
    now,
    grade,
  });

  const nextCard = next.card;
  const uid = sqlEscape(userId);
  const verbId = sqlEscape(card.verbId);
  const targetForm = sqlEscape(card.targetForm);
  const dueAt = sqlEscape(formatSqlDate(nextCard.due));
  const nowSql = sqlEscape(formatSqlDate(now));
  const state = sqlEscape(fsrsStateToDb(nextCard.state));

  runSql(
    LEARNING_DB_PATH,
    `
    UPDATE user_cards
    SET
      due_at = ${dueAt},
      stability = ${nextCard.stability},
      difficulty = ${nextCard.difficulty},
      reps = ${nextCard.reps},
      lapses = ${nextCard.lapses},
      state = ${state},
      last_review_at = ${nowSql},
      next_interval_days = ${nextCard.scheduled_days},
      total_reviews = total_reviews + 1,
      correct_reviews = correct_reviews + ${correct},
      metadata_json = json_set(
        COALESCE(metadata_json, '{}'),
        '$.last_input', ${sqlEscape(userInput)},
        '$.last_answer', ${sqlEscape(card.answer)}
      )
    WHERE user_id = ${uid} AND verb_id = ${verbId} AND target_form = ${targetForm};

    INSERT INTO review_logs(
      user_id, verb_id, rating, correct, reviewed_at,
      scheduled_days, elapsed_days, stability, difficulty,
      target_form, user_input, answer_expected
    ) VALUES (
      ${uid}, ${verbId}, ${rating}, ${correct}, ${nowSql},
      ${nextCard.scheduled_days}, ${next.logElapsedDays}, ${nextCard.stability}, ${nextCard.difficulty},
      ${targetForm}, ${sqlEscape(userInput)}, ${sqlEscape(card.answer)}
    );
  `
  );

  return {
    intervalDays: Number(nextCard.scheduled_days || 0),
  };
}
