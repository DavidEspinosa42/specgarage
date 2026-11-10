import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/domain/canonical.ts';
import { detectMediaType, evidenceKindFor } from '../../src/domain/media.ts';
import { BlobStore } from '../../src/storage/blobs.ts';

let directory: string;
let store: BlobStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'specgarage-blobs-'));
  store = new BlobStore(directory);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe('BlobStore', () => {
  it('stores bytes under their hash and reads them back', () => {
    const { sha256, byteSize } = store.put(bytes('hello'));
    expect(sha256).toBe(sha256Hex('hello'));
    expect(byteSize).toBe(5);
    expect(store.has(sha256)).toBe(true);
    expect(store.read(sha256).toString('utf8')).toBe('hello');
    expect(store.pathFor(sha256)).toContain(join('sha256', sha256.slice(0, 2), sha256));
  });

  it('stores identical content once', () => {
    const first = store.put(bytes('same'));
    const second = store.put(bytes('same'));
    expect(second.sha256).toBe(first.sha256);
    const shard = join(directory, 'sha256', first.sha256.slice(0, 2));
    expect(readdirSync(shard)).toEqual([first.sha256]);
  });

  it('leaves no temporary files behind', () => {
    store.put(bytes('a'));
    store.put(bytes('b'));
    const all = readdirSync(join(directory, 'sha256'), { recursive: true }).map(String);
    expect(all.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('stores empty files', () => {
    const { sha256, byteSize } = store.put(new Uint8Array());
    expect(byteSize).toBe(0);
    expect(store.check(sha256)).toBe('ok');
  });

  it('rejects hashes that could escape the store directory', () => {
    for (const bad of ['../etc/passwd', 'abc', 'G'.repeat(64), `${'a'.repeat(63)}/`, '']) {
      expect(() => store.pathFor(bad)).toThrow('Invalid file hash.');
      expect(() => store.has(bad)).toThrow();
    }
  });

  it('detects missing and tampered files', () => {
    const { sha256 } = store.put(bytes('original'));
    expect(store.check(sha256)).toBe('ok');
    writeFileSync(store.pathFor(sha256), 'tampered');
    expect(store.check(sha256)).toBe('corrupt');
    expect(store.check('0'.repeat(64))).toBe('missing');
  });
});

describe('detectMediaType', () => {
  const pad = (...head: number[]) => Uint8Array.from([...head, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  it('recognizes supported files by their signature', () => {
    expect(detectMediaType(pad(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectMediaType(pad(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(detectMediaType(bytes('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(detectMediaType(bytes('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('rejects other content regardless of what it claims to be', () => {
    expect(detectMediaType(bytes('<script>alert(1)</script>'))).toBeNull();
    expect(detectMediaType(bytes('GIF89a'))).toBeNull();
    expect(detectMediaType(bytes('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toBeNull();
    expect(detectMediaType(new Uint8Array())).toBeNull();
    expect(detectMediaType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });

  it('does not accept a PDF signature that is not at the start', () => {
    expect(detectMediaType(bytes(' %PDF-1.7'))).toBeNull();
  });

  it('maps images to photos and PDFs to documents', () => {
    expect(evidenceKindFor('image/jpeg')).toBe('photo');
    expect(evidenceKindFor('image/png')).toBe('photo');
    expect(evidenceKindFor('image/webp')).toBe('photo');
    expect(evidenceKindFor('application/pdf')).toBe('document');
  });
});
