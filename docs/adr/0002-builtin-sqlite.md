# 0002. Built-in SQLite via node:sqlite

**Status:** Accepted

## Context

The data is relational (editions, inspections, observations, evidence, results), needs transactions, and must live in one portable file. A native addon such as better-sqlite3 adds a compiled dependency and an install-script question, which conflicts with the project's policy of blocking dependency build scripts. Node.js 26 ships `node:sqlite`.

## Decision

Use `node:sqlite` (`DatabaseSync`) with STRICT tables, foreign keys, WAL mode, hand-written SQL, and numbered migrations. All database access lives in `src/storage/`.

## Consequences

- No native dependency and no build script to approve.
- The API was documented as a release candidate in the Node.js 26.0.0 documentation; its status in 26.13 was not re-read. An in-memory smoke test on Node 26.13.0 ran without warnings (see `tests/runtime.test.ts`).
- Because access is confined to `storage/`, replacing the driver later is a local change.
- No ORM or query builder: row shapes are validated by hand at the storage boundary.
- The Node.js major version is pinned in `package.json` `engines` and `.node-version`.
