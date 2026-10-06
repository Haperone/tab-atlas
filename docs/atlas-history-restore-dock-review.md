> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Restore action review

5 October 2026. Scope: the Time machine restoration action, its selection states,
scrolling, confirmation/Cancel and theme materials. Applied project-local
better-layout, better-ui and better-accessibility with the project's minimalist
theme conventions. Existing vanilla JS controller, native dialogs and CSS tokens;
no dependencies or changes to restoration/storage semantics.

## Keep important actions reachable

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | extension/lib/atlas-history-ui.js:44; extension/time-machine.css:20 | Selected restoration scrolled away with search; full restoration was inside the options menu | Compact bottom-right action stays outside the scrolling content, with snapshot date and selection scope; narrow screens get a full-width button | Stable chrome keeps the primary action reachable without covering the final links |

## Label the action and preserve keyboard context

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| MEDIUM | extension/lib/atlas-history-ui.js:94 | Selection count did not distinguish folders from links; cancelling review returned focus to Close | Distinct full/selected labels, folder/link counts without double counting, described date/scope, clear selection and focus returned to the visible restore button | Users can understand the effect and continue reviewing without searching for the action again |

## Preserve materials and restrained motion

The dock reuses panel background, shadow direction, control radius and accent
tokens. Glass retains translucent blur, Soft retains opposing tactile shadows,
and solid themes retain opaque surfaces. Its 120 ms press feedback respects both
system reduced motion and the project's reduced-motion preference. Forced-colors
and reduced-transparency rules include the new dock.

## Verification

- UI scenarios (`atlas-history-restore-dock-ui.json`, deleted capture): 29/29 at 1280 × 720.
- Small window (`atlas-history-restore-dock-ui-320x400.json`, deleted capture): 29/29 in a real
  320 × 400 iframe, including 16 themes, selection, scroll position, no overlap,
  confirmation/Cancel, reset and unchanged collections after cancellation.
- Settled text contrast in these checks is at least 5.00:1.
- Actual Tab → Enter → Escape returns to the selected restore button with its
  visible 2 px focus outline (`atlas-history-restore-dock-keyboard.json`, deleted capture).
- Node verification (`atlas-history-restore-dock-verification.txt`, deleted capture): 324/324.
- Screenshots inspected: Space Black (`time-machine-screenshots/atlas-history-restore-dock.png`, deleted capture),
  Glass (`time-machine-screenshots/atlas-history-restore-dock-glass.png`, deleted capture),
  Soft (`time-machine-screenshots/atlas-history-restore-dock-soft.png`, deleted capture).

Not verified: installed Chrome service-worker lifecycle, screen-reader speech,
200% browser zoom, RTL mirror, OS forced-colors rendering and Animations-panel
replay at 10% speed. Local fixtures use synthetic Chrome APIs and native IDB;
they do not establish those native-extension boundaries.

Approve for the inspected restoration-action scope. Overall Time machine
acceptance remains separate and in progress.
