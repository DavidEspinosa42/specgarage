# Domain

SpecGarage turns a category's regulations into checks that a preparer can run against one vehicle at one event. This document defines the terms, rules, and invariants. Sections marked _MVP_ are what v0.1.0 implements; everything else is planned (see [ROADMAP.md](../ROADMAP.md)).

## Context: single-make regulations in Argentina

The design follows how Argentine single-make categories publish their rules:

- A **technical regulation** with numbered articles (engine, chassis, track widths, weight, tires, brakes, fuel, ballast, and so on), often with lettered sub-articles such as `7-B`, plus a block of lettered general provisions.
- A **sporting regulation** that also contains vehicle-preparation duties: competition numbers, tire purchase limits, mandatory onboard devices and where they are installed, procedures before qualifying.
- **Official annexes and communiqués** that amend either document during the season.
- A **per-event particular regulation** with event-specific conditions.
- A pre-event technical verification, sealing of components, and a closed-park regime run by technical officials.

Rules are often conditional on the event: a round number, a "special" round, a weekend with two finals, the first event of a participant, the last rounds of the season. Documents sometimes carry inconsistent metadata (for example a cover year that differs from a header year).

## Glossary

| Term             | Meaning                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| Category         | An independent regulatory configuration                                                                          |
| Season           | Period during which an edition applies                                                                           |
| Rulepack         | A JSON file describing a category-season: documents, systems, events, requirements                               |
| Edition          | One immutable, hashed import of a rulepack                                                                       |
| Document         | A regulation file (technical, sporting, appendix, bulletin, event) with title, edition, validity dates, and hash |
| Source reference | Document + article + page that a requirement comes from                                                          |
| Requirement      | A verifiable condition derived from the regulations                                                              |
| System           | Grouping of requirements (chassis, brakes and tires, safety, and so on)                                          |
| Check            | How a requirement is evaluated: numeric limit or manual verdict (MVP)                                            |
| Condition        | A circumstance that must hold for a measurement to count (for example, weighed with the driver included)         |
| Observation      | One recorded measurement or verdict for a requirement in an inspection                                           |
| Evidence         | A photo or PDF attached to an observation                                                                        |
| Result           | Status plus reasons for a requirement, derived from the observation and evidence                                 |
| Inspection       | An evaluation of one vehicle at one event against one pinned edition                                             |
| Vehicle          | A physical car identified by an internal code                                                                    |
| Event            | A dated occasion (round) in the season                                                                           |
| Observer station | A non-personal label for where the inspection is done (for example `Bay-2`)                                      |

## Statuses

| Status         | Meaning                                                                  | Produced in              |
| -------------- | ------------------------------------------------------------------------ | ------------------------ |
| Pending        | Nothing recorded yet                                                     | MVP                      |
| Compliant      | Satisfies the requirement based on the recorded observation and evidence | MVP                      |
| Non-Compliant  | A violation was identified                                               | MVP                      |
| Unverifiable   | Evidence, conditions, or information are insufficient                    | MVP                      |
| Not Applicable | The requirement's activation conditions are not met                      | Phase 6 (planned)        |
| Conflict       | Incompatible rules or unresolved ambiguity                               | Phase 6 and 10 (planned) |

Results are internal assessments. They are not homologation and not an official technical decision; the regulations typically reserve interpretation to the category's technical commission, and SpecGarage never resolves an ambiguity on its own.

## MVP rules

### Checks

- **Numeric limit** — `min` (value ≥ limit), `max` (value ≤ limit), or `range` (min ≤ value ≤ max). Bounds are inclusive. The rule carries a unit; the recorded measurement must use the same unit. No unit conversion happens in the MVP.
- **Manual verdict** — the observer records `pass`, `fail`, or `undetermined`. A label (obligation, prohibition, visual inspection, procedural) is shown to the user but the engine treats all manual checks alike in the MVP.

### Exact decimals

Limits and measurements are decimal strings: optional leading minus, digits, optionally a dot and digits (`1660`, `1658.5`, `-3.5`). Exponents, a leading plus, `.5`, `5.`, thousands separators, and the decimal comma are rejected. They are compared as scaled integers, never as floating point. A tolerance exists only if a rule declares one together with its source; the MVP rules declare none.

### Conditions and evidence

A requirement can list **conditions** (each with a key and text) and **required evidence** (`photo`, `document`). To count as a complete observation the observer must confirm every condition, and the current observation must have at least one attached file of each required kind. Evidence kind comes from the file's detected type: JPEG, PNG, and WebP are photos; PDF is a document.

Conditions and evidence belong to one observation. A new observation starts with neither: the interface never pre-ticks conditions from an earlier record, and an evidence upload names the observation it was prepared for, so it is refused rather than attached to a newer record ([ADR 0006](adr/0006-evidence-bound-to-observation.md)). Recording an observation with its files in one request is atomic: the observation, its evidence, and its result are all stored or none are.

### Status derivation

1. No observation → **Pending**.
2. Verdict `undetermined` → **Unverifiable**.
3. Any condition unconfirmed, or any required evidence kind missing → **Unverifiable**, with each missing item listed.
4. Numeric: compare the exact value to the limit → **Compliant** or **Non-Compliant**.
5. Manual: `pass` → **Compliant**, `fail` → **Non-Compliant**.

Recording a new observation supersedes the previous one for that requirement; the older records stay in the history. A re-measurement starts with no evidence, and each evaluation of an observation is stored, so adding evidence later adds a result to that observation's history rather than changing an earlier one.

### Editions and history

- An imported rulepack is stored under the SHA-256 of its canonical JSON. Importing identical content again changes nothing. Changed content under an existing category, season, and edition label is refused: use a new edition label.
- An inspection pins exactly one edition. Later editions never change it.
- Each stored result keeps the rule snapshot, the observation and evidence it used, and the engine version, so it can be reproduced.

### Boundaries and privacy

Vehicles use internal codes (`^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$`). Observers are identified only by a station label of the same shape. Free-text notes are limited in length and the UI warns not to enter personal data. Photos may contain people or location metadata; that is the user's responsibility until metadata stripping arrives (Phase 17).

## Representative scenarios

These are fictional values; the track-width figures come from the project brief.

1. **Dimension limit.** A rule sets a maximum track width of 1660 mm and requires a photo. 1658 mm with a photo → Compliant. 1661 mm with a photo → Non-Compliant. 1658 mm with no photo → Unverifiable.
2. **Weight including the driver.** A minimum weight rule has the condition "weighed with the driver in racing equipment". If the observer does not confirm the condition, the result is Unverifiable even if the number is above the limit.
3. **New edition.** A later edition raises the track-width maximum. An inspection started before the import keeps the old limit and its results; a new inspection pinned to the new edition uses the new limit.
4. **Category independence.** A rule in category A never appears in an inspection of category B unless B's rulepack defines it.
5. **Manual obligation.** "Electronic flag-signal device installed where the driver can see it" is a manual check requiring a photo; the observer's verdict decides, and no image analysis is done.

## Planned domain extensions

- Authorized component lists with declared components and explicit prohibitions (Phase 6).
- Events with a round number and tags; exceptions, precedence, official annexes with validity dates, cumulative limits from declared history such as tire counts and ballast earned from earlier results, and conflict reporting (Phase 10). Real regulations contain layered tire limits with first-event exceptions and ballast rules whose wording about when ballast is removed can be ambiguous; those are the cases the engine must report as Conflict or Unverifiable rather than interpret.
- Document metadata checks, dossiers, offline reconciliation, and competition-number assignments (Phases 11 and 13).
