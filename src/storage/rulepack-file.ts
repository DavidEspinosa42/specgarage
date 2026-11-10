import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { SpecGarageError } from '../domain/errors.ts';
import { parseRulepack, type Rulepack } from '../domain/rulepack.ts';

export interface LoadedRulepack {
  rulepack: Rulepack;
  /** Contents of each document's file, by document key. */
  documentFiles: Map<string, Uint8Array>;
}

/** Largest regulation document accepted, in bytes. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/**
 * Reads and validates a rulepack file and the document files it references.
 * Document paths are resolved relative to the rulepack and may not leave its
 * directory, even through symbolic links.
 */
export function loadRulepackFile(path: string): LoadedRulepack {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SpecGarageError('invalid-input', `Cannot read "${path}" as JSON: ${reason}`);
  }

  const parsed = parseRulepack(raw);
  if (!parsed.ok) {
    throw new SpecGarageError(
      'invalid-input',
      `"${path}" is not a valid rulepack.`,
      parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
    );
  }

  const baseDirectory = realpathSync(dirname(resolve(path)));
  const documentFiles = new Map<string, Uint8Array>();
  const problems: string[] = [];

  parsed.rulepack.documents.forEach((document, index) => {
    if (document.file === undefined) return;
    const at = `documents[${index}].file`;
    try {
      const real = realpathSync(resolve(baseDirectory, document.file));
      const outside = relative(baseDirectory, real);
      const escapes = outside === '..' || outside.startsWith(`..${sep}`) || isAbsolute(outside);
      if (outside === '' || escapes) {
        problems.push(`${at}: "${document.file}" is outside the rulepack directory`);
        return;
      }
      if (statSync(real).size > MAX_DOCUMENT_BYTES) {
        problems.push(
          `${at}: "${document.file}" is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`,
        );
        return;
      }
      documentFiles.set(document.key, readFileSync(real));
    } catch {
      problems.push(`${at}: cannot read "${document.file}"`);
    }
  });

  if (problems.length > 0) {
    throw new SpecGarageError(
      'invalid-input',
      `"${path}" refers to unusable document files.`,
      problems,
    );
  }
  return { rulepack: parsed.rulepack, documentFiles };
}
