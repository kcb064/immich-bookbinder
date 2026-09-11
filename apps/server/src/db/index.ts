import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Locate apps/server/drizzle from wherever this module runs: src/db/ (tsx dev, vitest)
 * or dist/ (tsup bundle). Walks up a few levels looking for the migration journal.
 */
export function findMigrationsFolder(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const candidate = resolve(dir, 'drizzle');
    if (existsSync(resolve(candidate, 'meta/_journal.json'))) return candidate;
    dir = resolve(dir, '..');
  }
  throw new Error('Could not locate the drizzle/ migrations folder next to the server package');
}

export interface OpenDbResult {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

export function openDb(file: string): OpenDbResult {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: findMigrationsFolder() });
  return { db, sqlite, close: () => sqlite.close() };
}

export { schema };
