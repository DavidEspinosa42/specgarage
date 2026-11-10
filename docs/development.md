# Development

## Prerequisites

- Node.js 26.13.0 (see `.node-version`; `engines` accepts `>=26.13.0 <27`).
- pnpm 12.17.0. The `packageManager` field makes pnpm download that exact version when yours differs.
- On Windows, Linux, or macOS. CI runs on Linux and Windows.

## Setup

```bash
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` requires every package version, including transitive ones, to be at least 7 days old, and blocks dependency build scripts. If an install fails with "no matching version", the version is probably too new: wait, or pick an older release. Do not lower `minimumReleaseAge` or add build-script exceptions to get past it.

## Commands

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm check`        | Biome lint and format check, then TypeScript type check              |
| `pnpm lint`         | Biome only                                                           |
| `pnpm typecheck`    | `tsc --noEmit` only                                                  |
| `pnpm test`         | Vitest, all tests                                                    |
| `pnpm format`       | Apply Biome formatting, organize imports, and apply safe fixes       |
| `pnpm specgarage …` | Run the CLI (TypeScript is executed directly by Node, no build step) |

## Using the CLI

```bash
pnpm specgarage seed demo           # import the fictional demo category, add a vehicle, start an inspection
pnpm specgarage rulepack list
pnpm specgarage inspection list
pnpm specgarage rulepack validate examples/demo-monomarca/rulepack.json
```

Other commands: `db migrate`, `rulepack import <file>`, `vehicle add <code>`, `vehicle list`, `inspection start --edition … --vehicle … --event … --station …`. Run `pnpm specgarage --help` for the full list. Exit status is 0 on success, 1 for an expected failure (invalid input, not found, conflict), and 2 for a usage error.

The web interface is not implemented yet.

### Configuration

Settings come from environment variables; a `.env` file in the working directory is read if present and never overrides variables that are already set. `--data-dir` overrides `SPECGARAGE_DATA_DIR` for one command.

| Variable                   | Default  | Meaning                                                    |
| -------------------------- | -------- | ---------------------------------------------------------- |
| `SPECGARAGE_DATA_DIR`      | `./data` | Directory holding the database and stored files            |
| `SPECGARAGE_PORT`          | `8787`   | Port of the local web server (used once the server exists) |
| `SPECGARAGE_MAX_UPLOAD_MB` | `15`     | Largest accepted upload, in megabytes                      |

## Data directory

```text
data/
  specgarage.db      SQLite database (WAL mode, so -wal and -shm files may appear beside it)
  blobs/sha256/ab/…  Stored regulation documents and evidence, named by SHA-256
```

To back up, copy the whole directory while no SpecGarage command is running. `data/` is git-ignored.

The database can be opened read-only with any SQLite tool for inspection. The append-only triggers protect history from application bugs; they do not stop someone who edits the file directly with another tool, so treat the data directory like any other record you want to keep intact.

## Tests

Tests live in `tests/`, mirroring `src/`. They are deterministic: the clock and identifiers are injected, and every test that touches the file system works in a fresh directory under the operating system's temp folder and removes it afterward. No test reads or writes `./data`.

`tests/domain/examples.test.ts` checks that the demo rulepack is valid and that its declared page counts match the generated PDFs. To regenerate the demo PDFs after editing `scripts/make-demo-pdfs.ts`:

```bash
node scripts/make-demo-pdfs.ts
```

## Troubleshooting

- **`SyntaxError` or `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`** — Node runs `.ts` files by stripping types, so enums, parameter properties, and runtime namespaces cannot be used. `pnpm typecheck` flags them (`erasableSyntaxOnly`).
- **`ERR_MODULE_NOT_FOUND` for a local file** — local imports need the `.ts` extension.
- **`database is locked`** — only one process should write at a time; SQLite waits up to 5 seconds before failing. Close other SpecGarage commands.
- **Wrong Node.js version** — check `node --version` against `.node-version`.
