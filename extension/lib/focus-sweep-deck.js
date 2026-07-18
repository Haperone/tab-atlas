const DEFAULT_COMMIT_DURATION = 240;
const DEFAULT_SNAP_DURATION = 180;
const DEFAULT_RETURN_DURATION = 220;
const DEFAULT_EASING = 'cubic-bezier(.22,.8,.25,1)';
const HORIZONTAL_DISTANCE = 96;
const HORIZONTAL_RATIO = 0.24;
const VERTICAL_DISTANCE = 88;
const VERTICAL_RATIO = 0.22;
const FLING_VELOCITY = 0.65;
const FLING_MIN_DISTANCE = 40;
const DIRECTION_RATIO = 1.15;
const DRAG_CLICK_SLOP = 6;

export function focusSweepGestureIntent({ dx = 0, dy = 0 } = {}) {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.hypot(dx, dy) < 12) return null;
  if (dy < 0 && absY > absX * DIRECTION_RATIO) return 'save';
  if (absX > absY * DIRECTION_RATIO) return dx < 0 ? 'close' : 'keep';
  return null;
}

export function resolveFocusSweepGesture({
  dx = 0,
  dy = 0,
  durationMs = 0,
  width = 0,
  height = 0,
} = {}) {
  const intent = focusSweepGestureIntent({ dx, dy });
  if (!intent) return null;

  const elapsed = Math.max(1, durationMs);
  if (intent === 'save') {
    const distance = Math.abs(dy);
    const threshold = Math.max(VERTICAL_DISTANCE, Math.max(0, height) * VERTICAL_RATIO);
    return distance >= threshold || (distance >= FLING_MIN_DISTANCE && distance / elapsed >= FLING_VELOCITY)
      ? 'save'
      : null;
  }

  const distance = Math.abs(dx);
  const threshold = Math.max(HORIZONTAL_DISTANCE, Math.max(0, width) * HORIZONTAL_RATIO);
  if (distance < threshold && !(distance >= FLING_MIN_DISTANCE && distance / elapsed >= FLING_VELOCITY)) {
    return null;
  }
  return intent;
}

function wait(window, duration) {
  if (duration <= 0) return Promise.resolve();
  return new Promise(resolve => window.setTimeout(resolve, duration));
}

function actionVector(action, window, element) {
  const rect = element.getBoundingClientRect();
  const horizontal = Math.max(window.innerWidth || 0, rect.width || 0) + (rect.width || 0) + 80;
  const vertical = Math.max(window.innerHeight || 0, rect.height || 0) + (rect.height || 0) + 80;
  if (action === 'close') return { x: -horizontal, y: 28, rotation: -8 };
  if (action === 'save') return { x: 0, y: -vertical, rotation: 0 };
  return { x: horizontal, y: 28, rotation: 8 };
}

export function createFocusSweepDeckController({
  window,
  element,
  deck = element?.parentElement || null,
  onCommit,
  isEnabled = () => true,
  commitDuration = DEFAULT_COMMIT_DURATION,
  snapDuration = DEFAULT_SNAP_DURATION,
  returnDuration = DEFAULT_RETURN_DURATION,
} = {}) {
  if (!window || !element || typeof onCommit !== 'function') {
    throw new TypeError('Focus Sweep deck controller requires window, element and onCommit');
  }

  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let dx = 0;
  let dy = 0;
  let dragged = false;
  let animating = false;
  let destroyed = false;
  let suppressClick = false;
  let suppressClickTimer = null;

  function now() {
    return window.performance?.now?.() ?? Date.now();
  }

  function reducedMotion() {
    return !!reducedMotionQuery?.matches;
  }

  function setIntent(intent) {
    for (const action of ['close', 'save', 'keep']) {
      element.classList.toggle(`intent-${action}`, intent === action);
      deck?.classList?.toggle(`intent-${action}`, intent === action);
    }
    if (intent) element.dataset.sweepIntent = intent;
    else delete element.dataset.sweepIntent;
  }

  function setDragTransform(nextX, nextY) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, rect.width || 1);
    const height = Math.max(1, rect.height || 1);
    const intent = focusSweepGestureIntent({ dx: nextX, dy: nextY });
    const rotation = Math.max(-8, Math.min(8, (nextX / width) * 8));
    const horizontalProgress = Math.abs(nextX) / Math.max(HORIZONTAL_DISTANCE, width * HORIZONTAL_RATIO);
    const verticalProgress = Math.abs(Math.min(0, nextY)) / Math.max(VERTICAL_DISTANCE, height * VERTICAL_RATIO);
    const progress = Math.min(1, intent === 'save' ? verticalProgress : horizontalProgress);
    element.style.setProperty('--sweep-drag-x', `${nextX}px`);
    element.style.setProperty('--sweep-drag-y', `${nextY}px`);
    element.style.setProperty('--sweep-drag-rotation', `${rotation}deg`);
    element.style.setProperty('--sweep-drag-progress', String(progress));
    setIntent(intent);
  }

  function clearVisualState() {
    element.classList.remove(
      'is-dragging',
      'is-snapping',
      'is-committed',
      'is-returning',
      'is-returning-active',
    );
    deck?.classList?.remove('is-advancing', 'is-returning');
    setIntent(null);
    for (const property of [
      '--sweep-drag-x',
      '--sweep-drag-y',
      '--sweep-drag-rotation',
      '--sweep-drag-progress',
      '--sweep-exit-x',
      '--sweep-exit-y',
      '--sweep-exit-rotation',
      '--sweep-motion-duration',
    ]) element.style.removeProperty(property);
  }

  function releasePointer() {
    if (pointerId === null) return;
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {}
    pointerId = null;
  }

  function markClickSuppressed() {
    suppressClick = true;
    if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = window.setTimeout(() => {
      suppressClick = false;
      suppressClickTimer = null;
    }, 400);
  }

  async function snapBack() {
    if (destroyed) return;
    releasePointer();
    element.classList.remove('is-dragging');
    element.classList.add('is-snapping');
    element.style.setProperty('--sweep-motion-duration', `${reducedMotion() ? 0 : snapDuration}ms`);
    setIntent(null);
    element.style.setProperty('--sweep-drag-x', '0px');
    element.style.setProperty('--sweep-drag-y', '0px');
    element.style.setProperty('--sweep-drag-rotation', '0deg');
    element.style.setProperty('--sweep-drag-progress', '0');
    await wait(window, reducedMotion() ? 0 : snapDuration);
    if (!destroyed && !animating) clearVisualState();
  }

  async function animateDecision(action, { source = 'programmatic' } = {}) {
    if (destroyed || animating || !isEnabled()) return false;
    if (!['close', 'save', 'keep'].includes(action)) return false;
    animating = true;
    releasePointer();
    const vector = actionVector(action, window, element);
    const duration = reducedMotion() ? 0 : commitDuration;
    setIntent(action);
    element.classList.remove('is-dragging', 'is-snapping');
    element.classList.add('is-committed');
    deck?.classList?.add('is-advancing');
    element.style.setProperty('--sweep-motion-duration', `${duration}ms`);
    element.style.setProperty('--sweep-exit-x', `${vector.x}px`);
    element.style.setProperty('--sweep-exit-y', `${vector.y}px`);
    element.style.setProperty('--sweep-exit-rotation', `${vector.rotation}deg`);
    await wait(window, duration);
    try {
      await onCommit(action, source);
    } finally {
      animating = false;
      if (!destroyed) clearVisualState();
    }
    return true;
  }

  async function animateReturn(action = 'keep') {
    if (destroyed || animating) return false;
    animating = true;
    const vector = actionVector(action, window, element);
    const duration = reducedMotion() ? 0 : returnDuration;
    setIntent(action);
    element.style.setProperty('--sweep-exit-x', `${vector.x}px`);
    element.style.setProperty('--sweep-exit-y', `${vector.y}px`);
    element.style.setProperty('--sweep-exit-rotation', `${vector.rotation}deg`);
    element.style.setProperty('--sweep-motion-duration', `${duration}ms`);
    element.classList.add('is-returning');
    deck?.classList?.add('is-returning');
    void element.offsetWidth;
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    element.classList.add('is-returning-active');
    await wait(window, duration);
    animating = false;
    if (!destroyed) clearVisualState();
    return true;
  }

  function handlePointerDown(event) {
    if (destroyed || animating || !isEnabled()) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.isPrimary === false) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startedAt = now();
    dx = 0;
    dy = 0;
    dragged = false;
    element.classList.add('is-dragging');
    try { element.setPointerCapture?.(pointerId); } catch {}
  }

  function handlePointerMove(event) {
    if (pointerId === null || event.pointerId !== pointerId || animating) return;
    dx = event.clientX - startX;
    dy = event.clientY - startY;
    if (Math.hypot(dx, dy) > DRAG_CLICK_SLOP) dragged = true;
    if (dragged) event.preventDefault?.();
    setDragTransform(dx, dy);
  }

  async function handlePointerUp(event) {
    if (pointerId === null || event.pointerId !== pointerId || animating) return;
    const rect = element.getBoundingClientRect();
    const action = resolveFocusSweepGesture({
      dx,
      dy,
      durationMs: now() - startedAt,
      width: rect.width,
      height: rect.height,
    });
    if (dragged) markClickSuppressed();
    if (action) {
      await animateDecision(action, { source: 'pointer' });
      return;
    }
    await snapBack();
  }

  async function handlePointerCancel(event) {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    if (dragged) markClickSuppressed();
    await snapBack();
  }

  function handleClick(event) {
    if (!suppressClick) return;
    suppressClick = false;
    if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = null;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function handleBlur() {
    if (pointerId !== null && !animating) void handlePointerCancel();
  }

  element.addEventListener('pointerdown', handlePointerDown);
  element.addEventListener('pointermove', handlePointerMove);
  element.addEventListener('pointerup', handlePointerUp);
  element.addEventListener('pointercancel', handlePointerCancel);
  element.addEventListener('click', handleClick, true);
  window.addEventListener('blur', handleBlur);

  return {
    animateDecision,
    animateReturn,
    cancel() {
      releasePointer();
      animating = false;
      clearVisualState();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      releasePointer();
      if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
      element.removeEventListener('click', handleClick, true);
      window.removeEventListener('blur', handleBlur);
      clearVisualState();
    },
    isAnimating: () => animating,
  };
}

export const FOCUS_SWEEP_DECK_MOTION = Object.freeze({
  commitDuration: DEFAULT_COMMIT_DURATION,
  snapDuration: DEFAULT_SNAP_DURATION,
  returnDuration: DEFAULT_RETURN_DURATION,
  easing: DEFAULT_EASING,
});
