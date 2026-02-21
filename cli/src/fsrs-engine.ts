import { fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { DbState } from './types';

const srs = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: false,
    enable_short_term: false,
  })
);

export function dbStateToFsrs(state: DbState): State {
  if (state === 'learning') return State.Learning;
  if (state === 'review') return State.Review;
  if (state === 'relearning') return State.Relearning;
  return State.New;
}

export function fsrsStateToDb(state: State): DbState {
  if (state === State.Learning) return 'learning';
  if (state === State.Review) return 'review';
  if (state === State.Relearning) return 'relearning';
  return 'new';
}

export function gradeToRating(grade: 1 | 2 | 3 | 4): Grade {
  if (grade === 1) return Rating.Again;
  if (grade === 2) return Rating.Hard;
  if (grade === 3) return Rating.Good;
  return Rating.Easy;
}

export interface NextResult {
  card: Card;
  logElapsedDays: number;
}

export function nextFsrsCard(input: {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  dbState: DbState;
  lastReview?: Date;
  nextIntervalDays: number;
  now: Date;
  grade: 1 | 2 | 3 | 4;
}): NextResult {
  const card: Card = {
    due: input.due,
    stability: input.stability,
    difficulty: input.difficulty,
    elapsed_days: 0,
    scheduled_days: Math.max(0, Math.round(input.nextIntervalDays)),
    learning_steps: 0,
    reps: input.reps,
    lapses: input.lapses,
    state: dbStateToFsrs(input.dbState),
    last_review: input.lastReview,
  };

  const out = srs.next(card, input.now, gradeToRating(input.grade));
  return {
    card: out.card,
    logElapsedDays: out.log.elapsed_days,
  };
}
