# Lessons Learned

## Nested dashboard scrolling

- Keep column shells paint-visible and put overflow only on their inner scroll viewports so Soft UI shadows are not clipped.
- A wheel controller must consume only the distance available inside a column and forward the unused remainder to the page; clamping the full delta creates a sticky edge.
- Recalculate geometry at the end of short anchor animations and cancel active animation on resize or new pointer/keyboard intent.
- Capture-phase scroll handlers must distinguish document scrolling from descendant scrolling before running layout measurements.
- Keep shared mobile resets in one breakpoint block so later column variants cannot drift apart.
