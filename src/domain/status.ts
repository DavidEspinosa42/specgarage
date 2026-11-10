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

export const NOT_OFFICIAL_NOTICE =
  'Internal preparation assessment. This is not an official inspection, homologation, or certification.';
