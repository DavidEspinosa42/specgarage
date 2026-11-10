# 0004. TypeScript 7, native type stripping, and Biome

**Status:** Accepted

## Context

The project wants strict typing, few dependencies, and fast, reproducible tooling. Node.js 26 can run `.ts` files directly by stripping types, which removes a build step for the server, CLI, and engine. The `typescript-eslint` release available at planning time (8.72) declares a TypeScript peer range below 6.1, so it cannot be used with TypeScript 7.

## Decision

- TypeScript 7.0.2 for type checking only (`noEmit`); Node runs the sources directly.
- Only erasable syntax (`erasableSyntaxOnly`), explicit `.ts` import extensions, and `verbatimModuleSyntax`.
- Biome for linting and formatting instead of ESLint and Prettier.
- Vitest for tests; Vite builds the browser UI only.

## Consequences

- No transpile step for server code, and one tool for lint and format.
- Enums, parameter properties, runtime namespaces, and tsconfig `paths` cannot be used in Node-run code.
- Biome has fewer type-aware rules than `typescript-eslint`; the strict compiler options carry that weight.
- Verified at setup: `tsc` reports type errors and rejects enums under these options, and Biome's recommended rules flag violations. If a later tool requires TypeScript 6, falling back is a one-line version change.
