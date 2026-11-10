import { describe, expect, it } from 'vitest';
import { canonicalJson, hashJson, sha256Hex } from '../../src/domain/canonical.ts';
import { emptyStatusCounts, STATUSES } from '../../src/domain/status.ts';

describe('canonicalJson', () => {
  it('sorts keys at every level and removes whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,2]},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('omits undefined properties but keeps null', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('serializes undefined and sparse array slots as null', () => {
    expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
    expect(canonicalJson(new Array(2))).toBe('[null,null]');
    expect(canonicalJson(new Array(1))).not.toBe(canonicalJson([]));
  });

  it('keeps Unicode text exactly as written', () => {
    expect(canonicalJson({ t: 'Width — naïve café' })).toBe('{"t":"Width — naïve café"}');
  });

  it('distinguishes composed from decomposed accents', () => {
    expect(canonicalJson('é')).not.toBe(canonicalJson('é'));
  });

  it('rejects values JSON cannot represent', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
    expect(() => canonicalJson(() => 1)).toThrow(TypeError);
  });
});

describe('hashing', () => {
  it('matches a known SHA-256 vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes equal data to the same digest and different data to different ones', () => {
    expect(hashJson({ a: 1, b: [1, 2] })).toBe(hashJson({ b: [1, 2], a: 1 }));
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
  });
});

describe('status model', () => {
  it('lists the six statuses', () => {
    expect(STATUSES).toHaveLength(6);
  });

  it('creates zeroed counts for every status', () => {
    expect(Object.keys(emptyStatusCounts()).sort()).toEqual([...STATUSES].sort());
    expect(Object.values(emptyStatusCounts()).every((count) => count === 0)).toBe(true);
  });
});
