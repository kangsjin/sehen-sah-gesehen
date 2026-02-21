import readline from 'node:readline';
import { QUESTION_COUNT } from './config';
import { ensureFsrsSchema, ensureUser, listUsers, loadDueCards, persistReview } from './repository';
import { ask, buildQuizTable, green, isCorrect, red, renderUsersTable } from './ui';

const sharedQuizLogic = require('../../web/shared/quiz-logic.js') as {
  gradeFromResponseTime: (seconds: number) => 2 | 3 | 4;
};

async function promptUserLogin(rl: readline.Interface): Promise<string> {
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

    if (/^[a-zA-Z0-9_-]{2,32}$/.test(pick)) {
      return pick;
    }

    console.log('Invalid selection. Enter a number or n.');
  }
}

async function run(): Promise<void> {
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
    const prompt = [`[${solved + 1}/${cards.length}]`, buildQuizTable(card), '> '].join('\n');

    const startMs = Date.now();
    const input = await ask(rl, prompt);
    const elapsedSec = (Date.now() - startMs) / 1000;
    if (input.trim().toLowerCase() === 'q') break;

    const exact = isCorrect(input, card.answer);
    let grade: 1 | 2 | 3 | 4 = 1;
    if (exact) {
      grade = sharedQuizLogic.gradeFromResponseTime(elapsedSec);
    }

    const next = persistReview(userId, card, input, grade);
    solved += 1;

    if (grade > 1) {
      score += 1;
      const gradeLabel = grade === 4 ? 'Easy' : grade === 3 ? 'Good' : 'Hard';
      console.log(
        `${green('Correct')} [${gradeLabel}, ${elapsedSec.toFixed(1)}s] (next review in ~${next.intervalDays.toFixed(1)} days)\n`
      );
    } else {
      console.log(red(`Incorrect (answer: ${card.answer})`));
      console.log(`Next review: immediate to ~${next.intervalDays.toFixed(1)} days\n`);
    }
  }

  rl.close();
  console.log(`Score: ${score}/${solved || cards.length}`);
}

run().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
