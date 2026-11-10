# Security and privacy

SpecGarage is a single-user tool that runs on the user's own computer. This document states what it protects, what it assumes, and what it deliberately does not do.

## Trust model

- **One trusted local user.** There are no accounts, logins, roles, or permissions. Anyone who can run commands as the user, or read the data directory, can read and change everything. The data directory should be protected the way any private working folder is.
- **Nothing leaves the computer.** The application makes no outbound network requests, has no telemetry, and loads no third-party scripts, fonts, or images. In a browser check, every request of the page went to `127.0.0.1`.
- **No secrets exist.** The application has no credentials, API keys, or tokens. `.env` holds only the data directory, port, and upload limit, and is git-ignored.

## The local web server

The server is the main attack surface, because any web page the user visits could try to make the browser talk to it.

| Threat                                                | Defense                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachable from other machines                         | Binds to `127.0.0.1` only                                                                                                                                                                                                                                                                       |
| DNS rebinding (a hostile name resolving to 127.0.0.1) | The `Host` header must be `localhost`, `127.0.0.1`, or `[::1]`; anything else gets `403`                                                                                                                                                                                                        |
| Cross-site requests from a visited web page           | A present `Origin` must be a local `http` origin; `Sec-Fetch-Site` must be `same-origin` or `none`                                                                                                                                                                                              |
| Script injection into the interface                   | A strict `Content-Security-Policy` (`default-src 'none'`, with scripts, styles, images, fonts, and connections limited to `'self'`, `frame-ancestors 'none'`, no inline scripts or styles), plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY` |
| Malicious uploads                                     | Type decided from leading bytes (JPEG, PNG, WebP, PDF only); size and count limits; stored under the SHA-256 of the content, never under a user-supplied name or path; never executed                                                                                                           |
| Path traversal when serving files                     | Hashes must be 64 hexadecimal characters; web assets are resolved inside their directory, symbolic links included                                                                                                                                                                               |
| Information leaks in errors                           | Unexpected errors return a generic message; the cause is written only to the server's own log                                                                                                                                                                                                   |

Stored files are served without a Content-Security-Policy because browsers' built-in PDF viewers do not work under a restrictive one. The mitigation is the four-type allowlist and `nosniff`.

The checks are tested over a real socket as well as in-process (`tests/server/api.test.ts`, `tests/cli/serve.test.ts`), including foreign hosts, hostile origins, traversal paths, oversized and malformed uploads, and error responses.

## Data integrity

- **Immutable editions.** A rulepack is stored under the SHA-256 of its canonical content, including the hashes of its document files. A changed rule is a new edition.
- **Append-only history.** Database triggers reject updates and deletes on every history table, and `recursive_triggers` is on so `INSERT OR REPLACE` cannot bypass them. Foreign keys and further triggers keep evidence and results consistent with the observation they belong to.
- **Evidence cannot be mis-attached.** An upload names the observation it was prepared for and is refused if that is no longer current.
- **File integrity.** Files are written atomically under their hash and can be re-hashed to detect loss or modification.

These protect against application bugs and mistakes. They do **not** stop someone who opens the SQLite file with another tool and changes it; there is no tamper-proofing, signing, or external audit log. Timestamps come from the computer's clock and are not trustworthy evidence of when something happened.

## Privacy

SpecGarage is built to hold as little personal data as possible.

- **Vehicles** are identified by an internal code (letters, digits, `.`, `_`, `-`, up to 32 characters).
- **Observers** are identified only by a station label such as `Bay-2` with the same restricted shape, not by a name.
- **There is no field** for names, licenses, contact details, or driver or inspector identity anywhere in the data model.
- **Free text** (notes) is limited to 500 characters, and the interface says not to enter personal data. Nothing can enforce that.
- **Photos can contain people and location metadata** (such as GPS coordinates in the image file). SpecGarage stores files exactly as received. Review what is attached; stripping metadata is planned (see the roadmap).
- **Real regulations are not bundled.** The demo category and its documents are fictional and written for this project.

## Dependencies and supply chain

- Direct dependencies are pinned to exact versions, and `pnpm-workspace.yaml` refuses versions published less than seven days ago, including transitive ones.
- Dependency build scripts are blocked by default; none are allowed.
- Production dependencies are `hono`, `@hono/node-server`, and `zod`, all MIT-licensed. Development tooling is permissive except `lightningcss` (MPL-2.0), a build-time tool bundled with Vite that is not redistributed.
- Dependabot-style automated advisories and a dependency audit in CI are planned (roadmap Phase 17).

## Reporting a problem

This is a personal project without a security contact. Please open an issue in the repository for non-sensitive reports.
