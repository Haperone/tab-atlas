# tools/

Local helpers for previewing, testing and **publishing** Tab Atlas. Nothing here ships with the extension —
the store ZIP is built only from `extension/`.

## Generated check output

JSON reports and test logs belong in `output/checks/reports/`; screenshots belong
in `output/checks/screenshots/`. Both are ignored by Git. The browser runners
create their output directories automatically; save manual fixture captures there too.
The filenames below describe generated outputs, not committed acceptance evidence.
Historical captures and their temporary cleanup archive were deleted; see
[`docs/development-artifacts.md`](../docs/development-artifacts.md).
Keep test generators and assertions in `tools/` and `tests/`, and specifications
and written review conclusions in `docs/`.

## Time machine checks

The collection-history replacement is tested at
`http://localhost:8232/tools/atlas-history-checks.html`. Run checks exercises native
IndexedDB with synthetic folders, saved links and archive: exact payload accounting,
replay/order, protected Before restore, trimming, atomic quota failure and one retry,
reopening, and 100/1,000/10,000-link timings. Three additional checks run the new
collection restorer/writer against native IDB with injected local storage: durable
pending/receipt recovery followed by Undo, abandoned preparation and quota failure.
It never restores real browser tabs. Additional checks cover explicit repair of corrupt
history, cached missing dictionary records, batched record quota rollback and the
maximum 199-event replay before a checkpoint (20 checks). This tests native IDB
with injected local storage; it does not prove installed-extension worker/browser lifecycle.

`screenshot-harness.html?time-machine&history-checks&theme=spaceblack` tests the new
Atlas controller/service with native IDB and synthetic Chrome/local-storage APIs.
Read `#atlasHistoryUIResults`. It covers the three folder choices, cancellation,
Undo/Before Undo, newer-edit confirmation, historical link opening, filtering,
rapid seek, full/individual/multiple-folder restore, imported prototype-like IDs,
pause/resume/off, empty/loading/error/Retry, reduced motion and selected rendered
contrast/fit checks across 16 themes (28 checks). Additional cases cover all
missing-parent destinations, an initial name collision, multiple matching folder
names with an explicit destination, and locked folders. Text channels are parsed
from computed RGB/sRGB CSS, without canvas readback or palette interpolation.
Escape closes the options menu before history, preserves the inspected moment,
restores focus and leaves secondary controls collapsed at the next entry.
For a reproducible 320px layout run, open `atlas-history-ui-narrow.html` and read
`#atlasNarrowResults`; the child iframe reports its actual 320×720 size. This
does not emulate browser zoom. Omit `history-checks` for manual preview.
Add `history-first-run` for four automatic-startup/off/reopen/resume checks; no
activation screen is shown. Standalone Saved for later links are tested before
folder pagination, including individual restore/Undo. Add
`history-fault=corrupt`, `quota`, `newer-schema` or `blocked` for two recovery
checks each. Corrupt/newer-schema fixtures alter disposable native IDB metadata
or version; quota exposes a stopped-recording state, and blocked uses a controlled
production storage error. These last two UI fixtures do not prove native quota
exhaustion or a real upgrade block; native transactions have separate tests.
These are disposable synthetic collections; profile data and real browser windows are untouched.
Evidence is in `output/checks/reports/atlas-history-ui-checks.json`, `output/checks/reports/atlas-history-ui-320.json`
and `output/checks/reports/atlas-history-native-checks.json`. The overall feature remains in progress;
the acceptance boundaries are listed in `docs/atlas-history-progress.md`.

`atlas-history-worker-checks.html` runs the production collection service in actual
module Workers and terminates them after durable preparation, atomic local receipt,
target journal commit and final operation commit. Restart/retry/Undo, the three
folder modes, concurrent postMessage intentions and a 1,000-link/199-event replay
are checked, including 20 service round-trip samples for the bounded replay (10 checks).
The production quick-save service shares the history writer: popup/context handler
saves, repeat/no-op, quick Undo, concurrent create-folder/dashboard save, reopening
and stale popup Undo after restore are checked without dashboard DOM. Receipt and
sound requests are counted through fixture adapters; actual Chrome dispatch,
injection and audible feedback are not proved here.
Read `#results`. A separate disposable native IDB database substitutes
for `chrome.storage.local`; this proves Worker interruption boundaries, not an
installed extension's storage or a browser restart.

`atlas-history-ui-performance.html` measures the real controller with the collection
service in a native Worker, using 100/1,000/10,000-link datasets and actual journal
payload near the configured 200 MiB budget, using multiple historical collections
that each fit ordinary local storage. It collects 20 seek round trips, 20 warm useful
previews and 20 previews including Worker termination/reopening per dataset.
The current flow opens the latest matching state, then chooses Earlier to show a
recovery moment with one missing link per folder. Useful-preview timings include
both actions; entry-only timings are recorded separately. Current archived links
are separate from historical active counts and must survive restore/Undo unchanged.
Long-task observation covers the preview flow; heap/origin values are estimates,
not physical history bytes or Worker heap. Restore/Undo and actual budget trimming
are timed separately and the protected point/ledger are checked afterward.
Read `#atlasHistoryPerformanceResults`; failures remain visible in its `errors`.
Both pages use disposable synthetic collections and cannot restore profile data.

The pages below test the superseded browser-tab history prototype. Their verdicts
do not establish acceptance of the collection-history specification.

`http://localhost:8232/tools/time-machine-checks.html` runs native IndexedDB ledger,
atomicity, replay, trimming and timing checks on disposable synthetic databases. It also
terminates/restarts a native Worker and tests an interrupted restore through postMessage.
The Worker uses synthetic Chrome APIs; this is not an installed-extension lifecycle test.

`time-machine-ui-checks.js` and `time-machine-ui-performance.js` belong to the
superseded browser-tab model. Their measurements and `docs/time-machine-review.md`
do not establish new Atlas acceptance. Do not run the old performance fixture against
the replacement UI; use `atlas-history-ui-performance.html` for the collection model.

Before release, also test the installed unpacked extension with real regular/private
windows, native groups, toolbar/ПКМ, worker termination and a Chrome restart. Do not
interpret the harness's mocked APIs as evidence for those cases.

## `atlas-history-timeline-checks.mjs`

`atlas-history-timeline-checks.mjs <existing-playwright-entry> [chrome-executable]`
runs the zoomable ruler with native pointer, wheel and keyboard input at 1280×720
and 320×400 in Space Black, Aurora Glass and Paper Soft. The disposable
`?time-machine&history-timeline-preview` fixture has monthly history since 2024
and an 80-snapshot dense burst. It checks anchored zoom, drag without selection,
fit, refinement to exact points, the one-second zoom floor (including wheel input),
whole-second axis intervals, adjacent stepping, bounds and read-only collections,
native thumb/playhead alignment at both ends and during actual mouse scrubbing
(including nearest commit on release),
then runs the native IDB suite (including bounded timestamp metadata/nearest lookup,
v1-to-v2 size-index upgrade with protected Undo, and shared-reference compaction
that reconstructs every retained moment without scanning record payloads).
No project dependency is installed. Reports: `output/checks/reports/atlas-history-timeline-ui.json`
and `output/checks/reports/atlas-history-timeline-native.json`; these do not prove installed MV3 behavior.

## `atlas-history-ux-ui-checks.mjs`

`atlas-history-ux-ui-checks.mjs <existing-playwright-entry> [chrome-executable]`
runs 16 themes at 1280×720, 1024×500, 1920×1080, 640×360 and 320×400 (80 cases), against disposable
localhost comparison history with native IndexedDB and synthetic Chrome adapters.
It checks expanded help, noncollapsed lists, padded checkbox selection and its
persistent cue, selected-link names in confirmation, options/outside/Escape, native link
Enter/Ctrl/middle behavior, confirmation bounds and expanded captions, AX names,
copy destination disclosure, Cancel/reset/search focus and storage consequences.
Gated reads verify immediate adjacent-navigation loading/disabled controls and
closed-session stale error isolation. Modifier-created tabs are fulfilled by a
local route; they never contact an external website. No dependency is installed.
Outputs: `output/checks/reports/atlas-history-ux-ui-browser.json`, 16 × 3 flow screenshots and
16 × 2 short/wide overviews under
`output/checks/screenshots/review/` plus a narrow confirmation. The gallery
there shows final flow surfaces; `all-themes/` is the earlier axis-only gallery.
These checks do not prove installed MV3, speech, OS high contrast or real zoom.

## `atlas-history-polish-checks.mjs`

`atlas-history-polish-checks.mjs <existing-playwright-entry> [chrome-executable]`
runs all 16 themes at 1024×500 and 320×400. It injects critical usage metadata
into disposable history to exercise warning + selection dock + short scrolling,
checks reachable folder/link targets, selected-link confirmation, expanded help,
RTL and long header labels, and unchanged collections after Cancel.
Outputs `output/checks/reports/atlas-history-second-polish-ui.json` and representative selected
screenshots in `output/checks/screenshots/second-review/`. It does not fill
an actual disk or access an installed extension/profile.

## `atlas-history-step-checks.mjs`

`atlas-history-step-checks.mjs <existing-playwright-entry> [chrome-executable]`
seeds 250 disposable moments with a 500-event checkpoint cadence, reopens with
the current 200-event policy, and exercises actual Earlier/Later button clicks.
At both 1280×720 and 320×400 it checks every timestamp and corresponding content
through 250 steps in each direction, true endpoint disablement and unchanged
current collections. Moments are 1ms apart: it also checks one-second minimum
zoom, keyboard/wheel stability at that limit, clustered-point focus/hint and
exact arrow stepping within a second. Then it runs the native IDB suite, including bidirectional
replay after changed checkpoint spacing. No installed profile is used and no
dependency is added. Outputs: `output/checks/reports/atlas-history-step-ui.json` and
`output/checks/reports/atlas-history-step-native.json`.

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

For the current collection-history UI, use
`http://localhost:8232/tools/screenshot-harness.html?time-machine&history-checks&theme=spaceblack`.
Its 32 cases include the plain inbox/folder split and independent scrolling,
fully expanded Saved for later, all missing folder links exposed before remaining
present links, and expansion by 25 from the actual visible count,
current-snapshot restore suppression, the quiet header action and selected dock, delayed restore feedback, failure
without a local write, visible recovery/Retry and returning keyboard focus after
Cancel. To constrain both width and height, use
`http://localhost:8232/tools/atlas-history-ui-narrow.html?height=400` (320 × 400).
These are synthetic Chrome collections with native IDB, not installed-extension
lifecycle, browser zoom or physical Chrome quota evidence.

For real keyboard input with browser-emulated forced colors and reduced motion,
run `node tools/atlas-history-keyboard-checks.mjs <installed-playwright/index.mjs> [chrome-executable]`
with an already installed runtime and the static server running. No dependency is
installed. The runner covers all 16 themes at 1280 × 720 and 320 × 400, records focus
perimeters/bounds, and exercises selection → confirmation → Escape → clear selection
→ close. The report is `output/checks/reports/atlas-history-forced-colors-keyboard.json`. Its isolated
HTTP fixture has a test-only CSP excluding antivirus-injected external scripts.
This is browser media emulation, not OS high contrast, browser zoom or installed MV3.

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
in `docs/interface-full-review.md`; results in `output/checks/reports/interface-full-measurements.json`.

## Chrome Web Store package

For the revised active-only Time machine, run `/tools/atlas-history-active-checks.html`
for six native IndexedDB checks of archival exclusion, legacy migration, atomic
failure, durable reactivation Undo and ordinary-save survival after history budget
failure. `/tools/atlas-history-checks.html` covers
21 storage/quota/replay checks; timing datasets contain 100/1,000/10,000 active links.
The history UI fixture runs 28 revised scenarios, including hidden fully present
groups, red missing-folder fills, missing-first rows in mixed folders/inbox,
search/pagination-independent comparison and missing empty folders without permanent labels,
and tests all 16 themes. Its 320 px iframe wrapper is
`/tools/atlas-history-ui-narrow.html`. A disposable visual example is
`/tools/screenshot-harness.html?time-machine&history-comparison-preview&theme=spaceblack`.
These fixtures are not installed-extension lifecycle proof.

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
