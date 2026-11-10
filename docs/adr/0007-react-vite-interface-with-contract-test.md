# 0007. React and Vite interface with hand-written API types

**Status:** Accepted

## Context

The first release needs one interactive screen: forms, file uploads, live status, and an accessible keyboard workflow. Options were server-rendered HTML with a little script, or a client-side application. The screen will gain an editor and summaries, which favors a component model. The bundle must not import server code, because the server uses Node-only modules and the browser has a strict Content Security Policy.

## Decision

- A React single-page app built with Vite, served as static files by the same process. No router, state library, or CSS framework: one screen, plain CSS, and a hash (`#/inspection/<id>`) for the selected inspection.
- The bundle keeps its own copy of the API's response types in `web/src/api-types.ts`.
- `tests/web-contract.test.ts` asserts at compile time that the server's types are assignable to that copy, so `pnpm typecheck` fails if they drift apart.
- All interface text is English. Regulation text is shown as written in the rulepack and marked with a `lang` attribute from the rulepack's language tag.

## Consequences

- A build step exists (`pnpm build`), and the server shows a clear message until the interface is built.
- The two sets of types must be edited together; the contract test makes forgetting impossible to miss.
- Accessibility is checked in a real browser (Lighthouse accessibility 100 at release), but there are no automated browser tests yet; they are planned in roadmap Phase 15.
- Race conditions between slow requests are handled in the client (latest request wins) and, for evidence, on the server ([ADR 0006](0006-evidence-bound-to-observation.md)).
