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

export function createSpeedDialController({ document, storage, escapeHtml, favIcon, showToast }) {
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
    if (!speedDialEnabled()) {
      element.style.display = 'none';
      element.innerHTML = '';
      return;
    }
    element.innerHTML = renderSpeedDialMarkup(getSpeedDialItems(), escapeHtml, favIcon);
    element.style.display = 'flex';
  }

  function updateShortcutsToggleTitle() {
    const button = document.getElementById('shortcutsToggle');
    if (button) button.title = speedDialEnabled() ? 'Hide shortcuts' : 'Show shortcuts';
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
    const dialog = document.getElementById('speedDialDialog');
    if (dialog) dialog.style.display = 'flex';
    if (labelInput) {
      labelInput.focus();
      labelInput.select();
    }
  }

  function closeSpeedDialDialog() {
    const dialog = document.getElementById('speedDialDialog');
    if (dialog) dialog.style.display = 'none';
    pendingId = null;
  }

  function saveSpeedDialFromDialog() {
    let label = (document.getElementById('speedDialLabelInput')?.value || '').trim();
    let url = (document.getElementById('speedDialUrlInput')?.value || '').trim();
    if (!url) {
      closeSpeedDialDialog();
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
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
    saveSpeedDialItems(getSpeedDialItems().filter(item => item.id !== id));
    renderSpeedDial();
  }

  return Object.freeze({
    getSpeedDialItems,
    speedDialEnabled,
    setSpeedDialEnabled,
    renderSpeedDial,
    updateShortcutsToggleTitle,
    openSpeedDialDialog,
    closeSpeedDialDialog,
    saveSpeedDialFromDialog,
    removeSpeedDial,
  });
}
