# Rulepack format

A rulepack is a JSON file that describes one category-season: the regulation documents, the vehicle systems, the events, and the verifiable requirements derived from the documents. It is the only place category-specific data lives. The schema is implemented in `src/domain/rulepack.ts` (Zod); this page describes what it enforces.

Unknown keys are rejected everywhere, so a typo cannot silently drop a field.

## Example

```json
{
  "schema": "specgarage.rulepack/1",
  "category": { "code": "CAT-A", "name": "Category A (fictional)" },
  "season": "2026",
  "edition": "2026-R1",
  "language": "es-AR",
  "documents": [
    {
      "key": "TR",
      "title": "Technical Regulations",
      "type": "technical",
      "edition": "Issue 1",
      "effectiveFrom": "2026-01-01",
      "effectiveTo": "2026-12-31",
      "pageCount": 6
    }
  ],
  "systems": [{ "key": "chassis", "name": "Chassis, dimensions and weight" }],
  "events": [{ "key": "round-1", "name": "Round 1", "date": "2026-03-15" }],
  "requirements": [
    {
      "key": "track-front-max",
      "system": "chassis",
      "title": "Maximum front track width",
      "check": { "type": "max", "limit": "1660", "unit": "mm" },
      "conditions": [{ "key": "static", "text": "Vehicle at rest on a flat surface" }],
      "evidence": ["photo"],
      "sources": [{ "document": "TR", "article": "3", "page": 2 }]
    }
  ]
}
```

## Top level

| Field          | Required | Rules                                                                                                       |
| -------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `schema`       | yes      | Exactly `specgarage.rulepack/1`                                                                             |
| `category`     | yes      | `code` (a key) and `name` (up to 120 characters)                                                            |
| `season`       | yes      | A key, for example `2026`                                                                                   |
| `edition`      | yes      | A key naming this edition, for example `2026-R1`. Reusing a label with changed content is refused at import |
| `language`     | no       | BCP 47 tag of the regulation text, such as `es-AR`                                                          |
| `documents`    | yes      | 1–50 documents                                                                                              |
| `systems`      | yes      | 1–50 vehicle systems; array order is display order                                                          |
| `events`       | yes      | 1–100 events                                                                                                |
| `requirements` | yes      | 1–5000 requirements; array order is display order within a system                                           |

A **key** starts with a letter or digit and then uses letters, digits, `.`, `_`, or `-` (at most 64 characters). Keys are unique within their list.

All free text is a single line (no control characters), not blank, and kept exactly as written, including accents.

## Documents

| Field                          | Required | Rules                                                                                  |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `key`, `title`                 | yes      |                                                                                        |
| `type`                         | yes      | `technical`, `sporting`, `appendix`, `bulletin`, or `event`                            |
| `edition`                      | no       | The edition the document declares for itself, kept as declared                         |
| `effectiveFrom`, `effectiveTo` | no       | `YYYY-MM-DD` real dates; `effectiveTo` must not precede `effectiveFrom`                |
| `pageCount`                    | no       | If present, source pages are checked against it                                        |
| `file`                         | no       | Relative path with `/` separators; no `.` or `..` segments, no absolute or drive paths |
| `sha256`                       | no       | 64 lowercase hex characters; filled in from the file when the rulepack is imported     |

## Requirements

| Field         | Required | Rules                                                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `key`         | yes      | Unique within the rulepack                                                                            |
| `system`      | yes      | Must be a key from `systems`                                                                          |
| `title`       | yes      | Up to 200 characters                                                                                  |
| `description` | no       | Up to 1000 characters                                                                                 |
| `check`       | yes      | One of the check types below                                                                          |
| `conditions`  | no       | Up to 10 `{ key, text }`. The observer must confirm each for a measurement to count. Defaults to `[]` |
| `evidence`    | no       | Any of `photo`, `document`, no repeats. Defaults to `[]`                                              |
| `sources`     | yes      | 1–10 of `{ document, article, page }`                                                                 |

A source's `document` must exist, `article` is free text up to 40 characters (`3`, `7-B`, `D`), and `page` is an integer of at least 1 that must not exceed the document's `pageCount` when that is declared.

### Check types

| `type`   | Fields                 | Meaning                                                                                                                                           |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `min`    | `limit`, `unit`        | Measured value must be greater than or equal to `limit`                                                                                           |
| `max`    | `limit`, `unit`        | Measured value must be less than or equal to `limit`                                                                                              |
| `range`  | `min`, `max`, `unit`   | Value between `min` and `max`, both inclusive; `min` must not exceed `max`                                                                        |
| `manual` | `label`, `instruction` | The observer records pass, fail, or undetermined. `label` is `obligation`, `prohibition`, `visual`, or `procedural` and is only shown to the user |

Limits are **strings** holding plain decimal numbers (`"1660"`, `"1658.5"`, `"-3.5"`), never JSON numbers. A dot is the decimal separator; commas, exponents, a leading plus, leading zeros, and thousands separators are rejected. Limits are normalized before hashing (`"1660.0"` becomes `"1660"`). `unit` is up to 16 characters without spaces and is compared exactly; no conversion happens. There is no tolerance field: a tolerance exists only if the regulation states one, and support for declaring it with its source is not part of this version.

## Validation

`parseRulepack` reports problems with their location, for example `requirements[3].check.limit`. Validation happens in two passes: first the structure of every field, then the cross-references (unknown systems or documents, duplicate keys, source pages beyond a document, inverted ranges). Cross-reference problems appear once the structure is valid.

## Identity

An edition's identity is the SHA-256 of the canonical JSON (sorted keys, no whitespace) of the validated, normalized rulepack, so equal content always has the same identity, and omitted defaults hash the same as explicit empty lists. Any change, down to one accent in a title, produces a different identity.

## Import (not implemented yet)

Phase 2 adds the `rulepack import` command. It will hash each document's `file`, check it against a declared `sha256`, store the file, and record the resolved hash in the edition. Until then the schema validates files but nothing is stored.
