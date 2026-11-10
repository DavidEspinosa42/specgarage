import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecGarageError } from '../../src/domain/errors.ts';
import { ENGINE_VERSION, type ObservationInput } from '../../src/domain/evaluation.ts';
import { evaluate } from '../../src/engine/evaluate.ts';
import {
  addEvidence,
  type ChecklistView,
  getChecklist,
  getHistory,
  MAX_FILES_PER_UPLOAD,
  type RequirementView,
  type RuleSnapshot,
  recordObservation,
} from '../../src/service/checklist.ts';
import { importEdition } from '../../src/service/editions.ts';
import { addVehicle, startInspection } from '../../src/service/inspections.ts';
import { loadRulepackFile } from '../../src/storage/rulepack-file.ts';
import { createTestEnvironment, demoRulepackPath, type TestEnvironment } from '../helpers.ts';

let env: TestEnvironment;
let inspectionId: string;

beforeEach(() => {
  env = createTestEnvironment();
  importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
  addVehicle(env.ctx, 'DEMO-01');
  inspectionId = startInspection(env.ctx, {
    edition: 'COPA-DEMO/2026/2026-R1',
    vehicleCode: 'DEMO-01',
    eventKey: 'fecha-1',
    stationLabel: 'Bay-1',
  }).id;
});
afterEach(() => env.cleanup());

/** A tiny file with a JPEG signature; `n` makes the content (and hash) unique. */
const jpeg = (n = 0) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, n]);
const pdf = (n = 0) => new TextEncoder().encode(`%PDF-1.4 evidence ${n}`);

const TRACK = 'chasis-trocha-delantera-max';
const WEIGHT = 'chasis-peso-minimo';
const EXTINGUISHER = 'seguridad-extintor';

function find(view: ChecklistView, key: string): RequirementView {
  const found = view.systems
    .flatMap((system) => system.requirements)
    .find((item) => item.key === key);
  if (found === undefined) throw new Error(`requirement ${key} not in checklist`);
  return found;
}

function expectError(action: () => unknown, code: string, message?: RegExp) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SpecGarageError);
    expect((error as SpecGarageError).code).toBe(code);
    if (message) expect((error as SpecGarageError).message).toMatch(message);
    return;
  }
  throw new Error('expected an error');
}

const record = (requirementKey: string, fields: Record<string, unknown> = {}) =>
  recordObservation(env.ctx, { inspectionId, requirementKey, ...fields });

describe('getChecklist', () => {
  it('starts with every requirement Pending, grouped by system in rulepack order', () => {
    const view = getChecklist(env.ctx, inspectionId);
    expect(view.systems.map((system) => system.key)).toEqual([
      'chasis',
      'frenos-neumaticos',
      'combustible',
      'electronica',
      'seguridad',
      'identificacion',
      'precintos',
    ]);
    const all = view.systems.flatMap((system) => system.requirements);
    expect(all).toHaveLength(20);
    expect(all.every((item) => item.status === 'pending' && item.current === null)).toBe(true);
    expect(view.counts).toEqual({
      pending: 20,
      compliant: 0,
      'non-compliant': 0,
      unverifiable: 0,
      'not-applicable': 0,
      conflict: 0,
    });
    expect(view.notice).toMatch(/not an official/);
  });

  it('describes the inspection, edition, and documents with their hashes', () => {
    const view = getChecklist(env.ctx, inspectionId);
    expect(view.inspection).toMatchObject({
      vehicleCode: 'DEMO-01',
      eventKey: 'fecha-1',
      eventName: 'Fecha 1',
      eventDate: '2026-03-15',
      stationLabel: 'Bay-1',
    });
    expect(view.edition).toMatchObject({
      categoryCode: 'COPA-DEMO',
      edition: '2026-R1',
      language: 'es-AR',
    });
    expect(view.documents.map((doc) => doc.key)).toEqual(['TR', 'RD']);
    expect(view.documents.every((doc) => /^[0-9a-f]{64}$/.test(doc.sha256 ?? ''))).toBe(true);
  });

  it('links each requirement to its source document, article, page, and stored file', () => {
    const track = find(getChecklist(env.ctx, inspectionId), TRACK);
    expect(track.sources).toEqual([
      expect.objectContaining({ documentKey: 'TR', article: '3', page: 2 }),
    ]);
    expect(track.sources[0]?.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(track.checkSummary).toBe('≤ 1660 mm');
    const camera = find(getChecklist(env.ctx, inspectionId), 'senalizacion-electronica');
    expect(camera.sources.map((s) => s.documentKey)).toEqual(['TR', 'RD']);
  });

  it('rejects an unknown inspection', () => {
    expectError(() => getChecklist(env.ctx, 'nope'), 'not-found');
  });
});

describe('recordObservation: results', () => {
  it('returns the updated requirement with its status and the recorded values', () => {
    const view = record(TRACK, {
      value: '1658.0',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg()],
    });
    expect(view.status).toBe('compliant');
    expect(view.current).toMatchObject({ value: '1658', unit: 'mm', verdict: null });
    expect(view.current?.evidence).toHaveLength(1);
    expect(view.current?.evidence[0]).toMatchObject({
      kind: 'photo',
      mediaType: 'image/jpeg',
      byteSize: 7,
    });
    expect(view.observationCount).toBe(1);
  });

  it('treats a lone "undetermined" as Unverifiable for a numeric requirement', () => {
    expect(record(TRACK, { verdict: 'undetermined' }).status).toBe('unverifiable');
  });

  it('records a manual verdict', () => {
    const view = record(EXTINGUISHER, { verdict: 'fail', files: [jpeg()] });
    expect(view.status).toBe('non-compliant');
    expect(view.current).toMatchObject({ value: null, verdict: 'fail' });
  });

  it('stores confirmed conditions in the rule order, once each', () => {
    const view = record(WEIGHT, {
      value: '1100',
      unit: 'kg',
      confirmedConditions: ['balanza-nivelada', 'piloto-a-bordo', 'balanza-nivelada'],
      files: [jpeg()],
    });
    expect(view.current?.confirmedConditions).toEqual(['piloto-a-bordo', 'balanza-nivelada']);
  });

  it('keeps accents and trims empty notes to nothing', () => {
    const withNote = record(TRACK, { value: '1', unit: 'mm', note: 'Medición con el ñandú' });
    expect(withNote.current?.note).toBe('Medición con el ñandú');
    const blank = record(TRACK, { value: '1', unit: 'mm', note: '   ' });
    expect(blank.current?.note).toBeNull();
  });

  it('keeps counts of statuses up to date', () => {
    record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg()],
    });
    record(EXTINGUISHER, { verdict: 'fail', files: [jpeg(1)] });
    record(WEIGHT, { value: '1200', unit: 'kg' });
    const { counts } = getChecklist(env.ctx, inspectionId);
    expect(counts).toMatchObject({
      pending: 17,
      compliant: 1,
      'non-compliant': 1,
      unverifiable: 1,
    });
  });
});

describe('recordObservation: validation', () => {
  it.each([
    ['a decimal comma', { value: '1658,5', unit: 'mm' }, /dot as the decimal separator/],
    ['exponent notation', { value: '1e3', unit: 'mm' }, /Exponent/],
    ['a different unit', { value: '1.658', unit: 'm' }, /Units are not converted/],
    ['a missing unit', { value: '1658' }, /Units are not converted/],
    ['no value and no verdict', {}, /Enter a measurement/],
    ['a value together with a verdict', { value: '5', unit: 'mm', verdict: 'pass' }, /not both/],
    ['pass on a numeric rule', { verdict: 'pass' }, /Enter a measurement/],
    [
      'an unknown condition',
      { value: '1', unit: 'mm', confirmedConditions: ['nope'] },
      /Unknown condition/,
    ],
    ['an overlong note', { value: '1', unit: 'mm', note: 'x'.repeat(501) }, /at most 500/],
    [
      'an unsupported file',
      { value: '1', unit: 'mm', files: [new TextEncoder().encode('<html>')] },
      /not a supported type/,
    ],
  ])('rejects %s', (_label, fields, message) => {
    expectError(() => record(TRACK, fields), 'invalid-input', message);
    expect(getChecklist(env.ctx, inspectionId).counts.pending).toBe(20);
  });

  it('rejects a measurement for a manual requirement and a missing or unknown verdict', () => {
    expectError(
      () => record(EXTINGUISHER, { value: '1', unit: 'mm' }),
      'invalid-input',
      /judged by a verdict/,
    );
    expectError(() => record(EXTINGUISHER, {}), 'invalid-input', /Choose a verdict/);
    expectError(
      () => record(EXTINGUISHER, { verdict: 'maybe' }),
      'invalid-input',
      /must be one of/,
    );
  });

  it('rejects too many files at once', () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, n) => jpeg(n));
    expectError(() => record(TRACK, { value: '1', unit: 'mm', files }), 'invalid-input', /At most/);
  });

  it('rejects an unknown requirement and an unknown inspection', () => {
    expectError(() => record('no-such-requirement', { verdict: 'pass' }), 'not-found');
    expectError(
      () =>
        recordObservation(env.ctx, {
          inspectionId: 'missing',
          requirementKey: TRACK,
          verdict: 'pass',
        }),
      'not-found',
    );
  });

  it('writes nothing when any part of a request is invalid', () => {
    expectError(
      () =>
        record(TRACK, {
          value: '1658',
          unit: 'mm',
          files: [jpeg(), new TextEncoder().encode('bad')],
        }),
      'invalid-input',
    );
    const track = find(getChecklist(env.ctx, inspectionId), TRACK);
    expect(track.observationCount).toBe(0);
    expect(env.ctx.store.listBlobs().filter((blob) => blob.mediaType === 'image/jpeg')).toEqual([]);
  });
});

describe('re-measuring and history', () => {
  it('supersedes the current observation while keeping every earlier record', () => {
    record(TRACK, {
      value: '1661',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg(1)],
    });
    env.advance(60);
    const second = record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
    });

    expect(second.observationCount).toBe(2);
    expect(second.current?.value).toBe('1658');
    expect(second.current?.evidence).toEqual([]);
    expect(second.status).toBe('unverifiable');

    const history = getHistory(env.ctx, inspectionId, TRACK);
    expect(history.map((entry) => entry.observation.value)).toEqual(['1661', '1658']);
    expect(history[0]?.evidence).toHaveLength(1);
    expect(history[0]?.results.map((r) => r.status)).toEqual(['non-compliant']);
    expect(history[1]?.results.map((r) => r.status)).toEqual(['unverifiable']);
  });

  it('does not let the old observation’s evidence count for the new one', () => {
    record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg()],
    });
    const again = record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
    });
    expect(again.status).toBe('unverifiable');
    expect(again.reasons[0]).toMatchObject({ code: 'evidence-missing', detail: 'photo' });
  });

  it('rejects history for a requirement outside the edition', () => {
    expectError(() => getHistory(env.ctx, inspectionId, 'nope'), 'not-found');
  });
});

describe('addEvidence', () => {
  it('turns an Unverifiable result into a judged one and keeps both results', () => {
    const before = record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
    });
    expect(before.status).toBe('unverifiable');

    env.advance(30);
    const after = addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [jpeg()] });
    expect(after.status).toBe('compliant');
    expect(after.observationCount).toBe(1);
    expect(after.current?.evidence).toHaveLength(1);

    const [entry] = getHistory(env.ctx, inspectionId, TRACK);
    expect(entry?.results.map((r) => r.status)).toEqual(['unverifiable', 'compliant']);
  });

  it('counts a PDF as a document, not a photo', () => {
    record(EXTINGUISHER, { verdict: 'pass' });
    const withPdf = addEvidence(env.ctx, {
      inspectionId,
      requirementKey: EXTINGUISHER,
      files: [pdf()],
    });
    expect(withPdf.status).toBe('unverifiable');
    expect(withPdf.current?.evidence[0]?.kind).toBe('document');
    const withPhoto = addEvidence(env.ctx, {
      inspectionId,
      requirementKey: EXTINGUISHER,
      files: [jpeg()],
    });
    expect(withPhoto.status).toBe('compliant');
    expect(withPhoto.current?.evidence).toHaveLength(2);
  });

  it('requires an observation first, and at least one valid file', () => {
    expectError(
      () => addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [jpeg()] }),
      'conflict',
      /Record a measurement or verdict/,
    );
    record(TRACK, { value: '1', unit: 'mm' });
    expectError(
      () => addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [] }),
      'invalid-input',
    );
    expectError(
      () =>
        addEvidence(env.ctx, {
          inspectionId,
          requirementKey: TRACK,
          files: [new TextEncoder().encode('x')],
        }),
      'invalid-input',
    );
  });

  it('stores identical files once but attaches them each time', () => {
    record(TRACK, { value: '1658', unit: 'mm' });
    addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [jpeg(9)] });
    addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [jpeg(9)] });
    const track = find(getChecklist(env.ctx, inspectionId), TRACK);
    expect(track.current?.evidence).toHaveLength(2);
    expect(
      env.ctx.store.listBlobs().filter((blob) => blob.mediaType === 'image/jpeg'),
    ).toHaveLength(1);
  });
});

describe('reproducibility', () => {
  it('stores the rule values used with every result', () => {
    record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg()],
    });
    const result = env.ctx.store.currentResults(inspectionId).get(TRACK);
    const snapshot = result?.ruleSnapshot as RuleSnapshot;
    expect(snapshot.editionId).toBe(
      env.ctx.store.findEditionByLabel('COPA-DEMO', '2026', '2026-R1')?.id,
    );
    expect(snapshot.requirement.check).toEqual({ type: 'max', limit: '1660', unit: 'mm' });
    expect(result?.engineVersion).toBe(ENGINE_VERSION);
  });

  it('re-evaluating every stored result from its stored inputs gives the same answer', () => {
    record(TRACK, { value: '1661', unit: 'mm', confirmedConditions: ['reposo-plano'] });
    addEvidence(env.ctx, { inspectionId, requirementKey: TRACK, files: [jpeg()] });
    record(TRACK, {
      value: '1658',
      unit: 'mm',
      confirmedConditions: ['reposo-plano'],
      files: [jpeg(2)],
    });
    record(WEIGHT, {
      value: '1200',
      unit: 'kg',
      confirmedConditions: ['piloto-a-bordo'],
      files: [jpeg(3)],
    });
    record(EXTINGUISHER, { verdict: 'undetermined' });

    let checked = 0;
    for (const key of [TRACK, WEIGHT, EXTINGUISHER]) {
      for (const result of env.ctx.store.listResults(inspectionId, key)) {
        const observation = env.ctx.store.getObservation(result.observationId);
        if (observation === undefined) throw new Error('missing observation');
        const evidence = result.evidenceIds.map((id) => {
          const found = env.ctx.store
            .listEvidenceForObservation(observation.id)
            .find((item) => item.id === id);
          if (found === undefined) throw new Error('missing evidence');
          return found;
        });
        const input: ObservationInput = {
          value: observation.value,
          unit: observation.unit,
          verdict: observation.verdict,
          confirmedConditions: observation.confirmedConditions,
        };
        const again = evaluate((result.ruleSnapshot as RuleSnapshot).requirement, input, evidence);
        expect(again.status).toBe(result.status);
        expect(again.reasons).toEqual(result.reasons);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});
