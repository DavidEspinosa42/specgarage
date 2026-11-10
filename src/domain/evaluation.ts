import type { Status } from './status.ts';

/**
 * Types shared by the engine, storage, and service layers for recording and
 * evaluating observations.
 */

/** Bumped whenever evaluation semantics change, so stored results stay explainable. */
export const ENGINE_VERSION = '1';

export const VERDICTS = ['pass', 'fail', 'undetermined'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What the observer recorded for one requirement. */
export interface ObservationInput {
  /** Normalized decimal text, present for numeric measurements. */
  value: string | null;
  /** Unit of the measurement; present exactly when `value` is. */
  unit: string | null;
  /** Manual verdict; for numeric checks only `undetermined` is meaningful. */
  verdict: Verdict | null;
  /** Keys of the rule's conditions the observer confirmed. */
  confirmedConditions: readonly string[];
}

export const REASON_CODES = [
  'no-observation',
  'invalid-observation',
  'verdict-undetermined',
  'condition-unconfirmed',
  'evidence-missing',
  'within-limit',
  'below-minimum',
  'above-maximum',
  'outside-range',
  'verdict-pass',
  'verdict-fail',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** One explanation for a status, with the specifics a person needs to act on it. */
export interface Reason {
  code: ReasonCode;
  message: string;
  /** The condition key, evidence kind, or other item the reason is about. */
  detail?: string;
}

export interface Evaluation {
  status: Status;
  reasons: Reason[];
}
