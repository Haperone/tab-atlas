# Lessons Learned

## Nested dashboard scrolling

- Keep column shells paint-visible and put overflow only on their inner scroll viewports so Soft UI shadows are not clipped.
- A wheel controller must consume only the distance available inside a column. Stop the crossing event at the edge and hand the next outward event to the page; forwarding a large same-event remainder makes fast direction changes oscillate the page.
- Recalculate geometry at the end of short anchor animations and cancel active animation on resize or new pointer/keyboard intent.
- While an anchor animation is active, it must be the only owner of wheel input for that viewport; never let native page scrolling run against the same rAF animation.
- Smooth large wheel steps with an immediate partial move plus one short retargetable animation; keep small pixel deltas direct and cancel the old target on direction reversal.
- Capture-phase scroll handlers must distinguish document scrolling from descendant scrolling before running layout measurements.
- Keep shared mobile resets in one breakpoint block so later column variants cannot drift apart.

## Glass theme materials

- Build glass from a flat translucent fill, backdrop blur, a soft outer border, and diffuse depth. Directional gradients, hard inset highlights, and glowing card pseudo-elements read as polished metal.
- Keep theme identity in the canvas palette and motion profile instead of repainting each card with theme-specific reflections.
- On a quiet light canvas, use lower-alpha white surfaces and soft neutral shadows; an opaque white sheen hides transparency instead of making it legible.
