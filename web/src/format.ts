import type { Status } from './api-types.ts';

export const STATUS_LABELS: Record<Status, string> = {
  pending: 'Pending',
  compliant: 'Compliant',
  'non-compliant': 'Non-Compliant',
  unverifiable: 'Unverifiable',
  'not-applicable': 'Not Applicable',
  conflict: 'Conflict',
};

/** A text symbol so status never depends on color alone. */
export const STATUS_SYMBOLS: Record<Status, string> = {
  pending: '…',
  compliant: '✓',
  'non-compliant': '✗',
  unverifiable: '?',
  'not-applicable': '–',
  conflict: '!',
};

/** Statuses that still need attention from the preparer. */
export const OUTSTANDING: readonly Status[] = [
  'pending',
  'non-compliant',
  'unverifiable',
  'conflict',
];

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 12);
}
