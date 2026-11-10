import { explainDecimalProblem, normalizeDecimalString } from '../domain/decimal.ts';
import { SpecGarageError } from '../domain/errors.ts';
import {
  ENGINE_VERSION,
  type Evaluation,
  type ObservationInput,
  type Reason,
  VERDICTS,
  type Verdict,
} from '../domain/evaluation.ts';
import { detectMediaType, evidenceKindFor, type MediaType } from '../domain/media.ts';
import type { Check, EvidenceKind, Requirement, Rulepack } from '../domain/rulepack.ts';
import { emptyStatusCounts, NOT_OFFICIAL_NOTICE, type Status } from '../domain/status.ts';
import { describeCheck, evaluate } from '../engine/evaluate.ts';
import type {
  EditionRecord,
  EvidenceRecord,
  InspectionRecord,
  ObservationRecord,
} from '../storage/store.ts';
import type { ServiceContext } from './context.ts';
import { loadEditionRulepack } from './editions.ts';

/** Most files accepted with one observation or one evidence upload. */
export const MAX_FILES_PER_UPLOAD = 10;
const MAX_NOTE_LENGTH = 500;

export interface RecordObservationInput {
  inspectionId: string;
  requirementKey: string;
  /** Measurement as typed: plain decimal text. */
  value?: string | null;
  /** Unit of the measurement; must equal the rule's unit exactly. */
  unit?: string | null;
  verdict?: string | null;
  /** Keys of the rule's conditions the observer confirms. */
  confirmedConditions?: readonly string[];
  note?: string | null;
  files?: readonly Uint8Array[];
}

export interface AddEvidenceInput {
  inspectionId: string;
  requirementKey: string;
  /**
   * The observation the files were prepared for. If the requirement has been recorded
   * again since, the upload is refused instead of attaching to the newer observation,
   * which could make a result look supported by evidence that belongs to something else.
   */
  observationId: number;
  files: readonly Uint8Array[];
}

/** What a stored result was computed from, so it can be reproduced. */
export interface RuleSnapshot {
  editionId: string;
  requirement: Requirement;
}

export interface EvidenceView {
  id: number;
  kind: EvidenceKind;
  sha256: string;
  mediaType: MediaType;
  byteSize: number;
  recordedAt: string;
}

export interface CurrentObservationView {
  id: number;
  recordedAt: string;
  value: string | null;
  unit: string | null;
  verdict: Verdict | null;
  confirmedConditions: string[];
  note: string | null;
  evidence: EvidenceView[];
}

export interface SourceView {
  documentKey: string;
  documentTitle: string;
  article: string;
  page: number;
  /** Hash of the stored document file, or null when the document has no stored file. */
  fileSha256: string | null;
}

export interface RequirementView {
  key: string;
  title: string;
  description: string | null;
  system: string;
  check: Check;
  checkSummary: string;
  conditions: { key: string; text: string }[];
  requiredEvidence: EvidenceKind[];
  sources: SourceView[];
  status: Status;
  reasons: Reason[];
  current: CurrentObservationView | null;
  /** Observations recorded for this requirement, including superseded ones. */
  observationCount: number;
}

export interface DocumentView {
  key: string;
  title: string;
  type: string;
  edition: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sha256: string | null;
}

export interface ChecklistView {
  inspection: {
    id: string;
    vehicleCode: string;
    eventKey: string;
    eventName: string;
    eventDate: string;
    stationLabel: string;
    startedAt: string;
  };
  edition: {
    id: string;
    categoryCode: string;
    categoryName: string;
    season: string;
    edition: string;
    language: string | null;
  };
  documents: DocumentView[];
  systems: { key: string; name: string; requirements: RequirementView[] }[];
  counts: Record<Status, number>;
  notice: string;
}

interface Loaded {
  inspection: InspectionRecord;
  edition: EditionRecord;
  rulepack: Rulepack;
}

function load(ctx: ServiceContext, inspectionId: string): Loaded {
  const inspection = ctx.store.getInspection(inspectionId);
  if (inspection === undefined) {
    throw new SpecGarageError('not-found', `No inspection "${inspectionId}".`);
  }
  const edition = ctx.store.getEdition(inspection.editionId);
  if (edition === undefined) throw new Error(`Inspection ${inspection.id} has no edition.`);
  return { inspection, edition, rulepack: loadEditionRulepack(edition) };
}

function findRule(rulepack: Rulepack, requirementKey: string): Requirement {
  const requirement = rulepack.requirements.find((item) => item.key === requirementKey);
  if (requirement === undefined) {
    throw new SpecGarageError(
      'not-found',
      `Requirement "${requirementKey}" is not part of this inspection's edition.`,
    );
  }
  return requirement;
}

function toInput(observation: ObservationRecord): ObservationInput {
  return {
    value: observation.value,
    unit: observation.unit,
    verdict: observation.verdict,
    confirmedConditions: observation.confirmedConditions,
  };
}

function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

/** An observation after validation: normalized, checked against the rule, ready to store. */
interface CleanObservation {
  value: string | null;
  unit: string | null;
  verdict: Verdict | null;
  confirmedConditions: string[];
  note: string | null;
}

/** Validates what the observer entered against the rule and returns the cleaned record. */
function validateObservation(
  requirement: Requirement,
  input: RecordObservationInput,
): CleanObservation {
  const value = input.value === undefined || input.value === '' ? null : input.value;
  const unit = input.unit === undefined || input.unit === '' ? null : input.unit;
  const verdictText = input.verdict === undefined || input.verdict === '' ? null : input.verdict;
  const check = requirement.check;

  let verdict: Verdict | null = null;
  if (verdictText !== null) {
    if (!isVerdict(verdictText)) {
      throw new SpecGarageError(
        'invalid-input',
        `The verdict must be one of: ${VERDICTS.join(', ')}.`,
      );
    }
    verdict = verdictText;
  }

  let cleanValue: string | null = null;
  let cleanUnit: string | null = null;

  if (check.type === 'manual') {
    if (value !== null || unit !== null) {
      throw new SpecGarageError(
        'invalid-input',
        'This requirement is judged by a verdict; do not enter a measurement.',
      );
    }
    if (verdict === null) {
      throw new SpecGarageError('invalid-input', 'Choose a verdict: pass, fail, or undetermined.');
    }
  } else if (value === null && unit === null) {
    if (verdict !== 'undetermined') {
      throw new SpecGarageError(
        'invalid-input',
        `Enter a measurement in ${check.unit}, or choose "undetermined" if it cannot be measured.`,
      );
    }
  } else {
    if (verdict !== null) {
      throw new SpecGarageError(
        'invalid-input',
        'Enter either a measurement or "undetermined", not both.',
      );
    }
    if (value === null) throw new SpecGarageError('invalid-input', 'Enter the measured value.');
    const problem = explainDecimalProblem(value);
    if (problem !== null) throw new SpecGarageError('invalid-input', problem);
    if (unit !== check.unit) {
      throw new SpecGarageError(
        'invalid-input',
        `This requirement is measured in ${check.unit}. Units are not converted; enter the value in ${check.unit}.`,
      );
    }
    cleanValue = normalizeDecimalString(value);
    cleanUnit = unit;
  }

  const allowed = new Set(requirement.conditions.map((condition) => condition.key));
  const requested = new Set(input.confirmedConditions ?? []);
  const unknown = [...requested].filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new SpecGarageError('invalid-input', `Unknown condition(s): ${unknown.join(', ')}.`);
  }
  // Keep the rule's order so equal confirmations are stored identically.
  const confirmedConditions = requirement.conditions
    .map((condition) => condition.key)
    .filter((key) => requested.has(key));

  const note =
    input.note === undefined || input.note === null || input.note.trim() === '' ? null : input.note;
  if (note !== null && note.length > MAX_NOTE_LENGTH) {
    throw new SpecGarageError(
      'invalid-input',
      `A note can have at most ${MAX_NOTE_LENGTH} characters.`,
    );
  }

  return {
    value: cleanValue,
    unit: cleanUnit,
    verdict: cleanValue === null ? verdict : null,
    confirmedConditions,
    note,
  };
}

interface TypedFile {
  bytes: Uint8Array;
  mediaType: MediaType;
  kind: EvidenceKind;
}

function typeFiles(files: readonly Uint8Array[]): TypedFile[] {
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new SpecGarageError(
      'invalid-input',
      `At most ${MAX_FILES_PER_UPLOAD} files can be attached at once.`,
    );
  }
  return files.map((bytes, index) => {
    const mediaType = detectMediaType(bytes);
    if (mediaType === null) {
      throw new SpecGarageError(
        'invalid-input',
        `File ${index + 1} is not a supported type. Attach a JPEG, PNG, or WebP photo, or a PDF.`,
      );
    }
    return { bytes, mediaType, kind: evidenceKindFor(mediaType) };
  });
}

function snapshotOf(editionId: string, requirement: Requirement): RuleSnapshot {
  return { editionId, requirement };
}

function persistEvaluation(
  ctx: ServiceContext,
  loaded: Loaded,
  requirement: Requirement,
  observationId: number,
  evidence: readonly EvidenceRecord[],
  evaluation: Evaluation,
): void {
  ctx.store.insertResult({
    inspectionId: loaded.inspection.id,
    requirementKey: requirement.key,
    status: evaluation.status,
    reasons: evaluation.reasons,
    ruleSnapshot: snapshotOf(loaded.edition.id, requirement),
    observationId,
    evidenceIds: evidence.map((item) => item.id),
    engineVersion: ENGINE_VERSION,
    evaluatedAt: ctx.now(),
  });
}

/**
 * Records a measurement or verdict, with optional evidence files, and stores
 * the evaluation that follows from it. Everything is written in one
 * transaction: either the observation, its evidence, and its result all exist,
 * or none of them do.
 */
export function recordObservation(
  ctx: ServiceContext,
  input: RecordObservationInput,
): RequirementView {
  const loaded = load(ctx, input.inspectionId);
  const requirement = findRule(loaded.rulepack, input.requirementKey);
  const cleaned = validateObservation(requirement, input);
  const files = typeFiles(input.files ?? []);

  // Files are addressed by hash, so writing them before the transaction is harmless.
  const stored = files.map((file) => ({ ...file, ...ctx.blobs.put(file.bytes) }));

  ctx.store.transaction(() => {
    const recordedAt = ctx.now();
    const observationId = ctx.store.insertObservation({
      inspectionId: loaded.inspection.id,
      requirementKey: requirement.key,
      value: cleaned.value,
      unit: cleaned.unit,
      verdict: cleaned.verdict,
      confirmedConditions: cleaned.confirmedConditions,
      note: cleaned.note,
      recordedAt,
    });
    const evidence = stored.map((file) => {
      ctx.store.insertBlob({
        sha256: file.sha256,
        byteSize: file.byteSize,
        mediaType: file.mediaType,
        storedAt: recordedAt,
      });
      const record = {
        observationId,
        inspectionId: loaded.inspection.id,
        requirementKey: requirement.key,
        kind: file.kind,
        blobSha256: file.sha256,
        recordedAt,
      };
      return { ...record, id: ctx.store.insertEvidence(record) };
    });
    persistEvaluation(
      ctx,
      loaded,
      requirement,
      observationId,
      evidence,
      evaluate(requirement, cleaned, evidence),
    );
  });

  return requirementView(ctx, loaded, requirement);
}

/**
 * Attaches more files to the current observation of a requirement and
 * re-evaluates it. Earlier results stay in the history.
 */
export function addEvidence(ctx: ServiceContext, input: AddEvidenceInput): RequirementView {
  const loaded = load(ctx, input.inspectionId);
  const requirement = findRule(loaded.rulepack, input.requirementKey);
  const current = ctx.store.currentObservations(loaded.inspection.id).get(requirement.key);
  if (current === undefined) {
    throw new SpecGarageError(
      'conflict',
      'Record a measurement or verdict before attaching evidence to this requirement.',
    );
  }
  if (input.observationId !== current.id) {
    throw new SpecGarageError(
      'conflict',
      'This requirement was recorded again after the page was loaded. Reload the checklist and attach the evidence to the current record if it still applies.',
    );
  }
  if (input.files.length === 0)
    throw new SpecGarageError('invalid-input', 'Attach at least one file.');
  const files = typeFiles(input.files);
  const stored = files.map((file) => ({ ...file, ...ctx.blobs.put(file.bytes) }));

  ctx.store.transaction(() => {
    const recordedAt = ctx.now();
    for (const file of stored) {
      ctx.store.insertBlob({
        sha256: file.sha256,
        byteSize: file.byteSize,
        mediaType: file.mediaType,
        storedAt: recordedAt,
      });
      ctx.store.insertEvidence({
        observationId: current.id,
        inspectionId: loaded.inspection.id,
        requirementKey: requirement.key,
        kind: file.kind,
        blobSha256: file.sha256,
        recordedAt,
      });
    }
    const evidence = ctx.store.listEvidenceForObservation(current.id);
    persistEvaluation(
      ctx,
      loaded,
      requirement,
      current.id,
      evidence,
      evaluate(requirement, toInput(current), evidence),
    );
  });

  return requirementView(ctx, loaded, requirement);
}

function evidenceViews(ctx: ServiceContext, records: readonly EvidenceRecord[]): EvidenceView[] {
  return records.map((record) => {
    const blob = ctx.store.getBlob(record.blobSha256);
    if (blob === undefined) throw new Error(`Evidence ${record.id} has no stored file.`);
    return {
      id: record.id,
      kind: record.kind,
      sha256: record.blobSha256,
      mediaType: blob.mediaType,
      byteSize: blob.byteSize,
      recordedAt: record.recordedAt,
    };
  });
}

interface ChecklistState {
  observations: Map<string, ObservationRecord>;
  evidence: Map<number, EvidenceRecord[]>;
  results: ReturnType<ServiceContext['store']['currentResults']>;
  counts: Map<string, number>;
  documentFiles: Map<string, string>;
}

function loadState(ctx: ServiceContext, loaded: Loaded): ChecklistState {
  const id = loaded.inspection.id;
  const evidence = new Map<number, EvidenceRecord[]>();
  for (const record of ctx.store.currentEvidence(id)) {
    const list = evidence.get(record.observationId) ?? [];
    list.push(record);
    evidence.set(record.observationId, list);
  }
  return {
    observations: ctx.store.currentObservations(id),
    evidence,
    results: ctx.store.currentResults(id),
    counts: ctx.store.observationCounts(id),
    documentFiles: new Map(
      ctx.store
        .listEditionDocuments(loaded.edition.id)
        .map((doc) => [doc.documentKey, doc.blobSha256]),
    ),
  };
}

function buildRequirementView(
  ctx: ServiceContext,
  loaded: Loaded,
  state: ChecklistState,
  requirement: Requirement,
): RequirementView {
  const observation = state.observations.get(requirement.key);
  const result = state.results.get(requirement.key);
  const evaluation: Evaluation =
    result !== undefined
      ? { status: result.status, reasons: result.reasons }
      : evaluate(requirement, null, []);
  const documents = new Map(loaded.rulepack.documents.map((document) => [document.key, document]));

  return {
    key: requirement.key,
    title: requirement.title,
    description: requirement.description ?? null,
    system: requirement.system,
    check: requirement.check,
    checkSummary: describeCheck(requirement),
    conditions: requirement.conditions,
    requiredEvidence: requirement.evidence,
    sources: requirement.sources.map((source) => ({
      documentKey: source.document,
      documentTitle: documents.get(source.document)?.title ?? source.document,
      article: source.article,
      page: source.page,
      fileSha256: state.documentFiles.get(source.document) ?? null,
    })),
    status: evaluation.status,
    reasons: evaluation.reasons,
    current:
      observation === undefined
        ? null
        : {
            id: observation.id,
            recordedAt: observation.recordedAt,
            value: observation.value,
            unit: observation.unit,
            verdict: observation.verdict,
            confirmedConditions: observation.confirmedConditions,
            note: observation.note,
            evidence: evidenceViews(ctx, state.evidence.get(observation.id) ?? []),
          },
    observationCount: state.counts.get(requirement.key) ?? 0,
  };
}

function requirementView(
  ctx: ServiceContext,
  loaded: Loaded,
  requirement: Requirement,
): RequirementView {
  return buildRequirementView(ctx, loaded, loadState(ctx, loaded), requirement);
}

/** The whole checklist of an inspection: requirements by system with their current results. */
export function getChecklist(ctx: ServiceContext, inspectionId: string): ChecklistView {
  const loaded = load(ctx, inspectionId);
  const state = loadState(ctx, loaded);
  const { rulepack, edition, inspection } = loaded;
  const event = rulepack.events.find((item) => item.key === inspection.eventKey);

  const counts = emptyStatusCounts();
  const systems = rulepack.systems.map((system) => {
    const requirements = rulepack.requirements
      .filter((requirement) => requirement.system === system.key)
      .map((requirement) => buildRequirementView(ctx, loaded, state, requirement));
    for (const requirement of requirements) counts[requirement.status] += 1;
    return { key: system.key, name: system.name, requirements };
  });

  return {
    inspection: {
      id: inspection.id,
      vehicleCode: inspection.vehicleCode,
      eventKey: inspection.eventKey,
      eventName: event?.name ?? inspection.eventKey,
      eventDate: event?.date ?? '',
      stationLabel: inspection.stationLabel,
      startedAt: inspection.startedAt,
    },
    edition: {
      id: edition.id,
      categoryCode: edition.categoryCode,
      categoryName: edition.categoryName,
      season: edition.season,
      edition: edition.edition,
      language: rulepack.language ?? null,
    },
    documents: rulepack.documents.map((document) => ({
      key: document.key,
      title: document.title,
      type: document.type,
      edition: document.edition ?? null,
      effectiveFrom: document.effectiveFrom ?? null,
      effectiveTo: document.effectiveTo ?? null,
      sha256: document.sha256 ?? null,
    })),
    systems,
    counts,
    notice: NOT_OFFICIAL_NOTICE,
  };
}

export interface HistoryEntry {
  observation: {
    id: number;
    recordedAt: string;
    value: string | null;
    unit: string | null;
    verdict: Verdict | null;
    confirmedConditions: string[];
    note: string | null;
  };
  evidence: EvidenceView[];
  /** Every evaluation of this observation, oldest first. */
  results: { status: Status; reasons: Reason[]; evaluatedAt: string; engineVersion: string }[];
}

/** Everything ever recorded for one requirement, oldest first. */
export function getHistory(
  ctx: ServiceContext,
  inspectionId: string,
  requirementKey: string,
): HistoryEntry[] {
  const loaded = load(ctx, inspectionId);
  findRule(loaded.rulepack, requirementKey);
  const results = ctx.store.listResults(loaded.inspection.id, requirementKey);
  return ctx.store.listObservations(loaded.inspection.id, requirementKey).map((observation) => ({
    observation: {
      id: observation.id,
      recordedAt: observation.recordedAt,
      value: observation.value,
      unit: observation.unit,
      verdict: observation.verdict,
      confirmedConditions: observation.confirmedConditions,
      note: observation.note,
    },
    evidence: evidenceViews(ctx, ctx.store.listEvidenceForObservation(observation.id)),
    results: results
      .filter((result) => result.observationId === observation.id)
      .map((result) => ({
        status: result.status,
        reasons: result.reasons,
        evaluatedAt: result.evaluatedAt,
        engineVersion: result.engineVersion,
      })),
  }));
}
