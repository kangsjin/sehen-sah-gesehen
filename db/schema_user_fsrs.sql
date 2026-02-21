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
  PRIMARY KEY (user_id, verb_id, target_form),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (verb_id) REFERENCES verbs(id) ON DELETE CASCADE
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
  difficulty REAL NOT NULL,
  target_form TEXT NOT NULL DEFAULT '',
  user_input TEXT NOT NULL DEFAULT '',
  answer_expected TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (verb_id) REFERENCES verbs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_cards_due ON user_cards(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs(user_id, reviewed_at DESC);
