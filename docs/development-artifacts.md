# Development artifacts

Cleanup on 6 October 2026 removed 366 generated reports, logs and screenshots
(32.01 MiB) from the checkout. At the user's subsequent request, their temporary
cleanup archive, its manifest and note backups were permanently deleted too.
The latest verification log and a support-image ZIP duplicating the retained
original images were also deleted.

Source, tests, fixture generators, specifications, written reviews, release
packages and original support illustrations were retained. Review documents keep
historical conclusions and capture filenames, but the captures are no longer
available. These historical conclusions do not establish acceptance of the
current code. Run the appropriate checks to obtain fresh evidence.

## New checks

- Save JSON reports and captured test logs under `output/checks/reports/`.
- Save browser screenshots under `output/checks/screenshots/`.
- These outputs and legacy generated report paths in `docs/` are ignored by Git.
- Keep specifications and written review conclusions in `docs/`.
- Keep small input fixtures and test/generator code in `tests/` and `tools/`.

From the project root, run `npm run verify` for Node tests and syntax checks.
For browser checks, start `node tools/serve.mjs`, then run the relevant existing
`tools/atlas-history-*-checks.mjs` with its installed Playwright entry and optional
Chrome executable, as described in [tools](../tools/README.md). The runners create
their output directories. No new project dependency is required.

The near-budget performance datasets are created in disposable browser IndexedDB,
not as large checked-in files. Clearing an installed extension's storage would
affect user data and is separate from cleaning this checkout.
