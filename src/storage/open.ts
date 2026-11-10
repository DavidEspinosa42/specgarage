import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BlobStore } from './blobs.ts';
import { openDatabase } from './database.ts';
import { Store } from './store.ts';

export interface Storage {
  /** Absolute path of the data directory. */
  dataDir: string;
  store: Store;
  blobs: BlobStore;
  close(): void;
}

/**
 * Opens (creating if needed) a data directory holding `specgarage.db` and a
 * `blobs/` folder of stored files, and applies pending migrations.
 */
export function openStorage(dataDir: string, now?: () => string): Storage {
  const root = resolve(dataDir);
  mkdirSync(join(root, 'blobs'), { recursive: true });
  const db = openDatabase(join(root, 'specgarage.db'), now);
  return {
    dataDir: root,
    store: new Store(db),
    blobs: new BlobStore(join(root, 'blobs')),
    close: () => db.close(),
  };
}
