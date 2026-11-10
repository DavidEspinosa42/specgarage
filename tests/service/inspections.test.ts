import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecGarageError } from '../../src/domain/errors.ts';
import { importEdition } from '../../src/service/editions.ts';
import {
  addVehicle,
  listInspections,
  listVehicles,
  resolveInspection,
  startInspection,
} from '../../src/service/inspections.ts';
import { loadRulepackFile } from '../../src/storage/rulepack-file.ts';
import { createTestEnvironment, demoRulepackPath, type TestEnvironment } from '../helpers.ts';

let env: TestEnvironment;
beforeEach(() => {
  env = createTestEnvironment();
  importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
});
afterEach(() => env.cleanup());

const EDITION = 'DEMO-CUP/2026/2026-R1';

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

describe('vehicles', () => {
  it('adds and lists vehicles by internal code', () => {
    addVehicle(env.ctx, 'DEMO-01');
    addVehicle(env.ctx, 'DEMO-02');
    expect(listVehicles(env.ctx).map((v) => v.code)).toEqual(['DEMO-01', 'DEMO-02']);
  });

  it('refuses duplicates', () => {
    addVehicle(env.ctx, 'DEMO-01');
    expectError(() => addVehicle(env.ctx, 'DEMO-01'), 'conflict', /already exists/);
  });

  it.each(['', ' ', 'has space', 'John Smith', '-leading', 'x'.repeat(33), 'a/b', "x'; DROP"])(
    'rejects the code %j',
    (code) => {
      expectError(() => addVehicle(env.ctx, code), 'invalid-input');
    },
  );
});

describe('startInspection', () => {
  const start = (overrides: Record<string, string> = {}) =>
    startInspection(env.ctx, {
      edition: EDITION,
      vehicleCode: 'DEMO-01',
      eventKey: 'round-1',
      stationLabel: 'Bay-2',
      ...overrides,
    });

  beforeEach(() => {
    addVehicle(env.ctx, 'DEMO-01');
  });

  it('pins the inspection to the edition, vehicle, and event', () => {
    const inspection = start();
    expect(inspection).toMatchObject({
      vehicleCode: 'DEMO-01',
      eventKey: 'round-1',
      stationLabel: 'Bay-2',
      startedAt: '2026-03-15T10:00:00.000Z',
    });
    expect(inspection.editionId).toBe(
      env.ctx.store.findEditionByLabel('DEMO-CUP', '2026', '2026-R1')?.id,
    );
  });

  it('lists inspections with the event name and edition', () => {
    start();
    env.advance(60);
    start({ eventKey: 'round-2' });
    const list = listInspections(env.ctx);
    expect(list.map((i) => i.eventName)).toEqual(['Round 2', 'Round 1']);
    expect(list[0]).toMatchObject({
      vehicleCode: 'DEMO-01',
      categoryCode: 'DEMO-CUP',
      season: '2026',
      edition: '2026-R1',
    });
  });

  it('rejects an unknown vehicle, event, or edition', () => {
    expectError(() => start({ vehicleCode: 'NOPE-9' }), 'not-found', /Add it first/);
    expectError(
      () => start({ eventKey: 'round-9' }),
      'not-found',
      /Available: round-1, round-2, round-3/,
    );
    expectError(() => start({ edition: 'DEMO-CUP/2026/none' }), 'not-found');
  });

  it('rejects station labels with characters outside the allowed set', () => {
    for (const label of ['', '-x', 'x'.repeat(33), 'a\nb', '<b>', 'Bay #2', 'Café', "O'Brien"]) {
      expectError(() => start({ stationLabel: label }), 'invalid-input');
    }
  });

  it('cannot tell a name from a label when it fits the allowed shape, which is why the UI warns', () => {
    // The shape rule limits what can be entered; it cannot detect personal data in plain text.
    expect(start({ stationLabel: 'Bay 2' }).stationLabel).toBe('Bay 2');
    expect(start({ stationLabel: 'Jane Smith' }).stationLabel).toBe('Jane Smith');
  });

  it('does not create an inspection when validation fails', () => {
    expectError(() => start({ eventKey: 'round-9' }), 'not-found');
    expect(listInspections(env.ctx)).toEqual([]);
  });

  it('resolves inspections by id prefix', () => {
    const inspection = start();
    expect(resolveInspection(env.ctx, inspection.id).id).toBe(inspection.id);
    expect(resolveInspection(env.ctx, inspection.id.slice(0, 8)).id).toBe(inspection.id);
    expectError(() => resolveInspection(env.ctx, 'ffffffff'), 'not-found');
    expectError(() => resolveInspection(env.ctx, 'abc'), 'invalid-input');
  });

  it('reports an ambiguous prefix', () => {
    start();
    start();
    expectError(() => resolveInspection(env.ctx, '00000000'), 'invalid-input', /more than one/);
  });
});
