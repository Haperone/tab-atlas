const DEFAULT_LINE_HEIGHT = 16;
const DEFAULT_STICKY_OFFSET = 32;
const DEFAULT_ANCHOR_DURATION = 90;
const DEFAULT_SCROLL_DURATION = 80;
const DEFAULT_IMMEDIATE_RATIO = 0.4;
const DEFAULT_SMOOTH_THRESHOLD = 24;
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
  scrollDuration = DEFAULT_SCROLL_DURATION,
  immediateRatio = DEFAULT_IMMEDIATE_RATIO,
  smoothThreshold = DEFAULT_SMOOTH_THRESHOLD,
  isInteractionBlocked = () => false,
}) {
  if (!window || !document || !root) throw new TypeError('Column scroll controller requires window, document and root');

  let anchorFrame = null;
  let anchorViewport = null;
  let scrollFrame = null;
  let scrollViewport = null;
  let scrollStart = 0;
  let scrollTarget = 0;
  let scrollStartedAt = null;

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

  function clampTarget(viewport, target) {
    const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    return Math.max(0, Math.min(maximum, target));
  }

  function cancelAnchor() {
    if (anchorFrame !== null) window.cancelAnimationFrame(anchorFrame);
    anchorFrame = null;
    anchorViewport = null;
  }

  function cancelScrollSmoothing() {
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    scrollViewport = null;
    scrollStartedAt = null;
  }

  function cancelAnimations() {
    cancelAnchor();
    cancelScrollSmoothing();
  }

  function activeViewport() {
    return anchorViewport || scrollViewport;
  }

  function finishAnchor(viewport) {
    window.scrollTo(0, anchorTop());
    anchorFrame = null;
    anchorViewport = null;
  }

  function startAnchor(viewport) {
    if (anchorFrame !== null && anchorViewport === viewport) return;
    cancelAnchor();

    anchorViewport = viewport;
    const startY = window.scrollY;
    const targetY = anchorTop();
    const duration = reducedMotionQuery?.matches ? 0 : anchorDuration;

    if (duration <= 0 || Math.abs(startY - targetY) <= DEFAULT_ANCHOR_TOLERANCE) {
      finishAnchor(viewport);
      return;
    }

    let startedAt = null;
    const step = timestamp => {
      if (anchorViewport !== viewport) return;
      if (startedAt === null) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      window.scrollTo(0, startY + ((targetY - startY) * eased));
      if (progress < 1) {
        anchorFrame = window.requestAnimationFrame(step);
        return;
      }
      finishAnchor(viewport);
    };
    anchorFrame = window.requestAnimationFrame(step);
  }

  function finishScrollSmoothing(viewport) {
    viewport.scrollTop = clampTarget(viewport, scrollTarget);
    scrollFrame = null;
    scrollViewport = null;
    scrollStartedAt = null;
  }

  function scheduleScrollSmoothing(viewport) {
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    scrollViewport = viewport;
    scrollStart = viewport.scrollTop;
    scrollStartedAt = null;

    if (scrollDuration <= 0 || Math.abs(scrollTarget - scrollStart) <= DEFAULT_ANCHOR_TOLERANCE) {
      finishScrollSmoothing(viewport);
      return;
    }

    const step = timestamp => {
      if (scrollViewport !== viewport) return;
      if (scrollStartedAt === null) scrollStartedAt = timestamp;
      const progress = Math.min(1, (timestamp - scrollStartedAt) / scrollDuration);
      const eased = 1 - Math.pow(1 - progress, 3);
      viewport.scrollTop = scrollStart + ((scrollTarget - scrollStart) * eased);
      if (progress < 1) {
        scrollFrame = window.requestAnimationFrame(step);
        return;
      }
      finishScrollSmoothing(viewport);
    };
    scrollFrame = window.requestAnimationFrame(step);
  }

  function applyWheelDelta(viewport, delta, event) {
    const reducedMotion = reducedMotionQuery?.matches;
    const existingDistance = scrollViewport === viewport
      ? scrollTarget - viewport.scrollTop
      : 0;
    if (scrollFrame !== null && Math.sign(existingDistance) !== Math.sign(delta)) {
      cancelScrollSmoothing();
    }

    const smooth = !reducedMotion && (
      scrollViewport === viewport
      || event.deltaMode !== 0
      || Math.abs(delta) > smoothThreshold
    );
    if (!smooth) {
      consumeScrollDelta(viewport, delta);
      return;
    }

    const baseTarget = scrollViewport === viewport ? scrollTarget : viewport.scrollTop;
    scrollTarget = clampTarget(viewport, baseTarget + delta);
    consumeScrollDelta(viewport, delta * immediateRatio);
    scheduleScrollSmoothing(viewport);
  }

  function closestViewport(target) {
    const viewport = target?.closest?.('.column-scroll');
    return viewport && root.contains(viewport) ? viewport : null;
  }

  function handleWheel(event) {
    const viewport = closestViewport(event.target);
    if (!viewport) return;
    if (window.innerWidth < minWidth || isInteractionBlocked()) {
      cancelAnimations();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      cancelAnimations();
      return;
    }
    if (Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) {
      cancelAnimations();
      return;
    }

    const delta = normalizeWheelDelta(event, viewport.clientHeight);
    if (!delta) return;

    // Once either animation starts, one owner must handle the rest of that gesture.
    // Letting boundary momentum fall through to the page while rAF is moving it
    // creates two competing scroll sources and visible up/down oscillation.
    const owner = activeViewport();
    if (owner) {
      if (owner === viewport) {
        if (anchorFrame === null && !canScrollInDirection(viewport, delta)) {
          cancelScrollSmoothing();
          return;
        }
        event.preventDefault();
        startAnchor(viewport);
        applyWheelDelta(viewport, delta, event);
        return;
      }
      cancelAnimations();
    }

    if (!canScrollInDirection(viewport, delta)) return;

    event.preventDefault();
    const targetY = anchorTop();
    if (Math.abs(window.scrollY - targetY) > DEFAULT_ANCHOR_TOLERANCE) {
      startAnchor(viewport);
    }
    applyWheelDelta(viewport, delta, event);
  }

  function handleResize() {
    cancelAnimations();
  }

  function handleExternalIntent(event) {
    if (!activeViewport()) return;
    if (event.type === 'keydown' && ['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
    cancelAnimations();
  }

  function handleExternalWheel(event) {
    const owner = activeViewport();
    if (!owner) return;
    if (closestViewport(event.target) === owner) return;
    cancelAnimations();
  }

  root.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('resize', handleResize);
  window.addEventListener('pointerdown', handleExternalIntent, true);
  window.addEventListener('keydown', handleExternalIntent, true);
  window.addEventListener('wheel', handleExternalWheel, { capture: true, passive: true });

  return {
    destroy() {
      cancelAnimations();
      root.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerdown', handleExternalIntent, true);
      window.removeEventListener('keydown', handleExternalIntent, true);
      window.removeEventListener('wheel', handleExternalWheel, true);
    },
  };
}
