import { ONBOARDING_STEPS } from './view-config.js';

export function createOnboardingController({
  document,
  window,
  isPrivacyOn,
  isFocusSweepActive,
  exitFocusSweep,
  closeContextMenu,
  closeFolderDeleteDialog,
  closeCloseAllDialog,
  closeSpeedDialDialog,
  setWorkspaceDrawerOpen,
  positionWorkspaceDrawer,
}) {
  const ONBOARDING_COMPLETE_KEY = 'tabout-onboarding-v1-complete';

  const onboardingState = {
    active: false,
    manual: false,
    index: 0,
    lastFocusEl: null,
  };

  let onboardingAutoAttempted = false;
  let onboardingPositionTimer = null;

  function hasCompletedOnboarding() {
    try { return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === '1'; }
    catch { return true; }
  }

  function markOnboardingComplete() {
    try { localStorage.setItem(ONBOARDING_COMPLETE_KEY, '1'); } catch {}
  }

  function maybeStartOnboarding() {
    if (onboardingAutoAttempted) return;
    if (isPrivacyOn() || hasCompletedOnboarding()) return;
    onboardingAutoAttempted = true;
    window.setTimeout(() => {
      if (!isPrivacyOn() && !hasCompletedOnboarding() && !onboardingState.active) {
        startOnboarding({ manual: false });
      }
    }, 450);
  }

  function startOnboarding({ manual = false } = {}) {
    if (isPrivacyOn()) return;

    if (typeof closeContextMenu === 'function') closeContextMenu();
    if (isFocusSweepActive()) exitFocusSweep();
    if (typeof closeFolderDeleteDialog === 'function') closeFolderDeleteDialog();
    if (typeof closeCloseAllDialog === 'function') closeCloseAllDialog();
    if (typeof closeSpeedDialDialog === 'function') closeSpeedDialDialog();
    setWorkspaceDrawerOpen(false);

    onboardingState.active = true;
    onboardingState.manual = !!manual;
    onboardingState.index = 0;
    onboardingState.lastFocusEl = document.activeElement;

    const overlay = document.getElementById('onboardingOverlay');
    document.documentElement.classList.add('onboarding-open');
    document.body.classList.add('onboarding-open');
    if (overlay) overlay.style.display = 'block';

    renderOnboardingStep({ focus: true });
  }

  function finishOnboarding({ skipped = false, viaEscape = false } = {}) {
    if (!onboardingState.active) return;

    if (skipped || !viaEscape || !onboardingState.manual) markOnboardingComplete();

    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('is-centered');
    }
    document.documentElement.classList.remove('onboarding-open');
    document.body.classList.remove('onboarding-open');
    clearTimeout(onboardingPositionTimer);
    positionWorkspaceDrawer();
    window.requestAnimationFrame(positionWorkspaceDrawer);

    const previousFocus = onboardingState.lastFocusEl;
    onboardingState.active = false;
    onboardingState.manual = false;
    onboardingState.index = 0;
    onboardingState.lastFocusEl = null;

    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus(); } catch {}
    }
  }

  function moveOnboarding(delta) {
    if (!onboardingState.active) return;
    const next = onboardingState.index + delta;
    if (next >= ONBOARDING_STEPS.length) {
      finishOnboarding();
      return;
    }
    onboardingState.index = Math.max(0, next);
    renderOnboardingStep();
  }

  function renderOnboardingStep({ focus = false } = {}) {
    const overlay = document.getElementById('onboardingOverlay');
    const title = document.getElementById('onboardingTitle');
    const copy = document.getElementById('onboardingCopy');
    const label = document.getElementById('onboardingStepLabel');
    const skip = overlay?.querySelector('[data-action="onboarding-skip"]');
    const prev = overlay?.querySelector('[data-action="onboarding-prev"]');
    const next = overlay?.querySelector('[data-action="onboarding-next"]');
    const step = ONBOARDING_STEPS[onboardingState.index];
    if (!overlay || !title || !copy || !label || !step) return;

    const isLast = onboardingState.index === ONBOARDING_STEPS.length - 1;
    title.textContent = step.title;
    copy.textContent = step.copy;
    label.textContent = `${onboardingState.index + 1} of ${ONBOARDING_STEPS.length}`;
    if (skip) skip.style.display = isLast ? 'none' : '';
    if (prev) prev.disabled = onboardingState.index === 0;
    if (next) next.textContent = isLast ? 'Start using Tab Atlas' : 'Next';

    window.requestAnimationFrame(() => {
      positionOnboarding();
      if (focus) focusOnboardingPrimary();
    });
  }

  function focusOnboardingPrimary() {
    const overlay = document.getElementById('onboardingOverlay');
    const next = overlay?.querySelector('[data-action="onboarding-next"]');
    if (next && typeof next.focus === 'function') {
      try { next.focus(); } catch {}
    }
  }

  function isOnboardingElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function firstVisibleOnboardingTarget(selectors) {
    for (const selector of selectors || []) {
      const el = document.querySelector(selector);
      if (isOnboardingElementVisible(el)) return el;
    }
    return null;
  }

  function getOnboardingCornerControlsTarget() {
    const buttons = Array.from(document.querySelectorAll('.corner-btn'))
      .filter(isOnboardingElementVisible)
      .map(button => button.getBoundingClientRect());
    if (!buttons.length) return null;

    const left = Math.min(...buttons.map(rect => rect.left));
    const top = Math.min(...buttons.map(rect => rect.top));
    const right = Math.max(...buttons.map(rect => rect.right));
    const bottom = Math.max(...buttons.map(rect => rect.bottom));
    return {
      scrollIntoView() {},
      getBoundingClientRect() {
        return {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
        };
      },
    };
  }

  function resolveOnboardingVirtualTarget(step) {
    if (step?.virtualTarget === 'cornerControls') {
      return getOnboardingCornerControlsTarget();
    }
    return null;
  }

  function resolveOnboardingTarget(step) {
    if (!step || step.centered) return null;
    const virtualTarget = resolveOnboardingVirtualTarget(step);
    if (virtualTarget) return virtualTarget;
    const target = firstVisibleOnboardingTarget(step.targets);
    if (target) return target;
    return firstVisibleOnboardingTarget([step.fallback]);
  }

  function clampOnboardingValue(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function onboardingSpotlightPadding(step) {
    const pad = step?.spotlightPadding ?? 8;
    if (typeof pad === 'number') {
      return { top: pad, right: pad, bottom: pad, left: pad };
    }
    return {
      top: Number.isFinite(pad.top) ? pad.top : 8,
      right: Number.isFinite(pad.right) ? pad.right : 8,
      bottom: Number.isFinite(pad.bottom) ? pad.bottom : 8,
      left: Number.isFinite(pad.left) ? pad.left : 8,
    };
  }

  function positionOnboarding() {
    if (!onboardingState.active) return;

    const overlay = document.getElementById('onboardingOverlay');
    const card = document.getElementById('onboardingCard');
    const highlight = document.getElementById('onboardingHighlight');
    const step = ONBOARDING_STEPS[onboardingState.index];
    if (!overlay || !card || !highlight || !step) return;

    const target = resolveOnboardingTarget(step);
    if (step.centered || !target) {
      overlay.classList.add('is-centered');
      highlight.style.opacity = '0';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }

    overlay.classList.remove('is-centered');
    if (typeof target.scrollIntoView === 'function') {
      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch {}
    }

    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const pad = onboardingSpotlightPadding(step);
    const gap = 14;
    const margin = 16;
    const rect = target.getBoundingClientRect();
    const ring = {
      left: clampOnboardingValue(rect.left - pad.left, margin / 2, viewportW - margin),
      top: clampOnboardingValue(rect.top - pad.top, 0, viewportH - margin),
      right: clampOnboardingValue(rect.right + pad.right, margin / 2, viewportW - margin / 2),
      bottom: clampOnboardingValue(rect.bottom + pad.bottom, margin / 2, viewportH - margin / 2),
    };
    ring.width = Math.max(1, ring.right - ring.left);
    ring.height = Math.max(1, ring.bottom - ring.top);

    highlight.style.opacity = '1';
    highlight.style.left = `${ring.left}px`;
    highlight.style.top = `${ring.top}px`;
    highlight.style.width = `${ring.width}px`;
    highlight.style.height = `${ring.height}px`;

    card.style.transform = 'none';
    const cardW = card.offsetWidth || 340;
    const cardH = card.offsetHeight || 190;
    const spaces = {
      right: viewportW - ring.right - gap,
      left: ring.left - gap,
      bottom: viewportH - ring.bottom - gap,
      top: ring.top - gap,
    };

    let x;
    let y;
    if (spaces.right >= cardW + margin) {
      x = ring.right + gap;
      y = ring.top + (ring.height - cardH) / 2;
    } else if (spaces.left >= cardW + margin) {
      x = ring.left - cardW - gap;
      y = ring.top + (ring.height - cardH) / 2;
    } else if (spaces.bottom >= cardH + margin) {
      x = ring.left + (ring.width - cardW) / 2;
      y = ring.bottom + gap;
    } else if (spaces.top >= cardH + margin) {
      x = ring.left + (ring.width - cardW) / 2;
      y = ring.top - cardH - gap;
    } else {
      x = (viewportW - cardW) / 2;
      y = (viewportH - cardH) / 2;
    }

    card.style.left = `${clampOnboardingValue(x, margin, viewportW - cardW - margin)}px`;
    card.style.top = `${clampOnboardingValue(y, margin, viewportH - cardH - margin)}px`;
  }

  function scheduleOnboardingPosition() {
    if (!onboardingState.active) return;
    clearTimeout(onboardingPositionTimer);
    onboardingPositionTimer = setTimeout(positionOnboarding, 60);
  }

  function onboardingFocusableControls() {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return [];
    return Array.from(overlay.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(isOnboardingElementVisible);
  }

  function trapOnboardingTab(e) {
    const focusable = onboardingFocusableControls();
    if (!focusable.length) {
      e.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!active || !document.getElementById('onboardingOverlay')?.contains(active)) {
      first.focus();
      e.preventDefault();
      return;
    }
    if (e.shiftKey && active === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    }
  }

  function handleOnboardingKeydown(e) {
    if (!onboardingState.active) return false;

    if (e.key === 'Escape') {
      e.preventDefault();
      finishOnboarding({ viaEscape: true });
      return true;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveOnboarding(1);
      return true;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveOnboarding(-1);
      return true;
    }

    if (e.key === 'Enter') {
      const action = e.target?.closest?.('[data-action]')?.dataset?.action;
      e.preventDefault();
      if (action === 'onboarding-prev') moveOnboarding(-1);
      else if (action === 'onboarding-skip') finishOnboarding({ skipped: true });
      else moveOnboarding(1);
      return true;
    }

    if (e.key === 'Tab') {
      trapOnboardingTab(e);
      return true;
    }

    return true;
  }

  return Object.freeze({
    maybeStartOnboarding,
    startOnboarding,
    finishOnboarding,
    moveOnboarding,
    handleOnboardingKeydown,
    scheduleOnboardingPosition,
    isActive: () => onboardingState.active,
  });
}
