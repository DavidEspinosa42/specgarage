import { describe, expect, it } from 'vitest';
import {
  compareDecimal,
  DecimalFormatError,
  explainDecimalProblem,
  formatDecimal,
  normalizeDecimalString,
  parseDecimal,
  tryParseDecimal,
} from '../../src/domain/decimal.ts';

describe('parseDecimal', () => {
  it.each([
    ['1660', '1660'],
    ['1658.5', '1658.5'],
    ['-3.5', '-3.5'],
    ['0', '0'],
    ['0.075', '0.075'],
    ['1660.0', '1660'],
    ['1.250', '1.25'],
    ['-0', '0'],
    ['-0.00', '0'],
  ])('accepts %s and normalizes it to %s', (input, expected) => {
    expect(normalizeDecimalString(input)).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['a decimal comma', '1658,5'],
    ['a thousands dot with comma', '1.658,5'],
    ['a leading plus', '+5'],
    ['exponent notation', '1e3'],
    ['a leading dot', '.5'],
    ['a trailing dot', '5.'],
    ['a leading zero', '01660'],
    ['inner spaces', '1 658'],
    ['surrounding spaces', ' 1658 '],
    ['letters', 'abc'],
    ['two dots', '1.2.3'],
    ['a lone minus', '-'],
    ['more than 30 digits', '1'.repeat(31)],
  ])('rejects %s', (_label, input) => {
    expect(tryParseDecimal(input)).toBeNull();
    expect(() => parseDecimal(input)).toThrow(DecimalFormatError);
  });

  it('accepts exactly 30 digits', () => {
    expect(tryParseDecimal('1'.repeat(30))).not.toBeNull();
  });

  it('explains the decimal comma specifically', () => {
    expect(explainDecimalProblem('1658,5')).toMatch(/dot as the decimal separator/);
  });

  it('returns null from explainDecimalProblem for valid input', () => {
    expect(explainDecimalProblem('1660')).toBeNull();
  });
});

describe('compareDecimal', () => {
  const cmp = (a: string, b: string) => compareDecimal(parseDecimal(a), parseDecimal(b));

  it('orders integers and fractions', () => {
    expect(cmp('1658', '1660')).toBe(-1);
    expect(cmp('1661', '1660')).toBe(1);
    expect(cmp('1660', '1660')).toBe(0);
    expect(cmp('1660.0', '1660')).toBe(0);
    expect(cmp('1660.001', '1660')).toBe(1);
    expect(cmp('1659.999', '1660')).toBe(-1);
  });

  it('orders negative numbers', () => {
    expect(cmp('-3.5', '-3')).toBe(-1);
    expect(cmp('-3.5', '3.5')).toBe(-1);
    expect(cmp('-0', '0')).toBe(0);
  });

  it('is exact where binary floating point is not', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; decimals compare the written values.
    expect(cmp('0.3', '0.3')).toBe(0);
    expect(cmp('0.30000000000000004', '0.3')).toBe(1);
    expect(cmp('9007199254740993', '9007199254740992')).toBe(1);
  });

  it('matches BigInt-scaled reference results on pseudo-random inputs', () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const make = () => {
      const whole = next() % 5000;
      const fractionDigits = next() % 5;
      const fraction = Array.from({ length: fractionDigits }, () => next() % 10).join('');
      const sign = next() % 4 === 0 ? '-' : '';
      return fractionDigits === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
    };
    for (let i = 0; i < 500; i += 1) {
      const a = make();
      const b = make();
      const scale = 6;
      const toScaled = (text: string) => {
        const negative = text.startsWith('-');
        const [w = '0', f = ''] = text.replace('-', '').split('.');
        const value = BigInt(w + f.padEnd(scale, '0'));
        return negative ? -value : value;
      };
      const left = toScaled(a);
      const right = toScaled(b);
      const expected = left < right ? -1 : left > right ? 1 : 0;
      expect(cmp(a, b)).toBe(expected);
    }
  });
});

describe('formatDecimal', () => {
  it('round-trips canonical text', () => {
    for (const text of ['0', '5', '-5', '0.5', '-0.5', '0.001', '1658.25', '-1000000.000001']) {
      expect(formatDecimal(parseDecimal(text))).toBe(text);
    }
  });
});
