# Deeper interface review — 2026-09-30

## Scope and coverage

Folder disclosure and inline editing, saved-link checkboxes, action menus,
shortcut editing, folder/pinned-tab confirmations, archive restore, workspace
management and recovery notifications. This extends the earlier dashboard/view
review. Plain HTML, ES modules and existing CSS theme tokens; no dependencies.

Applied the installed project-local `better-interface` and its six domain skills.
The conventions in `AGENTS.md` take precedence: minimal dashboard, controls behind
the edge arrow and distinct materials for Glass, Soft and solid Apple themes.
This is a screen/flow review, not a review of unrelated working-tree changes.
Sharing/import, onboarding and the full Sweep flow are outside this pass.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Native modal state, keyboard disclosure/menu navigation, names, focus restoration, error announcements, recovery lifetime | Fixed the findings below; no whole-extension conformance claim |
| Layout | Auxiliary surfaces in all 16 themes at desktop and 320 CSS pixels; real menu text, workspace metadata and notification wrapping | No measured horizontal overflow |
| Writing | Shortcut errors, folder-delete actions and workspace empty state against the corresponding handlers | Errors give a next step and destructive actions say what happens |
| Typography | Previously 10–11px metadata/labels, truncation and counters | Metadata wraps at 12px; menu actions can wrap and expose their full title |
| Colors | 112 computed text/surface pairs per viewport; opaque fills, translucent-material bounds and Orchid gradient endpoints | All sampled pairs ≥4.5:1; minimum 4.62:1 |
| UI | Theme surface/blur/shadow/radius tokens; target sizes and notification motion | Theme families retained; 24px color targets; only opacity/transform animate on notifications |

## Findings resolved

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Accessibility | `extension/app.js:2069` | Clickable folder header had no keyboard action/state | Native transparent disclosure button with expanded state and controlled body; menu/editor remain sibling controls | Folders can be opened without a pointer or nested interactive elements |
| HIGH | Accessibility | `extension/lib/renderers.js:135`, `extension/index.html:163`, `extension/app.js:3046` | Anonymous checkboxes, placeholder-only folder field and anonymous color buttons | Explicit action/object names; radio semantics and selected marker for colors | Controls expose their purpose and selected state |
| HIGH | Accessibility | `extension/index.html:205`, `extension/index.html:247`, `extension/index.html:276`, `extension/index.html:291`, `extension/lib/modal-dialog.js:4` | Legacy overlays lacked native modal isolation and reliable focus return | Native dialogs, named titles/descriptions, Cancel first for confirmations, Escape dismissal and return target fallback | Keyboard and assistive navigation stay inside modal interactions |
| HIGH | Accessibility | `extension/app.js:1643`, `extension/lib/speed-dial.js:127`, `extension/app.js:350` | Undo disappeared and its callback expired after 5.5 seconds; shortcut deletion had no recovery | One bounded persistent Undo, explicit dismissal, survives informational updates; shortcut/workspace deletions have Undo | Recovery remains available until used, dismissed or replaced by another undoable action |
| HIGH | Accessibility | `extension/lib/speed-dial.js:91`, `extension/index.html:260` | Blank address silently closed editor; malformed address could be stored | Parse HTTP(S) URL on save, keep values, announce inline error and focus address | Failed submission preserves work and explains how to recover |
| HIGH | Colors | `extension/dashboard-controls.css:189` | Menu heading in Mocha measured 4.45:1; Monokai destructive label 3.94:1; translucent surfaces could reduce secondary-text contrast | Reuse bounded glass material and semantic secondary/danger text mixes; remeasure all 16 themes | Small text meets 4.5:1 on the sampled actual surfaces without replacing theme palettes |
| MEDIUM | Accessibility | `extension/app.js:3046`, `extension/app.js:3873` | No menu focus/arrow/typeahead behavior; focus-induced scrolling could dismiss a new menu | Roving tabindex, arrows, Home/End, typeahead, Escape/Tab; keep focus-driven scrolling alive and dismiss on external wheel/resize | Menus remain usable through consecutive keyboard actions |
| MEDIUM | Accessibility | `extension/lib/keyed-renderer.js:7`, `extension/app.js:3516` | Cancel/unchanged rename could leave the temporary input in reused DOM | Invalidate that folder's cached markup; restore disclosure focus on Enter/Escape; respect the next focus target on blur | Completing editing actually removes the editor without stealing another control's focus |
| MEDIUM | Accessibility | `extension/app.js:1910`, `extension/app.js:498`, `extension/lib/speed-dial.js:46` | Removed/rebuilt actions could lose focus; workspace open did not move focus inside | Restore archive search/remaining action, enter/leave workspace drawer predictably, reuse workspace DOM and restore shortcut control after rendering | Repeated actions preserve keyboard position |
| MEDIUM | Accessibility | `extension/app.js:3838` | An already handled Escape could also toggle privacy after field focus was restored | Global Escape respects `defaultPrevented` | One key performs one action and does not unexpectedly obscure the dashboard |
| MEDIUM | Typography | `extension/dashboard-controls.css:19`, `extension/dashboard-controls.css:47`, `extension/dashboard-controls.css:193` | Small uppercase editor labels and 10px clipped metadata | 12px sentence-case labels, wrapping workspace metadata and tabular dates | Supporting information remains legible on narrow layouts |
| LOW | Writing | `extension/index.html:282`, `extension/app.js:467`, `extension/lib/speed-dial.js:102` | Verbose deletion choice, empty workspace with no next step, silent invalid address | “Move tabs to inbox”, short save instruction, example website address | Copy explains outcomes and recovery with fewer words |

## Verification

- `node --test tests/speed-dial.test.js tests/deletion-semantics.test.js`: targeted
  storage, address-validation and recovery checks pass.
- `npm run verify`: 155 tests pass; packaged entry-point syntax checks pass.
- `?theme=spaceblack&deep=1`: 10 sequential flow checks pass, including native
  modal isolation, keyboard menus, cancelled/blurred rename, both confirmations,
  archive restore after the old Undo timeout and workspace delete/Undo.
- Repeat `?deep=1` at 320 CSS pixels: all flow checks pass; document width stays
  within viewport and all 112 sampled surface/text pairs fit.
- `?checks=1` at desktop: existing dashboard/drag-scroll smoke checks pass.
- `docs/interface-deep-measurements.json` records viewport-specific samples and
  flow results. Glass contrast is bounded over black/white behind the material;
  Orchid archive uses both opaque gradient endpoints with/without radial tint.
- Real browser key presses check Enter/Space folder disclosure, menu navigation,
  Tab/Shift+Tab movement between dialog fields and Escape return. Theme screenshots check
  Space Black, Paper Glass, Latte Soft and Orchid surfaces.
- `git diff --check`: no whitespace errors.

**Not verified:** full screen-reader walkthrough, all operating-system/browser
combinations, installation in live Chrome and interactions outside this scope.
Native Chrome APIs in the browser checks are local harness mocks. Undo retains
the latest undoable action for the current page session, not an unlimited history.

## Verdict

Approve for the reviewed flows and measured themes. No unresolved HIGH finding
within this scope. This does not certify the whole extension or untouched flows.
