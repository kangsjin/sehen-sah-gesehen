import { spawnSync } from 'node:child_process';

export function sqlEscape(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function runSql(dbPath: string, sql: string, tabSeparated = false): string {
  const args = tabSeparated ? ['-separator', '\t', dbPath, sql] : [dbPath, sql];
  const res = spawnSync('sqlite3', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(res.stderr || 'sqlite3 command failed');
  }
  return res.stdout || '';
}

export function queryRows(dbPath: string, sql: string): string[][] {
  const out = runSql(dbPath, sql, true).trim();
  if (!out) return [];
  return out.split('\n').map((line) => line.split('\t'));
}

export function tableColumns(dbPath: string, tableName: string): string[] {
  return queryRows(dbPath, `PRAGMA table_info(${tableName});`).map((r) => r[1]);
}
