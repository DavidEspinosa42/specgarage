# Demo category (fictional)

"Copa Demo Monomarca" is an invented single-make category used to demonstrate SpecGarage. Its regulations, figures, and name were written for this project and do not describe any real series. The regulation text is in Spanish because that is the language the intended users work in.

- `rulepack.json` — 20 requirements across 7 vehicle systems, 3 events, and 2 documents.
- `demo-reglamento-tecnico.pdf` (6 pages) and `demo-reglamento-deportivo.pdf` (4 pages) — the documents the requirements cite by article and page.

The PDFs are generated and deterministic. To regenerate them:

```bash
node scripts/make-demo-pdfs.ts
```

If you change page content in `scripts/make-demo-pdfs.ts`, keep the `page` numbers in `rulepack.json` in sync; `tests/domain/examples.test.ts` checks that declared page counts match the files.
