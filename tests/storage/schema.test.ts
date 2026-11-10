import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDatabase, transaction } from '../../src/storage/database.ts';
import { MIGRATIONS, migrate } from '../../src/storage/migrations.ts';

const NOW = '2026-03-15T10:00:00.000Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const EDITION = 'e'.repeat(64);

/** Inserts the minimum chain of rows needed to reference an observation. */
function seed(db: DatabaseSync) {
  db.prepare('INSERT INTO blobs VALUES (?, ?, ?, ?)').run(SHA_A, 10, 'application/pdf', NOW);
  db.prepare('INSERT INTO blobs VALUES (?, ?, ?, ?)').run(SHA_B, 20, 'image/jpeg', NOW);
  db.prepare('INSERT INTO rulepack_editions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    EDITION,
    'CAT',
    'Category',
    '2026',
    '2026-R1',
    '{}',
    NOW,
  );
  db.prepare('INSERT INTO edition_documents VALUES (?, ?, ?)').run(EDITION, 'TR', SHA_A);
  db.prepare('INSERT INTO vehicles VALUES (?, ?)').run('CAR-01', NOW);
  db.prepare('INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?)').run(
    'insp-1',
    EDITION,
    'CAR-01',
    'round-1',
    'Bay-1',
    NOW,
  );
  db.prepare(
    'INSERT INTO observations (inspection_id, requirement_key, value, unit, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('insp-1', 'req-1', '1658', 'mm', '[]', NOW);
}

describe('migrations', () => {
  it('applies the initial schema once and records it', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrate(db, () => NOW)).toEqual([1]);
    expect(migrate(db, () => NOW)).toEqual([]);
    const rows = db.prepare('SELECT version, name, applied_at FROM schema_migrations').all();
    expect(rows).toEqual([{ version: 1, name: 'initial schema', applied_at: NOW }]);
  });

  it('rolls back a failing migration and leaves no trace', () => {
    const db = new DatabaseSync(':memory:');
    const broken = [
      { version: 1, name: 'broken', sql: 'CREATE TABLE ok (a INTEGER); SELECT nope FROM missing;' },
    ];
    expect(() => migrate(db, () => NOW, broken)).toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").all();
    expect(tables).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('applies later migrations after earlier ones', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, () => NOW);
    const next = [
      ...MIGRATIONS,
      { version: 2, name: 'extra', sql: 'CREATE TABLE extra (a INTEGER) STRICT' },
    ];
    expect(migrate(db, () => NOW, next)).toEqual([2]);
  });
});

describe('append-only history', () => {
  const tables: [string, string, unknown[]][] = [
    ['blobs', 'byte_size = 1', []],
    ['rulepack_editions', "category_name = 'x'", []],
    ['edition_documents', "document_key = 'x'", []],
    ['vehicles', "created_at = 'x'", []],
    ['inspections', "station_label = 'x'", []],
    ['observations', "value = '1'", []],
  ];

  it.each(tables)('rejects updates and deletes on %s', (table, assignment) => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() => db.exec(`UPDATE ${table} SET ${assignment}`)).toThrow(/append-only/);
    expect(() => db.exec(`DELETE FROM ${table}`)).toThrow(/append-only/);
  });

  it('rejects replacing and upserting existing history rows', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db.prepare('INSERT OR REPLACE INTO vehicles VALUES (?, ?)').run('CAR-01', 'changed'),
    ).toThrow(/append-only/);
    expect(() =>
      db
        .prepare('REPLACE INTO rulepack_editions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(EDITION, 'CAT', 'Replaced', '2026', '2026-R1', '{"changed":true}', NOW),
    ).toThrow(/append-only/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO observations (id, inspection_id, requirement_key, value, unit, confirmed_conditions, recorded_at) VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value',
        )
        .run('insp-1', 'req-1', '9999', 'mm', '[]', NOW),
    ).toThrow(/append-only/);
    expect(db.prepare('SELECT created_at FROM vehicles').get()).toEqual({ created_at: NOW });
    expect(db.prepare('SELECT value FROM observations WHERE id = 1').get()).toEqual({
      value: '1658',
    });
  });

  it('rejects updates and deletes on evidence and results', () => {
    const db = openDatabase(':memory:');
    seed(db);
    db.prepare(
      'INSERT INTO evidence (observation_id, inspection_id, requirement_key, kind, blob_sha256, recorded_at) VALUES (1, ?, ?, ?, ?, ?)',
    ).run('insp-1', 'req-1', 'photo', SHA_B, NOW);
    db.prepare(
      'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
    ).run('insp-1', 'req-1', 'compliant', '[]', '{}', '[1]', '1', NOW);
    for (const table of ['evidence', 'results']) {
      expect(() => db.exec(`UPDATE ${table} SET requirement_key = 'x'`)).toThrow(/append-only/);
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow(/append-only/);
    }
  });
});

describe('integrity rules', () => {
  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db
        .prepare('INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?)')
        .run('i', EDITION, 'NOPE', 'r', 's', NOW),
    ).toThrow(/FOREIGN KEY/);
  });

  it('rejects wrongly typed values in STRICT tables', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db.prepare('INSERT INTO blobs VALUES (?, ?, ?, ?)').run(SHA_A, 'big', 'text/plain', NOW),
    ).toThrow();
  });

  it('rejects an observation with neither a value nor a verdict', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO observations (inspection_id, requirement_key, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?)',
        )
        .run('insp-1', 'req-2', '[]', NOW),
    ).toThrow(/CHECK/);
  });

  it('rejects a value without a unit', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO observations (inspection_id, requirement_key, value, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('insp-1', 'req-2', '5', '[]', NOW),
    ).toThrow(/CHECK/);
  });

  it('accepts a verdict-only observation', () => {
    const db = openDatabase(':memory:');
    seed(db);
    db.prepare(
      'INSERT INTO observations (inspection_id, requirement_key, verdict, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?)',
    ).run('insp-1', 'req-3', 'undetermined', '[]', NOW);
  });

  it('rejects an unknown verdict or status', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO observations (inspection_id, requirement_key, verdict, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run('insp-1', 'req-3', 'maybe', '[]', NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        )
        .run('insp-1', 'req-1', 'passed', '[]', '{}', '[]', '1', NOW),
    ).toThrow(/CHECK/);
  });

  it('rejects evidence or a result that does not match its observation', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO evidence (observation_id, inspection_id, requirement_key, kind, blob_sha256, recorded_at) VALUES (1, ?, ?, ?, ?, ?)',
        )
        .run('insp-1', 'another-requirement', 'photo', SHA_B, NOW),
    ).toThrow(/must match its observation/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        )
        .run('insp-1', 'another-requirement', 'compliant', '[]', '{}', '[]', '1', NOW),
    ).toThrow(/must match its observation/);
  });

  describe('result evidence references', () => {
    const insertResult = (db: DatabaseSync, evidenceIds: string, observationId = 1) =>
      db
        .prepare(
          'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('insp-1', 'req-1', 'compliant', '[]', '{}', observationId, evidenceIds, '1', NOW);

    it('accepts an empty list and the ids of the observation’s own evidence', () => {
      const db = openDatabase(':memory:');
      seed(db);
      db.prepare(
        'INSERT INTO evidence (observation_id, inspection_id, requirement_key, kind, blob_sha256, recorded_at) VALUES (1, ?, ?, ?, ?, ?)',
      ).run('insp-1', 'req-1', 'photo', SHA_B, NOW);
      insertResult(db, '[]');
      insertResult(db, '[1]');
    });

    it('rejects ids that do not exist', () => {
      const db = openDatabase(':memory:');
      seed(db);
      expect(() => insertResult(db, '[999]')).toThrow(/result evidence must belong/);
    });

    it('rejects evidence that belongs to a different observation', () => {
      const db = openDatabase(':memory:');
      seed(db);
      db.prepare(
        'INSERT INTO evidence (observation_id, inspection_id, requirement_key, kind, blob_sha256, recorded_at) VALUES (1, ?, ?, ?, ?, ?)',
      ).run('insp-1', 'req-1', 'photo', SHA_B, NOW);
      db.prepare(
        'INSERT INTO observations (inspection_id, requirement_key, value, unit, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('insp-1', 'req-1', '1659', 'mm', '[]', NOW);
      expect(() => insertResult(db, '[1]', 2)).toThrow(/result evidence must belong/);
    });

    it('rejects malformed or non-array evidence lists', () => {
      const db = openDatabase(':memory:');
      seed(db);
      for (const bad of ['not json', '{"a":1}', '"1"', '1']) {
        expect(() => insertResult(db, bad), bad).toThrow(/result evidence must belong/);
      }
    });
  });

  it('rejects malformed JSON in observation and result columns', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO observations (inspection_id, requirement_key, value, unit, confirmed_conditions, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('insp-1', 'req-2', '1', 'mm', 'not json', NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
        )
        .run('insp-1', 'req-1', 'compliant', '{}', '{}', '[]', '1', NOW),
    ).toThrow(/CHECK/);
  });

  it('rejects a duplicate edition label', () => {
    const db = openDatabase(':memory:');
    seed(db);
    expect(() =>
      db
        .prepare('INSERT INTO rulepack_editions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('f'.repeat(64), 'CAT', 'Category', '2026', '2026-R1', '{}', NOW),
    ).toThrow(/UNIQUE/);
  });
});

describe('transaction', () => {
  it('commits on success and rolls back on error', () => {
    const db = openDatabase(':memory:');
    transaction(db, () => db.prepare('INSERT INTO vehicles VALUES (?, ?)').run('A', NOW));
    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO vehicles VALUES (?, ?)').run('B', NOW);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT code FROM vehicles').all()).toEqual([{ code: 'A' }]);
  });

  it('lets nested calls join the outer transaction', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      transaction(db, () => {
        transaction(db, () => db.prepare('INSERT INTO vehicles VALUES (?, ?)').run('A', NOW));
        throw new Error('outer failure');
      }),
    ).toThrow('outer failure');
    expect(db.prepare('SELECT count(*) AS n FROM vehicles').get()).toEqual({ n: 0 });
  });
});
