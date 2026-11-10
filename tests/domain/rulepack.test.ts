import { describe, expect, it } from 'vitest';
import { editionId, parseRulepack } from '../../src/domain/rulepack.ts';

/** A fresh, minimal, valid rulepack as untrusted JSON. */
function valid(): Record<string, unknown> {
  return {
    schema: 'specgarage.rulepack/1',
    category: { code: 'CAT-A', name: 'Category A (fictional)' },
    season: '2026',
    edition: '2026-R1',
    language: 'en',
    documents: [
      { key: 'TR', title: 'Technical Regulations', type: 'technical', pageCount: 6 },
      { key: 'SR', title: 'Sporting Regulations', type: 'sporting' },
    ],
    systems: [{ key: 'chassis', name: 'Chassis' }],
    events: [{ key: 'round-1', name: 'Round 1', date: '2026-03-15' }],
    requirements: [
      {
        key: 'track-front-max',
        system: 'chassis',
        title: 'Maximum front track width',
        check: { type: 'max', limit: '1660', unit: 'mm' },
        conditions: [{ key: 'static', text: 'Vehicle at rest on a flat surface' }],
        evidence: ['photo'],
        sources: [{ document: 'TR', article: '3', page: 2 }],
      },
      {
        key: 'extinguisher',
        system: 'chassis',
        title: 'Fire extinguisher fitted',
        check: { type: 'manual', label: 'obligation', instruction: 'Fitted and secured' },
        sources: [{ document: 'SR', article: '7-B', page: 3 }],
      },
    ],
  };
}

type Mutable = Record<string, unknown>;
const requirement = (pack: Mutable, index = 0) =>
  (pack.requirements as Mutable[])[index] as Mutable;

function issuesOf(pack: unknown) {
  const result = parseRulepack(pack);
  if (result.ok) throw new Error('expected the rulepack to be rejected');
  return result.issues;
}

describe('parseRulepack — acceptance', () => {
  it('accepts a valid rulepack and applies defaults', () => {
    const result = parseRulepack(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const second = result.rulepack.requirements[1];
    expect(second?.conditions).toEqual([]);
    expect(second?.evidence).toEqual([]);
  });

  it('normalizes decimal limits', () => {
    const pack = valid();
    requirement(pack).check = { type: 'max', limit: '1660.0', unit: 'mm' };
    const result = parseRulepack(pack);
    expect(result.ok && result.rulepack.requirements[0]?.check).toEqual({
      type: 'max',
      limit: '1660',
      unit: 'mm',
    });
  });

  it('accepts min and range checks, negative limits, and accented text', () => {
    const pack = valid();
    (pack.requirements as Mutable[]).push(
      {
        key: 'weight-min',
        system: 'chassis',
        title: 'Minimum weight, including the driver',
        check: { type: 'min', limit: '1090', unit: 'kg' },
        sources: [{ document: 'TR', article: '5', page: 3 }],
      },
      {
        key: 'camber',
        system: 'chassis',
        title: 'Camber',
        check: { type: 'range', min: '-3.5', max: '-1', unit: '°' },
        sources: [{ document: 'TR', article: '5-A', page: 3 }],
      },
    );
    expect(parseRulepack(pack).ok).toBe(true);
  });

  it('accepts a range whose bounds are equal', () => {
    const pack = valid();
    requirement(pack).check = { type: 'range', min: '5', max: '5.0', unit: 'mm' };
    expect(parseRulepack(pack).ok).toBe(true);
  });
});

describe('parseRulepack — structure', () => {
  it('rejects non-objects', () => {
    expect(parseRulepack(null).ok).toBe(false);
    expect(parseRulepack('text').ok).toBe(false);
  });

  it('rejects unknown keys at the top level and nested', () => {
    const pack = valid();
    pack.extra = true;
    requirement(pack).tolerance = '2';
    const paths = issuesOf(pack).map((issue) => issue.path);
    expect(paths).toContain('(root)');
    expect(paths).toContain('requirements[0]');
  });

  it('rejects an unsupported schema id', () => {
    const pack = valid();
    pack.schema = 'specgarage.rulepack/2';
    expect(issuesOf(pack).some((issue) => issue.path === 'schema')).toBe(true);
  });

  it('rejects an unknown check type with a location', () => {
    const pack = valid();
    requirement(pack).check = { type: 'approx', limit: '5', unit: 'mm' };
    expect(issuesOf(pack).some((issue) => issue.path.startsWith('requirements[0].check'))).toBe(
      true,
    );
  });

  it('rejects fields that belong to another check type', () => {
    const pack = valid();
    requirement(pack, 1).check = {
      type: 'manual',
      label: 'obligation',
      instruction: 'x',
      limit: '5',
    };
    expect(issuesOf(pack).length).toBeGreaterThan(0);
  });

  it('requires at least one source', () => {
    const pack = valid();
    requirement(pack).sources = [];
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].sources')).toBe(true);
  });

  it('rejects a requirement without sources at all', () => {
    const pack = valid();
    delete requirement(pack).sources;
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].sources')).toBe(true);
  });

  it('requires at least one document, system, event, and requirement', () => {
    for (const key of ['documents', 'systems', 'events', 'requirements']) {
      const pack = valid();
      pack[key] = [];
      expect(issuesOf(pack).some((issue) => issue.path === key)).toBe(true);
    }
  });
});

describe('parseRulepack — values', () => {
  it.each([
    ['a decimal comma', '1658,5'],
    ['exponent notation', '1e3'],
    ['a leading plus', '+5'],
    ['text', 'about 1660'],
    ['empty text', ''],
  ])('rejects a limit with %s', (_label, limit) => {
    const pack = valid();
    requirement(pack).check = { type: 'max', limit, unit: 'mm' };
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].check.limit')).toBe(true);
  });

  it('rejects a numeric limit that is a JSON number', () => {
    const pack = valid();
    requirement(pack).check = { type: 'max', limit: 1660, unit: 'mm' };
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].check.limit')).toBe(true);
  });

  it('rejects a range with min greater than max', () => {
    const pack = valid();
    requirement(pack).check = { type: 'range', min: '10', max: '9.5', unit: 'mm' };
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].check.min')).toBe(true);
  });

  it('rejects units with spaces or no unit', () => {
    for (const unit of ['', 'square mm']) {
      const pack = valid();
      requirement(pack).check = { type: 'max', limit: '5', unit };
      expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].check.unit')).toBe(
        true,
      );
    }
  });

  it('rejects impossible dates', () => {
    const pack = valid();
    (pack.events as Mutable[])[0] = { key: 'round-1', name: 'Round 1', date: '2026-02-30' };
    expect(issuesOf(pack).some((issue) => issue.path === 'events[0].date')).toBe(true);
  });

  it('rejects a document that ends before it starts', () => {
    const pack = valid();
    (pack.documents as Mutable[])[0] = {
      key: 'TR',
      title: 'Technical',
      type: 'technical',
      effectiveFrom: '2026-12-31',
      effectiveTo: '2026-01-01',
    };
    expect(issuesOf(pack).some((issue) => issue.path === 'documents[0].effectiveTo')).toBe(true);
  });

  it('rejects blank text and control characters', () => {
    const pack = valid();
    requirement(pack).title = '   ';
    requirement(pack, 1).title = 'two\nlines';
    const paths = issuesOf(pack).map((issue) => issue.path);
    expect(paths).toContain('requirements[0].title');
    expect(paths).toContain('requirements[1].title');
  });

  it('rejects malformed keys', () => {
    const pack = valid();
    requirement(pack).key = 'has space';
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].key')).toBe(true);
  });

  it('rejects a page number below 1 or fractional', () => {
    for (const page of [0, 1.5, -2]) {
      const pack = valid();
      requirement(pack).sources = [{ document: 'TR', article: '3', page }];
      expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].sources[0].page')).toBe(
        true,
      );
    }
  });

  it.each([
    '../secret.pdf',
    '/etc/passwd',
    'C:/x.pdf',
    'a\\b.pdf',
    'dir//file.pdf',
    './file.pdf',
    'dir/../file.pdf',
  ])('rejects the document file path %s', (file) => {
    const pack = valid();
    (pack.documents as Mutable[])[0] = { key: 'TR', title: 'T', type: 'technical', file };
    expect(issuesOf(pack).some((issue) => issue.path === 'documents[0].file')).toBe(true);
  });

  it('accepts a plain relative document path', () => {
    const pack = valid();
    (pack.documents as Mutable[])[0] = {
      key: 'TR',
      title: 'T',
      type: 'technical',
      file: 'documents/technical.pdf',
    };
    expect(parseRulepack(pack).ok).toBe(true);
  });

  it('rejects a malformed declared hash', () => {
    const pack = valid();
    (pack.documents as Mutable[])[0] = { key: 'TR', title: 'T', type: 'technical', sha256: 'ABC' };
    expect(issuesOf(pack).some((issue) => issue.path === 'documents[0].sha256')).toBe(true);
  });
});

describe('parseRulepack — cross-references', () => {
  it('rejects duplicate keys in every list', () => {
    const pack = valid();
    (pack.documents as Mutable[]).push({ key: 'TR', title: 'Again', type: 'technical' });
    (pack.systems as Mutable[]).push({ key: 'chassis', name: 'Again' });
    (pack.events as Mutable[]).push({ key: 'round-1', name: 'Again', date: '2026-04-01' });
    (pack.requirements as Mutable[]).push({ ...requirement(pack) });
    const paths = issuesOf(pack).map((issue) => issue.path);
    expect(paths).toContain('documents[2].key');
    expect(paths).toContain('systems[1].key');
    expect(paths).toContain('events[1].key');
    expect(paths).toContain('requirements[2].key');
  });

  it('rejects an unknown system', () => {
    const pack = valid();
    requirement(pack).system = 'brakes';
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].system')).toBe(true);
  });

  it('rejects a source citing an unknown document', () => {
    const pack = valid();
    requirement(pack).sources = [{ document: 'XX', article: '3', page: 1 }];
    expect(
      issuesOf(pack).some((issue) => issue.path === 'requirements[0].sources[0].document'),
    ).toBe(true);
  });

  it('rejects a source page beyond the declared page count', () => {
    const pack = valid();
    requirement(pack).sources = [{ document: 'TR', article: '3', page: 7 }];
    expect(issuesOf(pack).some((issue) => issue.path === 'requirements[0].sources[0].page')).toBe(
      true,
    );
  });

  it('rejects duplicate condition keys and duplicate evidence kinds', () => {
    const pack = valid();
    requirement(pack).conditions = [
      { key: 'static', text: 'A' },
      { key: 'static', text: 'B' },
    ];
    requirement(pack).evidence = ['photo', 'photo'];
    const paths = issuesOf(pack).map((issue) => issue.path);
    expect(paths).toContain('requirements[0].conditions[1].key');
    expect(paths).toContain('requirements[0].evidence');
  });

  it('reports all structural problems together, before cross-reference problems', () => {
    const pack = valid();
    requirement(pack).system = 'nope';
    requirement(pack).check = { type: 'max', limit: '1,5', unit: 'mm' };
    requirement(pack, 1).sources = [];
    const paths = issuesOf(pack).map((issue) => issue.path);
    // Both structural problems are reported at once...
    expect(paths).toContain('requirements[0].check.limit');
    expect(paths).toContain('requirements[1].sources');
    // ...and the unknown system only surfaces once the structure is valid.
    expect(paths).not.toContain('requirements[0].system');

    requirement(pack).check = { type: 'max', limit: '15', unit: 'mm' };
    requirement(pack, 1).sources = [{ document: 'SR', article: 'D', page: 1 }];
    expect(issuesOf(pack).map((issue) => issue.path)).toEqual(['requirements[0].system']);
  });
});

describe('editionId', () => {
  const id = (pack: unknown) => {
    const result = parseRulepack(pack);
    if (!result.ok) throw new Error('invalid fixture');
    return editionId(result.rulepack);
  };

  it('is stable for equal content regardless of key order and decimal spelling', () => {
    const a = valid();
    const b = valid();
    requirement(b).check = { unit: 'mm', limit: '1660.00', type: 'max' };
    expect(id(a)).toBe(id(b));
  });

  it('treats omitted defaults the same as explicit empty lists', () => {
    const a = valid();
    const b = valid();
    requirement(b, 1).conditions = [];
    requirement(b, 1).evidence = [];
    expect(id(a)).toBe(id(b));
  });

  it('changes when a limit changes', () => {
    const a = valid();
    const b = valid();
    requirement(b).check = { type: 'max', limit: '1661', unit: 'mm' };
    expect(id(a)).not.toBe(id(b));
  });

  it('changes when text changes by a single accent', () => {
    const a = valid();
    const b = valid();
    requirement(a).title = 'Peso minimo';
    requirement(b).title = 'Café weight';
    expect(id(a)).not.toBe(id(b));
  });

  it('is a 64-character lowercase hexadecimal digest', () => {
    expect(id(valid())).toMatch(/^[0-9a-f]{64}$/);
  });
});
