/**
 * Result statuses for a requirement in an inspection.
 *
 * Results are internal assessments, never official homologation.
 */
export const STATUSES = [
  'pending',
  'compliant',
  'non-compliant',
  'unverifiable',
  'not-applicable',
  'conflict',
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  'non-compliant': 'Non-Compliant',
  unverifiable: 'Unverifiable',
  'not-applicable': 'Not Applicable',
  conflict: 'Conflict',
};

/** Statuses that still need attention from the preparer. */
export const OUTSTANDING_STATUSES: readonly Status[] = [
  'pending',
  'non-compliant',
  'unverifiable',
  'conflict',
];

export function emptyStatusCounts(): Record<Status, number> {
  return {
    pending: 0,
    compliant: 0,
    'non-compliant': 0,
    unverifiable: 0,
    'not-applicable': 0,
    conflict: 0,
  };
}

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export const NOT_OFFICIAL_NOTICE =
  'Internal preparation assessment. This is not an official inspection, homologation, or certification.';
