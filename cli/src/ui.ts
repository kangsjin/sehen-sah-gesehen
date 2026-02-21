import type readline from 'node:readline';
import type { DueCard, UserSummary } from './types';
const sharedQuizLogic = require('../../shared/quiz-logic.js') as {
  canonicalizeAnswer: (input: string) => string;
};

const COLOR = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
};

export function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function fit(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width - 1) + '…';
  return str.padEnd(width, ' ');
}

export function green(text: string): string {
  return `${COLOR.green}${text}${COLOR.reset}`;
}

export function red(text: string): string {
  return `${COLOR.red}${text}${COLOR.reset}`;
}

export function canonical(input: string): string {
  return sharedQuizLogic.canonicalizeAnswer(input);
}

export function isCorrect(userInput: string, answer: string): boolean {
  return canonical(userInput) === canonical(answer);
}

export function renderUsersTable(users: UserSummary[]): string {
  const w = { no: 4, user: 18, last: 19, known: 7, weak: 7, due: 7 };
  const line = `+${'-'.repeat(w.no + 2)}+${'-'.repeat(w.user + 2)}+${'-'.repeat(w.last + 2)}+${'-'.repeat(w.known + 2)}+${'-'.repeat(w.weak + 2)}+${'-'.repeat(w.due + 2)}+`;
  const header = `| ${fit('No', w.no)} | ${fit('User ID', w.user)} | ${fit('Last Login', w.last)} | ${fit('Known', w.known)} | ${fit('Weak', w.weak)} | ${fit('Due', w.due)} |`;
  const rows = users.map((u, i) => {
    const last = u.lastLoginAt || '-';
    return `| ${fit(String(i + 1), w.no)} | ${fit(u.userId, w.user)} | ${fit(last, w.last)} | ${fit(String(u.knownCount), w.known)} | ${fit(String(u.weakCount), w.weak)} | ${fit(String(u.dueCount), w.due)} |`;
  });
  return [line, header, line, ...rows, line].join('\n');
}

export function buildQuizTable(card: DueCard): string {
  const english = card.english.length ? card.english.join(', ') : '-';
  const row: Record<'infinitive' | 'praeteritum' | 'partizip2' | 'english', string> = {
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
