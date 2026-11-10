import { canonicalJson, sha256Hex } from '../domain/canonical.ts';
import { SpecGarageError } from '../domain/errors.ts';
import { detectMediaType } from '../domain/media.ts';
import {
  editionId,
  parseRulepack,
  type Rulepack,
  type RulepackDocument,
} from '../domain/rulepack.ts';
import type { EditionRecord } from '../storage/store.ts';
import type { ServiceContext } from './context.ts';

export interface ImportInput {
  rulepack: Rulepack;
  /** Contents of each document's file, by document key. */
  documentFiles: ReadonlyMap<string, Uint8Array>;
}

export interface ImportOutcome {
  /** `unchanged` means identical content was already imported. */
  status: 'imported' | 'unchanged';
  id: string;
  categoryCode: string;
  season: string;
  edition: string;
  documentsStored: number;
}

/**
 * Imports a rulepack as an immutable edition. Document files are hashed and
 * stored, and their hashes become part of the edition's identity.
 */
export function importEdition(ctx: ServiceContext, input: ImportInput): ImportOutcome {
  const problems: string[] = [];
  const documents: RulepackDocument[] = [];
  const files: Uint8Array[] = [];

  input.rulepack.documents.forEach((document, index) => {
    const at = `documents[${index}]`;
    if (document.file === undefined) {
      if (document.sha256 !== undefined) {
        problems.push(`${at}.sha256: a hash can only be declared together with a file`);
        return;
      }
      documents.push(document);
      return;
    }
    const bytes = input.documentFiles.get(document.key);
    if (bytes === undefined) {
      problems.push(`${at}.file: the file "${document.file}" was not supplied`);
      return;
    }
    if (detectMediaType(bytes) !== 'application/pdf') {
      problems.push(`${at}.file: "${document.file}" is not a PDF file`);
      return;
    }
    const sha256 = sha256Hex(bytes);
    if (document.sha256 !== undefined && document.sha256 !== sha256) {
      problems.push(`${at}.sha256: the declared hash does not match the file "${document.file}"`);
      return;
    }
    documents.push({ ...document, sha256 });
    files.push(bytes);
  });

  if (problems.length > 0) {
    throw new SpecGarageError('invalid-input', 'The rulepack documents cannot be used.', problems);
  }

  const resolved = parseRulepack({ ...input.rulepack, documents });
  if (!resolved.ok) {
    throw new SpecGarageError(
      'invalid-input',
      'The resolved rulepack is not valid.',
      resolved.issues.map((issue) => `${issue.path}: ${issue.message}`),
    );
  }
  const rulepack = resolved.rulepack;
  const id = editionId(rulepack);
  const summary = {
    id,
    categoryCode: rulepack.category.code,
    season: rulepack.season,
    edition: rulepack.edition,
  };

  if (ctx.store.getEdition(id) !== undefined) {
    return { status: 'unchanged', ...summary, documentsStored: files.length };
  }

  const sameLabel = ctx.store.findEditionByLabel(
    summary.categoryCode,
    summary.season,
    summary.edition,
  );
  if (sameLabel !== undefined) {
    throw new SpecGarageError(
      'conflict',
      `Edition "${summary.edition}" of ${summary.categoryCode} ${summary.season} already exists with different content (${sameLabel.id.slice(0, 12)}). Editions are immutable: use a new edition label for changed regulations.`,
    );
  }

  const importedAt = ctx.now();
  const documentRecords: { documentKey: string; blobSha256: string }[] = [];
  const blobs = documents.flatMap((document) => {
    if (document.file === undefined || document.sha256 === undefined) return [];
    const bytes = input.documentFiles.get(document.key);
    return bytes === undefined ? [] : [{ key: document.key, bytes }];
  });

  // Files are written first: they are addressed by hash, so an unused file is harmless.
  const stored = blobs.map(({ key, bytes }) => ({ key, ...ctx.blobs.put(bytes) }));
  ctx.store.transaction(() => {
    for (const blob of stored) {
      ctx.store.insertBlob({
        sha256: blob.sha256,
        byteSize: blob.byteSize,
        mediaType: 'application/pdf',
        storedAt: importedAt,
      });
      documentRecords.push({ documentKey: blob.key, blobSha256: blob.sha256 });
    }
    ctx.store.insertEdition(
      {
        id,
        categoryCode: summary.categoryCode,
        categoryName: rulepack.category.name,
        season: summary.season,
        edition: summary.edition,
        content: canonicalJson(rulepack),
        importedAt,
      },
      documentRecords,
    );
  });

  return { status: 'imported', ...summary, documentsStored: stored.length };
}

/** Parses the stored content of an edition back into a rulepack. */
export function loadEditionRulepack(edition: EditionRecord): Rulepack {
  const parsed = parseRulepack(JSON.parse(edition.content));
  if (!parsed.ok) {
    throw new Error(`Stored edition ${edition.id} is no longer a valid rulepack.`);
  }
  return parsed.rulepack;
}

const HEX_PREFIX = /^[0-9a-f]{8,64}$/;

/**
 * Finds an edition by `CATEGORY/season/edition` or by a hash prefix of at
 * least 8 hexadecimal characters.
 */
export function resolveEdition(ctx: ServiceContext, reference: string): EditionRecord {
  if (reference.includes('/')) {
    const parts = reference.split('/');
    const [category, season, edition] = parts;
    if (parts.length === 3 && category && season && edition) {
      const found = ctx.store.findEditionByLabel(category, season, edition);
      if (found !== undefined) return found;
    }
    throw new SpecGarageError('not-found', `No edition matches "${reference}".`);
  }
  if (!HEX_PREFIX.test(reference)) {
    throw new SpecGarageError(
      'invalid-input',
      'Refer to an edition as CATEGORY/season/edition or by at least 8 characters of its id.',
    );
  }
  const matches = ctx.store.findEditionsByPrefix(reference);
  if (matches.length === 0)
    throw new SpecGarageError('not-found', `No edition matches "${reference}".`);
  const [only] = matches;
  if (matches.length > 1 || only === undefined) {
    throw new SpecGarageError(
      'invalid-input',
      `"${reference}" matches more than one edition; use more characters.`,
    );
  }
  return only;
}

export interface EditionSummary {
  id: string;
  categoryCode: string;
  categoryName: string;
  season: string;
  edition: string;
  importedAt: string;
}

export function listEditions(ctx: ServiceContext): EditionSummary[] {
  return ctx.store.listEditions().map(({ content: _content, ...summary }) => summary);
}
