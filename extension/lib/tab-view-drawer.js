/** A nonmodal, column-anchored drawer. Overlay the left edge only when the
 * viewport has no room beside the column; never shift the dashboard grid. */
export function createTabViewDrawerController({ window, document, section, toggle, drawer, isInteractionBlocked = () => false }) {
  let open = false;
  let frame = null;
  let focusFrame = null;

  function position() {
    frame = null;
    const rect = section.getBoundingClientRect();
    const available = section.getClientRects().length && rect.bottom > 0 && rect.top < window.innerHeight;
    toggle.hidden = !available;
    if (!available) { setOpen(false, { restoreFocus: false }); return; }
    const width = Math.min(240, window.innerWidth - 24);
    const left = Math.max(12, rect.left - width - 12);
    const handleLeft = Math.max(6, rect.left - 22);
    const handleTop = Math.max(12, Math.min(window.innerHeight - 52, rect.top + 44));
    drawer.style.width = `${width}px`;
    drawer.style.left = `${left}px`;
    drawer.style.maxHeight = `${Math.max(0, window.innerHeight - 24)}px`;
    const top = Math.max(12, Math.min(handleTop - 8, window.innerHeight - drawer.offsetHeight - 12));
    drawer.style.top = `${top}px`;
    toggle.style.left = `${handleLeft}px`;
    toggle.style.top = `${handleTop}px`;
    toggle.style.setProperty('--tab-view-handle-shift', `${open ? left + width - 1 - handleLeft : 0}px`);
  }

  function refreshPosition() {
    if (frame === null) frame = window.requestAnimationFrame(position);
  }

  function setOpen(value, { restoreFocus = true, focusPanel = false } = {}) {
    if (value && isInteractionBlocked()) return;
    const changed = open !== value;
    open = value;
    if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    focusFrame = null;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} tab view settings${toggle.classList.contains('has-view-settings') ? ', custom view active' : ''}`);
    drawer.setAttribute('aria-hidden', String(!open));
    drawer.inert = !open;
    drawer.classList.toggle('is-open', open);
    if (changed && !open && restoreFocus) toggle.focus({ preventScroll: true });
    if (open) {
      position();
      if (focusPanel) focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        if (open) drawer.querySelector('[data-tab-filter][aria-pressed="true"]')?.focus({ preventScroll: true });
      });
    } else toggle.style.setProperty('--tab-view-handle-shift', '0px');
  }

  function click() { setOpen(!open, { focusPanel: !open }); }
  function outside(event) {
    if (open && !drawer.contains(event.target) && !toggle.contains(event.target)) setOpen(false, { restoreFocus: false });
  }
  function keydown(event) {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setOpen(false);
  }
  function focusout(event) {
    if (open && event.relatedTarget && !drawer.contains(event.relatedTarget) && !toggle.contains(event.relatedTarget)) setOpen(false, { restoreFocus: false });
  }
  function dragstart() { setOpen(false, { restoreFocus: false }); }

  toggle.addEventListener('click', click);
  drawer.addEventListener('focusout', focusout);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('dragstart', dragstart, true);
  document.addEventListener('scroll', refreshPosition, true);
  window.addEventListener('resize', refreshPosition);
  refreshPosition();
  return {
    setOpen,
    refreshPosition,
    destroy() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      toggle.removeEventListener('click', click);
      drawer.removeEventListener('focusout', focusout);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('dragstart', dragstart, true);
      document.removeEventListener('scroll', refreshPosition, true);
      window.removeEventListener('resize', refreshPosition);
    },
  };
}
