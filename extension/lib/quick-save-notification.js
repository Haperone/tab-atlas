// This function is serialized by chrome.scripting: keep it self-contained.
export function showQuickSaveNotification(message, appearance, expectedUrl, onUndo) {
  if (location.href !== expectedUrl || !document.documentElement) return false;
  const key = '__tabAtlasSaveNotification';
  const previous = globalThis[key];
  previous?.dispose();
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial!important;position:fixed!important;bottom:24px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483647!important;width:max-content!important;max-width:min(320px,calc(100vw - 32px))!important;pointer-events:none!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  host.dataset.theme = appearance?.theme || 'default';
  for (const [name, value] of Object.entries(appearance?.tokens || {})) {
    if (name.startsWith('--')) host.style.setProperty(name, value);
  }
  const reduced = appearance?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const style = document.createElement('style');
  style.textContent = `
    .notice { position:relative; box-sizing:border-box; display:flex; align-items:center; gap:8px; padding:8px 10px; max-width:min(320px,calc(100vw - 32px));
      background:var(--view-panel-bg,#222226); color:var(--text,#f0f0f2);
      border:1px solid var(--view-panel-border,#45454b); border-radius:var(--view-panel-radius,16px);
      box-shadow:var(--view-panel-shadow,0 12px 32px #0004); pointer-events:auto;
      font:500 13px/1.5 var(--font-sans,system-ui,sans-serif); }
    .notice:not(.error) { background:color-mix(in srgb,var(--accent-success,#73937a) var(--success-tint,28%),var(--view-panel-bg,#222226));
      border-color:color-mix(in srgb,var(--accent-success,#73937a) 55%,var(--view-panel-border,#45454b)); }
    :host(:is([data-theme="papersoft"],[data-theme="lattesoft"],[data-theme="pearlglass"],[data-theme="paperglass"],[data-theme="orchidbloom"])) { --success-tint:14%; }
    :host([data-theme$="glass"]) .notice { backdrop-filter:blur(var(--glass-blur,20px)) saturate(var(--glass-saturation,150%)); }
    .icon { flex:none; width:18px; height:18px; color:var(--accent-success,#73937a); }
    .error .icon { color:var(--view-danger-text,#ffa9a9); }
    .copy { position:relative; flex:1; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .error .copy { overflow:visible; white-space:normal; overflow-wrap:anywhere; }
    button { all:unset; box-sizing:border-box; display:grid; place-items:center; flex:none; width:24px; height:24px;
      border-radius:8px; cursor:pointer; color:var(--view-secondary-text,#bdbdc8); }
    button:hover { color:var(--text,#f0f0f2); }
    button:focus-visible { outline:2px solid var(--accent-primary,#aaa7ff); outline-offset:2px; }
    button svg { width:16px; height:16px; }
    .content, button.undo-action { display:flex; align-items:center; gap:8px; flex:1; min-width:0; width:auto; height:24px; color:inherit; }
    .content { height:auto; }
    .error button.undo-action { height:auto; cursor:default; }
    button.undo-action .icon { width:18px; height:18px; }
    .status-glyph, .undo-glyph { transform-origin:12px 12px; transition:opacity 100ms cubic-bezier(.2,0,0,1), scale 100ms cubic-bezier(.2,0,0,1), filter 100ms cubic-bezier(.2,0,0,1); }
    .undo-glyph { opacity:0; scale:.25; filter:blur(4px); }
    .undo-ready .status-glyph { opacity:0; scale:.25; filter:blur(4px); }
    .undo-ready .undo-glyph { opacity:1; scale:1; filter:blur(0px); }
    .undo-label { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; opacity:0; }
    .label, .undo-label { transition:opacity 100ms ease-out; }
    .undo-ready .label { opacity:0; }
    .undo-ready .undo-label { opacity:1; }
    .countdown-clip { position:absolute; inset:0; border-radius:inherit; overflow:hidden; pointer-events:none; }
    .countdown { position:absolute; bottom:0; left:0; right:0; height:2px; background:var(--accent-success,#73937a); transform-origin:left; }
    .error .countdown { background:var(--view-danger-text,#ffa9a9); }
    :host([data-reduced-motion]) .label, :host([data-reduced-motion]) .undo-label { transition:none; }
    :host([data-reduced-motion]) .status-glyph, :host([data-reduced-motion]) .undo-glyph { transition:none; }
    @media(forced-colors:active) { .notice, .notice:not(.error) { background:Canvas; color:CanvasText; border-color:CanvasText; } .icon, button { color:CanvasText; } }
    @media(forced-colors:active) { .countdown { background:Highlight; } .undo-label { color:CanvasText; } }
  `;
  if (reduced) host.setAttribute('data-reduced-motion', '');
  const notice = document.createElement('div');
  notice.className = message.ok ? 'notice' : 'notice error';
  // Only fixed icon markup is HTML; folder names and error messages remain plain text.
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = message.ok ? '<path d="m5 12 4 4 10-10"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>';
  const copy = document.createElement('span');
  copy.className = 'copy';
  copy.setAttribute('role', message.ok ? 'status' : 'alert');
  copy.setAttribute('aria-atomic', 'true');
  const label = document.createElement('span');
  label.className = 'label';
  copy.append(label);
  const canUndo = !!(message.ok && message.undoId);
  const content = document.createElement(canUndo ? 'button' : 'div');
  content.className = canUndo ? 'undo-action' : 'content';
  if (canUndo) {
    // Reuse the dashboard's Undo arrow; both glyphs share one fixed SVG box.
    icon.innerHTML = '<g class="status-glyph"><path d="m5 12 4 4 10-10"/></g><g class="undo-glyph"><path d="M9 14 4 9m0 0 5-5M4 9h10a6 6 0 0 1 6 6v1"/></g>';
    content.type = 'button';
    content.setAttribute('aria-label', `Undo: ${message.text}`);
    const undoLabel = document.createElement('span');
    undoLabel.className = 'undo-label';
    undoLabel.setAttribute('aria-hidden', 'true');
    undoLabel.textContent = 'Undo';
    copy.append(undoLabel);
  }
  content.append(icon, copy);
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss Tab Atlas notification');
  close.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg>';
  const countdownClip = document.createElement('div');
  countdownClip.className = 'countdown-clip';
  countdownClip.setAttribute('aria-hidden', 'true');
  const countdown = document.createElement('div');
  countdown.className = 'countdown';
  countdownClip.append(countdown);
  notice.append(content, close, countdownClip);
  shadow.append(style, notice);
  let timer;
  let exitTimer;
  let tick;
  let progress;
  let duration = message.ok ? 4500 : 8000;
  let remaining = duration;
  let startedAt = 0;
  let running = false;
  let hovered = false;
  let focused = false;
  let busy = false;
  let undoAvailable = canUndo;
  let dismissing = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearTimeout(exitTimer); clearInterval(tick);
    progress?.cancel();
    notice.getAnimations().forEach(animation => animation.cancel());
    icon.getAnimations().forEach(animation => animation.cancel());
    const heldFocus = document.activeElement === host;
    host.remove();
    if (heldFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll:true });
    if (globalThis[key]?.host === host) delete globalThis[key];
  };
  const dismiss = () => {
    if (disposed || dismissing) return;
    dismissing = true;
    clearTimeout(timer); clearInterval(tick); progress?.pause();
    if (reduced) { dispose(); return; }
    notice.animate([{ opacity:1, transform:'translateY(0)' }, { opacity:0, transform:'translateY(6px)' }], { duration:160, easing:'ease-out', fill:'forwards' });
    exitTimer = setTimeout(dispose, 170);
  };
  const updateCountdown = () => {
    const left = running ? Math.max(0, remaining - (performance.now() - startedAt)) : remaining;
    countdown.style.transform = `scaleX(${left / duration})`;
  };
  const syncTimer = () => {
    if (disposed || dismissing) return;
    notice.classList.toggle('undo-ready', undoAvailable && (hovered || focused));
    if (running) remaining = Math.max(0, remaining - (performance.now() - startedAt));
    running = false;
    clearTimeout(timer); clearInterval(tick);
    if (!reduced && !progress) {
      progress = countdown.animate([{ transform:'scaleX(1)' }, { transform:'scaleX(0)' }], { duration, easing:'linear', fill:'forwards' });
    }
    if (progress) { progress.pause(); progress.currentTime = duration - remaining; }
    updateCountdown();
    if (hovered || focused || busy) return;
    running = true;
    startedAt = performance.now();
    timer = setTimeout(dismiss, remaining);
    if (progress) progress.play();
    // Reduced motion retains a readable timer through discrete updates.
    else tick = setInterval(updateCountdown, 250);
  };
  const undo = async () => {
    if (!undoAvailable || busy || disposed || dismissing) return;
    busy = true;
    content.setAttribute('aria-disabled', 'true');
    syncTimer();
    let result;
    try { result = typeof onUndo === 'function' ? await onUndo() : await chrome.runtime.sendMessage({ type:'tab-atlas/quick-save/undo', undoId:message.undoId }); }
    catch { result = { ok:false }; }
    if (disposed || dismissing) return;
    if (result?.ok) { dismiss(); return; }
    busy = false;
    undoAvailable = false;
    notice.classList.add('error');
    content.removeAttribute('aria-label');
    copy.setAttribute('role', 'alert');
    copy.querySelector('.undo-label')?.remove();
    icon.innerHTML = '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>';
    label.textContent = result?.message || (result?.error === 'UNDO_GONE' ? 'This Undo is no longer available.'
      : result?.error === 'UNDO_CHANGED' || result?.error === 'SOURCE_LOCKED' ? 'The saved page changed. Review it in Tab Atlas.'
      : 'Could not undo the save. Try again in Tab Atlas.');
    progress?.cancel(); progress = null;
    remaining = duration = 8000;
    syncTimer();
  };
  close.addEventListener('click', dismiss);
  // The native button handles Enter/Space; the surrounding padding is clickable too.
  notice.addEventListener('click', event => { if (!close.contains(event.target)) void undo(); });
  notice.addEventListener('mouseenter', () => { hovered = true; syncTimer(); });
  notice.addEventListener('mouseleave', () => { hovered = false; syncTimer(); });
  notice.addEventListener('focusin', () => { focused = true; syncTimer(); });
  notice.addEventListener('focusout', event => { focused = !!event.relatedTarget && notice.contains(event.relatedTarget); syncTimer(); });
  notice.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
  (document.querySelector('dialog[open]') || document.documentElement).append(host);
  // Populate the already-mounted live region so assistive technology announces it.
  label.textContent = message.text;
  globalThis[key] = { host, dispose };
  if (!reduced) {
    notice.animate([{ opacity:0, transform:'translateY(calc(100% + 24px))' }, { opacity:1, transform:'translateY(0)' }], { duration:260, easing:'cubic-bezier(.2,0,0,1)' });
    if (message.ok) icon.animate([{ opacity:0, transform:'scale(.7)' }, { opacity:1, transform:'scale(1)' }], { duration:240, delay:60, easing:'ease-out', fill:'backwards' });
  }
  syncTimer();
  return true;
}
