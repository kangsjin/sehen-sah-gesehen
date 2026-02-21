const { spawnSync } = require('child_process');
const readline = require('readline');
const path = require('path');

const LEXICON_DB_PATH = path.join(__dirname, 'lexicon.sqlite');
const LEARNING_DB_PATH = path.join(__dirname, 'learning.sqlite');
const QUESTION_COUNT = Number(process.argv[2] || 10);
const CARD_FORMS = ['infinitive', 'praeteritum', 'partizip2'];
const REQUEST_RETENTION = 0.9;
const FSRS45_W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const FSRS45_DECAY = -0.5;
const FSRS45_FACTOR = 19 / 81;

const COLOR = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

function sqlEscape(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runSql(dbPath, sql, opts = {}) {
  const args = opts.tabSeparated
    ? ['-separator', '\t', dbPath, sql]
    : [dbPath, sql];

  const res = spawnSync('sqlite3', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(res.stderr || 'sqlite3 command failed');
  }
  return res.stdout || '';
}

function queryRows(dbPath, sql) {
  const out = runSql(dbPath, sql, { tabSeparated: true }).trim();
  if (!out) return [];
  return out.split('\n').map((line) => line.split('\t'));
}

function canonical(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

function isCorrect(userInput, answer) {
  return canonical(userInput) === canonical(answer);
}

function green(text) {
  return `${COLOR.green}${text}${COLOR.reset}`;
}

function red(text) {
  return `${COLOR.red}${text}${COLOR.reset}`;
}

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function fit(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s.slice(0, width - 1) + '…';
  return s.padEnd(width, ' ');
}

function renderUsersTable(users) {
  const w = { no: 4, user: 18, last: 19, known: 7, weak: 7, due: 7 };
  const line = `+${'-'.repeat(w.no + 2)}+${'-'.repeat(w.user + 2)}+${'-'.repeat(w.last + 2)}+${'-'.repeat(w.known + 2)}+${'-'.repeat(w.weak + 2)}+${'-'.repeat(w.due + 2)}+`;
  const header = `| ${fit('No', w.no)} | ${fit('User ID', w.user)} | ${fit('Last Login', w.last)} | ${fit('Known', w.known)} | ${fit('Weak', w.weak)} | ${fit('Due', w.due)} |`;
  const rows = users.map((u, i) => {
    const last = u.lastLoginAt || '-';
    return `| ${fit(String(i + 1), w.no)} | ${fit(u.userId, w.user)} | ${fit(last, w.last)} | ${fit(String(u.knownCount), w.known)} | ${fit(String(u.weakCount), w.weak)} | ${fit(String(u.dueCount), w.due)} |`;
  });
  return [line, header, line, ...rows, line].join('\n');
}

function buildQuizTable(card) {
  const english = card.english.length ? card.english.join(', ') : '-';
  const row = {
    infinitive: card.infinitive,
    praeteritum: card.praeteritum,
    partizip2: card.partizip2,
    english,
  };
  row[card.targetForm] = '?';

  const w = {
    infinitive: 14,
    praeteritum: 14,
    partizip2: 14,
    english: 30,
  };

  const topBottom = `+${'-'.repeat(w.infinitive + 2)}+${'-'.repeat(w.praeteritum + 2)}+${'-'.repeat(w.partizip2 + 2)}+${'-'.repeat(w.english + 2)}+`;
  const header = `| ${fit('Infinitive', w.infinitive)} | ${fit('Praeteritum', w.praeteritum)} | ${fit('Partizip2', w.partizip2)} | ${fit('English', w.english)} |`;
  const body = `| ${fit(row.infinitive, w.infinitive)} | ${fit(row.praeteritum, w.praeteritum)} | ${fit(row.partizip2, w.partizip2)} | ${fit(row.english, w.english)} |`;

  return [topBottom, header, topBottom, body, topBottom].join('\n');
}

function formatSqlDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function parseDateOrNull(s) {
  if (!s) return null;
  const dt = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function daysBetween(a, b) {
  const ms = Math.max(0, a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fsrsD0(grade) {
  const w = FSRS45_W;
  return clamp(w[4] - (grade - 3) * w[5], 1, 10);
}

function fsrsDifficultyAfterReview(difficulty, grade) {
  const w = FSRS45_W;
  const dPrime = w[7] * fsrsD0(3) + (1 - w[7]) * (difficulty - w[6] * (grade - 3));
  return clamp(dPrime, 1, 10);
}

function fsrsRetrievability(elapsedDays, stability) {
  const s = Math.max(0.001, stability);
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + FSRS45_FACTOR * (t / s), FSRS45_DECAY);
}

function fsrsNextInterval(stability) {
  const s = Math.max(0.001, stability);
  const interval = (s / FSRS45_FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / FSRS45_DECAY) - 1);
  return Math.max(0, interval);
}

// FSRS-4.5 update
// grade: 1=Again, 2=Hard, 3=Good, 4=Easy
function fsrsUpdate(card, grade, elapsedDays) {
  const w = FSRS45_W;
  let stability = Number(card.stability || 0);
  let difficulty = Number(card.difficulty || 5);
  let lapses = Number(card.lapses || 0);

  if (stability <= 0 || Number(card.reps || 0) === 0) {
    const initStability = w[grade - 1];
    const initDifficulty = fsrsD0(grade);
    if (grade === 1) {
      return {
        stability: Math.max(0.001, initStability),
        difficulty: initDifficulty,
        lapses: lapses + 1,
        intervalDays: 0,
        state: 'learning',
      };
    }
    return {
      stability: Math.max(0.001, initStability),
      difficulty: initDifficulty,
      lapses,
      intervalDays: fsrsNextInterval(initStability),
      state: 'review',
    };
  }

  const r = fsrsRetrievability(elapsedDays, stability);
  const newDifficulty = fsrsDifficultyAfterReview(difficulty, grade);

  if (grade === 1) {
    const newStability = w[11]
      * Math.pow(newDifficulty, -w[12])
      * (Math.pow(stability + 1, w[13]) - 1)
      * Math.exp(w[14] * (1 - r));
    return {
      stability: Math.max(0.001, newStability),
      difficulty: newDifficulty,
      lapses: lapses + 1,
      intervalDays: 0,
      state: 'learning',
    };
  }

  const hardPenalty = grade === 2 ? w[15] : 1;
  const easyBonus = grade === 4 ? w[16] : 1;
  const newStability = stability * (
    Math.exp(w[8])
      * (11 - newDifficulty)
      * Math.pow(stability, -w[9])
      * (Math.exp(w[10] * (1 - r)) - 1)
      * hardPenalty
      * easyBonus
    + 1
  );

  return {
    stability: Math.max(0.001, newStability),
    difficulty: newDifficulty,
    lapses,
    intervalDays: fsrsNextInterval(newStability),
    state: 'review',
  };
}

function tableColumns(tableName) {
  return queryRows(LEARNING_DB_PATH, `PRAGMA table_info(${tableName});`).map((r) => r[1]);
}

function ensureFsrsSchema() {
  runSql(LEARNING_DB_PATH, `
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
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (verb_id) REFERENCES verbs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_cards_due ON user_cards(user_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs(user_id, reviewed_at DESC);
  `);

  const logCols = new Set(tableColumns('review_logs'));
  if (!logCols.has('target_form')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN target_form TEXT DEFAULT '';`);
  if (!logCols.has('user_input')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN user_input TEXT DEFAULT '';`);
  if (!logCols.has('answer_expected')) runSql(LEARNING_DB_PATH, `ALTER TABLE review_logs ADD COLUMN answer_expected TEXT DEFAULT '';`);
}

function ensureUser(userId) {
  const uid = sqlEscape(userId);

  runSql(LEARNING_DB_PATH, `
    INSERT OR IGNORE INTO users(user_id, created_at, last_login_at, metadata_json)
    VALUES (${uid}, datetime('now'), datetime('now'), '{}');
    UPDATE users SET last_login_at = datetime('now') WHERE user_id = ${uid};
  `);

  runSql(LEARNING_DB_PATH, `
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
  `);
}

function listUsers() {
  const rows = queryRows(LEARNING_DB_PATH, `
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
  `);
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

async function promptUserLogin(rl) {
  while (true) {
    const users = listUsers();
    console.log('\nLogin');
    if (users.length) {
      console.log(renderUsersTable(users));
      console.log('n) Create new user');
    } else {
      console.log('No existing users.');
      console.log('n) Create new user');
    }

    const pick = (await ask(rl, '> ')).trim();
    if (!pick) continue;

    if (pick.toLowerCase() === 'n') {
      const newId = (await ask(rl, 'New User ID: ')).trim();
      if (!/^[a-zA-Z0-9_-]{2,32}$/.test(newId)) {
        console.log('User ID must be 2-32 chars and contain only letters, numbers, _, or -.');
        continue;
      }
      return newId;
    }

    const idx = Number(pick);
    if (Number.isInteger(idx) && idx >= 1 && idx <= users.length) {
      return users[idx - 1].userId;
    }

    // direct ID login fallback
    if (/^[a-zA-Z0-9_-]{2,32}$/.test(pick)) {
      return pick;
    }

    console.log('Invalid selection. Enter a number or n.');
  }
}

function loadDueCards(userId, limit) {
  const uid = sqlEscape(userId);
  const rows = queryRows(LEARNING_DB_PATH, `
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
      COALESCE(uc.due_at, '')
    FROM user_cards uc
    JOIN lx.verbs v ON v.id = uc.verb_id
    WHERE uc.user_id = ${uid}
      AND datetime(uc.due_at) <= datetime('now')
      AND uc.target_form IN ('infinitive', 'praeteritum', 'partizip2')
    ORDER BY datetime(uc.due_at) ASC, RANDOM()
    LIMIT ${Math.max(1, limit)};
    DETACH DATABASE lx;
  `);

  return rows.map((r) => {
    let english = [];
    try {
      english = JSON.parse(r[4] || '[]');
    } catch {
      english = [];
    }

    return {
      verbId: r[0],
      infinitive: r[1],
      praeteritum: r[2],
      partizip2: r[3],
      english,
      targetForm: r[5],
      answer: r[6],
      stability: Number(r[7] || 0),
      difficulty: Number(r[8] || 5),
      reps: Number(r[9] || 0),
      lapses: Number(r[10] || 0),
      state: r[11] || 'new',
      lastReviewAt: r[12] || '',
      dueAt: r[13] || '',
    };
  });
}

function persistReview(userId, card, userInput, grade) {
  const rating = grade;
  const correct = grade > 1 ? 1 : 0;
  const now = new Date();
  const last = parseDateOrNull(card.lastReviewAt);
  const elapsedDays = last ? daysBetween(now, last) : 0;

  const next = fsrsUpdate(card, grade, elapsedDays);
  const dueDate = new Date(now.getTime() + next.intervalDays * 24 * 60 * 60 * 1000);

  const uid = sqlEscape(userId);
  const verbId = sqlEscape(card.verbId);
  const targetForm = sqlEscape(card.targetForm);
  const dueAt = sqlEscape(formatSqlDate(dueDate));
  const nowSql = sqlEscape(formatSqlDate(now));
  const state = sqlEscape(next.state);

  runSql(LEARNING_DB_PATH, `
    UPDATE user_cards
    SET
      due_at = ${dueAt},
      stability = ${next.stability},
      difficulty = ${next.difficulty},
      reps = reps + 1,
      lapses = ${next.lapses},
      state = ${state},
      last_review_at = ${nowSql},
      next_interval_days = ${next.intervalDays},
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
      ${next.intervalDays}, ${elapsedDays}, ${next.stability}, ${next.difficulty},
      ${targetForm}, ${sqlEscape(userInput)}, ${sqlEscape(card.answer)}
    );
  `);

  return next;
}

async function run() {
  ensureFsrsSchema();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const userId = await promptUserLogin(rl);

  ensureUser(userId);
  const cards = loadDueCards(userId, QUESTION_COUNT);

  if (!cards.length) {
    rl.close();
    console.log('No cards are due right now.');
    return;
  }

  console.log(`\nLogged in as ${userId}`);
  console.log(`${cards.length} questions due (FSRS per-form cards)`);
  console.log("Type 'q' to quit\n");

  let solved = 0;
  let score = 0;

  for (const card of cards) {
    const prompt = [
      `[${solved + 1}/${cards.length}]`,
      buildQuizTable(card),
      '> ',
    ].join('\n');

    const input = await ask(rl, prompt);
    if (input.trim().toLowerCase() === 'q') break;

    const exact = isCorrect(input, card.answer);
    let grade = 1;
    if (exact) {
      const g = (await ask(rl, 'Rate recall [h=hard, g=good, e=easy] (default g): ')).trim().toLowerCase();
      if (g === 'h') grade = 2;
      else if (g === 'e') grade = 4;
      else grade = 3;
    }
    const next = persistReview(userId, card, input, grade);

    solved += 1;
    if (grade > 1) {
      score += 1;
      console.log(`${green('Correct')} (next review in ~${next.intervalDays.toFixed(1)} days)\n`);
    } else {
      console.log(red(`Incorrect (answer: ${card.answer})`));
      console.log(`Next review: immediate to ~${next.intervalDays.toFixed(1)} days\n`);
    }
  }

  rl.close();
  console.log(`Score: ${score}/${solved || cards.length}`);
}

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
