/**
 * Exact decimal numbers for limits and measurements.
 *
 * Values are held as a scaled BigInt so comparisons never involve binary
 * floating point. Only plain decimal text is accepted: an optional minus sign,
 * digits, and optionally a dot followed by digits.
 */

export interface Decimal {
  /** The value multiplied by 10^scale. */
  readonly units: bigint;
  /** Number of fractional digits. Normalized: no trailing zeros in the fraction. */
  readonly scale: number;
}

export type Ordering = -1 | 0 | 1;

const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_DIGITS = 30;

export class DecimalFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalFormatError';
  }
}

/**
 * Returns a user-facing reason why the text is not an accepted decimal, or
 * null when it is valid.
 */
export function explainDecimalProblem(input: string): string | null {
  if (input.length === 0) return 'Enter a number.';
  if (/\s/.test(input)) return 'Remove spaces from the number.';
  if (input.includes(',')) {
    return 'Use a dot as the decimal separator (for example 1658.5). The decimal comma is not supported yet.';
  }
  if (input.startsWith('+')) return 'Do not use a leading plus sign.';
  if (/[eE]/.test(input)) return 'Exponent notation is not supported.';
  if (!DECIMAL_PATTERN.test(input)) {
    return 'Enter a plain decimal number such as 1660 or 1658.5 (no leading zeros, no thousands separators).';
  }
  if (input.replace(/[-.]/g, '').length > MAX_DIGITS) {
    return `Too many digits (maximum ${MAX_DIGITS}).`;
  }
  return null;
}

/** Parses decimal text, throwing a DecimalFormatError that explains the problem. */
export function parseDecimal(input: string): Decimal {
  const problem = explainDecimalProblem(input);
  if (problem !== null) throw new DecimalFormatError(problem);

  const [integerPart = '', rawFraction = ''] = input.split('.');
  const fraction = rawFraction.replace(/0+$/, '');
  return { units: BigInt(`${integerPart}${fraction}`), scale: fraction.length };
}

/** Parses decimal text, returning null instead of throwing. */
export function tryParseDecimal(input: string): Decimal | null {
  return explainDecimalProblem(input) === null ? parseDecimal(input) : null;
}

/** Compares two decimals exactly. */
export function compareDecimal(a: Decimal, b: Decimal): Ordering {
  const scale = Math.max(a.scale, b.scale);
  const left = a.units * 10n ** BigInt(scale - a.scale);
  const right = b.units * 10n ** BigInt(scale - b.scale);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Canonical text: no trailing fractional zeros, no negative zero. */
export function formatDecimal(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString();
  const sign = negative ? '-' : '';
  if (value.scale === 0) return `${sign}${digits}`;
  const padded = digits.padStart(value.scale + 1, '0');
  const split = padded.length - value.scale;
  return `${sign}${padded.slice(0, split)}.${padded.slice(split)}`;
}

/** Parses and re-formats, so equal values have identical text. */
export function normalizeDecimalString(input: string): string {
  return formatDecimal(parseDecimal(input));
}
