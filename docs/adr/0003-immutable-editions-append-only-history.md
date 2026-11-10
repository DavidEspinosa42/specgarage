# 0003. Immutable editions and append-only history

**Status:** Accepted

## Context

Regulations change during and between seasons. A team must be able to show what was inspected, against which edition, with which values, and that later changes did not alter earlier results. Later phases also need to merge inspections made offline without overwriting either side.

## Decision

- An imported rulepack is an immutable _edition_ identified by the SHA-256 of its canonical JSON. Changes create a new edition; reusing an edition label with different content is refused.
- An inspection pins one edition.
- Observations, evidence, and results are append-only. A correction is a new record; the latest observation for a requirement is the current one. Database triggers reject updates and deletes on these tables.
- Each result stores the rule snapshot, the input record IDs, and the engine version.

## Consequences

- Reproducibility and auditability are properties of the schema, not of application discipline.
- More rows are stored than with in-place updates, and mistakes cannot be deleted. Retention and purge tooling is planned separately (Phase 17).
- Offline reconciliation (Phase 13) has no overwritten state to untangle, because every side keeps its own records.
- Timestamps come from the local clock and are not tamper-proof; this is documented rather than hidden.
