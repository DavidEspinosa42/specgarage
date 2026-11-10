import { compareDecimal, type Decimal, tryParseDecimal } from '../domain/decimal.ts';
import type { Evaluation, ObservationInput, Reason } from '../domain/evaluation.ts';
import type { EvidenceKind, NumericCheck, Requirement } from '../domain/rulepack.ts';

/**
 * Decides the status of one requirement from the rule, the current
 * observation, and the evidence attached to that observation.
 *
 * Pure: no I/O, clock, or randomness. Compliant and Non-Compliant are only
 * produced when the observation is well-formed, every condition is confirmed,
 * and every required kind of evidence is attached. Anything less is
 * Unverifiable, never a guess. Nothing is inferred from file contents.
 */
export function evaluate(
  requirement: Requirement,
  observation: ObservationInput | null,
  evidence: readonly { kind: EvidenceKind }[],
): Evaluation {
  if (observation === null) {
    return {
      status: 'pending',
      reasons: [{ code: 'no-observation', message: 'Nothing has been recorded yet.' }],
    };
  }

  if (observation.verdict === 'undetermined') {
    return {
      status: 'unverifiable',
      reasons: [
        { code: 'verdict-undetermined', message: 'The observer could not determine the result.' },
      ],
    };
  }

  const blockers: Reason[] = [];
  const check = requirement.check;
  let measured: Decimal | null = null;

  if (check.type === 'manual') {
    if (observation.value !== null || observation.unit !== null) {
      blockers.push({
        code: 'invalid-observation',
        message: 'A manual requirement is judged by a verdict, not a measurement.',
      });
    } else if (observation.verdict === null) {
      blockers.push({ code: 'invalid-observation', message: 'No verdict was recorded.' });
    }
  } else {
    if (observation.verdict !== null) {
      blockers.push({
        code: 'invalid-observation',
        message: 'A numeric requirement is judged by its measurement, not a manual verdict.',
      });
    } else if (observation.value === null || observation.unit === null) {
      blockers.push({
        code: 'invalid-observation',
        message: 'A measured value and its unit are required.',
      });
    } else if (observation.unit !== check.unit) {
      blockers.push({
        code: 'invalid-observation',
        message: `The measurement unit "${observation.unit}" does not match the rule's unit "${check.unit}".`,
        detail: observation.unit,
      });
    } else {
      measured = tryParseDecimal(observation.value);
      if (measured === null) {
        blockers.push({
          code: 'invalid-observation',
          message: `"${observation.value}" is not a valid number.`,
          detail: observation.value,
        });
      }
    }
  }

  for (const condition of requirement.conditions) {
    if (!observation.confirmedConditions.includes(condition.key)) {
      blockers.push({
        code: 'condition-unconfirmed',
        message: `Condition not confirmed: ${condition.text}`,
        detail: condition.key,
      });
    }
  }

  const attached = new Set(evidence.map((item) => item.kind));
  for (const kind of requirement.evidence) {
    if (!attached.has(kind)) {
      blockers.push({
        code: 'evidence-missing',
        message: `Required evidence missing: ${kind === 'photo' ? 'a photo' : 'a PDF document'}.`,
        detail: kind,
      });
    }
  }

  if (blockers.length > 0) return { status: 'unverifiable', reasons: blockers };

  if (check.type === 'manual') {
    return observation.verdict === 'pass'
      ? {
          status: 'compliant',
          reasons: [{ code: 'verdict-pass', message: 'The observer recorded a pass.' }],
        }
      : {
          status: 'non-compliant',
          reasons: [{ code: 'verdict-fail', message: 'The observer recorded a fail.' }],
        };
  }
  if (measured === null) {
    // Unreachable: a missing measurement is a blocker above.
    throw new Error('Invariant violated: numeric evaluation without a measurement.');
  }
  return judgeNumeric(check, observation.value ?? '', measured);
}

function judgeNumeric(check: NumericCheck, valueText: string, measured: Decimal): Evaluation {
  const shown = `${valueText} ${check.unit}`;
  const limit = (text: string) => parseOrThrow(text);

  switch (check.type) {
    case 'min': {
      const ok = compareDecimal(measured, limit(check.limit)) >= 0;
      return ok
        ? within(`Measured ${shown}, at or above the minimum of ${check.limit} ${check.unit}.`)
        : outside(
            'below-minimum',
            `Measured ${shown}, below the minimum of ${check.limit} ${check.unit}.`,
          );
    }
    case 'max': {
      const ok = compareDecimal(measured, limit(check.limit)) <= 0;
      return ok
        ? within(`Measured ${shown}, at or below the maximum of ${check.limit} ${check.unit}.`)
        : outside(
            'above-maximum',
            `Measured ${shown}, above the maximum of ${check.limit} ${check.unit}.`,
          );
    }
    case 'range': {
      const ok =
        compareDecimal(measured, limit(check.min)) >= 0 &&
        compareDecimal(measured, limit(check.max)) <= 0;
      const range = `${check.min} to ${check.max} ${check.unit}`;
      return ok
        ? within(`Measured ${shown}, within the range ${range}.`)
        : outside('outside-range', `Measured ${shown}, outside the range ${range}.`);
    }
  }
}

function within(message: string): Evaluation {
  return { status: 'compliant', reasons: [{ code: 'within-limit', message }] };
}

function outside(
  code: 'below-minimum' | 'above-maximum' | 'outside-range',
  message: string,
): Evaluation {
  return { status: 'non-compliant', reasons: [{ code, message }] };
}

function parseOrThrow(text: string): Decimal {
  const parsed = tryParseDecimal(text);
  if (parsed === null) throw new Error(`Rule limit "${text}" is not a valid decimal.`);
  return parsed;
}

/** Short human-readable form of a rule's limit, for display. */
export function describeCheck(requirement: Requirement): string {
  const check = requirement.check;
  switch (check.type) {
    case 'min':
      return `≥ ${check.limit} ${check.unit}`;
    case 'max':
      return `≤ ${check.limit} ${check.unit}`;
    case 'range':
      return `${check.min} to ${check.max} ${check.unit}`;
    case 'manual':
      return check.instruction;
  }
}
