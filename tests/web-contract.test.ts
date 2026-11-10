/**
 * The web bundle keeps its own copy of the API's response shapes
 * (web/src/api-types.ts) so it never imports server code. These assertions are
 * checked by the TypeScript compiler (`pnpm typecheck`): if a server type
 * changes in a way the interface no longer understands, compilation fails.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChecklistView,
  EvidenceView,
  HistoryEntry,
  RequirementView,
} from '../src/service/checklist.ts';
import type { InspectionSummary } from '../src/service/inspections.ts';
import type * as Web from '../web/src/api-types.ts';

describe('web API contract', () => {
  it('accepts every response shape the server produces', () => {
    expectTypeOf<ChecklistView>().toExtend<Web.ChecklistView>();
    expectTypeOf<RequirementView>().toExtend<Web.RequirementView>();
    expectTypeOf<EvidenceView>().toExtend<Web.EvidenceView>();
    expectTypeOf<HistoryEntry>().toExtend<Web.HistoryEntry>();
    expectTypeOf<InspectionSummary>().toExtend<Web.InspectionSummary>();
  });

  it('keeps the status names in step', () => {
    expectTypeOf<keyof ChecklistView['counts']>().toEqualTypeOf<Web.Status>();
  });
});
