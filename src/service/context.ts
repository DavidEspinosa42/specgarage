import { randomUUID } from 'node:crypto';
import type { BlobStore } from '../storage/blobs.ts';
import type { Store } from '../storage/store.ts';

/**
 * Everything a use case needs. Time and identifiers are injected so tests are
 * deterministic.
 */
export interface ServiceContext {
  store: Store;
  blobs: BlobStore;
  /** Current time as an ISO 8601 UTC string. */
  now: () => string;
  /** A new unique identifier. */
  newId: () => string;
}

export function createContext(
  parts: Pick<ServiceContext, 'store' | 'blobs'> & Partial<Pick<ServiceContext, 'now' | 'newId'>>,
): ServiceContext {
  return {
    store: parts.store,
    blobs: parts.blobs,
    now: parts.now ?? (() => new Date().toISOString()),
    newId: parts.newId ?? (() => randomUUID()),
  };
}
