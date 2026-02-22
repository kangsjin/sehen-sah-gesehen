import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { fsrs, generatorParameters, Rating, State } from 'https://esm.sh/ts-fsrs@5.2.3';

const html = htm.bind(React.createElement);
const srs = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, enable_short_term: false }));
const canonical = window.SehenShared?.canonicalizeAnswer || ((s) => String(s || '').trim().toLowerCase());
const gradeBySeconds = window.SehenShared?.gradeFromResponseTime || ((sec) => (sec <= 3 ? 4 : sec <= 8 ? 3 : 2));

function dbStateToFsrs(s) {
  if (s === 'learning') return State.Learning;
  if (s === 'review') return State.Review;
  if (s === 'relearning') return State.Relearning;
  return State.New;
}

function fsrsStateToDb(s) {
  if (s === State.Learning) return 'learning';
  if (s === State.Review) return 'review';
  if (s === State.Relearning) return 'relearning';
  return 'new';
}

function gradeToRating(g) {
  if (g === 1) return Rating.Again;
  if (g === 2) return Rating.Hard;
  if (g === 3) return Rating.Good;
  return Rating.Easy;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration errors on unsupported browsers.
  }
}

function makeTable(card) {
  if (!card || !card.verb) return 'No due cards right now.';

  const row = {
    infinitive: card.verb.infinitive,
    praeteritum: card.verb.praeteritum,
    partizip2: card.verb.partizip2,
    english: card.verb.english_meaning || '',
  };

  row[card.target_form] = '?';

  const f = (x, w) => {
    const text = String(x || '');
    return text.length > w ? `${text.slice(0, w - 1)}…` : text.padEnd(w, ' ');
  };

  const w = { a: 14, b: 14, c: 14, d: 30 };
  const line = `+${'-'.repeat(w.a + 2)}+${'-'.repeat(w.b + 2)}+${'-'.repeat(w.c + 2)}+${'-'.repeat(w.d + 2)}+`;

  return [
    line,
    `| ${f('Infinitive', w.a)} | ${f('Praeteritum', w.b)} | ${f('Partizip2', w.c)} | ${f('English', w.d)} |`,
    line,
    `| ${f(row.infinitive, w.a)} | ${f(row.praeteritum, w.b)} | ${f(row.partizip2, w.c)} | ${f(row.english, w.d)} |`,
    line,
  ].join('\n');
}

function getQuizValue(card, form) {
  if (!card || !card.verb) return '';
  if (card.target_form === form) return '?';
  return card.verb[form] || '';
}

function formatLastSolvedLabel(reviewedAtIso) {
  if (!reviewedAtIso) return 'Last solved: never';
  const reviewedAt = new Date(reviewedAtIso);
  if (Number.isNaN(reviewedAt.getTime())) return 'Last solved: unknown';

  const nowMs = Date.now();
  const diffHours = Math.max(0, (nowMs - reviewedAt.getTime()) / (1000 * 60 * 60));
  return `Last solved: ${reviewedAt.toLocaleString()} (${diffHours.toFixed(1)}h ago)`;
}

const LEARN_FORMS = ['infinitive', 'praeteritum', 'partizip2'];

async function fetchRuntimeConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to load runtime config from /api/config');
  }

  const cfg = await res.json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('Invalid runtime config from /api/config');
  }

  return cfg;
}

function App() {
  const [supabase, setSupabase] = useState(null);
  const [runtimeConfig, setRuntimeConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('Initializing...');
  const [result, setResult] = useState('No question loaded.');
  const [answer, setAnswer] = useState('');
  const [card, setCard] = useState(null);
  const [shownAt, setShownAt] = useState(0);
  const [lastTargetForm, setLastTargetForm] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [hasLearningStarted, setHasLearningStarted] = useState(false);
  const [lastSolvedLabel, setLastSolvedLabel] = useState('Last solved: never');
  const [learnVerb, setLearnVerb] = useState(null);
  const [lastLearnVerbId, setLastLearnVerbId] = useState('');
  const [learnReveal, setLearnReveal] = useState(true);
  const [learnCountdown, setLearnCountdown] = useState(3);
  const [learnFormIndex, setLearnFormIndex] = useState(0);
  const [learnRepIndex, setLearnRepIndex] = useState(0);
  const [learnInput, setLearnInput] = useState('');
  const [learnAttemptShownAt, setLearnAttemptShownAt] = useState(0);
  const [learnCorrectCount, setLearnCorrectCount] = useState(0);
  const [learnDone, setLearnDone] = useState(false);
  const [learnCardMeta, setLearnCardMeta] = useState({});
  const [learnResult, setLearnResult] = useState('');
  const [overview, setOverview] = useState({
    totalCards: 0,
    dueCards: 0,
    knownCards: 0,
    weakCards: 0,
    accuracy: 0,
  });
  const [overviewWords, setOverviewWords] = useState({ known: [], weak: [] });
  const [activeOverviewList, setActiveOverviewList] = useState('');

  const tableText = useMemo(() => makeTable(card), [card]);

  async function buildClient(cfg = runtimeConfig) {
    let nextCfg = cfg;
    if (!nextCfg) {
      nextCfg = await fetchRuntimeConfig();
      setRuntimeConfig(nextCfg);
    }

    const client = createClient(nextCfg.supabaseUrl, nextCfg.supabaseAnonKey);
    const { data, error } = await client.auth.getSession();
    if (error) {
      setStatus(`Init error: ${error.message}`);
      return null;
    }

    setSupabase(client);
    setUser(data.session?.user || null);
    setHasStarted(false);
    setStatus(data.session?.user ? `Logged in: ${data.session.user.email}` : 'Not logged in.');
    return client;
  }

  async function ensureUserCards(client, sessionUser) {
    const [{ error: quizErr }, { error: learnErr }] = await Promise.all([
      client.rpc('init_user_cards', { p_user_id: sessionUser.id }),
      client.rpc('init_user_learning_cards', { p_user_id: sessionUser.id }),
    ]);
    if (quizErr) throw quizErr;
    if (learnErr) {
      throw new Error(`init_user_learning_cards failed. Apply latest schema.sql. (${learnErr.message})`);
    }
  }

  async function refreshOverview(client = supabase, sessionUser = user) {
    if (!client || !sessionUser) return;

    const nowIso = new Date().toISOString();
    const [{ count: totalCount, error: totalErr }, { count: dueCount, error: dueErr }, { data: perfRows, error: perfErr }] =
      await Promise.all([
        client.from('user_cards').select('*', { count: 'exact', head: true }).eq('user_id', sessionUser.id),
        client.from('user_cards').select('*', { count: 'exact', head: true }).eq('user_id', sessionUser.id).lte('due_at', nowIso),
        client
          .from('user_cards')
          .select('verb_id,target_form,total_reviews,correct_reviews,verb:verbs(infinitive,praeteritum,partizip2,english_meaning)')
          .eq('user_id', sessionUser.id),
      ]);

    if (totalErr || dueErr || perfErr) {
      throw totalErr || dueErr || perfErr;
    }

    let knownCards = 0;
    let weakCards = 0;
    let totalReviews = 0;
    let correctReviews = 0;
    const knownForms = [];
    const weakForms = [];

    for (const row of perfRows || []) {
      const reviews = Number(row.total_reviews || 0);
      const correct = Number(row.correct_reviews || 0);
      const rate = reviews > 0 ? correct / reviews : 0;

      totalReviews += reviews;
      correctReviews += correct;

      if (reviews >= 3 && rate >= 0.85) {
        knownCards += 1;
        if (row.verb_id && row.verb?.infinitive && row.target_form) {
          const formValue = row.target_form === 'infinitive'
            ? row.verb.infinitive
            : row.target_form === 'praeteritum'
              ? (row.verb.praeteritum || '')
              : (row.verb.partizip2 || '');
          knownForms.push({
            id: `${row.verb_id}:${row.target_form}`,
            infinitive: row.verb.infinitive,
            english: row.verb.english_meaning || '',
            targetForm: row.target_form,
            formValue,
          });
        }
      }
      if (reviews >= 3 && rate < 0.6) {
        weakCards += 1;
        if (row.verb_id && row.verb?.infinitive && row.target_form) {
          const formValue = row.target_form === 'infinitive'
            ? row.verb.infinitive
            : row.target_form === 'praeteritum'
              ? (row.verb.praeteritum || '')
              : (row.verb.partizip2 || '');
          weakForms.push({
            id: `${row.verb_id}:${row.target_form}`,
            infinitive: row.verb.infinitive,
            english: row.verb.english_meaning || '',
            targetForm: row.target_form,
            formValue,
          });
        }
      }
    }

    const accuracy = totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 0;
    const sortByCard = (a, b) => {
      const byInf = a.infinitive.localeCompare(b.infinitive);
      if (byInf !== 0) return byInf;
      return a.targetForm.localeCompare(b.targetForm);
    };
    setOverview({
      totalCards: Number(totalCount || 0),
      dueCards: Number(dueCount || 0),
      knownCards,
      weakCards,
      accuracy,
    });
    setOverviewWords({
      known: knownForms.sort(sortByCard),
      weak: weakForms.sort(sortByCard),
    });
  }

  async function refreshLastSolved(client = supabase, sessionUser = user) {
    if (!client || !sessionUser) return;

    const [{ data: quizData, error: quizErr }, { data: learnData, error: learnErr }] = await Promise.all([
      client
        .from('review_logs')
        .select('reviewed_at')
        .eq('user_id', sessionUser.id)
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('learning_review_logs')
        .select('reviewed_at')
        .eq('user_id', sessionUser.id)
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (quizErr) throw quizErr;
    if (learnErr) throw learnErr;

    const quizTs = quizData?.reviewed_at || '';
    const learnTs = learnData?.reviewed_at || '';
    const latestTs = quizTs && learnTs ? (quizTs > learnTs ? quizTs : learnTs) : (quizTs || learnTs || '');

    setLastSolvedLabel(formatLastSolvedLabel(latestTs));
  }

  async function loadNextCard(client = supabase, sessionUser = user) {
    if (!client || !sessionUser) return;

    const nowIso = new Date().toISOString();
    const { data, error } = await client
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
            english_meaning,
            korean_meaning,
            verb_level
          )
        `
      )
      .eq('user_id', sessionUser.id)
      .lte('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(500);

    if (error) throw error;

    let nextCard = null;
    if (data && data.length > 0) {
      const differentFormPool = lastTargetForm
        ? data.filter((row) => row.target_form !== lastTargetForm)
        : data;
      const pool = differentFormPool.length > 0 ? differentFormPool : data;
      nextCard = pool[Math.floor(Math.random() * pool.length)];
      setLastTargetForm(nextCard.target_form || '');
    }

    setCard(nextCard);
    setAnswer('');
    setShownAt(Date.now());
    setResult(nextCard ? 'Type answer and submit.' : '');
  }

  async function handleGoogleLogin() {
    try {
      const client = supabase || (await buildClient());
      if (!client) return;

      const redirectTo = `${window.location.origin}/`;
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) setStatus(`Login error: ${error.message}`);
    } catch (e) {
      setStatus(`Login error: ${e.message || String(e)}`);
    }
  }

  async function handleLogout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setCard(null);
    setHasStarted(false);
    setHasLearningStarted(false);
    setLastSolvedLabel('Last solved: never');
    setLearnVerb(null);
    setLearnFormIndex(0);
    setLearnRepIndex(0);
    setLearnInput('');
    setLearnAttemptShownAt(0);
    setLearnCorrectCount(0);
    setLearnDone(false);
    setLearnCardMeta({});
    setLearnResult('');
    setLearnReveal(true);
    setLearnCountdown(3);
    setOverview({ totalCards: 0, dueCards: 0, knownCards: 0, weakCards: 0, accuracy: 0 });
    setOverviewWords({ known: [], weak: [] });
    setActiveOverviewList('');
    setResult('No question loaded.');
    setStatus('Not logged in.');
  }

  async function handleStartQuiz() {
    if (!supabase || !user) return;
    await loadNextCard();
    setHasStarted(true);
    setHasLearningStarted(false);
    setLearnVerb(null);
    setLearnResult('');
    setLearnDone(false);
    setLearnAttemptShownAt(0);
    setLearnCardMeta({});
  }

  async function loadNextLearnVerb(client = supabase) {
    if (!client || !user) return;

    const nowIso = new Date().toISOString();
    const cardSelect = `
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
      correct_reviews
    `;

    const { data: dueRows, error: dueErr } = await client
      .from('user_learning_cards')
      .select(
        `
          ${cardSelect},
          verb:verbs (
            id,
            infinitive,
            praeteritum,
            partizip2,
            english_meaning
          )
        `
      )
      .eq('user_id', user.id)
      .lte('due_at', nowIso)
      .order('due_at', { ascending: true })
      .limit(800);

    if (dueErr) throw dueErr;

    let picked = null;
    let pickedFromDue = false;

    if (dueRows && dueRows.length > 0) {
      const byVerb = new Map();
      for (const row of dueRows) {
        if (!row.verb || !row.verb.id) continue;
        const key = row.verb.id;
        if (!byVerb.has(key)) byVerb.set(key, { verb: row.verb, rows: [] });
        byVerb.get(key).rows.push(row);
      }

      let candidates = Array.from(byVerb.values());
      if (lastLearnVerbId) {
        const filtered = candidates.filter((c) => c.verb.id !== lastLearnVerbId);
        if (filtered.length > 0) candidates = filtered;
      }

      candidates.sort((a, b) => {
        const aDueForms = a.rows.length;
        const bDueForms = b.rows.length;
        if (aDueForms !== bDueForms) return bDueForms - aDueForms;
        const aDueAt = a.rows[0]?.due_at || '';
        const bDueAt = b.rows[0]?.due_at || '';
        return aDueAt.localeCompare(bDueAt);
      });

      const top = candidates.slice(0, Math.min(12, candidates.length));
      if (top.length > 0) {
        picked = top[Math.floor(Math.random() * top.length)].verb;
        pickedFromDue = true;
      }
    }

    if (!picked) {
      const { data: verbs, error: verbsErr } = await client
        .from('verbs')
        .select('id, infinitive, praeteritum, partizip2, english_meaning')
        .limit(400);

      if (verbsErr) throw verbsErr;
      if (!verbs || verbs.length === 0) {
        setLearnVerb(null);
        setLearnResult('No verbs available for learning.');
        return;
      }

      const pool = lastLearnVerbId ? verbs.filter((v) => v.id !== lastLearnVerbId) : verbs;
      const candidates = pool.length > 0 ? pool : verbs;
      picked = candidates[Math.floor(Math.random() * candidates.length)];
    }

    const { data: cardRows, error: cardErr } = await client
      .from('user_learning_cards')
      .select(cardSelect)
      .eq('user_id', user.id)
      .eq('verb_id', picked.id);

    if (cardErr) throw cardErr;
    const meta = {};
    for (const row of cardRows || []) {
      meta[row.target_form] = row;
    }

    setLastLearnVerbId(picked.id || '');
    setLearnVerb(picked);
    setLearnFormIndex(0);
    setLearnRepIndex(0);
    setLearnInput('');
    setLearnAttemptShownAt(0);
    setLearnCorrectCount(0);
    setLearnDone(false);
    setLearnCardMeta(meta);
    setLearnResult(pickedFromDue ? 'Loaded due review word.' : '');
    setLearnReveal(true);
    setLearnCountdown(3);
  }

  async function handleStartLearning() {
    if (!supabase || !user) return;
    await loadNextLearnVerb(supabase);
    setHasLearningStarted(true);
    setHasStarted(false);
  }

  function handleExitQuiz() {
    setHasStarted(false);
    setCard(null);
    setAnswer('');
    setResult('No question loaded.');
  }

  function handleExitLearning() {
    setHasLearningStarted(false);
    setLearnVerb(null);
    setLearnFormIndex(0);
    setLearnRepIndex(0);
    setLearnInput('');
    setLearnAttemptShownAt(0);
    setLearnCorrectCount(0);
    setLearnDone(false);
    setLearnCardMeta({});
    setLearnResult('');
    setLearnReveal(true);
    setLearnCountdown(3);
  }

  function handleLearnSubmit() {
    if (!learnVerb || learnReveal || learnDone) return;

    const form = LEARN_FORMS[learnFormIndex];
    const expected = learnVerb[form] || '';
    const input = learnInput;
    const cardMeta = learnCardMeta[form];
    if (!cardMeta) {
      setLearnResult(`Missing card state for ${form}.`);
      return;
    }

    (async () => {
      try {
        const now = new Date();
        const sec = learnAttemptShownAt > 0 ? (Date.now() - learnAttemptShownAt) / 1000 : 0;
        const correct = canonical(input) === canonical(expected);
        let grade = 1;
        if (correct) grade = gradeBySeconds(sec);

        const fsrsCard = {
          due: cardMeta.due_at ? new Date(cardMeta.due_at) : now,
          stability: Number(cardMeta.stability || 0),
          difficulty: Number(cardMeta.difficulty || 5),
          elapsed_days: 0,
          scheduled_days: Math.max(0, Math.round(Number(cardMeta.next_interval_days || 0))),
          learning_steps: 0,
          reps: Number(cardMeta.reps || 0),
          lapses: Number(cardMeta.lapses || 0),
          state: dbStateToFsrs(cardMeta.state),
          last_review: cardMeta.last_review_at ? new Date(cardMeta.last_review_at) : undefined,
        };

        const next = srs.next(fsrsCard, now, gradeToRating(grade));

        const { error: upErr } = await supabase
          .from('user_learning_cards')
          .update({
            due_at: next.card.due.toISOString(),
            stability: next.card.stability,
            difficulty: next.card.difficulty,
            reps: next.card.reps,
            lapses: next.card.lapses,
            state: fsrsStateToDb(next.card.state),
            last_review_at: now.toISOString(),
            next_interval_days: next.card.scheduled_days,
            total_reviews: Number(cardMeta.total_reviews || 0) + 1,
            correct_reviews: Number(cardMeta.correct_reviews || 0) + (correct ? 1 : 0),
            last_input: input,
            last_answer: expected,
          })
          .eq('user_id', user.id)
          .eq('verb_id', learnVerb.id)
          .eq('target_form', form);

        if (upErr) throw upErr;

        const { error: logErr } = await supabase.from('learning_review_logs').insert({
          user_id: user.id,
          verb_id: learnVerb.id,
          target_form: form,
          client_source: 'web_learning',
          rating: grade,
          correct,
          reviewed_at: now.toISOString(),
          scheduled_days: next.card.scheduled_days,
          elapsed_days: next.log.elapsed_days,
          stability: next.card.stability,
          difficulty: next.card.difficulty,
          user_input: input,
          answer_expected: expected,
        });
        if (logErr) throw logErr;

        setLearnCardMeta((prev) => ({
          ...prev,
          [form]: {
            ...prev[form],
            due_at: next.card.due.toISOString(),
            stability: next.card.stability,
            difficulty: next.card.difficulty,
            reps: next.card.reps,
            lapses: next.card.lapses,
            state: fsrsStateToDb(next.card.state),
            last_review_at: now.toISOString(),
            next_interval_days: next.card.scheduled_days,
            total_reviews: Number(cardMeta.total_reviews || 0) + 1,
            correct_reviews: Number(cardMeta.correct_reviews || 0) + (correct ? 1 : 0),
          },
        }));

        const nextCorrectCount = learnCorrectCount + (correct ? 1 : 0);
        if (correct) setLearnCorrectCount(nextCorrectCount);

        const gradeLabel = grade === 4 ? 'Easy' : grade === 3 ? 'Good' : grade === 2 ? 'Hard' : 'Again';
        setLearnResult(`${correct ? 'Correct' : 'Incorrect'} [${gradeLabel}, ${sec.toFixed(1)}s]`);

        const nextRep = learnRepIndex + 1;
        if (nextRep < 3) {
          setLearnRepIndex(nextRep);
          setLearnInput('');
          setLearnAttemptShownAt(Date.now());
          await refreshOverview();
          await refreshLastSolved();
          return;
        }

        const nextForm = learnFormIndex + 1;
        if (nextForm < LEARN_FORMS.length) {
          setLearnFormIndex(nextForm);
          setLearnRepIndex(0);
          setLearnInput('');
          setLearnReveal(true);
          setLearnCountdown(3);
          setLearnAttemptShownAt(0);
          await refreshOverview();
          await refreshLastSolved();
          return;
        }

        setLearnDone(true);
        if (nextCorrectCount === 9) {
          setLearnResult('Perfect: 9/9');
          vibrate(80);
        } else {
          setLearnResult(`Score: ${nextCorrectCount}/9`);
          vibrate([80, 60, 80]);
        }
        await refreshOverview();
        await refreshLastSolved();
      } catch (e) {
        setLearnResult(`Error: ${e.message || String(e)}`);
      }
    })();
  }

  async function handleSubmit() {
    if (!supabase || !user || !card || !card.verb) return;

    try {
      const input = answer;
      const expected = card.verb[card.target_form];
      const correct = canonical(input) === canonical(expected);

      let grade = 1;
      const sec = (Date.now() - shownAt) / 1000;
      if (correct) grade = gradeBySeconds(sec);

      const now = new Date();
      const fsrsCard = {
        due: new Date(card.due_at),
        stability: Number(card.stability || 0),
        difficulty: Number(card.difficulty || 5),
        elapsed_days: 0,
        scheduled_days: Math.max(0, Math.round(Number(card.next_interval_days || 0))),
        learning_steps: 0,
        reps: Number(card.reps || 0),
        lapses: Number(card.lapses || 0),
        state: dbStateToFsrs(card.state),
        last_review: card.last_review_at ? new Date(card.last_review_at) : undefined,
      };

      const next = srs.next(fsrsCard, now, gradeToRating(grade));

      const { error: upErr } = await supabase
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
          total_reviews: Number(card.total_reviews || 0) + 1,
          correct_reviews: Number(card.correct_reviews || 0) + (correct ? 1 : 0),
          last_input: input,
          last_answer: expected,
        })
        .eq('user_id', user.id)
        .eq('verb_id', card.verb_id)
        .eq('target_form', card.target_form);

      if (upErr) throw upErr;

      const { error: logErr } = await supabase.from('review_logs').insert({
        user_id: user.id,
        verb_id: card.verb_id,
        target_form: card.target_form,
        client_source: 'web',
        rating: grade,
        correct,
        reviewed_at: now.toISOString(),
        scheduled_days: next.card.scheduled_days,
        elapsed_days: next.log.elapsed_days,
        stability: next.card.stability,
        difficulty: next.card.difficulty,
        user_input: input,
        answer_expected: expected,
      });

      if (logErr) throw logErr;

      if (correct) {
        const label = grade === 4 ? 'Easy' : grade === 3 ? 'Good' : 'Hard';
        setResult(`Correct [${label}, ${sec.toFixed(1)}s]\nNext review in ~${next.card.scheduled_days} days`);
        vibrate(50);
        await delay(2000);
      } else {
        setResult(`Incorrect (answer: ${expected})`);
        vibrate(180);
        await delay(3000);
      }

      await loadNextCard();
      await refreshOverview();
      await refreshLastSolved();
    } catch (e) {
      setResult(`Error: ${e.message || String(e)}`);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const cfg = await fetchRuntimeConfig();
        if (cancelled) return;
        setRuntimeConfig(cfg);

        const client = await buildClient(cfg);
        if (!client || cancelled) return;

        const { data } = await client.auth.getSession();
        if (!data.session?.user || cancelled) return;

        await ensureUserCards(client, data.session.user);
        await refreshOverview(client, data.session.user);
        await refreshLastSolved(client, data.session.user);
      } catch (e) {
        if (!cancelled) setStatus(`Init error: ${e.message || String(e)}`);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLearningStarted || !learnVerb || !learnReveal) return;
    if (learnCountdown <= 0) {
      setLearnReveal(false);
      setLearnAttemptShownAt(Date.now());
      return;
    }

    const timer = setTimeout(() => {
      setLearnCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [hasLearningStarted, learnVerb, learnReveal, learnCountdown]);

  const resultClass = result.startsWith('Correct') ? 'ok' : result.startsWith('Incorrect') ? 'bad' : '';
  const learnResultClass = learnResult.startsWith('Perfect') ? 'ok' : learnResult.startsWith('Score') ? 'bad' : '';
  const currentLearnForm = LEARN_FORMS[learnFormIndex] || LEARN_FORMS[0];
  const currentLearnValue = learnVerb && currentLearnForm ? (learnVerb[currentLearnForm] || '') : '';

  function renderLearningContent() {
    if (!learnVerb) {
      return html`<pre>No learning verb loaded.</pre>`;
    }

    if (learnDone) {
      return html`<div className="learn-card">
        <div className="learn-row">
          <span className="learn-label">English</span>
          <span className="learn-value">${learnVerb.english_meaning || '-'}</span>
        </div>
        <div className="learn-inputs">
          <pre className=${learnResultClass}>${learnResult}</pre>
          <div className="row">
            <button onClick=${() => loadNextLearnVerb()}>Next Word</button>
          </div>
        </div>
      </div>`;
    }

    if (learnReveal) {
      return html`<div className="learn-card">
        <div className="learn-row">
          <span className="learn-label">English</span>
          <span className="learn-value">${learnVerb.english_meaning || '-'}</span>
        </div>
        <div>
          <div className="learn-countdown">Memorize ${currentLearnForm}: ${learnCountdown}</div>
          <div className="learn-row">
            <span className="learn-label">${currentLearnForm}</span>
            <span className="learn-value">${currentLearnValue}</span>
          </div>
        </div>
      </div>`;
    }

    return html`<div className="learn-card">
      <div className="learn-row">
        <span className="learn-label">English</span>
        <span className="learn-value">${learnVerb.english_meaning || '-'}</span>
      </div>
      <div className="learn-inputs">
        <div className="learn-form-label">${currentLearnForm} (${learnRepIndex + 1}/3)</div>
        <input
          value=${learnInput}
          onChange=${(e) => setLearnInput(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === 'Enter') handleLearnSubmit();
          }}
          placeholder=${`Type ${currentLearnForm}`}
        />
        <div className="row">
          <button onClick=${handleLearnSubmit}>Submit</button>
          <button className="ghost" onClick=${() => loadNextLearnVerb()}>Next Word</button>
        </div>
        <pre>Write from memory, 3 times per form.</pre>
      </div>
    </div>`;
  }

  function renderOverviewWordList() {
    if (!activeOverviewList) return null;
    const words = activeOverviewList === 'known' ? overviewWords.known : overviewWords.weak;
    const title = activeOverviewList === 'known' ? 'Known words' : 'Weak words';

    return html`<div className="overview-list">
      <div className="overview-list-title">${title} (${words.length})</div>
      ${words.length === 0
        ? html`<pre>No words yet.</pre>`
        : html`<div className="overview-list-items">
            ${words.map((w) => html`<div className="overview-word" key=${w.id}>
              <span className="overview-word-main">${w.formValue || '-'}</span>
              <span className="overview-word-sub">${w.targetForm || '-'} of ${w.infinitive}</span>
              <span className="overview-word-sub">${w.english || '-'}</span>
            </div>`)}
          </div>`}
    </div>`;
  }

  return html`
    <main className="terminal">
      <header className="terminal__header">
        <div className="dots"><span></span><span></span><span></span></div>
        <h1>sehen-sah-gesehen</h1>
      </header>

      <section className="panel">
        ${user
          ? html`<div className="row row-space">
              <div>
                <div className="status-line">${status}</div>
                <div className="status-line">${lastSolvedLabel}</div>
              </div>
              <button className="ghost" onClick=${handleLogout}>Sign out</button>
            </div>`
          : html`<div>
              <div className="row">
                <button onClick=${handleGoogleLogin}>Sign in with Google</button>
              </div>
              <pre>${status}</pre>
            </div>`}
      </section>

      ${user && !hasStarted
        && !hasLearningStarted
        ? html`<section className="panel">
            <div className="row row-space">
              <h2>Overview</h2>
              <button className="ghost" onClick=${() => refreshOverview()}>Refresh</button>
            </div>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">${overview.totalCards}</div></div>
              <div className="stat-card"><div className="stat-label">Due</div><div className="stat-value">${overview.dueCards}</div></div>
              <button
                className=${`stat-card stat-card--button ${activeOverviewList === 'known' ? 'stat-card--active' : ''}`}
                onClick=${() => setActiveOverviewList((prev) => (prev === 'known' ? '' : 'known'))}
              >
                <div className="stat-label">Known</div>
                <div className="stat-value">${overview.knownCards}</div>
              </button>
              <button
                className=${`stat-card stat-card--button ${activeOverviewList === 'weak' ? 'stat-card--active' : ''}`}
                onClick=${() => setActiveOverviewList((prev) => (prev === 'weak' ? '' : 'weak'))}
              >
                <div className="stat-label">Weak</div>
                <div className="stat-value">${overview.weakCards}</div>
              </button>
              <div className="stat-card"><div className="stat-label">Accuracy</div><div className="stat-value">${overview.accuracy}%</div></div>
            </div>
            ${renderOverviewWordList()}
            <div className="row">
              <button onClick=${handleStartQuiz}>Start Quiz</button>
              <button className="ghost" onClick=${handleStartLearning}>Start Learning</button>
            </div>
          </section>`
        : null}

      ${user && hasStarted
        ? html`<section className="panel">
            <div className="row row-space">
              <h2>Due Quiz</h2>
              <div className="row">
                <button onClick=${() => loadNextCard()}>Next</button>
                <button className="ghost" onClick=${handleExitQuiz}>Exit Quiz</button>
              </div>
            </div>
            <pre className="table">${tableText}</pre>
            <div className="quiz-mobile">
              <div className="m-row">
                <span className="m-label">Infinitive</span>
                <span className="m-value">${getQuizValue(card, 'infinitive')}</span>
              </div>
              <div className="m-row">
                <span className="m-label">Praeteritum</span>
                <span className="m-value">${getQuizValue(card, 'praeteritum')}</span>
              </div>
              <div className="m-row">
                <span className="m-label">Partizip2</span>
                <span className="m-value">${getQuizValue(card, 'partizip2')}</span>
              </div>
              <div className="m-row">
                <span className="m-label">English</span>
                <span className="m-value">${card?.verb?.english_meaning || ''}</span>
              </div>
            </div>
            <div className="row">
              <input
                value=${answer}
                onChange=${(e) => setAnswer(e.target.value)}
                onKeyDown=${(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
                type="text"
                placeholder="type answer..."
              />
              <button onClick=${handleSubmit}>Submit</button>
            </div>
            <pre className=${resultClass}>${result}</pre>
          </section>`
        : null}

      ${user && hasLearningStarted
        ? html`<section className="panel">
            <div className="row row-space">
              <h2>Learning</h2>
              <button className="ghost" onClick=${handleExitLearning}>Exit Learning</button>
            </div>
            ${renderLearningContent()}
          </section>`
        : null}
    </main>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
