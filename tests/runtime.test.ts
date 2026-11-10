import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('runtime prerequisites', () => {
  it('runs on the supported Node.js major version', () => {
    expect(process.versions.node.split('.')[0]).toBe('26');
  });

  it('provides built-in SQLite with STRICT tables and foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT');
    db.exec(
      'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT',
    );
    expect(() => db.prepare('INSERT INTO child (parent_id) VALUES (?)').run(1)).toThrow();
    expect(() => db.prepare('INSERT INTO parent (id) VALUES (?)').run('not a number')).toThrow();
    db.close();
  });
});
