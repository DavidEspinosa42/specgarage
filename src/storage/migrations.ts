import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Tables whose rows must never change after insertion. */
const APPEND_ONLY_TABLES = [
  'blobs',
  'rulepack_editions',
  'edition_documents',
  'vehicles',
  'inspections',
  'observations',
  'evidence',
  'results',
] as const;

function appendOnlyTriggers(): string {
  return APPEND_ONLY_TABLES.map(
    (table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is append-only: rows cannot be updated'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} is append-only: rows cannot be deleted'); END;`,
  ).join('\n');
}

const INITIAL_SCHEMA = `
-- Stored files (regulation documents and evidence), identified by SHA-256.
CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  media_type TEXT NOT NULL,
  stored_at TEXT NOT NULL
) STRICT;

-- Immutable, hashed imports of a rulepack. "content" is canonical JSON.
CREATE TABLE rulepack_editions (
  id TEXT PRIMARY KEY CHECK (length(id) = 64),
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  season TEXT NOT NULL,
  edition TEXT NOT NULL,
  content TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (category_code, season, edition)
) STRICT;

CREATE TABLE edition_documents (
  edition_id TEXT NOT NULL REFERENCES rulepack_editions (id),
  document_key TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL REFERENCES blobs (sha256),
  PRIMARY KEY (edition_id, document_key)
) STRICT;

-- Vehicles are identified only by an internal code.
CREATE TABLE vehicles (
  code TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;

-- One vehicle at one event, pinned to one edition.
CREATE TABLE inspections (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES rulepack_editions (id),
  vehicle_code TEXT NOT NULL REFERENCES vehicles (code),
  event_key TEXT NOT NULL,
  station_label TEXT NOT NULL,
  started_at TEXT NOT NULL
) STRICT;

-- Every measurement or verdict ever recorded. The latest row for a
-- requirement is its current observation.
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT NOT NULL REFERENCES inspections (id),
  requirement_key TEXT NOT NULL,
  value TEXT,
  unit TEXT,
  verdict TEXT CHECK (verdict IN ('pass', 'fail', 'undetermined')),
  confirmed_conditions TEXT NOT NULL,
  note TEXT,
  recorded_at TEXT NOT NULL,
  CHECK (json_valid(confirmed_conditions) AND json_type(confirmed_conditions) = 'array'),
  CHECK ((value IS NULL) = (unit IS NULL)),
  CHECK (value IS NOT NULL OR verdict IS NOT NULL)
) STRICT;
CREATE INDEX observations_by_requirement ON observations (inspection_id, requirement_key, id);

-- Files attached to one observation.
CREATE TABLE evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations (id),
  inspection_id TEXT NOT NULL REFERENCES inspections (id),
  requirement_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'document')),
  blob_sha256 TEXT NOT NULL REFERENCES blobs (sha256),
  recorded_at TEXT NOT NULL
) STRICT;
CREATE INDEX evidence_by_observation ON evidence (observation_id);

-- Every evaluation. Keeps the rule values used, so results can be reproduced.
CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id TEXT NOT NULL REFERENCES inspections (id),
  requirement_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'compliant', 'non-compliant', 'unverifiable', 'not-applicable', 'conflict')
  ),
  reasons TEXT NOT NULL,
  rule_snapshot TEXT NOT NULL,
  observation_id INTEGER NOT NULL REFERENCES observations (id),
  evidence_ids TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  CHECK (json_valid(reasons) AND json_type(reasons) = 'array'),
  CHECK (json_valid(rule_snapshot) AND json_type(rule_snapshot) = 'object')
) STRICT;
CREATE INDEX results_by_requirement ON results (inspection_id, requirement_key, id);

-- Evidence and results must belong to the same inspection and requirement as
-- the observation they point to.
CREATE TRIGGER evidence_matches_observation BEFORE INSERT ON evidence
WHEN NOT EXISTS (
  SELECT 1 FROM observations o
  WHERE o.id = NEW.observation_id
    AND o.inspection_id = NEW.inspection_id
    AND o.requirement_key = NEW.requirement_key
)
BEGIN SELECT RAISE(ABORT, 'evidence must match its observation'); END;

CREATE TRIGGER results_match_observation BEFORE INSERT ON results
WHEN NOT EXISTS (
  SELECT 1 FROM observations o
  WHERE o.id = NEW.observation_id
    AND o.inspection_id = NEW.inspection_id
    AND o.requirement_key = NEW.requirement_key
)
BEGIN SELECT RAISE(ABORT, 'result must match its observation'); END;

-- A result lists the evidence it was computed from; every id must exist and
-- belong to the result's own observation, so the result stays reproducible.
CREATE TRIGGER results_evidence_valid BEFORE INSERT ON results
WHEN CASE
  WHEN NOT json_valid(NEW.evidence_ids) THEN 1
  WHEN json_type(NEW.evidence_ids) <> 'array' THEN 1
  ELSE EXISTS (
    SELECT 1 FROM json_each(NEW.evidence_ids) j
    WHERE NOT EXISTS (
      SELECT 1 FROM evidence e
      WHERE e.id = j.value AND e.observation_id = NEW.observation_id
    )
  )
END
BEGIN SELECT RAISE(ABORT, 'result evidence must belong to its observation'); END;

${appendOnlyTriggers()}
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: INITIAL_SCHEMA },
];

/**
 * Applies pending migrations in order, each in its own transaction, and
 * returns the versions applied by this call. Safe to call repeatedly.
 */
export function migrate(
  db: DatabaseSync,
  now: () => string,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  );
  const newlyApplied: number[] = [];

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        now(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}
