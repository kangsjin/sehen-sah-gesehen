import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1';
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { fsrs, generatorParameters, Rating, State } from 'https://esm.sh/ts-fsrs@5.2.3';

const html = htm.bind(React.createElement);
const srs = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false, enable_short_term: false }));

function canonical(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

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

function gradeBySeconds(sec) {
  if (sec <= 3) return 4;
  if (sec <= 8) return 3;
  return 2;
}

function gradeToRating(g) {
  if (g === 1) return Rating.Again;
  if (g === 2) return Rating.Hard;
  if (g === 3) return Rating.Good;
  return Rating.Easy;
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
    setStatus(data.session?.user ? `Logged in: ${data.session.user.email}` : 'Not logged in.');
    return client;
  }

  async function ensureUserCards(client, sessionUser) {
    const { error } = await client.rpc('init_user_cards', { p_user_id: sessionUser.id });
    if (error) throw error;
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
      .limit(30);

    if (error) throw error;

    let nextCard = null;
    if (data && data.length > 0) {
      nextCard = data[Math.floor(Math.random() * data.length)];
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
    setResult('No question loaded.');
    setStatus('Not logged in.');
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
      } else {
        setResult(`Incorrect (answer: ${expected})`);
      }

      await loadNextCard();
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
        await loadNextCard(client, data.session.user);
      } catch (e) {
        if (!cancelled) setStatus(`Init error: ${e.message || String(e)}`);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const resultClass = result.startsWith('Correct') ? 'ok' : result.startsWith('Incorrect') ? 'bad' : '';

  return html`
    <main className="terminal">
      <header className="terminal__header">
        <div className="dots"><span></span><span></span><span></span></div>
        <h1>sehen-sah-gesehen (React)</h1>
      </header>

      <section className="panel">
        <h2>Supabase Setup</h2>
        <p>Runtime config is loaded from <code>/api/config</code> (Vercel environment variables).</p>
        <div className="row">
          <button onClick=${handleGoogleLogin}>Sign in with Google</button>
          <button className="ghost" onClick=${handleLogout}>Sign out</button>
        </div>
        <pre>${status}</pre>
      </section>

      ${user
        ? html`<section className="panel">
            <div className="row row-space">
              <h2>Due Quiz</h2>
              <button onClick=${() => loadNextCard()}>Next</button>
            </div>
            <pre className="table">${tableText}</pre>
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
    </main>
  `;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
