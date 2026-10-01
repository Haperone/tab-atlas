import { consumeScrollDelta, normalizeWheelDelta } from './column-scroll-controller.js';

/** A short edge band, with a gentle ramp up to pixels per second. */
export function dragEdgeVelocity(position, start, end, band = 64, maxSpeed = 720) {
  if (end <= start || position < start - band || position > end + band) return 0;
  const edge = Math.min(band, (end - start) / 3);
  const top = Math.max(0, Math.min(1, (start + edge - position) / edge));
  const bottom = Math.max(0, Math.min(1, (position - end + edge) / edge));
  return (bottom * bottom - top * top) * maxSpeed;
}

/** Native HTML dragging suppresses pointermove. Track dragover and continue
 * on animation frames so holding still at an edge keeps scrolling. */
export function createDragScrollController({ window, document, root, isDragging, onScroll = () => {} }) {
  let pointer = null;
  let frame = null;
  let lastTime = null;

  function stop() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    pointer = null;
    lastTime = null;
  }

  function viewportAt(target, x, y) {
    const direct = target?.closest?.('.column-scroll');
    if (direct && root.contains(direct)) return direct;
    // Headers belong to their column too: hovering a header must let the user
    // reach the first folder even when its inner viewport is scrolled down.
    const column = target?.closest?.('#openTabsSection, #deferredColumn, #foldersColumn');
    if (column && root.contains(column)) return column.querySelector('.column-scroll');
    // Floating controls and gaps can intercept dragover right at a column's
    // edge. Geometry still identifies the column the pointer is hovering over.
    return [...root.querySelectorAll('.column-scroll')].find(viewport => {
      const rect = viewport.getBoundingClientRect();
      return rect.width > 0 && x >= rect.left && x <= rect.right && y >= Math.max(0, rect.top) - 64 && y <= Math.min(window.innerHeight, rect.bottom) + 64;
    }) || null;
  }

  function scrollPage(delta) {
    const scrolling = document.scrollingElement;
    if (!scrolling) return false;
    const before = scrolling.scrollTop;
    consumeScrollDelta(scrolling, delta);
    return scrolling.scrollTop !== before;
  }

  function tick(time) {
    frame = null;
    if (!isDragging() || !pointer || document.hidden) { stop(); return; }
    const dt = Math.min(32, Math.max(0, lastTime === null ? 16 : time - lastTime)) / 1000;
    lastTime = time;
    let moved = false;
    const viewport = viewportAt(pointer.target, pointer.x, pointer.y);
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      const bottom = Math.min(window.innerHeight, rect.bottom);
      const velocity = dragEdgeVelocity(pointer.y, top, bottom);
      const before = viewport.scrollTop;
      if (velocity) consumeScrollDelta(viewport, velocity * dt);
      moved = viewport.scrollTop !== before;
    }
    // At the actual screen edge, fall back to the page only when the column
    // cannot move. This also supports the single-column responsive layout.
    if (!moved) moved = scrollPage(dragEdgeVelocity(pointer.y, 0, window.innerHeight) * dt);
    if (moved) {
      const target = document.elementFromPoint(pointer.x, pointer.y);
      if (target) pointer.target = target;
      onScroll(target);
    }
    frame = window.requestAnimationFrame(tick);
  }

  function dragover(event) {
    if (!isDragging()) return;
    pointer = { x: event.clientX, y: event.clientY, target: event.target };
    if (frame === null) frame = window.requestAnimationFrame(tick);
  }

  function wheel(event) {
    if (!isDragging() || event.ctrlKey || event.metaKey) return;
    const viewport = viewportAt(event.target, pointer?.x ?? event.clientX, pointer?.y ?? event.clientY);
    const delta = normalizeWheelDelta(event, viewport?.clientHeight || window.innerHeight);
    if (!delta || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) return;
    event.preventDefault();
    event.stopPropagation();
    const remainder = viewport ? consumeScrollDelta(viewport, delta) : delta;
    if (remainder) scrollPage(remainder);
    onScroll(pointer ? document.elementFromPoint(pointer.x, pointer.y) : event.target);
  }

  function leave(event) {
    if (!event.relatedTarget && (event.target === document || event.target === document.documentElement)) stop();
  }

  document.addEventListener('dragover', dragover, true);
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  document.addEventListener('dragleave', leave, true);
  document.addEventListener('drop', stop, true);
  document.addEventListener('dragend', stop, true);
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('blur', stop);
  return {
    stop,
    destroy() {
      stop();
      document.removeEventListener('dragover', dragover, true);
      document.removeEventListener('wheel', wheel, true);
      document.removeEventListener('dragleave', leave, true);
      document.removeEventListener('drop', stop, true);
      document.removeEventListener('dragend', stop, true);
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('blur', stop);
    },
  };
}
