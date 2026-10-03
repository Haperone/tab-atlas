# tools/

Local helpers for previewing, testing and **publishing** Tab Atlas. Nothing here ships with the extension —
the store ZIP is built only from `extension/`.

## `serve.mjs`

A dependency-free static file server for the repo root.

```bash
node tools/serve.mjs [port]   # default port 8232
```

Then open, for example:
- `http://localhost:8232/tools/screenshot-harness.html` — screenshot harness (below)
- `http://localhost:8232/docs/privacy-policy.html` — preview the published privacy page

## `screenshot-harness.html`

Renders the **real** dashboard — the actual `extension/app.js` and `extension/style.css` —
inside a plain web page by mocking the `chrome.*` APIs the dashboard reads
(`chrome.tabs`, `chrome.storage`, `chrome.windows`, `chrome.tabGroups`) and feeding it
representative seed data. Favicons (normally from Chrome's local `_favicon` cache, which
isn't available outside the extension) are painted as on-brand letter tiles.

**Why:** Chrome Web Store requires at least one 1280×800 (or 640×400) screenshot, and
authentic ones would otherwise need the unpacked extension loaded plus ~15 real tabs
arranged by hand. This harness makes a clean, deterministic capture a one-file affair.

**Capture:**
1. `node tools/serve.mjs`
2. Open `http://localhost:8232/tools/screenshot-harness.html`
3. Force a **1280×800** viewport (DevTools device toolbar → Responsive → 1280×800)
4. Screenshot. To vary shots, edit the `SEED_TABS` / `SEED_STORE` arrays near the top of
   the harness, or open the Sweep / workspace UI before capturing.

Choose a theme deterministically with `?theme=<id>`, for example:

- `http://localhost:8232/tools/screenshot-harness.html?theme=auroraglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=smokeglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=pearlglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=paperglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=spaceblack`
- `http://localhost:8232/tools/screenshot-harness.html?theme=pacificblue`
- `http://localhost:8232/tools/screenshot-harness.html?theme=orchidbloom`

Save PNGs into `extension/store-assets/` and attach them in the Web Store dashboard.

For a crowded drag-scroll fixture, open `http://localhost:8232/tools/screenshot-harness.html?stress=1`.
For automatic browser checks, use `?checks=1` at a viewport of at least 1240px wide.
For computed view-panel color and material measurements across every theme,
use `?polish=1`. Read the JSON in the hidden `#interfacePolishResults` element;
run at 320px to also detect narrow-layout overflow. This fixture restores its
initial theme after sampling and does not change the saved theme pair.
The checks exercise the real dashboard with local Chrome API mocks: collapsed view
drawer, keyboard and outside-click dismissal, view filters,
keyboard search, node/focus preservation, compact preferences, stationary edge
scrolling, wheel scrolling during drag, moving an inbox link to the top folder,
scoped closing and duplicate cleanup with Undo. A result panel shows each outcome.
The suite also checks empty-search recovery and rapid theme reversal.

For the deeper folder/menu/dialog/archive/workspace interaction review, use
`?theme=spaceblack&deep=1`. The hidden `#interfaceDeepResults` JSON records ten
sequential flow checks and 112 auxiliary-surface text/material samples across
all 16 themes. Repeat at a 320px viewport to check bounds and wrapping. Use
`&surfaces=1` to sample only the surfaces. These fixtures run on mock data;
they do not edit live Chrome tabs or user bookmarks.

For the real quick-save popup with mocked Chrome APIs, open
`http://localhost:8232/tools/quick-save-harness.html?theme=spaceblack`.
Use `&checks=1` for save/repeat/move/Undo, keyboard/filter/new-folder scenarios,
and text/material measurements in all 16 themes (`#quickSaveResults` JSON).
Eight text roles produce 128 measured pairs per viewport, including the search
field, inline error, selected destination and Undo surface. The dashboard fixture
`?saved-refresh=1` checks four external-save/folder/Undo synchronization scenarios
without tab events, including deferring updates while an editor has focus.
Preview at 360×600. The native popup now has an explicit 360px intrinsic minimum;
320px is no longer its supported width. Additional fixtures: `&empty=1`, `&many=1`,
`&unsupported=1`, `&fail=1` (write failure), `&unavailable=1` (initial read failure),
`&existing=1`, `&context=1` (simulate a page-menu save),
and `&persist=1` (retain fixture data across reloads in sessionStorage).
The harness imports the production popup and worker service; it does not
install an extension, create native browser menus or touch live user tabs.

For the popup sizing regression and page notifications, open
`http://localhost:8232/tools/quick-save-notification-harness.html?theme=spaceblack&checks=1`.
Eight groups check sizing in an initially 142px iframe, success/repeat/error/dismiss,
all 16 theme materials, inert folder text, reduced motion, navigation races and
automatic cleanup, countdown pause/resume, focus disclosure, double-click guards
and action-specific Undo from both entry points (`#notificationResults` JSON). Hover events are simulated
by the fixture; focus and clicks use the real DOM controls. The page uses production injection
logic with mocked `chrome.scripting`; Chrome's actual activeTab grant is not exercised.
The preview popup closes after explicit confirmation and triggers feedback in
the sample website. Normal preview buttons play the packaged sound; automated
checks count sound requests without playing them. `&undone=1` on the standalone
popup confirms the previous Undo result is not rendered as a persistent block.

> The harness loads `extension/index.html` via `fetch`, so it only works over `http://`
> (the `serve.mjs` server), not from a `file://` path.

## Full interface audit

With `node tools/serve.mjs` running, open:

- `/tools/screenshot-harness.html?theme=spaceblack&audit=1` — production sharing,
  import, privacy, all tour steps, Sweep Apply/Undo, keyboard organization and
  injected partial save/close/restore failures. Fourteen check groups and 560
  text/material samples across 16 themes; read hidden `#interfaceAuditResults`.
- Add `&load-failure=1` — fail the first storage read and verify visible Retry.
- `/tools/responsive-interface-checks.html` — sequential iframe checks at a real
  320×700 and 640×400 with enlarged text spacing, then deep dialogs and public
  pages at 320px. Read `#responsiveInterfaceResults`. Sequential execution avoids
  competing focus between several test iframes.
- `/tools/public-interface-checks.html` — public share errors/recovery, review of
  all 20 incoming links, unavailable extension, landing and privacy page.
  Read `#publicInterfaceResults`.

The complete scope, resolved root causes and native-environment boundaries are
in `docs/interface-full-review.md`; results in `docs/interface-full-measurements.json`.

## Chrome Web Store package

Update `extension/manifest.json`, `package.json` and `CHROMEWEBSTORE.md`, run
`npm run verify`, then `python tools/build-store-package.py`. The builder creates
`release/tab-atlas-<version>-chrome-web-store.zip` with the manifest at its root
and a separate JSON inventory/hash report. It checks every packaged JavaScript
file, local dependencies, ZIP integrity and byte equality with current sources;
excludes private config, tests and store assets; and refuses to overwrite an
existing release archive.

Storage warning checks: open
`http://localhost:8232/tools/screenshot-harness.html?storage-checks=1`.
The fixture checks healthy/warning/critical states, external writes, cleanup
navigation, focus restoration, retry after a failed measurement, and controls
across all themes. For a static preview use `?storage=85&theme=spaceblack` or
`tools/quick-save-harness.html?storage=96&theme=spaceblack`.
All data and quotas in these previews belong to disposable Chrome API mocks.
