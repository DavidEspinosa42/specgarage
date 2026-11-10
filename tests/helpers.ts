import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, type ServiceContext } from '../src/service/context.ts';
import { openStorage, type Storage } from '../src/storage/open.ts';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const demoRulepackPath = join(projectRoot, 'examples', 'demo-monomarca', 'rulepack.json');
export const otherRulepackPath = join(
  projectRoot,
  'tests',
  'fixtures',
  'other-category.rulepack.json',
);

export interface TestEnvironment {
  ctx: ServiceContext;
  storage: Storage;
  directory: string;
  /** Moves the fake clock forward. */
  advance(seconds: number): void;
  cleanup(): void;
}

/**
 * A throwaway data directory under the OS temp folder with a fake clock and
 * sequential ids. Never touches a real data directory.
 */
export function createTestEnvironment(): TestEnvironment {
  const directory = mkdtempSync(join(tmpdir(), 'specgarage-test-'));
  let time = Date.parse('2026-03-15T10:00:00.000Z');
  let counter = 0;
  const now = () => new Date(time).toISOString();
  const storage = openStorage(directory, now);
  const ctx = createContext({
    store: storage.store,
    blobs: storage.blobs,
    now,
    newId: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    },
  });
  return {
    ctx,
    storage,
    directory,
    advance: (seconds) => {
      time += seconds * 1000;
    },
    cleanup: () => {
      storage.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
