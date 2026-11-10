import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpecGarageError } from '../../src/domain/errors.ts';
import { parseRulepack } from '../../src/domain/rulepack.ts';
import {
  importEdition,
  listEditions,
  loadEditionRulepack,
  resolveEdition,
} from '../../src/service/editions.ts';
import { loadRulepackFile } from '../../src/storage/rulepack-file.ts';
import {
  createTestEnvironment,
  demoRulepackPath,
  otherRulepackPath,
  type TestEnvironment,
} from '../helpers.ts';

let env: TestEnvironment;
beforeEach(() => {
  env = createTestEnvironment();
});
afterEach(() => env.cleanup());

function expectError(action: () => unknown, code: string, message?: RegExp) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SpecGarageError);
    expect((error as SpecGarageError).code).toBe(code);
    if (message)
      expect(
        (error as SpecGarageError).message + (error as SpecGarageError).details.join('\n'),
      ).toMatch(message);
    return;
  }
  throw new Error('expected an error');
}

/** A tiny valid rulepack whose single document has a file. */
function packWithFile(overrides: Record<string, unknown> = {}) {
  const parsed = parseRulepack({
    schema: 'specgarage.rulepack/1',
    category: { code: 'MINI', name: 'Mini' },
    season: '2026',
    edition: 'r1',
    documents: [{ key: 'TR', title: 'Tech', type: 'technical', file: 'tr.pdf', ...overrides }],
    systems: [{ key: 's', name: 'S' }],
    events: [{ key: 'e1', name: 'E1', date: '2026-01-01' }],
    requirements: [
      {
        key: 'r',
        system: 's',
        title: 'R',
        check: { type: 'max', limit: '5', unit: 'mm' },
        sources: [{ document: 'TR', article: '1', page: 1 }],
      },
    ],
  });
  if (!parsed.ok) throw new Error('fixture invalid');
  return parsed.rulepack;
}
const PDF = new TextEncoder().encode('%PDF-1.4\nfake but typed as a pdf');

describe('importEdition with the demo rulepack', () => {
  it('imports the edition, its documents, and their files', () => {
    const outcome = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    expect(outcome).toMatchObject({
      status: 'imported',
      categoryCode: 'DEMO-CUP',
      season: '2026',
      edition: '2026-R1',
      documentsStored: 2,
    });
    expect(outcome.id).toMatch(/^[0-9a-f]{64}$/);

    const documents = env.ctx.store.listEditionDocuments(outcome.id);
    expect(documents.map((d) => d.documentKey)).toEqual(['SR', 'TR']);
    for (const document of documents) {
      expect(env.ctx.blobs.check(document.blobSha256)).toBe('ok');
      expect(env.ctx.store.getBlob(document.blobSha256)?.mediaType).toBe('application/pdf');
    }
  });

  it('stores the hashes of the document files inside the edition content', () => {
    const outcome = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const record = env.ctx.store.getEdition(outcome.id);
    if (record === undefined) throw new Error('edition was not stored');
    const stored = loadEditionRulepack(record);
    const hashes = env.ctx.store
      .listEditionDocuments(outcome.id)
      .map((d) => d.blobSha256)
      .sort();
    expect(stored.documents.map((d) => d.sha256).sort()).toEqual(hashes);
  });

  it('treats importing identical content again as a no-op', () => {
    const first = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    env.advance(60);
    const second = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    expect(second).toMatchObject({ status: 'unchanged', id: first.id });
    expect(listEditions(env.ctx)).toHaveLength(1);
    expect(env.ctx.store.listBlobs()).toHaveLength(2);
  });

  it('refuses changed content under an existing edition label', () => {
    const loaded = loadRulepackFile(demoRulepackPath);
    importEdition(env.ctx, loaded);
    const changed = structuredClone(loaded.rulepack);
    const front = changed.requirements.find((r) => r.key === 'track-front-max');
    if (front?.check.type === 'max') front.check.limit = '1664';
    expectError(
      () => importEdition(env.ctx, { ...loaded, rulepack: changed }),
      'conflict',
      /immutable: use a new edition label/,
    );
    expect(listEditions(env.ctx)).toHaveLength(1);
  });

  it('imports a changed rulepack as a new edition when its label is new', () => {
    const loaded = loadRulepackFile(demoRulepackPath);
    const first = importEdition(env.ctx, loaded);
    const changed = structuredClone(loaded.rulepack);
    changed.edition = '2026-R2';
    const second = importEdition(env.ctx, { ...loaded, rulepack: changed });
    expect(second.status).toBe('imported');
    expect(second.id).not.toBe(first.id);
    expect(listEditions(env.ctx).map((e) => e.edition)).toEqual(['2026-R1', '2026-R2']);
    // The documents are the same files, so they are stored once.
    expect(env.ctx.store.listBlobs()).toHaveLength(2);
  });

  it('keeps categories independent', () => {
    const demo = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    const other = importEdition(env.ctx, loadRulepackFile(otherRulepackPath));
    expect(other.id).not.toBe(demo.id);
    expect(other.documentsStored).toBe(0);
    expect(listEditions(env.ctx).map((e) => e.categoryCode)).toEqual(['DEMO-CUP', 'OTHER-CUP']);
  });
});

describe('importEdition document handling', () => {
  it('rejects a file that was not supplied', () => {
    expectError(
      () => importEdition(env.ctx, { rulepack: packWithFile(), documentFiles: new Map() }),
      'invalid-input',
      /documents\[0\]\.file: the file "tr\.pdf" was not supplied/,
    );
  });

  it('rejects a document that is not a PDF', () => {
    expectError(
      () =>
        importEdition(env.ctx, {
          rulepack: packWithFile(),
          documentFiles: new Map([['TR', new TextEncoder().encode('<html>')]]),
        }),
      'invalid-input',
      /is not a PDF file/,
    );
  });

  it('rejects a declared hash that does not match the file', () => {
    expectError(
      () =>
        importEdition(env.ctx, {
          rulepack: packWithFile({ sha256: '0'.repeat(64) }),
          documentFiles: new Map([['TR', PDF]]),
        }),
      'invalid-input',
      /declared hash does not match/,
    );
  });

  it('accepts a declared hash that matches', async () => {
    const { sha256Hex } = await import('../../src/domain/canonical.ts');
    const outcome = importEdition(env.ctx, {
      rulepack: packWithFile({ sha256: sha256Hex(PDF) }),
      documentFiles: new Map([['TR', PDF]]),
    });
    expect(outcome.status).toBe('imported');
  });

  it('rejects a declared hash without a file', () => {
    const rulepack = packWithFile();
    const [document] = rulepack.documents;
    if (document) {
      delete document.file;
      document.sha256 = 'a'.repeat(64);
    }
    expectError(
      () => importEdition(env.ctx, { rulepack, documentFiles: new Map() }),
      'invalid-input',
      /only be declared together with a file/,
    );
  });

  it('writes nothing when an import fails', () => {
    expectError(
      () => importEdition(env.ctx, { rulepack: packWithFile(), documentFiles: new Map() }),
      'invalid-input',
    );
    expect(listEditions(env.ctx)).toEqual([]);
    expect(env.ctx.store.listBlobs()).toEqual([]);
  });
});

describe('loadRulepackFile', () => {
  const writePack = (name: string, content: string) => {
    const path = join(env.directory, name);
    writeFileSync(path, content);
    return path;
  };

  it('reports invalid JSON', () => {
    expectError(
      () => loadRulepackFile(writePack('bad.json', '{ nope')),
      'invalid-input',
      /as JSON/,
    );
  });

  it('reports schema problems with their locations', () => {
    expectError(() => loadRulepackFile(writePack('empty.json', '{}')), 'invalid-input', /schema:/);
  });

  it('reports a missing document file', () => {
    const base = JSON.parse(JSON.stringify(packWithFile()));
    expectError(
      () => loadRulepackFile(writePack('missing.json', JSON.stringify(base))),
      'invalid-input',
      /cannot read "tr\.pdf"/,
    );
  });

  it('loads documents from a sub-directory and allows names that begin with two dots', () => {
    mkdirSync(join(env.directory, 'docs'));
    writeFileSync(join(env.directory, 'docs', '..tr.pdf'), PDF);
    const base = JSON.parse(JSON.stringify(packWithFile({ file: 'docs/..tr.pdf' })));
    const loaded = loadRulepackFile(writePack('ok.json', JSON.stringify(base)));
    expect(loaded.documentFiles.get('TR')).toEqual(Buffer.from(PDF));
  });

  it('rejects a path that leaves the rulepack directory', () => {
    const base = JSON.parse(JSON.stringify(packWithFile()));
    base.documents[0].file = '../outside.pdf';
    expectError(
      () => loadRulepackFile(writePack('escape.json', JSON.stringify(base))),
      'invalid-input',
      /documents\[0\]\.file/,
    );
  });
});

describe('resolveEdition', () => {
  it('finds an edition by label, full id, or prefix', () => {
    const { id } = importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    expect(resolveEdition(env.ctx, 'DEMO-CUP/2026/2026-R1').id).toBe(id);
    expect(resolveEdition(env.ctx, id).id).toBe(id);
    expect(resolveEdition(env.ctx, id.slice(0, 8)).id).toBe(id);
  });

  it('reports unknown, malformed, and too-short references', () => {
    importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
    expectError(() => resolveEdition(env.ctx, 'DEMO-CUP/2026/nope'), 'not-found');
    expectError(() => resolveEdition(env.ctx, 'a/b'), 'not-found');
    expectError(() => resolveEdition(env.ctx, '00000000'), 'not-found');
    expectError(() => resolveEdition(env.ctx, 'abc'), 'invalid-input');
    expectError(() => resolveEdition(env.ctx, '%%%%%%%%'), 'invalid-input');
  });
});
