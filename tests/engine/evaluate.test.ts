import { describe, expect, it } from 'vitest';
import type { ObservationInput } from '../../src/domain/evaluation.ts';
import { parseRulepack, type Requirement } from '../../src/domain/rulepack.ts';
import { describeCheck, evaluate } from '../../src/engine/evaluate.ts';

/** Builds a validated requirement from a partial definition. */
function rule(definition: Record<string, unknown>): Requirement {
  const parsed = parseRulepack({
    schema: 'specgarage.rulepack/1',
    category: { code: 'CAT', name: 'Category' },
    season: '2026',
    edition: 'r1',
    documents: [{ key: 'TR', title: 'Tech', type: 'technical' }],
    systems: [{ key: 's', name: 'S' }],
    events: [{ key: 'e', name: 'E', date: '2026-01-01' }],
    requirements: [
      {
        key: 'r',
        system: 's',
        title: 'R',
        sources: [{ document: 'TR', article: '1', page: 1 }],
        ...definition,
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const [requirement] = parsed.rulepack.requirements;
  if (requirement === undefined) throw new Error('no requirement');
  return requirement;
}

const measurement = (value: string, unit = 'mm', conditions: string[] = []): ObservationInput => ({
  value,
  unit,
  verdict: null,
  confirmedConditions: conditions,
});
const verdict = (
  v: 'pass' | 'fail' | 'undetermined',
  conditions: string[] = [],
): ObservationInput => ({
  value: null,
  unit: null,
  verdict: v,
  confirmedConditions: conditions,
});
const photo = [{ kind: 'photo' as const }];
const codes = (result: ReturnType<typeof evaluate>) => result.reasons.map((reason) => reason.code);

describe('pending', () => {
  it('is pending when nothing is recorded', () => {
    const result = evaluate(rule({ check: { type: 'max', limit: '5', unit: 'mm' } }), null, []);
    expect(result.status).toBe('pending');
    expect(codes(result)).toEqual(['no-observation']);
  });
});

describe('acceptance case 1: dimensional limit from the rulepack', () => {
  const trackWidth = rule({
    check: { type: 'max', limit: '1660', unit: 'mm' },
    evidence: ['photo'],
  });

  it('1658 mm with evidence is Compliant', () => {
    const result = evaluate(trackWidth, measurement('1658'), photo);
    expect(result.status).toBe('compliant');
    expect(codes(result)).toEqual(['within-limit']);
  });

  it('1661 mm with evidence is Non-Compliant', () => {
    const result = evaluate(trackWidth, measurement('1661'), photo);
    expect(result.status).toBe('non-compliant');
    expect(codes(result)).toEqual(['above-maximum']);
    expect(result.reasons[0]?.message).toContain('1661 mm');
    expect(result.reasons[0]?.message).toContain('1660 mm');
  });

  it('the limit itself is Compliant and the next thousandth is not', () => {
    expect(evaluate(trackWidth, measurement('1660'), photo).status).toBe('compliant');
    expect(evaluate(trackWidth, measurement('1660.0'), photo).status).toBe('compliant');
    expect(evaluate(trackWidth, measurement('1660.001'), photo).status).toBe('non-compliant');
  });

  it('is Unverifiable without the required evidence, whatever the value', () => {
    for (const value of ['1658', '1661']) {
      const result = evaluate(trackWidth, measurement(value), []);
      expect(result.status).toBe('unverifiable');
      expect(result.reasons).toEqual([
        {
          code: 'evidence-missing',
          message: 'Required evidence missing: a photo.',
          detail: 'photo',
        },
      ]);
    }
  });

  it('uses whatever limit the rule declares, not a built-in constant', () => {
    const stricter = rule({
      check: { type: 'max', limit: '1500', unit: 'mm' },
      evidence: ['photo'],
    });
    expect(evaluate(stricter, measurement('1658'), photo).status).toBe('non-compliant');
  });
});

describe('acceptance case 2: conditions on a minimum', () => {
  const weight = rule({
    check: { type: 'min', limit: '1090', unit: 'kg' },
    conditions: [
      { key: 'driver', text: 'Weighed with the driver aboard' },
      { key: 'level', text: 'Scale on level ground' },
    ],
    evidence: ['photo'],
  });

  it('is Unverifiable when the conditions cannot be confirmed', () => {
    const result = evaluate(weight, measurement('1200', 'kg'), photo);
    expect(result.status).toBe('unverifiable');
    expect(result.reasons.map((reason) => reason.detail)).toEqual(['driver', 'level']);
  });

  it('lists only the conditions still missing', () => {
    const result = evaluate(weight, measurement('1200', 'kg', ['level']), photo);
    expect(result.status).toBe('unverifiable');
    expect(result.reasons.map((reason) => reason.detail)).toEqual(['driver']);
  });

  it('judges the value once every condition is confirmed', () => {
    const confirmed = ['driver', 'level'];
    expect(evaluate(weight, measurement('1090', 'kg', confirmed), photo).status).toBe('compliant');
    const light = evaluate(weight, measurement('1089.9', 'kg', confirmed), photo);
    expect(light.status).toBe('non-compliant');
    expect(codes(light)).toEqual(['below-minimum']);
  });

  it('ignores confirmations the rule does not ask for', () => {
    const result = evaluate(weight, measurement('1200', 'kg', ['driver', 'level', 'extra']), photo);
    expect(result.status).toBe('compliant');
  });
});

describe('range checks', () => {
  const wheelbase = rule({ check: { type: 'range', min: '2495', max: '2505', unit: 'mm' } });

  it.each([
    ['2495', 'compliant'],
    ['2500', 'compliant'],
    ['2505', 'compliant'],
    ['2494.99', 'non-compliant'],
    ['2505.01', 'non-compliant'],
  ])('%s mm is %s', (value, status) => {
    expect(evaluate(wheelbase, measurement(value), []).status).toBe(status);
  });

  it('reports the range in the reason', () => {
    const result = evaluate(wheelbase, measurement('2600'), []);
    expect(codes(result)).toEqual(['outside-range']);
    expect(result.reasons[0]?.message).toContain('2495 to 2505 mm');
  });

  it('handles negative bounds exactly', () => {
    const camber = rule({ check: { type: 'range', min: '-3.5', max: '-1', unit: 'deg' } });
    expect(evaluate(camber, measurement('-3.5', 'deg'), []).status).toBe('compliant');
    expect(evaluate(camber, measurement('-3.51', 'deg'), []).status).toBe('non-compliant');
    expect(evaluate(camber, measurement('-0.9', 'deg'), []).status).toBe('non-compliant');
  });
});

describe('manual checks', () => {
  const extinguisher = rule({
    check: { type: 'manual', label: 'obligation', instruction: 'Fitted and secured' },
    evidence: ['photo'],
  });

  it('follows the observer verdict when evidence is attached', () => {
    expect(evaluate(extinguisher, verdict('pass'), photo).status).toBe('compliant');
    const failed = evaluate(extinguisher, verdict('fail'), photo);
    expect(failed.status).toBe('non-compliant');
    expect(codes(failed)).toEqual(['verdict-fail']);
  });

  it('is Unverifiable when undetermined, even with evidence', () => {
    const result = evaluate(extinguisher, verdict('undetermined'), photo);
    expect(result.status).toBe('unverifiable');
    expect(codes(result)).toEqual(['verdict-undetermined']);
  });

  it('is Unverifiable without the required evidence, even for a pass or a fail', () => {
    expect(evaluate(extinguisher, verdict('pass'), []).status).toBe('unverifiable');
    expect(evaluate(extinguisher, verdict('fail'), []).status).toBe('unverifiable');
  });

  it('does not infer anything from the kind of file: a PDF is not a photo', () => {
    const result = evaluate(extinguisher, verdict('pass'), [{ kind: 'document' }]);
    expect(result.status).toBe('unverifiable');
    expect(result.reasons[0]?.detail).toBe('photo');
  });

  it('needs every evidence kind the rule lists', () => {
    const both = rule({
      check: { type: 'manual', label: 'procedural', instruction: 'Sealed' },
      evidence: ['photo', 'document'],
    });
    expect(evaluate(both, verdict('pass'), photo).reasons.map((r) => r.detail)).toEqual([
      'document',
    ]);
    expect(evaluate(both, verdict('pass'), [{ kind: 'photo' }, { kind: 'document' }]).status).toBe(
      'compliant',
    );
  });

  it('needs no evidence or conditions when the rule asks for none', () => {
    const plain = rule({
      check: { type: 'manual', label: 'prohibition', instruction: 'None fitted' },
    });
    expect(evaluate(plain, verdict('pass'), []).status).toBe('compliant');
  });

  it('applies conditions to manual checks too', () => {
    const conditional = rule({
      check: { type: 'manual', label: 'visual', instruction: 'Intact' },
      conditions: [{ key: 'cold', text: 'Engine cold' }],
    });
    expect(evaluate(conditional, verdict('pass'), []).status).toBe('unverifiable');
    expect(evaluate(conditional, verdict('pass', ['cold']), []).status).toBe('compliant');
  });
});

describe('malformed observations are Unverifiable, never guessed', () => {
  const numeric = rule({ check: { type: 'max', limit: '5', unit: 'mm' } });
  const manual = rule({ check: { type: 'manual', label: 'visual', instruction: 'ok' } });

  it('rejects a unit that does not match the rule, without converting', () => {
    const result = evaluate(numeric, measurement('0.005', 'm'), []);
    expect(result.status).toBe('unverifiable');
    expect(result.reasons[0]).toMatchObject({ code: 'invalid-observation', detail: 'm' });
  });

  it('rejects a number the rule cannot compare', () => {
    expect(evaluate(numeric, measurement('1,5'), []).status).toBe('unverifiable');
    expect(evaluate(numeric, measurement('abc'), []).status).toBe('unverifiable');
  });

  it('rejects a numeric rule judged by a pass or fail', () => {
    expect(evaluate(numeric, verdict('pass'), []).status).toBe('unverifiable');
    expect(evaluate(numeric, verdict('fail'), []).status).toBe('unverifiable');
  });

  it('rejects a numeric rule with no measurement', () => {
    const empty: ObservationInput = {
      value: null,
      unit: null,
      verdict: null,
      confirmedConditions: [],
    };
    expect(evaluate(numeric, empty, []).status).toBe('unverifiable');
  });

  it('rejects a manual rule answered with a measurement or nothing', () => {
    expect(evaluate(manual, measurement('5'), []).status).toBe('unverifiable');
    const empty: ObservationInput = {
      value: null,
      unit: null,
      verdict: null,
      confirmedConditions: [],
    };
    expect(evaluate(manual, empty, []).status).toBe('unverifiable');
  });

  it('reports every blocker together', () => {
    const demanding = rule({
      check: { type: 'max', limit: '5', unit: 'mm' },
      conditions: [{ key: 'a', text: 'A' }],
      evidence: ['photo'],
    });
    const result = evaluate(demanding, measurement('3', 'cm'), []);
    expect(codes(result)).toEqual([
      'invalid-observation',
      'condition-unconfirmed',
      'evidence-missing',
    ]);
  });
});

describe('purity', () => {
  it('returns the same result for the same inputs and does not mutate them', () => {
    const requirement = rule({
      check: { type: 'max', limit: '5', unit: 'mm' },
      evidence: ['photo'],
    });
    const observation = measurement('4');
    const snapshot = JSON.stringify({ requirement, observation });
    const first = evaluate(requirement, observation, photo);
    const second = evaluate(requirement, observation, photo);
    expect(second).toEqual(first);
    expect(JSON.stringify({ requirement, observation })).toBe(snapshot);
  });
});

describe('describeCheck', () => {
  it('summarizes each check type', () => {
    expect(describeCheck(rule({ check: { type: 'max', limit: '1660', unit: 'mm' } }))).toBe(
      '≤ 1660 mm',
    );
    expect(describeCheck(rule({ check: { type: 'min', limit: '1090', unit: 'kg' } }))).toBe(
      '≥ 1090 kg',
    );
    expect(
      describeCheck(rule({ check: { type: 'range', min: '725', max: '770', unit: 'g/l' } })),
    ).toBe('725 to 770 g/l');
    expect(
      describeCheck(rule({ check: { type: 'manual', label: 'visual', instruction: 'Intact' } })),
    ).toBe('Intact');
  });
});
