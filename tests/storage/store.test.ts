import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.ts';
import { type EditionRecord, Store } from '../../src/storage/store.ts';

const T1 = '2026-03-15T10:00:00.000Z';
const T2 = '2026-03-15T10:05:00.000Z';
const T3 = '2026-03-15T10:10:00.000Z';
const PDF = 'a'.repeat(64);
const PHOTO = 'b'.repeat(64);

const edition: EditionRecord = {
  id: 'e'.repeat(64),
  categoryCode: 'DEMO-CUP',
  categoryName: 'Demo Single-Make Cup (fictional)',
  season: '2026',
  edition: '2026-R1',
  content: '{"note":"Weight — naïve café"}',
  importedAt: T1,
};

let store: Store;

beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  store.insertBlob({ sha256: PDF, byteSize: 10, mediaType: 'application/pdf', storedAt: T1 });
  store.insertBlob({ sha256: PHOTO, byteSize: 20, mediaType: 'image/jpeg', storedAt: T1 });
  store.insertEdition(edition, [{ documentKey: 'TR', blobSha256: PDF }]);
  store.insertVehicle({ code: 'CAR-01', createdAt: T1 });
  store.insertInspection({
    id: 'aaaa1111-0000-4000-8000-000000000001',
    editionId: edition.id,
    vehicleCode: 'CAR-01',
    eventKey: 'round-1',
    stationLabel: 'Bay-1',
    startedAt: T1,
  });
});

const INSPECTION = 'aaaa1111-0000-4000-8000-000000000001';

const observe = (requirementKey: string, value: string | null, recordedAt = T2) =>
  store.insertObservation({
    inspectionId: INSPECTION,
    requirementKey,
    value,
    unit: value === null ? null : 'mm',
    verdict: value === null ? 'pass' : null,
    confirmedConditions: ['level-ground'],
    note: null,
    recordedAt,
  });

describe('blobs, editions, vehicles, inspections', () => {
  it('round-trips an edition with its documents and Unicode content', () => {
    expect(store.getEdition(edition.id)).toEqual(edition);
    expect(store.listEditionDocuments(edition.id)).toEqual([
      { documentKey: 'TR', blobSha256: PDF },
    ]);
    expect(store.findEditionByLabel('DEMO-CUP', '2026', '2026-R1')).toEqual(edition);
    expect(store.findEditionByLabel('DEMO-CUP', '2026', 'other')).toBeUndefined();
    expect(store.listEditions()).toEqual([edition]);
  });

  it('inserts an edition and its documents atomically', () => {
    expect(() =>
      store.insertEdition({ ...edition, id: 'f'.repeat(64), edition: '2026-R2' }, [
        { documentKey: 'TR', blobSha256: 'c'.repeat(64) },
      ]),
    ).toThrow(/FOREIGN KEY/);
    expect(store.getEdition('f'.repeat(64))).toBeUndefined();
  });

  it('treats recording the same blob twice as a no-op', () => {
    store.insertBlob({ sha256: PDF, byteSize: 999, mediaType: 'application/pdf', storedAt: T3 });
    expect(store.getBlob(PDF)?.byteSize).toBe(10);
    expect(store.listBlobs()).toHaveLength(2);
  });

  it('refuses a second vehicle with the same code', () => {
    expect(() => store.insertVehicle({ code: 'CAR-01', createdAt: T2 })).toThrow(/UNIQUE|PRIMARY/);
    expect(store.listVehicles()).toEqual([{ code: 'CAR-01', createdAt: T1 }]);
  });

  it('finds editions and inspections by id prefix, matching wildcards literally', () => {
    expect(store.findEditionsByPrefix('eeee').map((row) => row.id)).toEqual([edition.id]);
    expect(store.findEditionsByPrefix('%')).toEqual([]);
    expect(store.findEditionsByPrefix('_')).toEqual([]);
    expect(store.findInspectionsByPrefix('aaaa1111')).toHaveLength(1);
    expect(store.findInspectionsByPrefix('aaaa%')).toEqual([]);
    expect(store.findInspectionsByPrefix('zzzz')).toEqual([]);
  });

  it('lists inspections newest first', () => {
    store.insertInspection({
      id: 'bbbb2222-0000-4000-8000-000000000002',
      editionId: edition.id,
      vehicleCode: 'CAR-01',
      eventKey: 'round-2',
      stationLabel: 'Bay-1',
      startedAt: T3,
    });
    expect(store.listInspections().map((row) => row.eventKey)).toEqual(['round-2', 'round-1']);
  });
});

describe('observations, evidence, and results', () => {
  it('keeps every observation and exposes the latest as current', () => {
    observe('track', '1661', T2);
    const second = observe('track', '1658', T3);
    observe('weight', '1100', T2);

    const current = store.currentObservations(INSPECTION);
    expect(current.size).toBe(2);
    expect(current.get('track')?.id).toBe(second);
    expect(current.get('track')?.value).toBe('1658');
    expect(store.listObservations(INSPECTION, 'track').map((row) => row.value)).toEqual([
      '1661',
      '1658',
    ]);
  });

  it('round-trips observation fields, including conditions and a verdict-only record', () => {
    const id = observe('extinguisher', null);
    expect(store.getObservation(id)).toEqual({
      id,
      inspectionId: INSPECTION,
      requirementKey: 'extinguisher',
      value: null,
      unit: null,
      verdict: 'pass',
      confirmedConditions: ['level-ground'],
      note: null,
      recordedAt: T2,
    });
  });

  it('exposes only the evidence of current observations', () => {
    const first = observe('track', '1661', T2);
    store.insertEvidence({
      observationId: first,
      inspectionId: INSPECTION,
      requirementKey: 'track',
      kind: 'photo',
      blobSha256: PHOTO,
      recordedAt: T2,
    });
    const second = observe('track', '1658', T3);
    expect(store.currentEvidence(INSPECTION)).toEqual([]);

    const evidenceId = store.insertEvidence({
      observationId: second,
      inspectionId: INSPECTION,
      requirementKey: 'track',
      kind: 'photo',
      blobSha256: PHOTO,
      recordedAt: T3,
    });
    expect(store.currentEvidence(INSPECTION).map((row) => row.id)).toEqual([evidenceId]);
    expect(store.listEvidenceForObservation(first)).toHaveLength(1);
  });

  it('keeps every result and exposes the latest as current', () => {
    const first = observe('track', '1661', T2);
    store.insertResult({
      inspectionId: INSPECTION,
      requirementKey: 'track',
      status: 'unverifiable',
      reasons: [{ code: 'evidence-missing', message: 'No photo', detail: 'photo' }],
      ruleSnapshot: { key: 'track' },
      observationId: first,
      evidenceIds: [],
      engineVersion: '1',
      evaluatedAt: T2,
    });
    const evidenceId = store.insertEvidence({
      observationId: first,
      inspectionId: INSPECTION,
      requirementKey: 'track',
      kind: 'photo',
      blobSha256: PHOTO,
      recordedAt: T3,
    });
    store.insertResult({
      inspectionId: INSPECTION,
      requirementKey: 'track',
      status: 'non-compliant',
      reasons: [],
      ruleSnapshot: { key: 'track' },
      observationId: first,
      evidenceIds: [evidenceId],
      engineVersion: '1',
      evaluatedAt: T3,
    });

    expect(store.currentResults(INSPECTION).get('track')?.status).toBe('non-compliant');
    const history = store.listResults(INSPECTION, 'track');
    expect(history.map((row) => row.status)).toEqual(['unverifiable', 'non-compliant']);
    expect(history[0]?.reasons[0]?.detail).toBe('photo');
    expect(history[1]?.evidenceIds).toEqual([evidenceId]);
    expect(history[1]?.ruleSnapshot).toEqual({ key: 'track' });
  });

  it('scopes everything to its own inspection', () => {
    store.insertInspection({
      id: 'bbbb2222-0000-4000-8000-000000000002',
      editionId: edition.id,
      vehicleCode: 'CAR-01',
      eventKey: 'round-2',
      stationLabel: 'Bay-1',
      startedAt: T3,
    });
    observe('track', '1661', T2);
    expect(store.currentObservations('bbbb2222-0000-4000-8000-000000000002').size).toBe(0);
    expect(store.currentResults('bbbb2222-0000-4000-8000-000000000002').size).toBe(0);
  });
});
