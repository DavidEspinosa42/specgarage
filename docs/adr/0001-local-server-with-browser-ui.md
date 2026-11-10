# 0001. Local server with a browser UI

**Status:** Accepted

## Context

SpecGarage must run offline on a desktop or laptop, without accounts or external services, and be easy to run and evaluate. The first release needs one screen plus a CLI. A packaged desktop installer is valuable for non-technical users but costs substantial build and signing effort.

## Decision

Run one Node.js process that serves the browser UI and a JSON API on `127.0.0.1`, and also exposes the same use cases through a CLI. Packaging is deferred to a later phase.

## Consequences

- The MVP needs no desktop shell, installer, or code signing, and the same code serves tests, CLI, and UI.
- Users start it from a terminal until packaging arrives (Phase 16), which is a real limitation for the intended users.
- A local HTTP server is reachable by other local software and web pages, so the server must bind to loopback only and check `Host` and `Origin`.
- Electron and Tauri were considered. Both remain possible later; the UI and API are independent of the shell. Single-executable packaging will be decided in Phase 16 with a new ADR.
