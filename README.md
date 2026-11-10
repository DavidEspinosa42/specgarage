# SpecGarage

SpecGarage is an offline tool for vehicle preparers and technical leads in single-make (_monomarca_) racing categories, designed first around Argentine categories and the way their regulations are organized: a technical regulation, a sporting regulation, official annexes, and a per-event particular regulation. It turns a category's regulations into a preparation checklist for one vehicle at one event, records measurements and evidence against each requirement, and keeps every result traceable to the regulation article and edition it was judged against. It supports a team's own preparation work; it does not replace official technical inspection, homologation, or certification.

> **Status: early development.** Implemented so far: the rulepack format and validation, the SQLite storage layer, importing rulepacks as immutable editions, registering vehicles, starting inspections, and a command-line interface. Not implemented yet: recording measurements, the evaluation engine, and the web interface. Items under "Key Features" are marked as planned until they exist. This README is updated as behavior is implemented.

## Key Features

Planned for the first release (v0.1.0, see [ROADMAP.md](ROADMAP.md)):

- Describe a category's requirements in a validated JSON _rulepack_ and import it as an immutable, hashed edition.
- Start an inspection for a vehicle (internal code) at an event, pinned to one edition.
- Work a checklist grouped by vehicle system: record a measurement or a manual verdict, confirm measurement conditions, attach photos or PDFs.
- Get a result per requirement (Pending, Compliant, Non-Compliant, Unverifiable) with the reasons, the rule values used, and a link to the source page.
- Keep a full, append-only history of what was recorded and when.

Planned later, in this order: a Spanish/English interface with Argentine number entry (the first interface release is English only and accepts a dot as the decimal separator), a requirements editor, exceptions and conflict detection, PDF text import, PDF/CSV dossiers, offline exchange and reconciliation, instrument records, and a packaged installer. Permanently out of scope: official certification, OCR, AI interpretation of regulations, image recognition, telemetry, and personal identification of drivers or inspectors.

## Quick Start

The command line works today; the checklist screen does not exist yet.

```bash
pnpm install --frozen-lockfile
pnpm specgarage seed demo        # fictional demo category, a vehicle, and an inspection
pnpm specgarage rulepack list
pnpm specgarage inspection list
```

Data is written to `./data` (see [docs/development.md](docs/development.md)). Recording measurements and viewing the checklist arrive with the engine and the web interface (see [ROADMAP.md](ROADMAP.md)).

## Architecture

A single local Node.js process serves a browser UI and a CLI over the same domain logic, backed by SQLite and a content-addressed file store. Design details and a diagram are in [docs/architecture.md](docs/architecture.md); the design is not implemented yet.

Two invariants shape everything: a published regulation edition is immutable, and results are append-only and reproducible from stored inputs.

## Tech Stack

| Area            | Technology  | Version         | Purpose                                               |
| --------------- | ----------- | --------------- | ----------------------------------------------------- |
| Runtime         | Node.js     | 26.13.0 (LTS)   | Runs the application and tests                        |
| Package manager | pnpm        | 12.17.0         | Dependencies, 7-day release-age policy                |
| Language        | TypeScript  | 7.0.2           | Strict typing; runs directly on Node (type stripping) |
| Validation      | Zod         | 4.6.7           | Rulepack schema and input validation                  |
| Database        | node:sqlite | built into Node | Local storage, no native dependency                   |
| Lint and format | Biome       | 2.6.4           | One tool for both                                     |
| Tests           | Vitest      | 5.1.0           | Unit and integration tests                            |

`package.json` and `pnpm-lock.yaml` are authoritative for versions. Technologies are added to this table when they are first used.

## Repository Structure

```text
.github/workflows/ci.yml   Lint, type check, and tests on Linux and Windows
src/domain/                Pure types, rulepack schema, exact decimals, hashing
src/storage/               SQLite schema, typed store, content-addressed file store
src/service/               Use cases: import editions, vehicles, inspections
src/cli/                   Command-line interface
examples/demo-monomarca/   Fictional demo category and its PDFs
scripts/                   Generator for the demo PDFs
docs/                      Design documents and decision records
tests/                     Automated tests
```

`src/engine/`, `src/server/`, and `web/` are planned and not implemented yet; see [docs/architecture.md](docs/architecture.md).

## Development

Prerequisites: Node.js 26.13.0 (see `.node-version`) and pnpm 12.17.0. pnpm downloads the pinned version automatically because of the `packageManager` field.

```bash
pnpm install --frozen-lockfile
pnpm check   # Biome lint/format check and TypeScript type check
pnpm test    # Vitest
```

Runtime settings are described in `.env.example`; the full guide is [docs/development.md](docs/development.md).

## Documentation

- [ROADMAP.md](ROADMAP.md) — MVP scope and the phased path to production readiness
- [AGENTS.md](AGENTS.md) — instructions for contributors and coding agents
- [docs/development.md](docs/development.md) — setup, commands, data directory, troubleshooting
- [docs/domain.md](docs/domain.md) — terminology, rules, invariants, and scenarios
- [docs/rulepack-format.md](docs/rulepack-format.md) — the rulepack JSON format
- [docs/architecture.md](docs/architecture.md) — components, data flow, constraints
- [docs/landscape.md](docs/landscape.md) — existing alternatives and positioning
- [docs/adr/](docs/adr/) — architecture decision records

## Security & Data Privacy

SpecGarage runs entirely on the user's computer and makes no network requests. Vehicles are identified by internal codes and observers by a station label; no field for names, licenses, or contact details exists. Evidence files such as photos can still contain people or location metadata, so users should review what they attach. Details will be documented in `docs/security.md` when the server is implemented.

## Ownership

This is a 100% independent, personal side project. It is not related to, sponsored by, or developed for any employer or client.

## License

Released under the MIT License. See LICENSE.

## Future Work

See [ROADMAP.md](ROADMAP.md) for the planned progression from the MVP to a production-ready release. Planned work is never described as implemented.
