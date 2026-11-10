import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../domain/canonical.ts';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type BlobCheck = 'ok' | 'missing' | 'corrupt';

/**
 * Content-addressed file store: files live at
 * `<root>/sha256/<first two hex>/<hash>`, so the same bytes are stored once
 * and a file's name proves what it should contain.
 */
export class BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Path of the file with this hash. Rejects anything that is not a SHA-256 digest. */
  pathFor(sha256: string): string {
    if (!SHA256_PATTERN.test(sha256)) throw new Error('Invalid file hash.');
    return join(this.root, 'sha256', sha256.slice(0, 2), sha256);
  }

  has(sha256: string): boolean {
    return existsSync(this.pathFor(sha256));
  }

  /**
   * Stores the bytes if they are not already stored and returns their hash.
   * The file appears atomically, so a crash never leaves a partial file under
   * its final name.
   */
  put(data: Uint8Array): { sha256: string; byteSize: number } {
    const sha256 = sha256Hex(data);
    const target = this.pathFor(sha256);
    if (!existsSync(target)) {
      mkdirSync(join(target, '..'), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      writeFileSync(temporary, data, { flag: 'wx' });
      try {
        renameSync(temporary, target);
      } catch (error) {
        rmSync(temporary, { force: true });
        // Another writer stored the same bytes first; that is fine.
        if (!existsSync(target)) throw error;
      }
    }
    return { sha256, byteSize: data.length };
  }

  read(sha256: string): Buffer {
    return readFileSync(this.pathFor(sha256));
  }

  /** Re-hashes the stored file to detect loss or modification. */
  check(sha256: string): BlobCheck {
    const path = this.pathFor(sha256);
    if (!existsSync(path)) return 'missing';
    return sha256Hex(readFileSync(path)) === sha256 ? 'ok' : 'corrupt';
  }
}
