import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.ts';

export type Database = DatabaseSync;

/**
 * Opens a SQLite database (a file path or ":memory:"), enables foreign keys
 * and WAL, and applies pending migrations.
 */
export function openDatabase(
  path: string,
  now: () => string = () => new Date().toISOString(),
): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Without this, INSERT OR REPLACE deletes the conflicting row without firing
  // the delete triggers that keep history append-only.
  db.exec('PRAGMA recursive_triggers = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, now);
  return db;
}

/**
 * Runs the function inside a write transaction. Commits on success and rolls
 * back on any error. Nested calls join the outer transaction.
 */
export function transaction<T>(db: Database, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
