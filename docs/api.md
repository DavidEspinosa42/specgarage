# API

The local server exposes a small JSON API under `/api`. It exists for the bundled web interface; it is not a public or remote API. Start it with `pnpm start` (default `http://127.0.0.1:8787`).

**Access.** The server listens on `127.0.0.1` only and has no authentication, because it is not reachable from other machines. Requests whose `Host`, `Origin`, or `Sec-Fetch-Site` header is not local are refused with `403` (see [security.md](security.md)). Command-line clients such as `curl` work when they send a local `Host`, which they do by default.

Response shapes are defined by the types in `src/service/checklist.ts` and `src/service/inspections.ts`; the web interface keeps a copy in `web/src/api-types.ts`, and `tests/web-contract.test.ts` fails compilation if they drift apart.

## Endpoints

| Method | Path                                                  | Purpose                                                      | Success                                    |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| GET    | `/api/health`                                         | Liveness check                                               | `200` `{"status":"ok","app":"specgarage"}` |
| GET    | `/api/inspections`                                    | List inspections, newest first                               | `200` array of summaries                   |
| GET    | `/api/inspections/:id`                                | The checklist: requirements by system with current results   | `200` checklist                            |
| GET    | `/api/inspections/:id/requirements/:key/history`      | Every observation, its evidence, and its evaluations         | `200` `{ notice, entries }`                |
| POST   | `/api/inspections/:id/requirements/:key/observations` | Record a measurement or verdict, with optional files         | `201` `{ notice, requirement }`            |
| POST   | `/api/inspections/:id/requirements/:key/evidence`     | Attach files to the current observation                      | `201` `{ notice, requirement }`            |
| GET    | `/api/blobs/:sha256`                                  | A stored file (evidence photo, evidence PDF, regulation PDF) | `200` file bytes                           |

`:id` is a full inspection id or an unambiguous prefix of at least 6 characters. `:key` is a requirement key from the inspection's edition. Every other path under `/api` answers `404`; paths outside `/api` serve the built web interface.

Every response that carries a result includes the notice that results are internal assessments, not official decisions.

## Recording an observation

`POST …/observations` takes `multipart/form-data`:

| Field        | Repeatable | Meaning                                                                                                         |
| ------------ | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `value`      | no         | Measured value as plain decimal text (`1658`, `1658.5`). Dot decimal separator only                             |
| `unit`       | no         | Must equal the rule's unit exactly; units are never converted                                                   |
| `verdict`    | no         | `pass`, `fail`, or `undetermined`. Manual requirements need one; numeric ones accept only `undetermined`, alone |
| `conditions` | yes        | Keys of the rule's conditions the observer confirms                                                             |
| `note`       | no         | Up to 500 characters; do not include personal data                                                              |
| `files`      | yes        | Up to 10 JPEG, PNG, WebP, or PDF files, each within the size limit                                              |

Recording again supersedes the previous observation for that requirement; the earlier records stay in the history. Conditions and evidence belong to one observation and are never carried over.

```bash
curl -X POST "http://127.0.0.1:8787/api/inspections/<id>/requirements/frenos-pastilla-espesor-min/observations" \
  -F value=3.2 -F unit=mm -F "files=@photo.png"
```

```json
{
  "notice": "Internal preparation assessment. This is not an official inspection, homologation, or certification.",
  "requirement": {
    "key": "frenos-pastilla-espesor-min",
    "status": "non-compliant",
    "checkSummary": "≥ 3.5 mm",
    "reasons": [
      { "code": "below-minimum", "message": "Measured 3.2 mm, below the minimum of 3.5 mm." }
    ],
    "sources": [
      {
        "documentKey": "TR",
        "documentTitle": "Reglamento Técnico - Copa Demo Monomarca 2026 (ficticio)",
        "article": "11",
        "page": 5,
        "fileSha256": "950f3a5b6095…"
      }
    ],
    "current": {
      "id": 17,
      "recordedAt": "2026-11-10T21:39:19.633Z",
      "value": "3.2",
      "unit": "mm",
      "verdict": null,
      "confirmedConditions": [],
      "note": null,
      "evidence": [
        {
          "id": 14,
          "kind": "photo",
          "sha256": "06c0efd6cf5f…",
          "mediaType": "image/png",
          "byteSize": 24984,
          "recordedAt": "2026-11-10T21:39:19.633Z"
        }
      ]
    },
    "observationCount": 1
  }
}
```

(Hashes shortened here.) The full requirement view also carries the rule's `title`, `check`, `conditions`, and `requiredEvidence`.

## Attaching evidence

`POST …/evidence` takes `multipart/form-data` with `files` (repeatable) and a required `observationId`: the `current.id` of the record the files were prepared for. If the requirement has been recorded again since, the request is refused with `409` and nothing is stored, so evidence can never attach to a newer observation than the one it was meant for. See [ADR 0006](adr/0006-evidence-bound-to-observation.md).

## Stored files

`GET /api/blobs/:sha256` returns the file with its detected type (`image/jpeg`, `image/png`, `image/webp`, or `application/pdf`), `X-Content-Type-Options: nosniff`, and long-lived caching, since the hash identifies the content. Append `#page=N` in a browser to open a PDF at a page, which is how the checklist links each requirement to its source page.

## Errors

Failures are JSON: `{ "error": <code>, "message": <text>, "details": [<text>…] }`.

| Status | `error`                         | Meaning                                                                       |
| ------ | ------------------------------- | ----------------------------------------------------------------------------- |
| 400    | `invalid-input` / `bad-request` | Invalid value, unit, condition, file type, or malformed request               |
| 403    | `forbidden`                     | Host, Origin, or Sec-Fetch-Site is not local                                  |
| 404    | `not-found`                     | Unknown inspection, requirement, file, or endpoint                            |
| 409    | `conflict`                      | No observation to attach evidence to, or the observation is no longer current |
| 413    | `too-large`                     | A file or the whole request exceeds the upload limit                          |
| 415    | `bad-request`                   | The body is not `multipart/form-data`                                         |
| 500    | `internal`                      | Unexpected failure; details are logged on the server, never returned          |

```json
{
  "error": "not-found",
  "message": "Requirement \"nope\" is not part of this inspection's edition.",
  "details": []
}
```

## Limits

- Per-file size: `SPECGARAGE_MAX_UPLOAD_MB` (default 15). The whole request may be ten files plus form fields.
- At most 10 files per request.
- Only JPEG, PNG, WebP, and PDF are accepted, decided from the file's leading bytes, never from its name or declared type.
