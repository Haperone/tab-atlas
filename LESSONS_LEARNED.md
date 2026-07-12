# Lessons Learned

## Nested dashboard scrolling

- Keep column shells paint-visible and put overflow only on their inner scroll viewports so Soft UI shadows are not clipped.
- A wheel controller must consume only the distance available inside a column. Stop the crossing event at the edge and hand the next outward event to the page; forwarding a large same-event remainder makes fast direction changes oscillate the page.
- Recalculate geometry at the end of short anchor animations and cancel active animation on resize or new pointer/keyboard intent.
- While an anchor animation is active, it must be the only owner of wheel input for that viewport; never let native page scrolling run against the same rAF animation.
- Capture-phase scroll handlers must distinguish document scrolling from descendant scrolling before running layout measurements.
- Keep shared mobile resets in one breakpoint block so later column variants cannot drift apart.
