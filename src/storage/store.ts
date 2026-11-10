import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';
import type { Reason, Verdict } from '../domain/evaluation.ts';
import type { MediaType } from '../domain/media.ts';
import type { EvidenceKind } from '../domain/rulepack.ts';
import type { Status } from '../domain/status.ts';
import { type Database, transaction } from './database.ts';

export interface BlobRecord {
  sha256: string;
  byteSize: number;
  mediaType: MediaType;
  storedAt: string;
}

export interface EditionRecord {
  id: string;
  categoryCode: string;
  categoryName: string;
  season: string;
  edition: string;
  /** Canonical JSON of the validated rulepack. */
  content: string;
  importedAt: string;
}

export interface EditionDocumentRecord {
  documentKey: string;
  blobSha256: string;
}

export interface VehicleRecord {
  code: string;
  createdAt: string;
}

export interface InspectionRecord {
  id: string;
  editionId: string;
  vehicleCode: string;
  eventKey: string;
  stationLabel: string;
  startedAt: string;
}

export interface ObservationRecord {
  id: number;
  inspectionId: string;
  requirementKey: string;
  value: string | null;
  unit: string | null;
  verdict: Verdict | null;
  confirmedConditions: string[];
  note: string | null;
  recordedAt: string;
}

export interface EvidenceRecord {
  id: number;
  observationId: number;
  inspectionId: string;
  requirementKey: string;
  kind: EvidenceKind;
  blobSha256: string;
  recordedAt: string;
}

export interface ResultRecord {
  id: number;
  inspectionId: string;
  requirementKey: string;
  status: Status;
  reasons: Reason[];
  ruleSnapshot: unknown;
  observationId: number;
  evidenceIds: number[];
  engineVersion: string;
  evaluatedAt: string;
}

type Row = Record<string, SQLOutputValue>;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Column "${column}" is not text.`);
  return value;
}

function optionalText(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Column "${column}" is not text.`);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Column "${column}" is not an integer.`);
  }
  return Number(value);
}

const toBlob = (row: Row): BlobRecord => ({
  sha256: text(row, 'sha256'),
  byteSize: integer(row, 'byte_size'),
  mediaType: text(row, 'media_type') as MediaType,
  storedAt: text(row, 'stored_at'),
});

const toEdition = (row: Row): EditionRecord => ({
  id: text(row, 'id'),
  categoryCode: text(row, 'category_code'),
  categoryName: text(row, 'category_name'),
  season: text(row, 'season'),
  edition: text(row, 'edition'),
  content: text(row, 'content'),
  importedAt: text(row, 'imported_at'),
});

const toVehicle = (row: Row): VehicleRecord => ({
  code: text(row, 'code'),
  createdAt: text(row, 'created_at'),
});

const toInspection = (row: Row): InspectionRecord => ({
  id: text(row, 'id'),
  editionId: text(row, 'edition_id'),
  vehicleCode: text(row, 'vehicle_code'),
  eventKey: text(row, 'event_key'),
  stationLabel: text(row, 'station_label'),
  startedAt: text(row, 'started_at'),
});

const toObservation = (row: Row): ObservationRecord => ({
  id: integer(row, 'id'),
  inspectionId: text(row, 'inspection_id'),
  requirementKey: text(row, 'requirement_key'),
  value: optionalText(row, 'value'),
  unit: optionalText(row, 'unit'),
  verdict: optionalText(row, 'verdict') as Verdict | null,
  confirmedConditions: JSON.parse(text(row, 'confirmed_conditions')) as string[],
  note: optionalText(row, 'note'),
  recordedAt: text(row, 'recorded_at'),
});

const toEvidence = (row: Row): EvidenceRecord => ({
  id: integer(row, 'id'),
  observationId: integer(row, 'observation_id'),
  inspectionId: text(row, 'inspection_id'),
  requirementKey: text(row, 'requirement_key'),
  kind: text(row, 'kind') as EvidenceKind,
  blobSha256: text(row, 'blob_sha256'),
  recordedAt: text(row, 'recorded_at'),
});

const toResult = (row: Row): ResultRecord => ({
  id: integer(row, 'id'),
  inspectionId: text(row, 'inspection_id'),
  requirementKey: text(row, 'requirement_key'),
  status: text(row, 'status') as Status,
  reasons: JSON.parse(text(row, 'reasons')) as Reason[],
  ruleSnapshot: JSON.parse(text(row, 'rule_snapshot')),
  observationId: integer(row, 'observation_id'),
  evidenceIds: JSON.parse(text(row, 'evidence_ids')) as number[],
  engineVersion: text(row, 'engine_version'),
  evaluatedAt: text(row, 'evaluated_at'),
});

/** Escapes LIKE wildcards so a user-typed prefix matches literally. */
function likePrefix(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Typed access to the database. It contains no business rules: callers decide
 * what to insert; the schema's triggers keep history append-only.
 */
export class Store {
  readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  transaction<T>(work: () => T): T {
    return transaction(this.db, work);
  }

  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params);
  }

  private one(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params);
  }

  // Blobs

  /** Records a stored file. Recording the same hash again is a no-op. */
  insertBlob(blob: BlobRecord): void {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO blobs (sha256, byte_size, media_type, stored_at) VALUES (?, ?, ?, ?)',
      )
      .run(blob.sha256, blob.byteSize, blob.mediaType, blob.storedAt);
  }

  getBlob(sha256: string): BlobRecord | undefined {
    const row = this.one('SELECT * FROM blobs WHERE sha256 = ?', sha256);
    return row === undefined ? undefined : toBlob(row);
  }

  listBlobs(): BlobRecord[] {
    return this.all('SELECT * FROM blobs ORDER BY sha256').map(toBlob);
  }

  // Editions

  insertEdition(edition: EditionRecord, documents: readonly EditionDocumentRecord[]): void {
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO rulepack_editions (id, category_code, category_name, season, edition, content, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          edition.id,
          edition.categoryCode,
          edition.categoryName,
          edition.season,
          edition.edition,
          edition.content,
          edition.importedAt,
        );
      for (const document of documents) {
        this.db
          .prepare(
            'INSERT INTO edition_documents (edition_id, document_key, blob_sha256) VALUES (?, ?, ?)',
          )
          .run(edition.id, document.documentKey, document.blobSha256);
      }
    });
  }

  getEdition(id: string): EditionRecord | undefined {
    const row = this.one('SELECT * FROM rulepack_editions WHERE id = ?', id);
    return row === undefined ? undefined : toEdition(row);
  }

  findEditionByLabel(
    categoryCode: string,
    season: string,
    edition: string,
  ): EditionRecord | undefined {
    const row = this.one(
      'SELECT * FROM rulepack_editions WHERE category_code = ? AND season = ? AND edition = ?',
      categoryCode,
      season,
      edition,
    );
    return row === undefined ? undefined : toEdition(row);
  }

  findEditionsByPrefix(prefix: string): EditionRecord[] {
    return this.all(
      "SELECT * FROM rulepack_editions WHERE id LIKE ? ESCAPE '\\' ORDER BY id",
      likePrefix(prefix),
    ).map(toEdition);
  }

  listEditions(): EditionRecord[] {
    return this.all('SELECT * FROM rulepack_editions ORDER BY category_code, season, edition').map(
      toEdition,
    );
  }

  listEditionDocuments(editionId: string): EditionDocumentRecord[] {
    return this.all(
      'SELECT * FROM edition_documents WHERE edition_id = ? ORDER BY document_key',
      editionId,
    ).map((row) => ({
      documentKey: text(row, 'document_key'),
      blobSha256: text(row, 'blob_sha256'),
    }));
  }

  // Vehicles

  insertVehicle(vehicle: VehicleRecord): void {
    this.db
      .prepare('INSERT INTO vehicles (code, created_at) VALUES (?, ?)')
      .run(vehicle.code, vehicle.createdAt);
  }

  getVehicle(code: string): VehicleRecord | undefined {
    const row = this.one('SELECT * FROM vehicles WHERE code = ?', code);
    return row === undefined ? undefined : toVehicle(row);
  }

  listVehicles(): VehicleRecord[] {
    return this.all('SELECT * FROM vehicles ORDER BY code').map(toVehicle);
  }

  // Inspections

  insertInspection(inspection: InspectionRecord): void {
    this.db
      .prepare(
        'INSERT INTO inspections (id, edition_id, vehicle_code, event_key, station_label, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        inspection.id,
        inspection.editionId,
        inspection.vehicleCode,
        inspection.eventKey,
        inspection.stationLabel,
        inspection.startedAt,
      );
  }

  getInspection(id: string): InspectionRecord | undefined {
    const row = this.one('SELECT * FROM inspections WHERE id = ?', id);
    return row === undefined ? undefined : toInspection(row);
  }

  findInspectionsByPrefix(prefix: string): InspectionRecord[] {
    return this.all(
      "SELECT * FROM inspections WHERE id LIKE ? ESCAPE '\\' ORDER BY started_at, id",
      likePrefix(prefix),
    ).map(toInspection);
  }

  listInspections(): InspectionRecord[] {
    return this.all('SELECT * FROM inspections ORDER BY started_at DESC, id').map(toInspection);
  }

  // Observations

  insertObservation(observation: Omit<ObservationRecord, 'id'>): number {
    const result = this.db
      .prepare(
        'INSERT INTO observations (inspection_id, requirement_key, value, unit, verdict, confirmed_conditions, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        observation.inspectionId,
        observation.requirementKey,
        observation.value,
        observation.unit,
        observation.verdict,
        JSON.stringify(observation.confirmedConditions),
        observation.note,
        observation.recordedAt,
      );
    return Number(result.lastInsertRowid);
  }

  getObservation(id: number): ObservationRecord | undefined {
    const row = this.one('SELECT * FROM observations WHERE id = ?', id);
    return row === undefined ? undefined : toObservation(row);
  }

  /** The latest observation of each requirement in an inspection. */
  currentObservations(inspectionId: string): Map<string, ObservationRecord> {
    const rows = this.all(
      `SELECT * FROM observations WHERE id IN (
         SELECT max(id) FROM observations WHERE inspection_id = ? GROUP BY requirement_key
       )`,
      inspectionId,
    ).map(toObservation);
    return new Map(rows.map((observation) => [observation.requirementKey, observation]));
  }

  /** Every observation of a requirement, oldest first. */
  listObservations(inspectionId: string, requirementKey: string): ObservationRecord[] {
    return this.all(
      'SELECT * FROM observations WHERE inspection_id = ? AND requirement_key = ? ORDER BY id',
      inspectionId,
      requirementKey,
    ).map(toObservation);
  }

  // Evidence

  insertEvidence(evidence: Omit<EvidenceRecord, 'id'>): number {
    const result = this.db
      .prepare(
        'INSERT INTO evidence (observation_id, inspection_id, requirement_key, kind, blob_sha256, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        evidence.observationId,
        evidence.inspectionId,
        evidence.requirementKey,
        evidence.kind,
        evidence.blobSha256,
        evidence.recordedAt,
      );
    return Number(result.lastInsertRowid);
  }

  listEvidenceForObservation(observationId: number): EvidenceRecord[] {
    return this.all(
      'SELECT * FROM evidence WHERE observation_id = ? ORDER BY id',
      observationId,
    ).map(toEvidence);
  }

  /** Evidence attached to the current observation of each requirement. */
  currentEvidence(inspectionId: string): EvidenceRecord[] {
    return this.all(
      `SELECT * FROM evidence WHERE observation_id IN (
         SELECT max(id) FROM observations WHERE inspection_id = ? GROUP BY requirement_key
       ) ORDER BY id`,
      inspectionId,
    ).map(toEvidence);
  }

  // Results

  insertResult(result: Omit<ResultRecord, 'id'>): number {
    const inserted = this.db
      .prepare(
        'INSERT INTO results (inspection_id, requirement_key, status, reasons, rule_snapshot, observation_id, evidence_ids, engine_version, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        result.inspectionId,
        result.requirementKey,
        result.status,
        JSON.stringify(result.reasons),
        JSON.stringify(result.ruleSnapshot),
        result.observationId,
        JSON.stringify(result.evidenceIds),
        result.engineVersion,
        result.evaluatedAt,
      );
    return Number(inserted.lastInsertRowid);
  }

  /** The latest result of each requirement in an inspection. */
  currentResults(inspectionId: string): Map<string, ResultRecord> {
    const rows = this.all(
      `SELECT * FROM results WHERE id IN (
         SELECT max(id) FROM results WHERE inspection_id = ? GROUP BY requirement_key
       )`,
      inspectionId,
    ).map(toResult);
    return new Map(rows.map((result) => [result.requirementKey, result]));
  }

  /** Every result of a requirement, oldest first. */
  listResults(inspectionId: string, requirementKey: string): ResultRecord[] {
    return this.all(
      'SELECT * FROM results WHERE inspection_id = ? AND requirement_key = ? ORDER BY id',
      inspectionId,
      requirementKey,
    ).map(toResult);
  }
}
