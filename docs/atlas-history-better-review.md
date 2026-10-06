> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Current Time machine interface review

6 October: the subsequent full UX/UI review, resolved findings across all six
domains, 48-run browser flows and verification boundaries are consolidated in
[atlas-history-ux-ui-review.md](atlas-history-ux-ui-review.md). The earlier findings
and measurements below retain their stated historical scope.

6 October: the subsequent zoomable calendar ruler review and verification are in
[atlas-history-timeline-review.md](atlas-history-timeline-review.md). The sections
below retain their earlier content-layout scope.

Disclosure correction (better-layout: order by importance and hint at hidden
content): Saved for later exposes its entire list; folders expose every missing
link immediately and reserve Show more for remaining present links. Expansion
adds 25 to the actual exposed count, preserving both pane offsets. Current UI
fixtures pass 32/32 at both sizes; large fully exposed lists have not had a
separate performance benchmark. Existing material and motion styling is unchanged.

Stable-pane correction: desktop lanes keep their positions and widths when the
neighbour is hidden. The prior one-column fallback moved folder cards left and
reduced each card's width by fitting more cards per row. The browser regression
compares actual pane rectangles before/after folder-only and list-only search.
Narrow-screen block flow remains unchanged.

Latest action correction: full restore is a secondary button in the fixed header;
the bottom dock belongs solely to explicit selection and disappears on reset.
Restore labels wrap and have no literal ellipsis. The dock no longer inherits
the dashboard footer's delayed `fadeUp` animation (runtime opacity was 0 immediately
after selection); it is immediately opaque with no transform. Relevant UI checks
cover header placement, selection-only dock, unabridged labels and immediate
visibility. The user-confirmed two-part content layout is implemented: plain
Saved for later list on the left, folder cards on the right, equal desktop widths
and independent scrolling; narrow screens stack with a shared content scroll.
Native ul/li provides list semantics. Both scroll offsets survive expansion and
selection spans both areas. UI 32/32 passes at each tested viewport, including
transparent/no-border/no-shadow list styling and search/pagination. Native 200%
browser zoom remains outside these fixture measurements.

6 October follow-up (better-layout, better-ui, better-accessibility): the restore
dock is absent for a snapshot identical to the active current Atlas. Exact comparison
includes properties/order and ignores unrelated archive/settings. A different
latest snapshot while recording is off retains the restore action. Hiding the dock
returns its focus to Close; restore/Undo does not focus a hidden action. No CSS,
theme materials or animation tokens changed. Headless UI verification uses a
test-only CSP to exclude antivirus-injected external scripts; this is not privacy
or installed-extension evidence.

6 October keyboard follow-up: [reproducible runner](../tools/atlas-history-keyboard-checks.mjs)
and 32 passing runs (`atlas-history-forced-colors-keyboard.json`, deleted capture) exercise all 16
themes at 1280 × 720 and 320 × 400 with real Tab/Shift+Tab/Space/Enter/Escape input
and browser-emulated forced colors/reduced motion. Focused controls remain inside
the viewport and retain a solid perimeter of at least 2 CSS px. Selection survives
Cancel, focus returns to the restore action, clear selection focuses full restore,
and closing returns to Customize. No actionable findings in this observed flow;
OS high contrast, actual browser zoom and screen-reader speech remain unverified.

5 October 2026. Scope: current active-only collection history, default recording,
comparison/hidden groups, timeline/search, selection, pinned restore, conflicts,
confirmation/Cancel, protected Undo and fault/recovery surfaces. This is not an
approval of installed Chrome lifecycle or the superseded browser-tab recorder.

Stack: vanilla ESM, native dialog/details/button/input, project CSS and the existing
save notification. Conventions found: AGENTS.md, time-machine-spec.md and the
project-local better skills. All six owning skills were read, with apple-design
for feedback/materials. User-directed exceptions: no permanent presence captions
or extra status icons; descriptions remain in native titles, accessible names and
keyboard-focus text. The current theme remains the user's theme during preview.

## Coverage

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native names/roles, Cancel focus, menu/Escape, restore/Undo guards, status/alerts, focus descriptions; actual Tab → Enter → Escape; current UI checks at 1280 × 720 and 320 × 400 | Observed controls pass; screen-reader speech, all focus-color pairs and OS forced colors not verified |
| Layout | Hidden matching groups, inbox-first/missing-first stable order, lazy rows/folders, timeline and dock outside scrolling content; confirmations/errors at 320 × 400 | Observed widths pass; RTL and real browser zoom not verified |
| Writing | Default recording/off/pause, entire-vs-selected restore scope/date, three explicit folder choices and exact copy name, replacement/Undo/Clear consequences, specific recovery, active-only archive semantics | Clear for current source vocabulary; long-action and offscreen-error issues fixed below |
| Typography | Shared sans/serif hierarchy, unitless wrapped labels, tabular dates, full URL title/accessible name/focus wrap, varied-length fixture names/addresses | Observed strings pass at tested widths; real 200% zoom not verified |
| Colors | Settled rendered text samples across 16 themes, semantic primary/danger/presence tokens, translucent-background compositing in fixture measurements | Minimum measured text contrast 5.00:1; unmeasured focus/hover/OS combinations are not claimed |
| UI | Current Glass/Soft/Apple screenshots, family backgrounds/blur/shadow direction, 120 ms interruptible press feedback, reduced-motion rules, persistent Undo, no extra dashboard toolbar | Observed states pass; slow Animations-panel replay and native audio not verified |

## Consolidated changes

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| MEDIUM | Layout | extension/lib/atlas-history-ui.js:215 | The ten-row limit hid missing links and paginated the standalone list | Entire inbox and all missing folder rows are exposed; remaining present rows expand by 25 from the actual visible count | Important recovery content remains visible without unnecessary disclosure actions |
| MEDIUM | Layout | extension/lib/atlas-history-ui.js:44; extension/time-machine.css:20 | Selected restore scrolled away with search; full restore required the options menu | Restore dock stays below the scroll area, with date, scope and narrow-screen button layout | Important actions stay reachable without covering the final links |
| MEDIUM | Accessibility | extension/lib/atlas-history-ui.js:398 | Cancelling restoration left keyboard focus at Close after disabling the original button | Finalization returns focus to the visible dock action with a 2 px indicator | Trap-and-restore-focus preserves the user's place |
| MEDIUM | UI | extension/lib/atlas-history-ui.js:102; extension/lib/atlas-history-ui.js:341; extension/lib/atlas-history-ui.js:358 | Long restore/Undo exposed progress only near the top; the visible action kept its idle label | Dock action says Reviewing… / Restoring… / Undoing restore… while unavailable | Continuous feedback distinguishes a running operation from an unresponsive action |
| MEDIUM | Layout | extension/lib/atlas-history-ui.js:58 | Runtime errors appeared above the scrolled content | Error reporting brings the recovery message and Retry into view immediately | A failed operation must leave a reachable explanation and recovery path |

## Verification

- Current UI scenarios (`atlas-history-restore-dock-ui.json`, deleted capture) and
  320 × 400 fixture (`atlas-history-restore-dock-ui-320x400.json`, deleted capture): 29/29 each,
  across 16 themes. The full-restore case gates a reply, verifies visible disabled
  Restoring…, simulates failure, checks unchanged collections and an onscreen
  error, then retries and verifies exact restore/Undo. The quota fault is a
  controlled fixture, not physical Chrome quota exhaustion.
- Fault surfaces (`atlas-history-current-fault-ui.json`, deleted capture): corrupt, quota,
  newer-schema and blocked, 2/2 each; cancellation/Retry preserve data.
- Native IDB migration/reactivation/budget (`atlas-history-current-native.json`, deleted capture):
  6/6; storage/UTF-8/quota/replay (`atlas-history-current-storage.json`, deleted capture): 21/21.
- Actual module Worker (`atlas-history-current-worker.json`, deleted capture): 10/10, including
  termination and durable protocol stages; Chrome adapters remain synthetic.
- Performance (`atlas-history-restore-dock-performance.json`, deleted capture): current near-budget
  100/1,000/10,000 datasets, native IDB and Worker with the production controller;
  Long Task observation is available. Renderer heap is an estimate, origin usage
  covers all localhost data, and Worker heap/physical DB overhead are unmeasured.
- Source verification (`atlas-history-restore-dock-verification.txt`, deleted capture):
  `npm run verify`, 324/324. Also `node --check extension/lib/atlas-history-ui.js`,
  `node --check tools/atlas-history-ui-checks.js` and `git diff --check`.

Not verified: installed MV3 transport/interruption/browser restart, two actual
dashboards with popup/ПКМ, file access, native injected notification/audio,
screen-reader speech, OS forced colors, real browser zoom 200%, RTL mirror and
animation replay at 10% speed. Detailed acceptance gaps are in
[the current matrix](atlas-history-acceptance.md) and
[native checklist](atlas-history-native-checklist.md).

Approve for the reported local source/fixture coverage. Overall feature
acceptance remains in progress; this verdict does not close the native gaps.
