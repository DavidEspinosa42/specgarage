import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit order, no
 * insignificant whitespace, and undefined properties omitted. Equal data always
 * serializes to identical text, which makes it safe to hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Cannot canonicalize a non-finite number.');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        // Array.from visits every index, so holes in sparse arrays become null like undefined.
        const items = Array.from(value, (item) => canonicalJson(item === undefined ? null : item));
        return `[${items.join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
      return `{${entries.join(',')}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize a value of type ${typeof value}.`);
  }
}

/** Lowercase hexadecimal SHA-256 digest. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 of the canonical JSON of a value. */
export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
