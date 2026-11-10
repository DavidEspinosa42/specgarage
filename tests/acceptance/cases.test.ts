/**
 * Acceptance cases from the project brief that the first release covers,
 * exercised end to end through the service, storage, and engine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecGarageError } from '../../src/domain/errors.ts';
import {
  type ChecklistView,
  getChecklist,
  type RequirementView,
  recordObservation,
} from '../../src/service/checklist.ts';
import { importEdition } from '../../src/service/editions.ts';
import { addVehicle, startInspection } from '../../src/service/inspections.ts';
import { loadRulepackFile } from '../../src/storage/rulepack-file.ts';
import {
  createTestEnvironment,
  demoRulepackPath,
  otherRulepackPath,
  type TestEnvironment,
} from '../helpers.ts';

let env: TestEnvironment;
beforeEach(() => {
  env = createTestEnvironment();
});
afterEach(() => env.cleanup());

const photo = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1]);
const TRACK = 'chasis-trocha-delantera-max';

function start(edition: string, event = 'fecha-1', vehicle = 'DEMO-01') {
  if (env.ctx.store.getVehicle(vehicle) === undefined) addVehicle(env.ctx, vehicle);
  return startInspection(env.ctx, {
    edition,
    vehicleCode: vehicle,
    eventKey: event,
    stationLabel: 'Bay-1',
  }).id;
}

function requirement(view: ChecklistView, key: string): RequirementView {
  const found = view.systems
    .flatMap((system) => system.requirements)
    .find((item) => item.key === key);
  if (found === undefined) throw new Error(`requirement ${key} not found`);
  return found;
}

/** Conditions are defined per rule; the second category's rule has none. */
function measureTrack(
  inspectionId: string,
  value: string,
  withPhoto = true,
  conditions: string[] = ['reposo-plano'],
) {
  return recordObservation(env.ctx, {
    inspectionId,
    requirementKey: TRACK,
    value,
    unit: 'mm',
    confirmedConditions: conditions,
    files: withPhoto ? [photo()] : [],
  });
}

describe('Case 1: dimensional verification', () => {
  it('1658 mm is Compliant and 1661 mm is Non-Compliant against a 1660 mm limit, given evidence', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const inspectionId = start('COPA-DEMO/2026/2026-R1');
    expect(measureTrack(inspectionId, '1658').status).toBe('compliant');
    expect(measureTrack(inspectionId, '1661').status).toBe('non-compliant');
  });

  it('without the required measurement evidence neither value is judged', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const inspectionId = start('COPA-DEMO/2026/2026-R1');
    expect(measureTrack(inspectionId, '1658', false).status).toBe('unverifiable');
    expect(measureTrack(inspectionId, '1661', false).status).toBe('unverifiable');
  });

  it('takes the limit from the rulepack, not from the application', () => {
    const loaded = loadRulepackFile(demoRulepackPath);
    const stricter = structuredClone(loaded.rulepack);
    stricter.edition = 'strict';
    const rule = stricter.requirements.find((item) => item.key === TRACK);
    if (rule?.check.type === 'max') rule.check.limit = '1600';
    importEdition(env.ctx, { ...loaded, rulepack: stricter });
    const inspectionId = start('COPA-DEMO/2026/strict');
    expect(measureTrack(inspectionId, '1658').status).toBe('non-compliant');
  });
});

describe('Case 2: minimum weight that includes the occupant', () => {
  const weigh = (inspectionId: string, conditions: string[]) =>
    recordObservation(env.ctx, {
      inspectionId,
      requirementKey: 'chasis-peso-minimo',
      value: '1100',
      unit: 'kg',
      confirmedConditions: conditions,
      files: [photo()],
    });

  it('is Unverifiable when the measurement conditions cannot be confirmed', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const inspectionId = start('COPA-DEMO/2026/2026-R1');
    const result = weigh(inspectionId, ['balanza-nivelada']);
    expect(result.status).toBe('unverifiable');
    expect(result.reasons).toEqual([
      expect.objectContaining({ code: 'condition-unconfirmed', detail: 'piloto-a-bordo' }),
    ]);
  });

  it('is judged once the driver-aboard condition is confirmed', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const inspectionId = start('COPA-DEMO/2026/2026-R1');
    expect(weigh(inspectionId, ['piloto-a-bordo', 'balanza-nivelada']).status).toBe('compliant');
  });
});

describe('Case 8: regulatory changes', () => {
  it('keeps the original limit for earlier inspections while new ones use the new edition', () => {
    const loaded = loadRulepackFile(demoRulepackPath);
    importEdition(env.ctx, loaded);
    const oldInspection = start('COPA-DEMO/2026/2026-R1');
    expect(measureTrack(oldInspection, '1662').status).toBe('non-compliant');

    // A later edition raises the maximum track width.
    const next = structuredClone(loaded.rulepack);
    next.edition = '2026-R2';
    const rule = next.requirements.find((item) => item.key === TRACK);
    if (rule?.check.type === 'max') rule.check.limit = '1664';
    importEdition(env.ctx, { ...loaded, rulepack: next });

    // The earlier inspection is untouched: same pinned limit, same stored result.
    const oldView = getChecklist(env.ctx, oldInspection);
    expect(oldView.edition.edition).toBe('2026-R1');
    expect(requirement(oldView, TRACK).checkSummary).toBe('≤ 1660 mm');
    expect(requirement(oldView, TRACK).status).toBe('non-compliant');

    // A new inspection pinned to the new edition applies the new limit.
    const newInspection = start('COPA-DEMO/2026/2026-R2', 'fecha-2');
    expect(measureTrack(newInspection, '1662').status).toBe('compliant');
    expect(requirement(getChecklist(env.ctx, newInspection), TRACK).checkSummary).toBe('≤ 1664 mm');

    // Measuring again on the old inspection still uses the old limit.
    expect(measureTrack(oldInspection, '1662').status).toBe('non-compliant');
  });
});

describe('Case 9: category independence', () => {
  it('never applies one category’s rules to another', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    importEdition(env.ctx, loadRulepackFile(otherRulepackPath));
    const demo = start('COPA-DEMO/2026/2026-R1', 'fecha-1', 'DEMO-01');
    const other = start('OTHER-CUP/2026/2026-R1', 'round-1', 'OTHER-01');

    const demoKeys = getChecklist(env.ctx, demo)
      .systems.flatMap((system) => system.requirements)
      .map((item) => item.key);
    const otherKeys = getChecklist(env.ctx, other)
      .systems.flatMap((system) => system.requirements)
      .map((item) => item.key);

    expect(otherKeys.sort()).toEqual([TRACK, 'wheel-width-max']);
    expect(demoKeys).not.toContain('wheel-width-max');
    expect(demoKeys).toHaveLength(20);
  });

  it('the same requirement key carries each category’s own limit', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    importEdition(env.ctx, loadRulepackFile(otherRulepackPath));
    const demo = start('COPA-DEMO/2026/2026-R1', 'fecha-1', 'DEMO-01');
    const other = start('OTHER-CUP/2026/2026-R1', 'round-1', 'OTHER-01');

    expect(measureTrack(demo, '1658').status).toBe('compliant');
    expect(measureTrack(other, '1658', true, []).status).toBe('non-compliant');
    // The demo category's condition does not exist in the other category's rule.
    expect(() => measureTrack(other, '1658')).toThrow(/Unknown condition/);
    expect(requirement(getChecklist(env.ctx, other), TRACK).checkSummary).toBe('≤ 1500 mm');
  });

  it('refuses to record a rule from one category on an inspection of another', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    importEdition(env.ctx, loadRulepackFile(otherRulepackPath));
    const demo = start('COPA-DEMO/2026/2026-R1', 'fecha-1', 'DEMO-01');
    expect(() =>
      recordObservation(env.ctx, {
        inspectionId: demo,
        requirementKey: 'wheel-width-max',
        value: '8',
        unit: 'in',
      }),
    ).toThrow(SpecGarageError);
  });
});
