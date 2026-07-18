import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFocusSweepDeckController,
  focusSweepGestureIntent,
  resolveFocusSweepGesture,
} from '../extension/lib/focus-sweep-deck.js';

test('gesture intent maps left, up and right while rejecting ambiguous diagonals', () => {
  assert.equal(focusSweepGestureIntent({ dx: -60, dy: 4 }), 'close');
  assert.equal(focusSweepGestureIntent({ dx: 3, dy: -60 }), 'save');
  assert.equal(focusSweepGestureIntent({ dx: 60, dy: 4 }), 'keep');
  assert.equal(focusSweepGestureIntent({ dx: 50, dy: -50 }), null);
  assert.equal(focusSweepGestureIntent({ dx: 2, dy: 40 }), null);
  assert.equal(focusSweepGestureIntent({ dx: 5, dy: 4 }), null);
});

test('distance thresholds scale with card dimensions', () => {
  assert.equal(resolveFocusSweepGesture({ dx: -95, dy: 0, durationMs: 500, width: 300, height: 300 }), null);
  assert.equal(resolveFocusSweepGesture({ dx: -96, dy: 0, durationMs: 500, width: 300, height: 300 }), 'close');
  assert.equal(resolveFocusSweepGesture({ dx: 120, dy: 0, durationMs: 500, width: 500, height: 300 }), 'keep');
  assert.equal(resolveFocusSweepGesture({ dx: 0, dy: -99, durationMs: 500, width: 300, height: 450 }), 'save');
  assert.equal(resolveFocusSweepGesture({ dx: 0, dy: -98, durationMs: 500, width: 300, height: 450 }), null);
});

test('fast intentional flings commit after the minimum travel distance', () => {
  assert.equal(resolveFocusSweepGesture({ dx: -40, dy: 0, durationMs: 50, width: 420, height: 300 }), 'close');
  assert.equal(resolveFocusSweepGesture({ dx: 40, dy: 0, durationMs: 50, width: 420, height: 300 }), 'keep');
  assert.equal(resolveFocusSweepGesture({ dx: 0, dy: -40, durationMs: 50, width: 420, height: 300 }), 'save');
  assert.equal(resolveFocusSweepGesture({ dx: 39, dy: 0, durationMs: 20, width: 420, height: 300 }), null);
});

function createHarness({ reducedMotion = true } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const classes = new Set();
  const properties = new Map();
  const captures = new Set();
  const commits = [];
  const element = {
    dataset: {},
    offsetWidth: 420,
    parentElement: null,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: name => properties.delete(name),
    },
    addEventListener(type, handler, capture = false) { listeners.set(`${type}:${capture}`, handler); },
    removeEventListener(type, _handler, capture = false) { listeners.delete(`${type}:${capture}`); },
    getBoundingClientRect: () => ({ width: 420, height: 300 }),
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
  const deckClasses = new Set();
  const deck = {
    classList: {
      add: (...names) => names.forEach(name => deckClasses.add(name)),
      remove: (...names) => names.forEach(name => deckClasses.delete(name)),
      toggle(name, force) { if (force) deckClasses.add(name); else deckClasses.delete(name); },
    },
  };
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    performance: { now: () => 100 },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { callback(0); return 1; },
    setTimeout,
    clearTimeout,
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const controller = createFocusSweepDeckController({
    window,
    element,
    deck,
    isEnabled: () => true,
    onCommit: async (action, source) => { commits.push([action, source]); },
  });
  return { captures, classes, commits, controller, deckClasses, element, listeners, properties, windowListeners };
}

test('programmatic decisions use the shared animation pipeline', async () => {
  const harness = createHarness();
  assert.equal(await harness.controller.animateDecision('save', { source: 'keyboard' }), true);
  assert.deepEqual(harness.commits, [['save', 'keyboard']]);
  assert.equal(harness.controller.isAnimating(), false);
  assert.equal(harness.classes.has('is-committed'), false);
  harness.controller.destroy();
});

test('pointer drag commits once and suppresses the following click', async () => {
  const harness = createHarness();
  harness.listeners.get('pointerdown:false')({ pointerId: 4, button: 0, isPrimary: true, clientX: 200, clientY: 200 });
  harness.listeners.get('pointermove:false')({ pointerId: 4, clientX: 80, clientY: 200, preventDefault() {} });
  await harness.listeners.get('pointerup:false')({ pointerId: 4 });
  assert.deepEqual(harness.commits, [['close', 'pointer']]);
  let prevented = false;
  harness.listeners.get('click:true')({
    preventDefault() { prevented = true; },
    stopImmediatePropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(harness.captures.size, 0);
  harness.controller.destroy();
});

test('short drags and pointer cancellation snap back without committing', async () => {
  const harness = createHarness();
  harness.listeners.get('pointerdown:false')({ pointerId: 8, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
  harness.listeners.get('pointermove:false')({ pointerId: 8, clientX: 20, clientY: 11, preventDefault() {} });
  await harness.listeners.get('pointerup:false')({ pointerId: 8 });
  assert.deepEqual(harness.commits, []);
  assert.equal(harness.properties.has('--sweep-drag-x'), false);

  harness.listeners.get('pointerdown:false')({ pointerId: 9, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
  await harness.listeners.get('pointercancel:false')({ pointerId: 9 });
  assert.equal(harness.captures.size, 0);
  harness.controller.destroy();
});

test('destroy removes all pointer and blur listeners', () => {
  const harness = createHarness();
  harness.controller.destroy();
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.windowListeners.has('blur'), false);
});
