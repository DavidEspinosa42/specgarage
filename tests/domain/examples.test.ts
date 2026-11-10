import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { editionId, parseRulepack, type Rulepack } from '../../src/domain/rulepack.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const demoDirectory = join(root, 'examples', 'demo-cup');

function load(path: string): Rulepack {
  const result = parseRulepack(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.ok) {
    throw new Error(
      `${path} is invalid:\n${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`,
    );
  }
  return result.rulepack;
}

describe('demo rulepack', () => {
  const demo = load(join(demoDirectory, 'rulepack.json'));

  it('is a valid, English-language fictional category', () => {
    expect(demo.category.code).toBe('DEMO-CUP');
    expect(demo.language).toBe('en');
    expect(demo.category.name).toMatch(/fictional/);
  });

  it('covers every vehicle system with at least one requirement', () => {
    for (const system of demo.systems) {
      const count = demo.requirements.filter((requirement) => requirement.system === system.key);
      expect(count.length, system.key).toBeGreaterThan(0);
    }
  });

  it('uses numeric and manual checks, and both evidence kinds', () => {
    const types = new Set(demo.requirements.map((requirement) => requirement.check.type));
    expect([...types].sort()).toEqual(['manual', 'max', 'min', 'range']);
    const evidence = new Set(demo.requirements.flatMap((requirement) => requirement.evidence));
    expect([...evidence].sort()).toEqual(['document', 'photo']);
  });

  it('contains the acceptance-case limits from the project brief', () => {
    const front = demo.requirements.find((r) => r.key === 'track-front-max');
    expect(front?.check).toEqual({ type: 'max', limit: '1660', unit: 'mm' });
    const weight = demo.requirements.find((r) => r.key === 'weight-min');
    expect(weight?.conditions.map((condition) => condition.key)).toContain('driver-aboard');
  });

  it('has an article reference with a page for every source, including cross-document ones', () => {
    const crossDocument = demo.requirements.filter(
      (requirement) => new Set(requirement.sources.map((source) => source.document)).size > 1,
    );
    expect(crossDocument.length).toBeGreaterThan(0);
  });

  it('declares page counts that match the generated PDF files', () => {
    for (const document of demo.documents) {
      expect(document.file).toBeDefined();
      const bytes = readFileSync(join(demoDirectory, document.file ?? ''));
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // "/Type /Page " (with a trailing space) matches pages but not the "/Pages" tree.
      const pages = bytes.toString('latin1').split('/Type /Page ').length - 1;
      expect(pages, document.key).toBe(document.pageCount);
    }
  });
});

describe('second test category', () => {
  const demo = load(join(demoDirectory, 'rulepack.json'));
  const other = load(join(root, 'tests', 'fixtures', 'other-category.rulepack.json'));

  it('is valid and independent of the demo category', () => {
    expect(other.category.code).not.toBe(demo.category.code);
    expect(editionId(other)).not.toBe(editionId(demo));
  });

  it('reuses a requirement key with a different limit to prove keys are scoped per category', () => {
    const inDemo = demo.requirements.find((r) => r.key === 'track-front-max');
    const inOther = other.requirements.find((r) => r.key === 'track-front-max');
    expect(inDemo?.check).toMatchObject({ limit: '1660' });
    expect(inOther?.check).toMatchObject({ limit: '1500' });
  });
});
