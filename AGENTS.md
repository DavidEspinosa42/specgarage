# AGENTS.md

Instructions for contributors and coding agents working on SpecGarage.

## Purpose

SpecGarage helps vehicle preparers in single-make (_monomarca_) racing categories, primarily Argentine ones, turn regulations into per-vehicle, per-event checklists with evidence and traceability. Results are internal assessments, never official certification. Read [docs/domain.md](docs/domain.md) before changing behavior.

## Status

Early development. Check [ROADMAP.md](ROADMAP.md) for which phase is current. Do not describe planned behavior as implemented in any document.

## Commands

```bash
pnpm install --frozen-lockfile   # install exactly what the lockfile says
pnpm check                       # Biome lint/format check + TypeScript type check
pnpm test                        # Vitest
pnpm format                      # apply Biome formatting
```

Run `pnpm check` and `pnpm test` before every commit and report the real result. Further commands (CLI, server, UI build) are added here when they exist.

## Layout and boundaries

The layout is described in [docs/architecture.md](docs/architecture.md). The rules that matter:

- `domain/` and `engine/` are pure: no file system, database, network, clock, or randomness. Inputs in, results out.
- `storage/` is the only code that touches SQLite or the file system.
- The CLI and the HTTP server are thin front ends over the same service functions. Business rules never live in them.
- Validate every external input (files, HTTP, CLI arguments) with the Zod schemas at the boundary.

## Invariants (each needs a test)

1. No category-specific data in code. Limits, units, systems, and components come only from a rulepack.
2. A rulepack edition is immutable and identified by the SHA-256 of its canonical content. Changes create a new edition.
3. Every requirement cites at least one source (document, article, page). Article references are free text such as `7-B` or `D`, because regulations use lettered sub-articles.
4. Limits and measurements are exact decimal strings. Never use floating point for them. No tolerance exists unless a rule declares one with its source.
5. Compliant and Non-Compliant require the rule's required evidence and confirmed conditions; otherwise the result is Unverifiable. Nothing is inferred from a photograph.
6. Observations, evidence, and results are append-only; corrections are new records.
7. A stored result can be reproduced from its stored inputs and rule snapshot.
8. No personal data fields: vehicles use internal codes, observers use a station label.
9. Anything that shows a result also states that it is an internal assessment, not an official one.

## Data and privacy

- Use synthetic data only. Never commit real regulation documents, text copied from them, real series names or marks, or the names of real people or organizations. Demo categories are fictional and written for this project. Regulation text in a demo may be in Spanish; that is data, not application language.
- Never commit `.env`, databases, or evidence files. `data/` is ignored; keep it that way.
- Do not add network calls, telemetry, or third-party assets. The product must work offline.

## Code conventions

- American English in code, comments, UI text, documentation, and commit messages.
- TypeScript only uses erasable syntax (no enums, parameter properties, or runtime namespaces) because Node runs the files directly. Imports of local files include the `.ts` extension. Use `import type` for types.
- Prefer small pure functions and explicit return types at module boundaries. Do not add abstractions before a second use exists.
- Test observable behavior and invariants with deterministic, isolated tests. Inject the clock and use temporary directories; tests must never touch a real data directory.
- Treat text as Unicode (Spanish accents and `ñ` are normal data). Never normalize or strip characters in stored regulation text.

## Dependencies

- Direct dependencies are pinned to exact versions. `pnpm-workspace.yaml` requires versions to be at least 7 days old and blocks dependency build scripts; do not weaken either setting to make an install pass.
- Prefer platform features (`node:sqlite`, `node:crypto`, `node:util`) over new packages. Justify any new dependency in the commit message.

## Commits

- One coherent concern per commit, Conventional Commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `chore:`).
- Run an independent review of the changes before each commit and address real findings. State plainly which checks actually ran.
- Commits that include AI-generated work carry a `Co-Authored-By` trailer naming the assistant. Do not rewrite history or invent activity.

## Documentation

Keep README, ROADMAP, and the docs consistent with the code in the same change that alters behavior. Record significant decisions as ADRs in `docs/adr/`.
