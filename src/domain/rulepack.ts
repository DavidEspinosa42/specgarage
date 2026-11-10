import { z } from 'zod';
import { hashJson } from './canonical.ts';
import {
  compareDecimal,
  explainDecimalProblem,
  normalizeDecimalString,
  parseDecimal,
} from './decimal.ts';

/**
 * Rulepack: a category-season's regulations expressed as verifiable
 * requirements. Everything category-specific lives here, never in code.
 */

export const RULEPACK_SCHEMA_ID = 'specgarage.rulepack/1';
export const DOCUMENT_TYPES = ['technical', 'sporting', 'appendix', 'bulletin', 'event'] as const;
export const EVIDENCE_KINDS = ['photo', 'document'] as const;
export const MANUAL_LABELS = ['obligation', 'prohibition', 'visual', 'procedural'] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type ManualLabel = (typeof MANUAL_LABELS)[number];

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

const keySchema = z
  .string()
  .regex(
    KEY_PATTERN,
    'must start with a letter or digit and use only letters, digits, ".", "_" or "-" (maximum 64 characters)',
  );

/** Single-line, non-blank text. Content is stored exactly as written. */
const textSchema = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'must not be blank')
    .refine(
      (value) => !hasControlCharacter(value),
      'must be a single line without control characters',
    );

const decimalSchema = z.string().transform((value, ctx) => {
  const problem = explainDecimalProblem(value);
  if (problem !== null) {
    ctx.issues.push({ code: 'custom', message: problem, input: value });
    return z.NEVER;
  }
  return normalizeDecimalString(value);
});

const unitSchema = z
  .string()
  .min(1)
  .max(16)
  .refine((value) => !/\s/.test(value) && !hasControlCharacter(value), 'must not contain spaces');

const relativeFilePathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !hasControlCharacter(value) &&
      !value.includes('\\') &&
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'must be a relative path using "/" separators, without "." or ".." segments',
  );

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hexadecimal characters');

const documentSchema = z.strictObject({
  key: keySchema,
  title: textSchema(200),
  type: z.enum(DOCUMENT_TYPES),
  /** The edition label the document declares for itself. Kept as declared. */
  edition: textSchema(100).optional(),
  effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(),
  pageCount: z.number().int().min(1).max(100000).optional(),
  /** Path of the document file relative to the rulepack file. */
  file: relativeFilePathSchema.optional(),
  /** SHA-256 of the file. Filled in when the rulepack is imported. */
  sha256: sha256Schema.optional(),
});

const systemSchema = z.strictObject({ key: keySchema, name: textSchema(120) });

const eventSchema = z.strictObject({ key: keySchema, name: textSchema(120), date: z.iso.date() });

const minCheckSchema = z.strictObject({
  type: z.literal('min'),
  limit: decimalSchema,
  unit: unitSchema,
});
const maxCheckSchema = z.strictObject({
  type: z.literal('max'),
  limit: decimalSchema,
  unit: unitSchema,
});
const rangeCheckSchema = z.strictObject({
  type: z.literal('range'),
  min: decimalSchema,
  max: decimalSchema,
  unit: unitSchema,
});
const manualCheckSchema = z.strictObject({
  type: z.literal('manual'),
  label: z.enum(MANUAL_LABELS),
  instruction: textSchema(500),
});

const checkSchema = z.discriminatedUnion('type', [
  minCheckSchema,
  maxCheckSchema,
  rangeCheckSchema,
  manualCheckSchema,
]);

const conditionSchema = z.strictObject({ key: keySchema, text: textSchema(300) });

const sourceSchema = z.strictObject({
  document: keySchema,
  /** Free text such as "7-B" or "D": regulations use lettered sub-articles. */
  article: textSchema(40),
  page: z.number().int().min(1).max(100000),
});

const requirementSchema = z.strictObject({
  key: keySchema,
  system: keySchema,
  title: textSchema(200),
  description: textSchema(1000).optional(),
  check: checkSchema,
  /** Circumstances the observer must confirm for a measurement to count. */
  conditions: z.array(conditionSchema).max(10).default([]),
  /** Kinds of files that must be attached to the current observation. */
  evidence: z.array(z.enum(EVIDENCE_KINDS)).max(EVIDENCE_KINDS.length).default([]),
  sources: z.array(sourceSchema).min(1).max(10),
});

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: 'custom', message, path });
}

function checkUniqueKeys(
  items: readonly { key: string }[],
  listName: string,
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.key)) {
      addIssue(ctx, [listName, index, 'key'], `duplicate key "${item.key}"`);
    }
    seen.add(item.key);
  });
}

export const rulepackSchema = z
  .strictObject({
    schema: z.literal(RULEPACK_SCHEMA_ID),
    category: z.strictObject({ code: keySchema, name: textSchema(120) }),
    season: keySchema,
    edition: keySchema,
    /** Language of the regulation text, as a BCP 47 tag such as "es-AR". */
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a language tag such as "es-AR"')
      .optional(),
    documents: z.array(documentSchema).min(1).max(50),
    systems: z.array(systemSchema).min(1).max(50),
    events: z.array(eventSchema).min(1).max(100),
    requirements: z.array(requirementSchema).min(1).max(5000),
  })
  .superRefine((pack, ctx) => {
    checkUniqueKeys(pack.documents, 'documents', ctx);
    checkUniqueKeys(pack.systems, 'systems', ctx);
    checkUniqueKeys(pack.events, 'events', ctx);
    checkUniqueKeys(pack.requirements, 'requirements', ctx);

    const documents = new Map(pack.documents.map((document) => [document.key, document]));
    const systems = new Set(pack.systems.map((system) => system.key));

    pack.documents.forEach((document, index) => {
      if (
        document.effectiveFrom !== undefined &&
        document.effectiveTo !== undefined &&
        document.effectiveFrom > document.effectiveTo
      ) {
        addIssue(
          ctx,
          ['documents', index, 'effectiveTo'],
          'must not be earlier than effectiveFrom',
        );
      }
    });

    pack.requirements.forEach((requirement, index) => {
      const at = (...rest: (string | number)[]) => ['requirements', index, ...rest];

      if (!systems.has(requirement.system)) {
        addIssue(ctx, at('system'), `unknown system "${requirement.system}"`);
      }

      if (requirement.check.type === 'range') {
        const low = parseDecimal(requirement.check.min);
        const high = parseDecimal(requirement.check.max);
        if (compareDecimal(low, high) > 0) {
          addIssue(ctx, at('check', 'min'), 'must not be greater than max');
        }
      }

      const conditionKeys = new Set<string>();
      requirement.conditions.forEach((condition, conditionIndex) => {
        if (conditionKeys.has(condition.key)) {
          addIssue(
            ctx,
            at('conditions', conditionIndex, 'key'),
            `duplicate key "${condition.key}"`,
          );
        }
        conditionKeys.add(condition.key);
      });

      if (new Set(requirement.evidence).size !== requirement.evidence.length) {
        addIssue(ctx, at('evidence'), 'must not list the same evidence kind twice');
      }

      requirement.sources.forEach((source, sourceIndex) => {
        const document = documents.get(source.document);
        if (document === undefined) {
          addIssue(
            ctx,
            at('sources', sourceIndex, 'document'),
            `unknown document "${source.document}"`,
          );
        } else if (document.pageCount !== undefined && source.page > document.pageCount) {
          addIssue(
            ctx,
            at('sources', sourceIndex, 'page'),
            `page ${source.page} is beyond the ${document.pageCount} pages of document "${document.key}"`,
          );
        }
      });
    });
  });

export type Rulepack = z.output<typeof rulepackSchema>;
export type RulepackDocument = Rulepack['documents'][number];
export type RulepackSystem = Rulepack['systems'][number];
export type RulepackEvent = Rulepack['events'][number];
export type Requirement = Rulepack['requirements'][number];
export type Check = Requirement['check'];
export type NumericCheck = Extract<Check, { type: 'min' | 'max' | 'range' }>;
export type ManualCheck = Extract<Check, { type: 'manual' }>;
export type SourceReference = Requirement['sources'][number];

export interface RulepackIssue {
  /** Location in the file, for example `requirements[3].check.limit`. */
  path: string;
  message: string;
}

export type RulepackParseResult =
  | { ok: true; rulepack: Rulepack }
  | { ok: false; issues: RulepackIssue[] };

function formatPath(path: readonly PropertyKey[]): string {
  let text = '';
  for (const part of path) {
    if (typeof part === 'number') text += `[${part}]`;
    else text += text === '' ? String(part) : `.${String(part)}`;
  }
  return text === '' ? '(root)' : text;
}

/** Validates untrusted data as a rulepack, reporting every problem with its location. */
export function parseRulepack(raw: unknown): RulepackParseResult {
  const result = rulepackSchema.safeParse(raw);
  if (result.success) return { ok: true, rulepack: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
    })),
  };
}

/**
 * Identity of an edition: the SHA-256 of the canonical JSON of the validated,
 * normalized rulepack. Equal content always yields the same identity.
 */
export function editionId(rulepack: Rulepack): string {
  return hashJson(rulepack);
}

export function findRequirement(rulepack: Rulepack, key: string): Requirement | undefined {
  return rulepack.requirements.find((requirement) => requirement.key === key);
}
