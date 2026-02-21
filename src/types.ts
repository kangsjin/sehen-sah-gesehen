export type DbState = 'new' | 'learning' | 'review' | 'relearning';

export interface UserSummary {
  userId: string;
  lastLoginAt: string;
  knownCount: number;
  weakCount: number;
  dueCount: number;
}

export interface DueCard {
  verbId: string;
  infinitive: string;
  praeteritum: string;
  partizip2: string;
  english: string[];
  targetForm: 'infinitive' | 'praeteritum' | 'partizip2';
  answer: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: DbState;
  lastReviewAt: string;
  dueAt: string;
  nextIntervalDays: number;
}

export interface PersistResult {
  intervalDays: number;
}
