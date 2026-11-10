/**
 * Shapes of the JSON returned by the local API. They are maintained by hand so
 * the web bundle never imports server code; tests/web-contract.test.ts checks
 * at compile time that the server's types stay assignable to these.
 */

export type Status =
  | 'pending'
  | 'compliant'
  | 'non-compliant'
  | 'unverifiable'
  | 'not-applicable'
  | 'conflict';

export interface Reason {
  code: string;
  message: string;
  detail?: string;
}

export type Check =
  | { type: 'min' | 'max'; limit: string; unit: string }
  | { type: 'range'; min: string; max: string; unit: string }
  | { type: 'manual'; label: string; instruction: string };

export type EvidenceKind = 'photo' | 'document';

export interface EvidenceView {
  id: number;
  kind: EvidenceKind;
  sha256: string;
  mediaType: string;
  byteSize: number;
  recordedAt: string;
}

export interface CurrentObservation {
  id: number;
  recordedAt: string;
  value: string | null;
  unit: string | null;
  verdict: 'pass' | 'fail' | 'undetermined' | null;
  confirmedConditions: string[];
  note: string | null;
  evidence: EvidenceView[];
}

export interface SourceView {
  documentKey: string;
  documentTitle: string;
  article: string;
  page: number;
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
  current: CurrentObservation | null;
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

export interface InspectionSummary {
  id: string;
  vehicleCode: string;
  eventKey: string;
  eventName: string;
  categoryCode: string;
  categoryName: string;
  season: string;
  edition: string;
  startedAt: string;
}

export interface HistoryEntry {
  observation: {
    id: number;
    recordedAt: string;
    value: string | null;
    unit: string | null;
    verdict: 'pass' | 'fail' | 'undetermined' | null;
    confirmedConditions: string[];
    note: string | null;
  };
  evidence: EvidenceView[];
  results: { status: Status; reasons: Reason[]; evaluatedAt: string; engineVersion: string }[];
}

export interface HistoryResponse {
  notice: string;
  entries: HistoryEntry[];
}

export interface RecordResponse {
  notice: string;
  requirement: RequirementView;
}
