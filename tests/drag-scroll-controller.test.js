import assert from 'node:assert/strict';
import test from 'node:test';
import { createDragScrollController, dragEdgeVelocity } from '../extension/lib/drag-scroll-controller.js';

function harness() {
  const listeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let frameId = 0;
  let dragging = true;
  let hits = 0;
  const viewport = {
    scrollTop: 600, clientHeight: 400, scrollHeight: 1400,
    getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 0, right: 200, width: 200 }),
    closest: () => viewport,
  };
  const other = { ...viewport, scrollTop: 300, closest: () => other };
  const window = {
    innerHeight: 800,
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, fn) { windowListeners.set(type, fn); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const page = { scrollTop: 200, scrollHeight: 2400, clientHeight: 800 };
  const document = {
    hidden: false, scrollingElement: page, documentElement: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    elementFromPoint: () => null,
  };
  const controller = createDragScrollController({ window, document, root: { contains: () => true, querySelectorAll: () => [viewport] }, isDragging: () => dragging, onScroll: () => { hits++; } });
  function drag(y, target = viewport) { listeners.get('dragover')({ clientX: 50, clientY: y, target }); }
  function step(time) { const current = [...frames.values()]; frames.clear(); current.forEach(fn => fn(time)); }
  return { viewport, other, page, document, listeners, windowListeners, frames, controller, drag, step, setDragging(value) { dragging = value; }, get hits() { return hits; } };
}

test('edge speed ramps in both directions and stays quiet away from the edges', () => {
  assert.equal(dragEdgeVelocity(300, 100, 500), 0);
  assert.equal(dragEdgeVelocity(100, 100, 500), -720);
  assert.equal(dragEdgeVelocity(500, 100, 500), 720);
  assert.equal(dragEdgeVelocity(132, 100, 500), -180);
  assert.equal(dragEdgeVelocity(400, 400, 400), 0);
  assert.equal(dragEdgeVelocity(1000, 100, 500), 0);
});

test('holding still at the top or bottom keeps the hovered column scrolling', () => {
  const h = harness();
  h.drag(101);
  h.step(0);
  const first = h.viewport.scrollTop;
  h.step(16);
  assert.ok(h.viewport.scrollTop < first && first < 600);
  assert.equal(h.page.scrollTop, 200);
  assert.ok(h.hits >= 2);
  h.drag(499, h.other);
  h.step(32);
  assert.ok(h.other.scrollTop > 300);
  assert.ok(h.viewport.scrollTop < first);
  h.controller.destroy();
});

test('wheel during dragging consumes the column first and sends only the remainder to the page', () => {
  const h = harness();
  h.viewport.scrollTop = 980;
  let prevented = false;
  h.listeners.get('wheel')({ target: h.viewport, deltaY: 50, deltaX: 0, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(h.viewport.scrollTop, 1000);
  assert.equal(h.page.scrollTop, 230);
  h.controller.destroy();
});

test('headers scroll their column; page edges work when the inner column is at its limit', () => {
  const h = harness();
  const column = { querySelector: () => h.viewport };
  const header = { closest: selector => selector === '.column-scroll' ? null : column };
  h.drag(90, header);
  h.step(0);
  assert.ok(h.viewport.scrollTop < 600);
  h.viewport.scrollTop = 0;
  h.drag(2, header);
  h.step(16);
  assert.ok(h.page.scrollTop < 200);
  h.controller.destroy();
});

test('floating controls covering the top edge do not block autoscroll', () => {
  const h = harness();
  const overlay = { closest: () => null };
  h.drag(102, overlay);
  h.step(0);
  assert.ok(h.viewport.scrollTop < 600);
  h.controller.destroy();
});

test('drop, cancellation, blur and disposal stop every pending frame', () => {
  for (const event of ['drop', 'dragend', 'visibilitychange', 'blur']) {
    const h = harness();
    h.drag(499);
    (event === 'blur' ? h.windowListeners : h.listeners).get(event)();
    assert.equal(h.frames.size, 0);
    h.step(16);
    assert.equal(h.viewport.scrollTop, 600);
    h.controller.destroy();
    assert.equal(h.listeners.size, 0);
  }
  const h = harness();
  h.drag(499);
  h.setDragging(false);
  h.step(0);
  assert.equal(h.frames.size, 0);
});
