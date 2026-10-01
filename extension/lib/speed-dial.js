import { openModalDialog, closeModalDialog } from './modal-dialog.js';

const SPEED_DIAL_KEY = 'tabout-speeddial';
const SPEED_DIAL_ENABLED_KEY = 'tabout-speeddial-enabled';

export function renderSpeedDialMarkup(items, escapeHtml, favIcon) {
  const tiles = items.map(item => {
    const safeUrl = escapeHtml(item.url || '');
    const safeLabel = escapeHtml(item.label || item.url || '');
    const favicon = favIcon(item.url, 32);
    return `<button class="speed-tile" data-action="speeddial-open" data-id="${escapeHtml(item.id)}" data-url="${safeUrl}" title="${safeLabel}" type="button">
      ${favicon ? `<img class="speed-tile-fav" src="${favicon}" alt="">` : ''}
      <span class="speed-tile-label">${safeLabel}</span>
    </button>`;
  }).join('');
  const addTile = `<button class="speed-tile speed-tile-add" data-action="speeddial-add" title="Add shortcut" type="button">
    <span class="speed-tile-plus">＋</span><span class="speed-tile-label">Add</span>
  </button>`;
  return `<div class="speed-dial-tiles">${tiles}${addTile}</div>`;
}

export function createSpeedDialController({ document, storage, escapeHtml, favIcon, showToast, syncClearButtons = () => {} }) {
  let pendingId = null;

  function getSpeedDialItems() {
    try {
      const items = JSON.parse(storage.getItem(SPEED_DIAL_KEY) || '[]');
      return Array.isArray(items) ? items : [];
    } catch { return []; }
  }

  function saveSpeedDialItems(items) {
    try { storage.setItem(SPEED_DIAL_KEY, JSON.stringify(items)); } catch {}
  }

  function speedDialEnabled() {
    try { return storage.getItem(SPEED_DIAL_ENABLED_KEY) !== '0'; } catch { return true; }
  }

  function setSpeedDialEnabled(on) {
    try { storage.setItem(SPEED_DIAL_ENABLED_KEY, on ? '1' : '0'); } catch {}
  }

  function renderSpeedDial() {
    const element = document.getElementById('speedDial');
    if (!element) return;
    const focused = element.contains(document.activeElement) ? document.activeElement : null;
    if (!speedDialEnabled()) {
      element.style.display = 'none';
      element.innerHTML = '';
      return;
    }
    element.innerHTML = renderSpeedDialMarkup(getSpeedDialItems(), escapeHtml, favIcon);
    element.style.display = 'flex';
    if (focused) {
      const replacement = [...element.querySelectorAll('[data-id]')].find(tile => tile.dataset.id === focused.dataset.id);
      (replacement || element.querySelector('[data-action="speeddial-add"]'))?.focus({ preventScroll: true });
    }
  }

  function openSpeedDialDialog(id) {
    pendingId = id || null;
    const item = id ? getSpeedDialItems().find(value => value.id === id) : null;
    const title = document.getElementById('speedDialDialogTitle');
    const labelInput = document.getElementById('speedDialLabelInput');
    const urlInput = document.getElementById('speedDialUrlInput');
    if (title) title.textContent = item ? 'Edit shortcut' : 'Add shortcut';
    if (labelInput) labelInput.value = item ? item.label : '';
    if (urlInput) urlInput.value = item ? item.url : '';
    if (urlInput) {
      urlInput.removeAttribute('aria-invalid');
      urlInput.setCustomValidity('');
    }
    const error = document.getElementById('speedDialUrlError');
    if (error) error.hidden = true;
    syncClearButtons(document.getElementById('speedDialDialog'));
    const dialog = document.getElementById('speedDialDialog');
    openModalDialog(dialog, closeSpeedDialDialog);
    if (labelInput) {
      labelInput.focus();
      labelInput.select();
    }
  }

  function closeSpeedDialDialog() {
    const dialog = document.getElementById('speedDialDialog');
    closeModalDialog(dialog);
    pendingId = null;
  }

  function saveSpeedDialFromDialog() {
    let label = (document.getElementById('speedDialLabelInput')?.value || '').trim();
    const urlInput = document.getElementById('speedDialUrlInput');
    let url = (urlInput?.value || '').trim();
    // Accept a bare domain, but keep invalid or unsupported addresses editable.
    if (url && !/^[a-z][a-z\d+.-]*:/i.test(url)) url = `https://${url}`;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
      url = parsed.href;
    } catch {
      const message = 'Enter a website address, such as github.com.';
      const error = document.getElementById('speedDialUrlError');
      if (error) { error.textContent = message; error.hidden = false; }
      if (urlInput) { urlInput.setAttribute('aria-invalid', 'true'); urlInput.focus(); }
      return;
    }
    if (!label) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; }
    }
    const items = getSpeedDialItems();
    if (pendingId) {
      const item = items.find(value => value.id === pendingId);
      if (item) {
        item.label = label;
        item.url = url;
      }
    } else {
      items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, url });
    }
    saveSpeedDialItems(items);
    closeSpeedDialDialog();
    renderSpeedDial();
    showToast('Shortcut saved');
  }

  function removeSpeedDial(id) {
    const items = getSpeedDialItems();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return;
    const removed = items[index];
    saveSpeedDialItems(items.filter(item => item.id !== id));
    renderSpeedDial();
    showToast('Shortcut removed', () => {
      const current = getSpeedDialItems();
      if (!current.some(item => item.id === id)) current.splice(Math.min(index, current.length), 0, removed);
      saveSpeedDialItems(current);
      renderSpeedDial();
    });
  }

  return Object.freeze({
    getSpeedDialItems,
    speedDialEnabled,
    setSpeedDialEnabled,
    renderSpeedDial,
    openSpeedDialDialog,
    closeSpeedDialDialog,
    saveSpeedDialFromDialog,
    removeSpeedDial,
  });
}
