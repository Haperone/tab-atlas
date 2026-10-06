> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Atlas Time machine: evidence and remaining acceptance

5 October 2026. Scope: the collection-history specification, not the superseded
browser-tab recorder. Production integration is present. **Overall acceptance is
in progress.** Version 1.2.0, permissions and release archive are unchanged.

6 October storage follow-up: configured collection-history budget is now 200 MiB
with a 160 MiB trim target. Warnings begin at 160 MiB and become almost-full at
190 MiB; usage and cleanup text read the live status. Earlier measurements below
that explicitly mention 20 MiB describe the preceding budget, not current capacity.
Existing history/Undo are not cleared on this change; reload the installed worker
and Atlas page to use the new budget. Node verification 335/335 and 32 isolated
warning/theme/viewport checks pass; injected warning usage is not full-disk evidence.
The new native Worker benchmark (`atlas-history-200mb-performance.json`, deleted capture) passes
100/1,000/10,000 links with 187.85–188.01 MiB of actual accounted records.
GC after the budget crossing leaves 156.98/157.15/159.41 MiB and preserves the
protected return point. Restore/Undo and exact ledger audit pass. Warm useful
preview p95 is 81.5/85.2/500.3ms; cold 110.9/166.8/637.6ms. Disposable localhost
IndexedDB/synthetic Chrome adapters, not installed-profile quota/lifecycle evidence.

The revised target is implemented in source: automatic recording, active-only
moments, hidden fully present groups, red missing folders/links and green present
links within mixed groups without permanent status
labels, original-folder restoration, reactivation without duplicate identities and
exact protected Undo. Legacy collection history migrates atomically; promised Undo
remains intact. Current archive is separate and preserved outside selected identities.

6 October follow-up: current-snapshot restoration is hidden based on exact active
data/property/order equality, including after restore/Undo. An older identical
snapshot is also hidden; a changed latest snapshot while recording is off remains
restorable. User manually confirmed that the latest timestamp updates after saving
with the dashboard closed, via one unspecified popup/context-menu path. This is
partial native evidence, not proof of both entry paths or snapshot contents.

Latest user correction: full restore is now a neutral button in the fixed header;
the bottom action is shown only for an explicit selection. Labels wrap without
ellipsis/clipping, and the dock's inherited delayed footer animation is suppressed.
The user-confirmed two-part content layout is implemented: plain Saved for later
list on the left, folder cards on the right, independent desktop scrolling, shared
narrow-screen scrolling. UI checks exercise both offsets, expansion preservation,
search/pagination, native list semantics and cross-pane selection.
Desktop pane widths and positions now remain stable when either side is hidden;
the regression measures both actual rectangles during folder-only/list-only search.
Saved for later is fully expanded; every missing folder link is exposed immediately,
with progressive disclosure only for remaining present rows. Expansion tests cover
30 missing rows followed by batches of 25, search, selection and scroll preservation.
The current Node and near-budget performance runs include this disclosure
correction; there is no separate large fully exposed-list benchmark.

6 October timeline: the calendar ruler supports anchored zoom, pan, year/month
anchors and exact moment stepping. Small dots and stroke groups replace numbered
tiles; counts appear on hover/focus. [Review](atlas-history-timeline-review.md),
gesture checks (`atlas-history-timeline-ui.json`, deleted capture) 6/6 and
native timeline/storage checks (`atlas-history-timeline-native.json`, deleted capture) 22/22.
The latter supersede the earlier 21 storage checks for this source.

6 October full UX/UI polish: [consolidated six-domain review](atlas-history-ux-ui-review.md).
Options/Escape, native link modifiers, conflict validation, copy disclosure,
structured confirmation and Undo/empty-state copy are corrected. Focus details
no longer change row geometry; pointer checkbox selection after keyboard focus
is covered. Pending adjacent lookup immediately disables old snapshot actions;
closed-session failures do not contaminate re-entry.
48 browser flows (`atlas-history-ux-ui-browser.json`, deleted capture) pass across 16 themes/three
viewports, including CDP AX names, expanded captions, Cancel/reset and pending reads.
Final screenshots (`time-machine-screenshots/review/index.html`, deleted capture) cover all themes.

6 October navigation follow-up: Earlier/Later browser walk (`atlas-history-step-ui.json`, deleted capture)
passes 250 steps each way at both widths, checking exact dates and contents after
reopening history with older, longer checkpoint spacing. Native IDB 23/23 (`atlas-history-step-native.json`, deleted capture)
includes the existing 22 cases and the changed-cadence bidirectional replay case.
Seek now reads the real checkpoint-to-requested-time range rather than truncating
at the current write cadence. This repairs a repeated-point loop without rewriting
history. Installed worker reload/acceptance remains a separate boundary.

Current evidence: 333 Node checks (`atlas-history-step-verification.txt`, deleted capture),
6 native projection/migration checks (`atlas-history-current-native.json`, deleted capture),
earlier 21 native storage/quota checks (`atlas-history-current-storage.json`, deleted capture),
updated UI (`atlas-history-current-snapshot-ui.json`, deleted capture) and 320 × 400 UI (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture)
32/32 each, automatic startup (`atlas-history-current-snapshot-first-run.json`, deleted capture) 4/4,
actual Worker (`atlas-history-current-worker.json`, deleted capture) 10/10 with synthetic Chrome adapters,
four fault surfaces (`atlas-history-current-fault-ui.json`, deleted capture) 2/2 each.
Installed Chrome lifecycle, native cross-context dispatch, real audio, screen reader,
forced colors/200% zoom and installed MV3 performance remain unverified.
Browser-emulated forced colors/reduced motion now have a separate
32-run keyboard report (`atlas-history-forced-colors-keyboard.json`, deleted capture), all 16 themes
at two widths with actual Tab/Shift+Tab/Space/Enter/Escape input. Focus perimeters
and viewport bounds pass; Cancel/reset/close return focus correctly. This narrows
AT-18 uncertainty but does not prove OS high contrast, real browser zoom or speech.
The current near-budget localhost benchmark (`atlas-history-current-snapshot-performance.json`, deleted capture)
passes all three sizes (100/1,000/10,000): warm preview p95 41.8/64.5/463.2 ms,
preview after module Worker restart p95 66.5/124.9/692.2 ms, and no observed preview
Long Task ≥50 ms. This measures native IDB and a module Worker with synthetic
Chrome adapters; it does not establish physical database size or Worker heap.
This final run had no concurrent browser audits. Its recovery preview exposes
one missing link per folder; giant fully exposed inboxes/all-missing folders and
years of real user changes were not benchmarked.
Current UI reports use isolated headless Chrome and a test-only CSP excluding
antivirus-injected external scripts; they do not establish installed MV3 or privacy
boundaries. The initial unisolated UI run failed its external-resource assertion
because Kaspersky injected its own script; no application external-resource failure
was observed.
The earlier matrix below is historical archive-inclusive evidence; those green
checks do not substitute for updated acceptance of each revised requirement.

Latest comparison UI: hidden unchanged groups (`atlas-history-current-snapshot-ui.json`, deleted capture)
and 320 × 400 (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture), 32/32 each. Search cannot
reveal fully present groups; missing links remain first, current comparison updates
without changing the moment, and full restore retains the complete snapshot.

## Current requirement-by-requirement audit

This matrix covers the current active-only specification and the pinned restore
action. Evidence in the middle column establishes only the named source or
fixture boundary. A gap in the final column means that acceptance item is not
fully achieved; the previous-stage matrix cannot close it.

| ID | Current evidence inspected | Acceptance gap |
| --- | --- | --- |
| AT-01 | `atlas-history-model.js` captures only folders/active links and order; current native 6 + storage 21 check the active projection and dictionary | Installed data/profile composition |
| AT-02 | `background.js` starts the owner and passes its writer to quick-save; `app.js` uses collection commands; current Worker 10 checks popup/context callbacks with the dashboard absent; service tests verify archive-only/no-op exclusion and default baseline | Native popup/ПКМ dispatch and startup |
| AT-03 | Command/writer tests cover atomic rename/reorder/drop/delete/import boundaries and one local commit; current storage replay preserves ordering | Actual drag/import and multi-context gestures |
| AT-04 | Current UI 32 checks read-only preview/search/selection and live comparison without resetting the moment; selection remains after Cancel | Installed tabs/windows and new edits from other extension contexts |
| AT-05 | Current UI: 100 scrub inputs do not load until release; one final seek wins and a stale failed nearest reply stays silent. Gesture checks 6/6 cover calendar zoom/pan/exact stepping; 19 targeted Node tests cover geometry/calendar/service guards. UX gated adjacent read proves immediate loading/disabled old content, including modifier links; closed-session status failure remains silent. Updated IDB 23 and two actual button walks (1000 total transitions) prove exact replay across an older, longer checkpoint cadence | Installed large-dataset input |
| AT-06 | Model/restorer tests plus current UI full restore preserve unrelated archive/workspace/fixture browser tabs; one durable receipt/generation commit | Full restore in a disposable installed profile |
| AT-07 | Current UI 29 covers all folder modes, single links, original missing parents, multiple targets/conflicts and a combined plan; Cancel commits nothing | Native dialog/storage flow |
| AT-08 | Service tests and current UI open-link case check exact query/fragment URL and current normal window; restore opens no tabs. Native anchor Enter and real Ctrl/middle-created headless tabs covered with locally fulfilled dummy pages | Actual Chrome windows and file-access permission behavior |
| AT-09 | Current native 6, storage 21 and restorer tests prepare protected Before/target before local commit; failed protection retains prior Undo | Actual Chrome local quota and MV3 interruption at that boundary |
| AT-10 | Current native reopening and Worker termination recover Undo after the transient notice; persistent menu actions remain | Chrome service-worker and browser restart |
| AT-11 | Current native reactivation/reopening/Undo/return-again checks exact collections and both durable points | Installed restart |
| AT-12 | Current UI newer-edit conflict: Cancel retains edits; confirmation protects the new Before Undo; stale revision tests reject replacement | Native concurrent contexts |
| AT-13 | Current Worker 10 terminates real module Workers at four durable stages; lost-response/idempotence and preparation abandonment are covered | Actual MV3 termination/reawakening |
| AT-14 | Queue/CAS/generation source and tests; current Worker concurrent commands retain confirmed changes; status/step wait behind a gated commit | Two installed dashboards + popup + ПКМ |
| AT-15 | Model tests distinguish stable id/full URL/query/fragment, archive reactivation, Unicode copy names, identity collisions and lock rules; current UI checks explicit targets and original folders | Real profile identities/locked-flow integration |
| AT-16 | Current storage 21 measures the full UTF-8 ledger and bounded replay; current near-budget benchmark checks GC reachability and protected restore/Undo at 100/1,000/10,000 | Physical IDB overhead and actual Chrome origin quota are not the payload budget |
| AT-17 | Current storage 21 + native 6 verify abort/corrupt rollback, limited quota retry and ordinary-save survival; current faults 4 × 2 verify specific recovery, Retry and explicit Clear | Real quota exhaustion/blocked upgrade in an installed profile; fixture quota/block injection is controlled |
| AT-18 | Current UI 32 at 1280 × 720 and 320 × 400; keyboard/forced-colors/reduced-motion runner 32/32 across 16 themes. UX runner 48/48 at three sizes adds named AX controls, enlarged captions, stable keyboard-to-pointer selection, Escape ownership and precise invalid-field focus. Cancel/reset/close recovery and focus bounds pass | Real 200% browser zoom, OS forced colors and screen-reader speech; viewport/media emulation is not browser zoom or OS high contrast |
| AT-19 | Existing notice regression covers bottom success, countdown/pause, Undo/back glyph and Sound off; current UI covers restore notice and durable menu action | Actual Chrome content injection/offscreen audio and native hover/focus notification |
| AT-20 | Current benchmark covers near-budget warm/cold preview, seek round trips, writes/GC/restore/Undo, renderer heap estimate and whole-origin estimate; current Worker checks maximum 199-event replay | Installed MV3 transport/CPU, Worker heap and physical DB size remain unmeasured |
| AT-21 | Collection commands/quick-save/deletion/backup/archive tests in 333 checks; prior dashboard/audit/notice/responsive fixtures cover unchanged surfaces; current Worker covers shared quick-save history integration | Native popup/ПКМ, drag/wheel/autoscroll, real warnings and browser workspace regression |
| AT-22 | Current README, privacy policy and store notes describe default-on active-only history, separate budget, protected Undo and source-only release status; current matrix and review report state limits | Native evidence remains pending; no release claim is made |
| AT-23 | `atlas-collection-client.js` captures Undo generation; command/quick-save tests reject old generations, including an in-flight old action | Native delayed notification across contexts |
| AT-24 | Current native 6 + storage 21 verify atomic legacy projection, unchanged dates/sequences/off-pause, protected old Undo and damaged rollback; ordinary snapshots free unreachable archive data | Migration of a real installed legacy collection-history profile |
| AT-25 | Current UI 32 checks hidden fully present/empty groups, missing-first order, mixed/uniform colors, search/pagination, moved identities and pause/live updates across 16 themes; dock remains reachable without covering the last rows | Installed rendering with actual user data; native a11y boundaries remain under AT-18 |

Deliverables inspected: production modules/tests/docs; current Glass/Soft/Apple
screenshots; native/storage/Worker/fault/UI/performance artifacts. The latest
[full UX/UI review](atlas-history-ux-ui-review.md) identifies its actual coverage.
Version/permissions/release archive are unchanged; no commit or push was made.
Overall acceptance remains in progress because the native gaps are substantive.

## Previous stage: evidence boundaries (historical)

`npm run verify` passes 313 tests. Native IndexedDB fixtures pass 20/20 in IAB and
Chrome; actual module Worker fixtures pass 10/10 in both. Real controller/service UI
fixtures pass 27/27 at 1280×720, in a 320×720 iframe and in Chrome at its actual
3200 px width. These use synthetic Chrome
APIs and synthetic collections. The Worker fixture substitutes a separate durable
native IDB store for `chrome.storage.local`. Terminating that Worker proves the
protocol across those boundaries; it does not prove installed extension service
worker or browser restart behavior. No user collections were restored or cleared.

Installed acceptance is blocked by the current browser tool URL policy. A user-opened
ordinary chrome-extension://…/index.html is visible in inventory, but direct getTab
was explicitly rejected (only http/https allowed). Reopening is not a solution;
native requirements below need manual evidence. No workaround was attempted.

Latest outputs and reproducible URLs are linked in
[progress](atlas-history-progress.md) and [tools](../tools/README.md).

| ID | Evidence inspected | Remaining boundary |
| --- | --- | --- |
| AT-01 | Model capture/canonicalization and native round trip: folders, links, order, archive, excluded fields | Installed data and enabled/off recording |
| AT-02 | Shared production quick-save/history writer in actual Worker: popup and context handlers, create-folder-and-save concurrent with dashboard save, Undo and restart; five points, repeated save adds zero | Actual popup/ПКМ with dashboard closed |
| AT-03 | Command batching and native replay preserve rename/reorder/delete/import boundaries | Native multi-context gesture/import flow |
| AT-04 | UI preview/search/selection read-only and preserves inspected moment | Actual Chrome windows remain unchanged |
| AT-05 | 100 rapidly queued range inputs end at final moment; lazy render cancellation | Larger installed dataset |
| AT-06 | UI full restore and Undo exactly match historical/current arrays, workspace and fixture tabs unchanged | Full restore in disposable extension profile |
| AT-07 | All folder modes, single link and multiple conflicts with one Undo; UI covers all missing-parent destinations, initial name collision and multiple matching folders with explicit target | Installed flow |
| AT-08 | Service normal-window target tests and UI historical open; exact URL/query/fragment logic | Actual Chrome APIs, file access |
| AT-09 | Native IDB protected preparation and quota rollback precede local receipt; no partial target | Actual Chrome local quota/worker interruption |
| AT-10 | Native reopening and actual Worker termination/recovery/Undo | Installed service worker and Chrome restart |
| AT-11 | Restore/Undo journal points and protected Before Undo read-only preview | Installed restart |
| AT-12 | UI newer-edit conflict, Cancel, confirmed Undo, preserved Before Undo | Installed concurrent writers |
| AT-13 | Four actual Worker termination boundaries, lost-response retry, abandoned preparation and receipt idempotence | Chrome service-worker termination |
| AT-14 | Fresh writer queue, CAS/generation, concurrent Worker messages, stale preview rejected | Two dashboard + popup + ПКМ |
| AT-15 | Model ID/URL/active/archive/lock cases; imported prototype IDs render/copy; UI locked-folder and multiple-match fixtures preserve current data and require explicit choices | Native keyboard walkthrough for these edge cases |
| AT-16 | Exact native UTF-8 ledger, immutable dictionary, 20→16 MiB trimming and protected return; near-budget GC | Physical origin overhead is only estimated |
| AT-17 | Bounded quota retry/rollback, cached missing row, corrupt metadata and explicit Clear; UI future native schema preserves sentinel, controlled blocked Retry and stopped quota resume | Native upgrade blocking/quota in installed profile |
| AT-18 | 16-theme samples for missing-parent/name collision/multiple matches/locked/paused/off/empty/loading/error and onboarding/storage faults; 320 px, reduced-motion preview; keyboard walkthrough below | Remaining hover/focus pairs, 200% browser zoom, forced colors, screen reader |
| AT-19 | Bottom notice timer/back glyph/hover/focus, double-click idempotence and durable menu tested; receipt regression 8/8; Worker success/Undo sound requests counted | Real sound on/off and keyboard notice in extension |
| AT-20 | 20 warm/cold/seek samples at 100/1,000/10,000 and 91–94% budget; bounded 199-event replay; restore/Undo/GC/heap/origin outputs | Measurements describe this machine, not a guaranteed browser-wide capacity |
| AT-21 | Normal audit 14/14; responsive dashboard 320×700 15/15, 640×400 enlarged spacing 14/14, narrow dialogs 10/10 and public pages 5/5; fresh dashboard smoke 12/12 including stationary edge drag/wheel/drop with shared writer; popup/receipt regression 8/8 | Native drag/autoscroll/popup/ПКМ |
| AT-22 | README, privacy policy, store text, new specification/progress/tools/checklist reviewed; old evidence labeled superseded | Refresh report when native acceptance completes |
| AT-23 | Generation captured before async action, old Undo rejection tests; writer/quick-save stale guards | Installed dashboard/popup concurrent restore |
| AT-24 | Archive date/grace identity tests, retention commands and restored archive in full/folder UI | Installed startup cleanup after browser restart |

## Scoped better-interface review

Complete reviewed flow: Customize → historical Atlas → folder conflict → review
exact copy name → Cancel/Escape; plus fixture full/single/multiple selection and
Undo. Stack: native JavaScript modules/dialog/details/input, project CSS semantic
tokens; no framework or new dependency. Conventions: AGENTS.md and the Time
machine specification. All six project-local better owners were loaded and used.
Review excludes unverified native lifecycle and wider surfaces listed above.

| Domain | Evidence inspected | Result in this scope |
| --- | --- | --- |
| Accessibility | Native modal/name/state markup, loading status/error alert, initial Cancel, actual Enter/Space/Tab/Escape walkthrough; 2px visible focus on Review | Clear for observed controls; full screen-reader/focus matrix not verified |
| Layout | Rendered conflict, final confirmation, preview; wraps at 320 px and named controls fit horizontally in all theme samples; controls remain under menu/selection | Clear for observed surfaces |
| Writing | Three unselected choices, stable-identity note, destination, exact copy name, replacement/Undo/archive consequences, recoverable error/Retry and recording labels | Clear |
| Typography | Existing sans/serif families, unitless line height, tabular dates, wrapped labels/URLs; full URL on button name/title/focus | Clear for inspected strings/widths |
| Colors | 1,760 main-flow rendered contrast samples across 16 themes, minimum 5.00; separate opt-in/fault samples also pass; semantic danger on replacement/clear, text conveys recording state | Clear for those pairs; all focus/hover combinations not verified |
| UI | Opaque Apple/translucent Glass/tactile Soft materials, safe nested modal, reduced preview, hidden secondary controls, persistent Undo in menu | Clear for observed states; slow animation replay and real sound not verified |

No actionable interface findings remain in the inspected folder flow. The
prototype-like ID rendering error found during the fixture is fixed in
`extension/app.js:2072`: dictionary uses `Object.create(null)`, as does domain
grouping at line 2166. Model choice lookup uses `Object.hasOwn`; UI choice maps
also have no prototype. The UI fixture checks the original imported folder is
rendered, the current link survives copying, and Undo returns the current data.

Verification: `npm run verify` 313/313, native 20/20, Worker 10/10, IAB/Chrome UI 27/27,
onboarding 2/2 and four fault fixtures 2/2 each, dashboard
14/14 at normal width; `git diff --check`. Manual keyboard activation opens the
folder conflict with Cancel focus; Tab reaches Review with a 2px visible ring;
Space selects Copy; Enter shows `Restored · Past design`; Escape cancels the top
dialog, then closes history and returns Customize. Native browser chrome may take
focus when tabbing past the last dialog control; no claim of a custom cyclic trap.

The earlier 320 px dashboard audit reports Tour `UI did not settle` (13/14) and is
retained. A fresh responsive run passes dashboard 15/15 at 320×700 (including initial
read failure/Retry), 14/14 at 640×400 with enlarged spacing, narrow dialogs 10/10
and public pages 5/5. The original Tour timeout did not recur; no production Tour
fix is claimed. The Time machine 320 px checks themselves pass 27/27.

The contrast fixture now parses computed RGB/sRGB channels directly. Earlier
Chrome canvas readback produced backgrounds inconsistent with opaque ancestor CSS;
the original failed report is retained. Neither theme palettes nor the 4.5 threshold
were changed to satisfy that measurement. Fault fixtures explicitly distinguish
native corrupt/newer-schema storage from controlled blocked/stopped-quota UI states.
The current browser viewport override did not change the observed width, so narrow
coverage uses a real 320 px child iframe and records that boundary. Fixture setup
now reopens history only after pending UI actions settle, rather than relying on
a 150 ms external-change debounce delay; initial failures are retained as evidence.

### Keyboard follow-up

Owner: better-accessibility, focus/keyboard rules. Chrome keyboard input reproduced
one issue and verified its correction; synthetic collections were used throughout.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM, fixed | `extension/lib/atlas-history-ui.js:353` | Escape inside expanded options closed all history; the next entry retained expanded options | Escape closes the top disclosure and focuses its summary; next Escape closes history; Close resets disclosure | Dismiss the most recent layer first; preserve the inspected moment and predictable focus |

Verification: actual Tab/Enter/ArrowDown validation, Merge confirmation and durable
Undo; first/second Escape states recorded in `atlas-history-keyboard-checks.json`.
The UI fixture checks preserved preview/current collections and both Close/Escape
reentry paths. Full Node verification 313/313; UI 27/27 in Chrome/IAB/narrow iframe.
No actionable keyboard finding remains in these inspected paths. **Approve only
those paths.** Actual 200% zoom is not verified: browser shortcuts did not change
observed width/DPR. Forced colors and an actual screen-reader walkthrough are also
not verified; accessibility-tree inspection and authored CSS do not replace them.

**Approve for the inspected folder-restoration flow only.** This is not an
approval of all AT-01–24 or the installed extension. Continue the
[native checklist](atlas-history-native-checklist.md) in a disposable profile.
The browser tool currently exposes no ordinary user Atlas tab and prohibits
opening `chrome://extensions` under its URL policy; manual reload/open is needed.
