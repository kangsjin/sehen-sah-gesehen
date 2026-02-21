import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { QUESTION_COUNT } from './config';
import type { DbState, DueCard } from './types';
import { ask, buildQuizTable, green, isCorrect, red } from './ui';
import { fsrsStateToDb, nextFsrsCard } from './fsrs-engine';
import { resolveSupabaseConfig } from './cli-config';

const sharedQuizLogic = require('../../shared/quiz-logic.js') as {
  gradeFromResponseTime: (seconds: number) => 2 | 3 | 4;
};

type TargetForm = 'infinitive' | 'praeteritum' | 'partizip2';

interface SupabaseCardRow {
  user_id: string;
  verb_id: string;
  target_form: TargetForm;
  due_at: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: DbState;
  last_review_at: string | null;
  next_interval_days: number;
  total_reviews: number;
  correct_reviews: number;
  verb: {
    id: string;
    infinitive: string;
    praeteritum: string;
    partizip2: string;
    english_meaning: string;
  };
}

function loadEnvFromDotLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseEnglishMeaning(raw: string): string[] {
  const txt = String(raw || '').trim();
  if (!txt) return [];

  if (txt.startsWith('[')) {
    try {
      const arr = JSON.parse(txt) as unknown;
      if (Array.isArray(arr)) return arr.map(String);
    } catch {
      // Ignore malformed JSON and fallback below.
    }
  }

  return txt.split(',').map((s) => s.trim()).filter(Boolean);
}

function dueRowToCard(row: SupabaseCardRow): DueCard {
  const english = parseEnglishMeaning(row.verb?.english_meaning || '');
  const answer = row.target_form === 'infinitive'
    ? row.verb.infinitive
    : row.target_form === 'praeteritum'
      ? row.verb.praeteritum
      : row.verb.partizip2;

  return {
    verbId: row.verb_id,
    infinitive: row.verb.infinitive,
    praeteritum: row.verb.praeteritum,
    partizip2: row.verb.partizip2,
    english,
    targetForm: row.target_form,
    answer,
    stability: Number(row.stability || 0),
    difficulty: Number(row.difficulty || 5),
    reps: Number(row.reps || 0),
    lapses: Number(row.lapses || 0),
    state: (row.state as DbState) || 'new',
    lastReviewAt: row.last_review_at || '',
    dueAt: row.due_at || new Date().toISOString(),
    nextIntervalDays: Number(row.next_interval_days || 0),
    totalReviews: Number(row.total_reviews || 0),
    correctReviews: Number(row.correct_reviews || 0),
  };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Ignore if opening browser fails.
  }
}

async function waitForOAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      const code = urlObj.searchParams.get('code');

      if (urlObj.pathname === '/auth/callback' && code) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<h3>Login complete. You can close this tab and return to terminal.</h3>');
        server.close();
        resolve(code);
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1');
  });
}

async function loginWithGoogle(supabase: SupabaseClient): Promise<string> {
  const port = 54321;
  const redirectTo = `http://127.0.0.1:${port}/auth/callback`;

  const codePromise = waitForOAuthCode(port);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    throw new Error(error?.message || 'Failed to start Google OAuth');
  }

  console.log('\nOpen this URL to login with Google:');
  console.log(data.url);
  console.log(`\nExpected callback: ${redirectTo}`);
  console.log('If login fails, add this callback URL in Supabase Authentication > URL Configuration > Redirect URLs.\n');

  openBrowser(data.url);

  const code = await codePromise;
  const { data: sessionData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr || !sessionData?.session?.user) {
    throw new Error(exchangeErr?.message || 'Failed to exchange OAuth code for session');
  }

  return sessionData.session.user.id;
}

async function ensureUserCards(supabase: SupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase.rpc('init_user_cards', { p_user_id: userId });
  if (error) throw new Error(`init_user_cards failed: ${error.message}`);
}

async function getLastSolvedLabel(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('review_logs')
    .select('reviewed_at')
    .eq('user_id', userId)
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load last solved time: ${error.message}`);
  if (!data?.reviewed_at) return 'Last solved: never';

  const dt = new Date(data.reviewed_at);
  if (Number.isNaN(dt.getTime())) return 'Last solved: unknown';

  const diffHours = Math.max(0, (Date.now() - dt.getTime()) / (1000 * 60 * 60));
  return `Last solved: ${dt.toLocaleString()} (${diffHours.toFixed(1)}h ago)`;
}

async function loadNextDueCard(
  supabase: SupabaseClient,
  userId: string,
  lastTargetForm: TargetForm | ''
): Promise<DueCard | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('user_cards')
    .select(
      `
      user_id,
      verb_id,
      target_form,
      due_at,
      stability,
      difficulty,
      reps,
      lapses,
      state,
      last_review_at,
      next_interval_days,
      total_reviews,
      correct_reviews,
      verb:verbs (
        id,
        infinitive,
        praeteritum,
        partizip2,
        english_meaning
      )
    `
    )
    .eq('user_id', userId)
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(500);

  if (error) throw new Error(`Failed to load due cards: ${error.message}`);
  if (!data || data.length === 0) return null;

  const rows = data as unknown as SupabaseCardRow[];
  const pool = lastTargetForm ? rows.filter((r) => r.target_form !== lastTargetForm) : rows;
  const candidates = pool.length > 0 ? pool : rows;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];

  return dueRowToCard(picked);
}

async function persistReview(
  supabase: SupabaseClient,
  userId: string,
  card: DueCard,
  input: string,
  grade: 1 | 2 | 3 | 4
): Promise<number> {
  const now = new Date();
  const next = nextFsrsCard({
    due: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    dbState: card.state,
    lastReview: card.lastReviewAt ? new Date(card.lastReviewAt) : undefined,
    nextIntervalDays: card.nextIntervalDays,
    now,
    grade,
  });

  const correct = grade > 1;

  const { error: updateErr } = await supabase
    .from('user_cards')
    .update({
      due_at: next.card.due.toISOString(),
      stability: next.card.stability,
      difficulty: next.card.difficulty,
      reps: next.card.reps,
      lapses: next.card.lapses,
      state: fsrsStateToDb(next.card.state),
      last_review_at: now.toISOString(),
      next_interval_days: next.card.scheduled_days,
      total_reviews: Number(card.totalReviews || 0) + 1,
      correct_reviews: Number(card.correctReviews || 0) + (correct ? 1 : 0),
      last_input: input,
      last_answer: card.answer,
    })
    .eq('user_id', userId)
    .eq('verb_id', card.verbId)
    .eq('target_form', card.targetForm);

  if (updateErr) throw new Error(`Failed to update review: ${updateErr.message}`);

  const { error: logErr } = await supabase.from('review_logs').insert({
    user_id: userId,
    verb_id: card.verbId,
    target_form: card.targetForm,
    client_source: 'cli',
    rating: grade,
    correct,
    reviewed_at: now.toISOString(),
    scheduled_days: next.card.scheduled_days,
    elapsed_days: next.logElapsedDays,
    stability: next.card.stability,
    difficulty: next.card.difficulty,
    user_input: input,
    answer_expected: card.answer,
  });

  if (logErr) throw new Error(`Failed to insert review log: ${logErr.message}`);
  return Number(next.card.scheduled_days || 0);
}

async function askYesNo(rl: readline.Interface, prompt: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const answer = (await ask(rl, `${prompt}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultYes;
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no') return false;
  return defaultYes;
}

async function run(): Promise<void> {
  loadEnvFromDotLocal();

  const { supabaseUrl, supabaseAnonKey } = await resolveSupabaseConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });

  const proceedLogin = await askYesNo(rl, 'Proceed with Google login?', true);
  if (!proceedLogin) {
    rl.close();
    console.log('Login cancelled.');
    return;
  }

  console.log('\nGoogle login is required for CLI.');
  const userId = await loginWithGoogle(supabase);

  await ensureUserCards(supabase, userId);
  const lastSolvedLabel = await getLastSolvedLabel(supabase, userId);

  console.log(`\nLogged in as ${userId}`);
  console.log(lastSolvedLabel);
  const startQuiz = await askYesNo(rl, 'Start quiz now?', true);
  if (!startQuiz) {
    rl.close();
    console.log('Quiz cancelled.');
    return;
  }

  console.log(`Up to ${QUESTION_COUNT} due questions will be asked.`);
  console.log("Type 'q' to quit.\n");

  let totalSolved = 0;
  let totalScore = 0;
  let keepGoing = true;

  while (keepGoing) {
    let solved = 0;
    let score = 0;
    let lastTargetForm: TargetForm | '' = '';
    let quitRequested = false;

    while (solved < QUESTION_COUNT) {
      const card = await loadNextDueCard(supabase, userId, lastTargetForm);
      if (!card) {
        if (solved === 0) console.log('No cards are due right now.');
        break;
      }

      lastTargetForm = card.targetForm;
      const prompt = [`[${solved + 1}/${QUESTION_COUNT}]`, buildQuizTable(card), '> '].join('\n');
      const startMs = Date.now();
      const input = await ask(rl, prompt);
      const elapsedSec = (Date.now() - startMs) / 1000;

      if (input.trim().toLowerCase() === 'q') {
        quitRequested = true;
        break;
      }

      const exact = isCorrect(input, card.answer);
      let grade: 1 | 2 | 3 | 4 = 1;
      if (exact) grade = sharedQuizLogic.gradeFromResponseTime(elapsedSec);

      const intervalDays = await persistReview(supabase, userId, card, input, grade);

      solved += 1;
      if (exact) {
        score += 1;
        const gradeLabel = grade === 4 ? 'Easy' : grade === 3 ? 'Good' : 'Hard';
        console.log(`${green('Correct')} [${gradeLabel}, ${elapsedSec.toFixed(1)}s] (next ~${intervalDays.toFixed(1)} days)\n`);
      } else {
        console.log(red(`Incorrect (answer: ${card.answer})`));
        console.log(`Next review: immediate to ~${intervalDays.toFixed(1)} days\n`);
      }
    }

    totalSolved += solved;
    totalScore += score;

    if (solved > 0) {
      console.log(`Round score: ${score}/${solved}`);
    }

    if (quitRequested) {
      keepGoing = false;
      break;
    }

    const more = await askYesNo(rl, 'Do another round?', false);
    if (!more) {
      keepGoing = false;
    }
  }

  rl.close();
  if (totalSolved > 0) {
    console.log(`Total score: ${totalScore}/${totalSolved}`);
  }
}

run().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
