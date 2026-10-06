> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Quick-save interface review — 2026-09-30

## Scope

Toolbar popup and the native page-menu save handler, existing folders/inbox,
duplicate reuse, archive restoration, new-folder creation, persistent latest-save
Undo and external-change refresh of an already open dashboard. The popup imports
the existing theme CSS/tokens and pre-paint initializer; no dependencies or
content scripts. `AGENTS.md` supplies the minimalist/theme-material conventions.
Installed `better-interface` and its six owners informed this flow review.
Sharing, full-dashboard redesign and release publication are outside this pass.

## Domain coverage

| Domain | Evidence / resulting behavior |
| --- | --- |
| Accessibility | Native named buttons/fields, live status and alert, Arrow/Home/End destination navigation, real Enter/Arrow/Escape browser key presses, focus retained after saves, error focus, visible rings, one bounded durable Undo |
| Layout | 360×600 and 320×600 popup checks, long titles and 30-folder fixture, bounded scrolling, visible Undo, inline creation replaces the list while editing |
| Writing | Save/Move/Restore and Already saved distinguish outcomes; locked/missing folder, changed-page and storage errors give a next step; page stays open |
| Typography | Existing theme fonts, 12px supporting text, wrapping folder names and feedback; full title is retained in the title attribute and accessible text |
| Colors | 128 computed text/surface samples at each tested width; eight roles across 16 themes; minimum 4.62:1, all ≥4.5:1 |
| UI | Existing semantic/material tokens; Glass transparency/blur, Soft opposing shadows and opaque Apple materials checked; 24px+ controls, reduced-motion/forced-color fallbacks, no page-load entrance |

## Findings resolved

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Layout | `extension/popup.css:5` | Inherited narrow-dashboard header stacked the popup title/action and pushed recovery below 600px | Popup explicitly owns its compact row, spacing and list height; recovery scrolls into view | Save recovery stays reachable at supported popup widths |
| HIGH | Accessibility | `extension/lib/quick-save-service.js:57` | A toolbar-badge API failure could misreport a committed save as failed | Feedback painting is isolated from the data commit; storage failures still return failure | A retry does not follow false failure feedback |
| MEDIUM | Accessibility | `extension/popup.js:27`, `extension/popup.css:44` | Replacing destination markup could lose focused position; external rings could clip in the scroll area | Restore the focused destination and draw its ring inside the target | Consecutive keyboard saves retain position and a complete focus indicator |
| MEDIUM | Layout | `extension/app.js:5339` | Storage-only changes had no tab event to refresh folders/inbox | Listen for collection changes, refresh both columns, defer during editing/drag/modal interactions | Popup/page-menu saves appear in existing dashboards without interrupting editing |

## Verification

- `npm run verify`: 173 tests and entry-point syntax checks pass, including 18
  new save/service checks for duplicate reuse, locks, restoration, navigation
  races, worker restart, concurrent save requests, stale Undo, atomic folder/save,
  API failure handling and callback-based menu construction.
- Real production popup/service against local Chrome mocks: three browser groups
  pass at both 360px and 320px, including long destination lists and 128 measured
  color/material pairs at each width.
- Four dashboard external-save/move/remove/deferred-refresh checks pass.
- All 12 existing dashboard smoke checks pass with storage-change events enabled,
  including drag-edge/wheel scrolling and scoped undoable bulk actions.
- Manual browser checks: empty-folder inbox save, inline-form Escape return,
  unsupported page, failed storage/read-retry state, simulated page-menu save, reopen/Undo,
  real ArrowDown and Enter; screenshots inspected in Space Black, Paper Glass
  and Latte Soft.
- `docs/quick-save-measurements.json` records the viewport-specific results.
- `git diff --check`: no whitespace errors.

**Not verified:** loaded-extension/native-menu walkthrough in live Chrome,
screen-reader walkthrough, all browser/OS combinations. Native Chrome APIs are
mocked in browser fixtures; real registration/reload remains a manual integration
check. The existing release ZIP predates this feature and was left unchanged.
Latest quick-save Undo is local, bounded to one action and can decline if a later
edit or folder lock would make reversal unsafe. Dashboard mutations and worker
mutations still use the repository's existing Chrome storage read/modify/write
model; the worker serializes its own save requests, not every dashboard write.

## Verdict

Approve for the reviewed local flows and measured themes. No unresolved HIGH
finding within this scope; this does not certify live Chrome integration or the
whole extension.

## API references

[Chrome contextMenus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
documents the permission, page contexts, URL restrictions and callback error
handling used here. Callback menu methods preserve the existing Chrome 102
minimum; no Chrome 123-only Promise menu APIs are required.

## Popup sizing and page feedback correction — September 30, 2026

The user reported a real native popup shrunk to roughly 142px. The earlier
fixed-viewport checks missed intrinsic Chrome sizing: `max-width: 100vw` clamped
the intended width to the popup's initial viewport. Removed that dependency and
gave both root and body an explicit 360px minimum. The earlier 320px fixture
results above describe the previous implementation and are superseded by the
360px native sizing contract.

Context-menu saves now inject a temporary notification after the storage commit.
It shows the destination or a specific failure, replaces earlier feedback,
supports dismiss/Escape, pauses dismissal while hovered or focused, and removes
its DOM and animation state afterward. Shadow DOM isolates site styles; folder
names are text. Resolved dashboard theme tokens are mirrored locally for the
worker, preserving glass, soft and opaque materials. Reduced motion disables
movement; a URL guard suppresses feedback after navigation.

Added only `activeTab` and `scripting`: the explicit context-menu action grants
temporary access. No persistent host permissions or automatic content scripts.
If Chrome restricts injection, the persisted save/Undo and toolbar badge still work.

Verification: `npm run verify` passes 177 tests; four additional unit tests cover
post-commit notification ordering, theme arguments, restricted injection, errors
and popup isolation. Four browser notification groups pass, including a 142px
initial iframe, all 16 themes and timed cleanup. The three existing popup groups
pass at 360×600 with 30 destinations and 128 contrast samples (minimum 4.62:1).
Native Chrome popup/context-menu integration remains a manual check; these
browser fixtures mock Chrome APIs. The release ZIP remains unchanged.

[Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
documents context-menu activation and temporary access;
[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
documents packaged function injection into the default isolated world.

## Compact confirmation and Undo sounds — September 30, 2026

The popup now has one themed surface, without an inset card. Choosing a folder
marks it with a green check but writes nothing until the explicit green Save
button is pressed. A successful save (including Create and save) closes the
popup and shares the same bottom-center, compact green page feedback as the
context-menu entry point. Errors keep the popup open. Persistent “Save undone”
status is removed; a compact Undo link appears only for the current page's latest
available action.

Save uses a 320ms ascending cue; Undo uses a distinct descending cue across
dashboard toast actions, Focus Sweep review and the popup. Both obey Sound.
Packaged PCM audio requires no external requests. The worker uses an AUDIO_PLAYBACK
offscreen document, reused across both cues; Chrome retires it after inactivity.
Added the offscreen permission and raised the minimum Chrome version to 109;
the player uses clients.matchAll before runtime.getContexts became available.

Verification: 184 tests pass, including commit/mute/error sound semantics,
offscreen creation/reuse/recovery and both valid audio assets. Popup browser
groups check deferred confirmation, closure, Undo cleanup and 128 text contrast
pairs in all 16 themes at 360×600 (minimum 4.62:1). Existing 12 dashboard smoke
checks pass. Native Chrome offscreen playback and popup closure still require
a loaded-extension walkthrough; browser fixtures use Chrome mocks.

The confirmation button is hidden in the initial markup and until an explicit
destination choice, including when the page is already saved. Opening/cancelling
the new-folder form without a choice keeps it hidden. A page change clears the
pending choice; previously saved membership does not automatically select a row.

The four notification groups also pass for the bottom-center 42px chip, all
16 materials and reduced motion. A manual preview confirms popup confirmation
hides the window, shows page feedback and starts the packaged audio; playback
reaches ended. A storage-failure preview keeps the popup open. These fixture
results do not replace native offscreen playback verification in Chrome.

[Chrome offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
documents availability, the runtime-only restriction and audio document lifetime.

The page receipt now includes a 2px countdown strip along its bottom edge. It
uses the same 4.5s success / 8s error lifetime as dismissal, pauses on hover or
keyboard focus, and resumes the remaining time rather than restarting. Hover
or focus swaps the success label for Undo without changing the chip width.
The receipt is a native button backed by the committed action's Undo ID; stale
receipts cannot cancel newer saves, and errors/repeated saves offer no Undo.
Successful cancellation dismisses the receipt and uses the existing Undo cue.
Reduced motion uses discrete timer updates and no entrance or hover animation.

Verification: 185 tests and syntax checks pass. Eight notification browser
groups pass, including all 16 theme materials, simulated hover pause/resume,
focus disclosure, double-click cancellation and stale receipt failures. Manual
fixture walkthroughs verify Enter cancellation for both context-menu and popup
receipts, plus the popup storage UI refresh after cancellation. Native Chrome
injection and offscreen playback remain unverified; these fixtures mock Chrome.
