const DEFAULT_LINE_HEIGHT = 16;
const DEFAULT_STICKY_OFFSET = 32;
const DEFAULT_ANCHOR_DURATION = 120;
const DEFAULT_ANCHOR_TOLERANCE = 2;

export function normalizeWheelDelta(event, viewportHeight, lineHeight = DEFAULT_LINE_HEIGHT) {
  const delta = Number(event?.deltaY) || 0;
  if (event?.deltaMode === 1) return delta * lineHeight;
  if (event?.deltaMode === 2) return delta * viewportHeight;
  return delta;
}

export function canScrollInDirection(viewport, delta, epsilon = 1) {
  if (!viewport || !delta) return false;
  if (delta < 0) return viewport.scrollTop > epsilon;
  return viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - epsilon;
}

export function clampScrollDelta(delta, viewportHeight) {
  const limit = Math.max(0, Number(viewportHeight) || 0);
  return Math.max(-limit, Math.min(limit, delta));
}

export function consumeScrollDelta(viewport, delta) {
  const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const before = viewport.scrollTop;
  const after = Math.max(0, Math.min(maximum, before + delta));
  viewport.scrollTop = after;
  return delta - (after - before);
}

export function calculateDashboardAnchor({
  rootTop,
  scrollY,
  stickyOffset,
  documentHeight,
  viewportHeight,
}) {
  const absoluteRootTop = rootTop + scrollY;
  const maximumScroll = Math.max(0, documentHeight - viewportHeight);
  return Math.max(0, Math.min(maximumScroll, absoluteRootTop - stickyOffset));
}

export function createColumnScrollController({
  window,
  document,
  root,
  minWidth = 960,
  anchorDuration = DEFAULT_ANCHOR_DURATION,
  isInteractionBlocked = () => false,
}) {
  if (!window || !document || !root) throw new TypeError('Column scroll controller requires window, document and root');

  let animationFrame = null;
  let animationViewport = null;
  let pendingDelta = 0;

  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function documentHeight() {
    return Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
    );
  }

  function stickyOffset() {
    const value = window.getComputedStyle(root).getPropertyValue('--dashboard-sticky-offset');
    return Number.parseFloat(value) || DEFAULT_STICKY_OFFSET;
  }

  function anchorTop() {
    return calculateDashboardAnchor({
      rootTop: root.getBoundingClientRect().top,
      scrollY: window.scrollY,
      stickyOffset: stickyOffset(),
      documentHeight: documentHeight(),
      viewportHeight: window.innerHeight,
    });
  }

  function applyDelta(viewport, delta) {
    consumeScrollDelta(viewport, delta);
  }

  function cancelAnimation() {
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
    animationViewport = null;
    pendingDelta = 0;
  }

  function finishAnimation(viewport) {
    window.scrollTo(0, anchorTop());
    const delta = pendingDelta;
    animationFrame = null;
    animationViewport = null;
    pendingDelta = 0;
    applyDelta(viewport, delta);
  }

  function queueAnchor(viewport, delta) {
    pendingDelta = clampScrollDelta(
      animationViewport === viewport ? pendingDelta + delta : delta,
      viewport.clientHeight,
    );

    if (animationFrame !== null && animationViewport === viewport) return;
    if (animationFrame !== null) cancelAnimation();

    animationViewport = viewport;
    pendingDelta = clampScrollDelta(delta, viewport.clientHeight);
    const startY = window.scrollY;
    const targetY = anchorTop();
    const duration = reducedMotionQuery?.matches ? 0 : anchorDuration;

    if (duration <= 0 || Math.abs(startY - targetY) <= DEFAULT_ANCHOR_TOLERANCE) {
      finishAnimation(viewport);
      return;
    }

    let startedAt = null;
    const step = timestamp => {
      if (animationViewport !== viewport) return;
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.scrollTo(0, startY + ((targetY - startY) * eased));
      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(step);
        return;
      }
      finishAnimation(viewport);
    };
    animationFrame = window.requestAnimationFrame(step);
  }

  function closestViewport(target) {
    const viewport = target?.closest?.('.column-scroll');
    return viewport && root.contains(viewport) ? viewport : null;
  }

  function handleWheel(event) {
    const viewport = closestViewport(event.target);
    if (!viewport) return;
    if (window.innerWidth < minWidth || isInteractionBlocked()) {
      cancelAnimation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      cancelAnimation();
      return;
    }
    if (Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) {
      cancelAnimation();
      return;
    }

    const delta = normalizeWheelDelta(event, viewport.clientHeight);
    if (!delta) return;

    // Once anchoring starts, one owner must handle the rest of that gesture.
    // Letting boundary momentum fall through to the page while rAF is moving it
    // creates two competing scroll sources and visible up/down oscillation.
    if (animationFrame !== null) {
      if (animationViewport === viewport) {
        event.preventDefault();
        queueAnchor(viewport, delta);
        return;
      }
      cancelAnimation();
    }

    if (!canScrollInDirection(viewport, delta)) return;

    event.preventDefault();
    const targetY = anchorTop();
    if (Math.abs(window.scrollY - targetY) > DEFAULT_ANCHOR_TOLERANCE) {
      queueAnchor(viewport, delta);
      return;
    }
    applyDelta(viewport, delta);
  }

  function handleResize() {
    cancelAnimation();
  }

  function handleExternalIntent(event) {
    if (animationFrame === null) return;
    if (event.type === 'keydown' && ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
    cancelAnimation();
  }

  function handleExternalWheel(event) {
    if (animationFrame === null) return;
    if (closestViewport(event.target) === animationViewport) return;
    cancelAnimation();
  }

  root.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  window.addEventListener('pointerdown', handleExternalIntent, true);
  window.addEventListener('keydown', handleExternalIntent, true);
  window.addEventListener('wheel', handleExternalWheel, { capture: true, passive: true });

  return {
    destroy() {
      cancelAnimation();
      root.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', handleExternalIntent, true);
      window.removeEventListener('keydown', handleExternalIntent, true);
      window.removeEventListener('wheel', handleExternalWheel, true);
    },
  };
}
