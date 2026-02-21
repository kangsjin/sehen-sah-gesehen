import path from 'node:path';

export const LEXICON_DB_PATH = path.join(__dirname, '..', 'lexicon.sqlite');
export const LEARNING_DB_PATH = path.join(__dirname, '..', 'learning.sqlite');

export const QUESTION_COUNT = Number(process.argv[2] || 10);
