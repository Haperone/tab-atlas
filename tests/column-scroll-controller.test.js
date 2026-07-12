import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateDashboardAnchor,
  canScrollInDirection,
  clampScrollDelta,
  consumeScrollDelta,
  createColumnScrollController,
  normalizeWheelDelta,
} from '../extension/lib/column-scroll-controller.js';

test('wheel deltas normalize pixel, line and page modes', () => {
  assert.equal(normalizeWheelDelta({ deltaY: 12, deltaMode: 0 }, 500), 12);
  assert.equal(normalizeWheelDelta({ deltaY: 3, deltaMode: 1 }, 500), 48);
  assert.equal(normalizeWheelDelta({ deltaY: -1, deltaMode: 2 }, 500), -500);
});

test('scroll direction detects both boundaries with an epsilon', () => {
  const viewport = { scrollTop: 0, clientHeight: 300, scrollHeight: 900 };
  assert.equal(canScrollInDirection(viewport, -20), false);
  assert.equal(canScrollInDirection(viewport, 20), true);
  viewport.scrollTop = 600;
  assert.equal(canScrollInDirection(viewport, 20), false);
  assert.equal(canScrollInDirection(viewport, -20), true);
});

test('anchor and pending deltas remain inside their scroll ranges', () => {
  assert.equal(calculateDashboardAnchor({ rootTop: 400, scrollY: 100, stickyOffset: 32, documentHeight: 1800, viewportHeight: 800 }), 468);
  assert.equal(calculateDashboardAnchor({ rootTop: 20, scrollY: 0, stickyOffset: 32, documentHeight: 600, viewportHeight: 800 }), 0);
  assert.equal(calculateDashboardAnchor({ rootTop: 900, scrollY: 700, stickyOffset: 32, documentHeight: 1800, viewportHeight: 800 }), 1000);
  assert.equal(clampScrollDelta(900, 640), 640);
  assert.equal(clampScrollDelta(-900, 640), -640);
});

test('scroll consumption returns the unused delta at both boundaries', () => {
  const viewport = { scrollTop: 780, clientHeight: 400, scrollHeight: 1200 };
  assert.equal(consumeScrollDelta(viewport, 60), 40);
  assert.equal(viewport.scrollTop, 800);
  viewport.scrollTop = 15;
  assert.equal(consumeScrollDelta(viewport, -50), -35);
  assert.equal(viewport.scrollTop, 0);
});

function createHarness({ reducedMotion = false, innerWidth = 1440, blocked = false } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let nextFrame = 1;
  const viewport = {
    scrollTop: 100,
    clientHeight: 400,
    scrollHeight: 1200,
    closest(selector) { return selector === '.column-scroll' ? this : null; },
  };
  let absoluteRootTop = 300;
  let window;
  const root = {
    contains: value => value === viewport,
    getBoundingClientRect: () => ({ top: absoluteRootTop - window.scrollY }),
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    removeEventListener(type) { listeners.delete(type); },
  };
  window = {
    innerWidth,
    innerHeight: 800,
    scrollY: 0,
    getComputedStyle: () => ({ getPropertyValue: () => '32px' }),
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    scrollTo(_x, y) { this.scrollY = y; },
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const document = {
    documentElement: { scrollHeight: 2000 },
    body: { scrollHeight: 2000 },
  };
  const controller = createColumnScrollController({
    window,
    document,
    root,
    isInteractionBlocked: () => blocked,
  });
  function wheel(deltaY, extras = {}) {
    let prevented = false;
    listeners.get('wheel').handler({
      target: viewport,
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      preventDefault() { prevented = true; },
      ...extras,
    });
    return prevented;
  }
  function flushFrames() {
    let timestamp = 0;
    while (frames.size) {
      const callbacks = [...frames.values()];
      frames.clear();
      timestamp += 60;
      callbacks.forEach(callback => callback(timestamp));
    }
  }
  return {
    controller,
    frames,
    listeners,
    viewport,
    wheel,
    window,
    windowListeners,
    flushFrames,
    setRootTop(value) { absoluteRootTop = value; },
  };
}

test('reduced motion anchors immediately and applies the wheel delta', () => {
  const harness = createHarness({ reducedMotion: true });
  assert.equal(harness.wheel(80), true);
  assert.equal(harness.window.scrollY, 268);
  assert.equal(harness.viewport.scrollTop, 180);
  assert.equal(harness.frames.size, 0);
});

test('animated anchoring accumulates trackpad deltas and caps them to one viewport', () => {
  const harness = createHarness();
  assert.equal(harness.wheel(250), true);
  assert.equal(harness.wheel(250), true);
  harness.flushFrames();
  assert.equal(harness.window.scrollY, 268);
  assert.equal(harness.viewport.scrollTop, 500);
});

test('the tick that first reaches a boundary does not throw its remainder into the page', () => {
  const harness = createHarness({ reducedMotion: true });
  harness.viewport.scrollTop = 780;
  assert.equal(harness.wheel(60), true);
  assert.equal(harness.viewport.scrollTop, 800);
  assert.equal(harness.window.scrollY, 268);
  assert.equal(harness.wheel(60), false);
});

test('animation uses the current dashboard anchor when layout changes mid-flight', () => {
  const harness = createHarness();
  harness.wheel(100);
  harness.setRootTop(360);
  harness.flushFrames();
  assert.equal(harness.window.scrollY, 328);
  assert.equal(harness.viewport.scrollTop, 200);
});

test('boundaries, modifiers, mobile and blocked interactions retain native behavior', () => {
  const boundary = createHarness({ reducedMotion: true });
  boundary.viewport.scrollTop = 800;
  assert.equal(boundary.wheel(40), false);
  assert.equal(boundary.wheel(-40, { ctrlKey: true }), false);
  assert.equal(boundary.wheel(-40, { metaKey: true }), false);
  assert.equal(boundary.wheel(-40, { shiftKey: true }), false);
  assert.equal(boundary.wheel(-40, { deltaX: 80 }), false);

  const mobile = createHarness({ innerWidth: 800 });
  assert.equal(mobile.wheel(40), false);

  const blocked = createHarness({ blocked: true });
  assert.equal(blocked.wheel(40), false);
});

test('destroy cancels animation and removes listeners', () => {
  const harness = createHarness();
  harness.wheel(100);
  assert.ok(harness.frames.size > 0);
  harness.controller.destroy();
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.listeners.has('wheel'), false);
  assert.equal(harness.windowListeners.has('resize'), false);
  assert.equal(harness.windowListeners.has('pointerdown'), false);
  assert.equal(harness.windowListeners.has('keydown'), false);
  assert.equal(harness.windowListeners.has('wheel'), false);
});

test('any resize cancels active anchoring before its target becomes stale', () => {
  const harness = createHarness();
  harness.wheel(100);
  assert.ok(harness.frames.size > 0);
  harness.windowListeners.get('resize')();
  assert.equal(harness.frames.size, 0);
  assert.equal(harness.viewport.scrollTop, 100);
});

test('pointer and non-modifier keyboard intent cancel active anchoring', () => {
  const pointerHarness = createHarness();
  pointerHarness.wheel(100);
  pointerHarness.windowListeners.get('pointerdown')({ type: 'pointerdown' });
  assert.equal(pointerHarness.frames.size, 0);

  const keyboardHarness = createHarness();
  keyboardHarness.wheel(100);
  keyboardHarness.windowListeners.get('keydown')({ type: 'keydown', key: 'PageDown' });
  assert.equal(keyboardHarness.frames.size, 0);
});

test('rapid direction changes during anchoring have one scroll owner', () => {
  const harness = createHarness();
  harness.viewport.scrollTop = 800;
  assert.equal(harness.wheel(-120), true);
  assert.equal(harness.wheel(160), true);
  assert.equal(harness.wheel(-80), true);
  harness.flushFrames();
  assert.equal(harness.window.scrollY, 268);
  assert.equal(harness.viewport.scrollTop, 760);
});

test('wheel outside the active viewport cancels anchoring before native scroll proceeds', () => {
  const harness = createHarness();
  harness.wheel(100);
  assert.ok(harness.frames.size > 0);
  harness.windowListeners.get('wheel')({ target: { closest: () => null } });
  assert.equal(harness.frames.size, 0);
});

test('modifier wheel cancels anchoring before browser-native zoom or scrolling', () => {
  const harness = createHarness();
  harness.wheel(100);
  assert.ok(harness.frames.size > 0);
  assert.equal(harness.wheel(40, { ctrlKey: true }), false);
  assert.equal(harness.frames.size, 0);
});
