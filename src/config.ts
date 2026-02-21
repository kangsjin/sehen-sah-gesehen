import path from 'node:path';

export const LEXICON_DB_PATH = path.join(__dirname, '..', 'db', 'lexicon.sqlite');
export const LEARNING_DB_PATH = path.join(__dirname, '..', 'db', 'learning.sqlite');

export const QUESTION_COUNT = Number(process.argv[2] || 10);
