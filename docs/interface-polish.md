> Generated evidence referenced below was deleted during the 6 October 2026 cleanup at the user's request. Filenames identify historical captures, not current verification. See [output storage and reruns](development-artifacts.md).

# Interface polish — 2026-09-30

## Scope and coverage

The main dashboard's open-tab browsing, search and view-settings flow, across
all 16 registered themes. Plain HTML, JavaScript modules and CSS custom
properties; no framework or new runtime dependency. Project conventions:
`AGENTS.md`, `README.md` and the existing theme stylesheets. The minimalist
layout and every theme's palette and material identity are preserved.

This is a screen review and implementation, not a review of unrelated working
tree changes. Archive editing, share/import, onboarding and workspace dialogs
are outside this pass. The flow has no network loading or remote error state;
empty search, narrow width, keyboard focus and rapid theme reversal were checked.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Drawer names/states, Escape/outside dismissal, target sizes, main landmark, search focus, empty-state recovery, reduced-motion rules | Fixed the issues below; no conformance claim for the entire extension |
| Layout | Dashboard at 320px and desktop; all 16 theme styles; panel bounds and progressive disclosure | Fixed narrow-width clipping |
| Writing | Search/filter labels and the reset action against their handlers | Existing wording retained; custom-view state added to the accessible name |
| Typography | Filter/status sizes, counters, clamped titles and real rendered labels | Improved legibility; full title available on keyboard focus |
| Colors | Computed foreground/background pairs for all panel controls, labels and status in all 16 themes | Minimum measured WCAG 2 contrast 4.67:1 after the correction |
| UI | Original theme tokens, drawer surfaces, search icon layering and theme transitions; rendered Soft, Glass and solid themes | Materials now follow their theme family |

## Findings resolved

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Layout | `extension/dashboard-controls.css:170` | At 320px, the section action row extended to 376px | Open-tab actions wrap within their column | The close action was clipped at a narrow width |
| HIGH | Colors | `extension/dashboard-controls.css:9` | Mocha's muted labels against its panel measured 4.45:1 | Secondary panel text mixes 90% muted with 10% primary text; all measured pairs now exceed 4.5:1 | Required text contrast; keeps the theme's hue |
| MEDIUM | Accessibility | `extension/app.js:3854` | Reset removed the focused empty-state action | Reset returns focus to search | Keyboard navigation continues at a stable control |
| MEDIUM | UI | `extension/dashboard-controls.css:2` | One surface and radius for every view drawer | Glass uses a translucent blurred material; Soft uses the original dual shadows; each solid Apple theme uses its own surface tokens | New controls belong to the surrounding theme |
| MEDIUM | UI | `extension/lib/theme-controller.js:79` | Theme changes triggered independent color/shadow transitions | Materials commit together; transitions resume after paint, including rapid reversal | Avoids a smeared palette during theme switches |
| MEDIUM | Accessibility | `extension/index.html:20`, `extension/index.html:104`, `extension/dashboard-controls.css:165` | No main landmark/skip path; search relied on a subtle shadow for focus | Native main, a focus-only skip link and explicit search focus | Clearer keyboard and assistive-technology navigation without permanent chrome |
| LOW | Typography | `extension/dashboard-controls.css:97`, `extension/dashboard-controls.css:120`, `extension/dashboard-controls.css:163` | 10–11px panel text; clamped tab titles stayed clamped on keyboard focus | 12px panel labels/status, tabular counters and expansion of the focused title | Readable secondary controls and recoverable full titles |
| LOW | UI | `extension/dashboard-controls.css:147`, `extension/dashboard-controls.css:160` | Search glyph painted behind the input; small chip action geometry | Glyph paints above the input; action targets have at least 24px dimensions | Restores the search cue and makes small actions easier to hit |

## Verification

- `npm run verify`: 152 tests pass, dashboard/background/theme-init syntax passes.
- `node --check extension/lib/theme-controller.js` and
  `node --check tools/interface-polish-checks.js`: pass.
- `?checks=1` at a desktop viewport: 12 browser scenarios pass, including
  scrolling during drag, Undo, focus recovery and rapid theme reversal.
- `?polish=1` at an effective 320px viewport: all 16 themes have no horizontal
  overflow; computed panel text contrast has no pair below 4.5:1. Transparent
  panel materials are composited over both black and white to bound the content
  behind them. Exact measurements: `interface-polish-measurements.json`.
- Browser inspection: drawer open/closed and narrow layout; representative
  Glass, Soft and solid theme surfaces. Accessibility-tree names and states
  were inspected for the view-settings flow.
- Not verified: installed Chrome extension, hardware screen-reader speech,
  forced-colors/system preference emulation, RTL and 200% browser zoom,
  animation replay at 10% speed. Their relevant rules were inspected in source.

## Verdict

Approve for the scoped dashboard polish; the confirmed issues above are fixed.
This is not an accessibility certification of the unreviewed flows.
