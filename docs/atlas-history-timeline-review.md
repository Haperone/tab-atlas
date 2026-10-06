> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Zoomable Atlas timeline — 6 October 2026

6 October second-floor follow-up: minimum visual zoom is 1000ms; the smallest
calendar anchors are whole seconds. Complete histories shorter than a second
keep their actual bounds. Subsecond snapshot records and precise selection are
unchanged. At minimum zoom, a dense cluster focuses the range and announces
Earlier/Later/arrow navigation. Keyboard and wheel cannot shrink or drift the
window further. Calendar tests pass 9/9, Node verification 335/335, gesture
checks 6/6 across three themes/two sizes, native IDB 23/23. A separate real-pointer
walk passes 1000 Earlier/Later transitions through records 1ms apart at minimum
zoom, with exact dates/content and unchanged collections; arrow selection and
cluster focus also pass. Isolated localhost/synthetic Chrome adapters only.

6 October pointer follow-up: native thumb travel excluded its 12px diameter,
while the playhead used the full ruler width, producing approximately ±6px
separation. `time-machine.css:66` now disables inherited playhead transitions;
the range extends 6px beyond each edge. Continuous slider values preserve exact
selected positions without 1000-step rounding. The updated native pointer runner
passes 6/6 across three families/two viewports, including hit-tested centre
alignment at five positions, real drag, no commit before release and nearest
commit alignment. Node calendar geometry 7/7 and native IDB 22/22 pass.
All measurements use disposable localhost data, not installed MV3.

Scope: navigation within the active-collection Time machine, including empty,
loading, selection and error behavior, dense history and narrow reflow. Vanilla
JavaScript, native controls, IndexedDB and the existing theme tokens. Project
conventions are in AGENTS.md. No dependencies, permissions or version changes.
The better-* owners and apple-design informed the review and implementation.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native named buttons/range, roving point focus, arrow/Home/End/Page keys, visible focus, browser-emulated forced colors/reduced motion | Fixture checks pass; screen reader, real 200% zoom and OS high contrast not verified |
| Layout | Year/month anchors, anchored zoom, pan including over points, 1280×720 and 320×400 geometry, independent content panes | Fixture checks pass; RTL mirror not verified |
| Writing | Zoom in/out, All history, previous/next period, snapshot counts and exact dates on hover/focus | Actions match labels; no permanent point-count tiles |
| Typography | Theme fonts, 12px captions, tabular dates/counts, wrapping date tooltip with timezone offset/milliseconds | Source and rendered views inspected |
| Colors | Semantic tokens; 336 rendered marker samples across 16 themes, minimum 5.00:1 against their actual composed CSS backgrounds (3:1 required) | Checked states pass; no palette changes |
| UI | Small single dots and stroke groups, transient count/date, chosen moment's thin playhead, genuine pointer capture/rAF, Glass/Soft/solid screenshots | Rendered families inspected; slow Animations-panel replay not verified |

## Resolved findings

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| MEDIUM | Layout | extension/lib/atlas-history-ui.js:38 | One normalized slider spread every moment over the full retained history | Zoomable calendar ruler, movable window, real moment targets and one-record stepping | Several years remain navigable without losing nearby snapshots |
| MEDIUM | UI | extension/lib/atlas-history-timeline.js:122 | Large numbered cluster tiles dominated the axis | Tiny dots/stroke groups, counts only on hover/focus | Content hierarchy and the user's minimalist preference |
| MEDIUM | Layout | extension/lib/atlas-history-timeline.js:203 | Drag could activate a point instead of moving the period | Captured pointer with a movement threshold; tap and pan are separate | Direct manipulation must be predictable |
| MEDIUM | Writing | extension/lib/atlas-history-timeline.js:86 | Offscreen selected snapshot appeared at a visible period edge | Hide the playhead/thumb outside the window; accessible value states that it is outside | Selection must indicate the actual inspected time |

## Verification

- `node --test tests/atlas-history-timeline.test.js tests/atlas-history-service.test.js`: 19/19; anchored zoom, boundary clamps, single/millisecond moments, calendar months, leap year, local midnight and sender/queue behavior.
- `npm run verify`: 333/333, log (`atlas-history-timeline-verification.txt`, deleted capture).
- Native IndexedDB (`atlas-history-timeline-native.json`, deleted capture): 22/22, including 205 timestamps crossing checkpoint boundaries, no duplicate baseline, bounded buckets, nearest-neighbour ties, pause gaps and Clear.
- Gesture fixture (`atlas-history-timeline-ui.json`, deleted capture): 6/6, three theme families at two sizes. Real wheel/pointer/keyboard input; year and month zoom, fit, refine an 80-moment burst to exact points, adjacent stepping, no collection changes.
- General UI (`atlas-history-current-snapshot-ui.json`, deleted capture) and 320×400 UI (`atlas-history-current-snapshot-ui-320x400.json`, deleted capture): 32/32 each, including release-only scrubbing, a stale failed selection staying silent, restore/Undo and marker contrast.
- Automatic startup (`atlas-history-current-snapshot-first-run.json`, deleted capture): 4/4.
- Keyboard (`atlas-history-forced-colors-keyboard.json`, deleted capture): 32/32 across 16 themes, with browser-emulated forced colors/reduced motion. Exact fixture/source boundaries remain in the reports.

Near-budget fixture (`atlas-history-current-snapshot-performance.json`, deleted capture): all three
sizes pass (100/1,000/10,000 active links); warm useful-preview p95
38.6/76.3/413.8 ms, after module Worker restart 88.4/140.2/596.4 ms.
No preview Long Task ≥50 ms was observed. This isolated run uses native IDB
and an actual Worker with synthetic Chrome adapters, one missing link per folder.
It does not benchmark a giant fully exposed inbox/all-missing layout or years
of real user changes.

Timeline metadata uses bounded indexed count/endpoint requests. It does not decode
link records or snapshot patches, copy all timestamps into UI memory, or store
additional history records. Closest-moment lookup uses indexed neighbours.

Not verified: installed MV3 messaging/lifecycle, native audio, screen-reader
speech, real browser zoom/OS forced colors, RTL and a years-long real user profile.
Synthetic fixtures are independent of the user's saved collections.

Approve for the reported local source/fixture coverage. Full feature acceptance
still has the native gaps documented in atlas-history-acceptance.md.

## Soft axis follow-up — 6 October

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | extension/time-machine.css:55,60,154 | Transparent panel borders hid the guide; the first correction overemphasized it with a dark 3px recessed rail | Quiet 1px decorative rail using the theme's neutral palette and a faint light edge; calendar ticks use a separate stronger token | The rail should support snapshots without dominating them, while retaining the Soft material |

Compared rendered Paper Soft/Latte Soft rulers with Paper Glass and Space Black.
Measured 14 settled decorative rail pairs: Paper Soft minimum 1.77:1, Latte Soft
1.73:1. The rail carries no independent state or action, so the previous 3:1
requirement incorrectly promoted its emphasis. The 112 calendar-tick pairs remain
at least 3.61:1/3.39:1 respectively; snapshot marker and text thresholds remain
unchanged. Updated general UI 32/32 at both 1280×720 and 320×400; startup 4/4.
Screenshots updated in `time-machine-screenshots/all-themes/papersoft.png` and
`lattesoft.png`. The Soft treatment is limited to forced-colors:none; system-color
axis rules remain active in high contrast. No interaction or motion changes.
Not verified: actual OS high contrast or installed-extension rendering in this
follow-up. Approve for the inspected palette/material and fixture scope.

## Light Glass axis follow-up — 6 October

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| LOW | extension/time-machine.css:154 | White glass panel-border token made the ruler/ticks appear as a bright seam in Paper Glass and Pearl Glass | Shared semantic axis treatment mixes each theme's own secondary text into its page color; thin 1px line without Soft shadows | The calendar guide must fit each glass palette |

Paper Glass ruler rendered and inspected in isolated headless Chrome at 1280×720.
Computed axis/ticks: color(srgb 0.663725 0.632304 0.577451), page rgb(230,223,208),
axis 1px and no shadow. Existing strong moment markers, labels and selection
remain unchanged. Screenshot updated in `time-machine-screenshots/all-themes/paperglass.png`.
Diff check passes. No navigation or motion changes. Not verified: installed Chrome
rendering in this follow-up. Approve for the inspected palette/material scope.

Pearl Glass follow-up: rendered and inspected at 1280×720, computed axis/ticks
color(srgb 0.589902 0.614804 0.648922), page rgb(215,220,226), 1px/no shadow.
Updated `time-machine-screenshots/all-themes/pearlglass.png`. Shared the existing
Paper Glass treatment to fix the same light-material token mismatch. Other themes
and snapshot/selection colors are unchanged. Diff check passes; no interaction
changes. Installed rendering not verified in this follow-up. Approve for this
rendered fixture/palette scope.
