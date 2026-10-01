// Native modal dialogs isolate the background and handle Tab without a custom trap.
const returnTargets = new WeakMap();

export function openModalDialog(dialog, dismiss) {
  if (!dialog || dialog.open) return;
  returnTargets.set(dialog, dialog.ownerDocument.activeElement);
  dialog.style.display = 'flex';
  dialog.oncancel = event => { event.preventDefault(); dismiss(); };
  dialog.onkeydown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };
  dialog.showModal();
}

export function closeModalDialog(dialog) {
  if (!dialog?.open) return;
  dialog.close();
  dialog.style.display = 'none';
  // A pending recovery notification must stay reachable after its dialog closes.
  const toast = dialog.querySelector('#toast');
  if (toast) dialog.ownerDocument.body.appendChild(toast);
  const previous = returnTargets.get(dialog);
  returnTargets.delete(dialog);
  const target = previous?.isConnected && previous.getClientRects().length
    ? previous : dialog.ownerDocument.getElementById('globalSearch');
  target?.focus({ preventScroll: true });
}

// Spotlight/deck overlays retain their layout while isolating background controls.
export function isolateOverlay(overlay) {
  if (!overlay) return () => {};
  const body = overlay.ownerDocument.body;
  const floating = ['contextMenu', 'toast'].map(id => overlay.ownerDocument.getElementById(id))
    .filter(element => element && !overlay.contains(element))
    .map(element => ({ element, parent:element.parentNode, next:element.nextSibling }));
  for (const { element } of floating) overlay.append(element);
  const background = [...body.children].filter(element => element !== overlay && !element.contains(overlay))
    .map(element => ({ element, inert:element.inert }));
  for (const { element } of background) element.inert = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { element, inert } of background) element.inert = inert;
    for (const { element, parent, next } of floating) {
      if (overlay.contains(element)) parent.insertBefore(element, next?.parentNode === parent ? next : null);
    }
  };
}
