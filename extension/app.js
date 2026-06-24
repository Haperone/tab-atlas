/* ================================================================
   Tab Atlas — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// Signature of the last-rendered tab set, so auto-refresh can skip redraws
// when nothing relevant changed (a tab just updating its favicon/title fires
// events but shouldn't re-render and flicker the whole dashboard).
let lastTabSignature = null;
function tabsSignature(list) {
  return (list || []).map(t => `${t.id}|${t.url || ''}|${t.pinned ? 1 : 0}`).join('§');
}

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Atlas's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      pinned:   !!t.pinned,
      // Flag Tab Atlas's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Atlas new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Atlas tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false,             // true = checked off (archived)
       dismissed: false              // true = dismissed without reading
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab, folderId = null) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
  deferred.push({
    id,
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
    dismissed: false,
    folderId:  folderId || null,
  });
  await chrome.storage.local.set({ deferred });
  return id;
}

/**
 * undismissSavedTab(id)
 *
 * Reverses dismissSavedTab() — used by the "Undo" toast action.
 */
async function undismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = false;
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Filters out dismissed items (those are gone for good).
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Marks a saved tab as dismissed (removed from all lists).
 */
async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   FOLDERS — chrome.storage.local (backward compatible)

   Folders live under a NEW "folders" key, separate from "deferred".
   Saved tabs gain an optional "folderId" field:
     - folderId absent / null  → the tab is in the inbox (Saved for later)
     - folderId === <id>        → the tab lives inside that folder

   Existing saved tabs have no folderId, so they all stay in the inbox.
   Nothing is ever deleted or rewritten in bulk — only the touched record
   changes. Rolling back to an older build simply ignores these fields.

   Folder shape stored under the "folders" key:
   [
     { id: "1712345678901", name: "Reading", collapsed: false,
       createdAt: "2026-06-06T10:00:00.000Z" },
     ...
   ]
   ---------------------------------------------------------------- */

// Folder accent colours (cycled on creation; changeable from the menu)
const FOLDER_COLORS = ['#78a8c8', '#73937a', '#c8916e', '#9a8ac0', '#c96e72', '#6fae9e', '#c7a85a'];

/**
 * getFolders()
 *
 * Returns the list of folders (empty array if none exist yet).
 */
async function getFolders() {
  const { folders = [] } = await chrome.storage.local.get('folders');
  return folders;
}

/**
 * folderColor(folder)
 *
 * Resolves a folder's accent colour, or null when none is set.
 */
function folderColor(folder) {
  return folder.color || null;
}

/**
 * createFolder(name)
 *
 * Adds a new folder and returns it. Empty names are ignored.
 */
async function createFolder(name) {
  const clean = (name || '').trim();
  if (!clean) return null;
  const folders = await getFolders();
  const folder = {
    id:        Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name:      clean,
    collapsed: false,
    color:     null, // no colour by default — the user sets one from the menu
    createdAt: new Date().toISOString(),
  };
  folders.push(folder);
  await chrome.storage.local.set({ folders });
  return folder;
}

/**
 * setFolderColor(id, color)
 *
 * Sets a folder's accent colour (pass null to clear it).
 */
async function setFolderColor(id, color) {
  const folders = await getFolders();
  const folder = folders.find(f => f.id === id);
  if (folder) {
    folder.color = color || null;
    await chrome.storage.local.set({ folders });
  }
}

/**
 * reorderFolders(draggedId, targetId)
 *
 * Moves the dragged folder to the position of the target folder.
 */
async function reorderFolders(draggedId, targetId) {
  if (draggedId === targetId) return;
  const folders = await getFolders();
  const from = folders.findIndex(f => f.id === draggedId);
  const to   = folders.findIndex(f => f.id === targetId);
  if (from === -1 || to === -1) return;
  const [moved] = folders.splice(from, 1);
  folders.splice(to, 0, moved);
  await chrome.storage.local.set({ folders });
}

/**
 * setAllFoldersCollapsed(collapsed)
 *
 * Collapses or expands every folder at once.
 */
async function setAllFoldersCollapsed(collapsed) {
  const folders = await getFolders();
  folders.forEach(f => { f.collapsed = !!collapsed; });
  await chrome.storage.local.set({ folders });
}

/**
 * renameFolder(id, name)
 *
 * Renames a folder. Empty names are ignored (folder keeps its old name).
 */
async function renameFolder(id, name) {
  const clean = (name || '').trim();
  if (!clean) return;
  const folders = await getFolders();
  const folder = folders.find(f => f.id === id);
  if (folder) {
    folder.name = clean;
    await chrome.storage.local.set({ folders });
  }
}

/**
 * setFolderCollapsed(id, collapsed)
 *
 * Persists a folder's collapsed/expanded state.
 */
async function setFolderCollapsed(id, collapsed) {
  const folders = await getFolders();
  const folder = folders.find(f => f.id === id);
  if (folder) {
    folder.collapsed = !!collapsed;
    await chrome.storage.local.set({ folders });
  }
}

/**
 * deleteFolder(id, mode)
 *
 * Removes a folder. The tabs that lived inside it are handled per `mode`:
 *   'inbox'  → tabs return to the inbox (folderId cleared)        [safe default]
 *   'delete' → tabs are dismissed along with the folder
 */
async function deleteFolder(id, mode = 'inbox') {
  const folders = await getFolders();
  const folder  = folders.find(f => f.id === id);
  const index   = folders.findIndex(f => f.id === id);
  const nextFolders = folders.filter(f => f.id !== id);

  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const affected = [];
  for (const tab of deferred) {
    if (tab.folderId === id) {
      affected.push({ id: tab.id, prevFolderId: tab.folderId, prevDismissed: tab.dismissed });
      if (mode === 'delete') tab.dismissed = true;
      else                   tab.folderId  = null; // back to inbox
    }
  }

  await chrome.storage.local.set({ folders: nextFolders, deferred });
  return { folder, index, affected }; // snapshot for undo
}

/**
 * restoreDeletedFolder(snapshot)
 *
 * Reverses deleteFolder() — re-inserts the folder at its old position and
 * restores each affected tab's folderId / dismissed state.
 */
async function restoreDeletedFolder(snapshot) {
  if (!snapshot || !snapshot.folder) return;
  const folders = await getFolders();
  folders.splice(Math.min(snapshot.index, folders.length), 0, snapshot.folder);

  const { deferred = [] } = await chrome.storage.local.get('deferred');
  for (const a of snapshot.affected) {
    const tab = deferred.find(t => t.id === a.id);
    if (tab) { tab.folderId = a.prevFolderId; tab.dismissed = a.prevDismissed; }
  }
  await chrome.storage.local.set({ folders, deferred });
}

/**
 * moveTabToFolder(deferredId, folderId)
 *
 * Moves a saved tab into a folder, or back to the inbox when folderId
 * is null/empty. Only the single record is touched.
 */
async function moveTabToFolder(deferredId, folderId) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === deferredId);
  if (tab) {
    tab.folderId = folderId || null;
    await chrome.storage.local.set({ deferred });
  }
}


/* ----------------------------------------------------------------
   FOLDERS ⇄ CHROME TAB GROUPS

   A folder (saved/parked tabs) can be opened as a native Chrome tab group
   (live tabs), and a Chrome tab group can be stashed back into a folder.
   Full conversion: folder→group removes the folder; group→folder closes the
   group's tabs. Requires the "tabGroups" permission.
   ---------------------------------------------------------------- */

// Chrome's 8 named group colours, as RGB, for nearest-match mapping
const CHROME_GROUP_COLORS = {
  grey:   [95, 99, 104],   blue:   [26, 115, 232], red:    [217, 48, 37],
  yellow: [249, 171, 0],   green:  [30, 142, 62],  pink:   [208, 24, 132],
  purple: [147, 52, 230],  cyan:   [0, 123, 131],  orange: [250, 144, 62],
};
// Reverse: a Chrome group colour → a pleasant folder hex (grey = no colour)
const GROUP_COLOR_TO_HEX = {
  grey: null, blue: '#78a8c8', red: '#c96e72', yellow: '#c7a85a',
  green: '#73937a', pink: '#c98ab0', purple: '#9a8ac0', cyan: '#6fae9e', orange: '#c8916e',
};

// Exact mapping for our folder palette (RGB-nearest mis-sorts a few warm tones)
const FOLDER_HEX_TO_GROUP = {
  '#78a8c8': 'blue', '#73937a': 'green', '#c8916e': 'orange', '#9a8ac0': 'purple',
  '#c96e72': 'red',  '#6fae9e': 'cyan',  '#c7a85a': 'yellow',
};
function hexToGroupColor(hex) {
  if (!hex) return 'grey';
  const key = hex.toLowerCase();
  if (FOLDER_HEX_TO_GROUP[key]) return FOLDER_HEX_TO_GROUP[key];
  const m = key.replace('#', '').match(/.{2}/g);
  if (!m) return 'grey';
  const [r, g, b] = m.map(x => parseInt(x, 16));
  let best = 'blue', bestD = Infinity;
  for (const [name, c] of Object.entries(CHROME_GROUP_COLORS)) {
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}
function groupColorToHex(name) { return GROUP_COLOR_TO_HEX[name] || null; }

/**
 * folderToGroup(folderId)
 *
 * Opens a folder's saved tabs as a native Chrome tab group (named + coloured
 * after the folder), then deletes the folder (full conversion).
 */
async function folderToGroup(folderId) {
  if (typeof chrome === 'undefined' || !chrome.tabGroups) {
    showToast('Tab groups not available'); return;
  }
  const folders = await getFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const { active } = await getSavedTabs();
  const items = active.filter(t => t.folderId === folderId);
  if (items.length === 0) { showToast('Folder is empty'); return; }

  // Open every saved tab (in the background)
  const ids = [];
  for (const it of items) {
    try {
      const tab = await chrome.tabs.create({ url: it.url, active: false });
      if (tab && tab.id != null) ids.push(tab.id);
    } catch {}
  }
  if (ids.length === 0) { showToast('Could not open the tabs'); return; }

  // Group them and name/colour the group
  try {
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, { title: folder.name, color: hexToGroupColor(folder.color) });
  } catch (e) {
    console.warn('[tab-atlas] grouping failed:', e);
    showToast('Opened the tabs, but couldn’t group them'); // keep the folder as a safety net
    await fetchOpenTabs();
    await renderStaticDashboard();
    return;
  }

  // Conversion: the data now lives in the open group → drop the folder
  await deleteFolder(folderId, 'delete');
  await fetchOpenTabs();
  await renderStaticDashboard();
  showToast(`Opened “${folder.name}” as a tab group`);
}

/**
 * groupToFolder(groupId)
 *
 * Saves a Chrome tab group's open tabs into a new folder (named + coloured
 * after the group), then closes those tabs (full conversion).
 */
async function groupToFolder(groupId) {
  if (typeof chrome === 'undefined' || !chrome.tabGroups) {
    showToast('Tab groups not available'); return;
  }
  let group, tabs;
  try {
    group = await chrome.tabGroups.get(groupId);
    tabs  = await chrome.tabs.query({ groupId });
  } catch (e) { console.warn(e); showToast('Could not read the group'); return; }

  const savable = tabs.filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'));
  if (savable.length === 0) { showToast('Group has nothing to save'); return; }

  const folder = await createFolder(group.title || 'Tab group');
  if (folder) {
    await setFolderColor(folder.id, groupColorToHex(group.color));
    for (const t of savable) {
      try { await saveTabForLater({ url: t.url, title: t.title }, folder.id); } catch {}
    }
  }

  // Conversion: close the group's tabs (the group disappears with them)
  try { await chrome.tabs.remove(savable.map(t => t.id)); } catch {}
  await fetchOpenTabs();
  await renderStaticDashboard();
  showToast(`Saved “${group.title || 'group'}” to a folder`);
}

/**
 * renderTabGroupsBar()
 *
 * Shows a bar of the currently-open Chrome tab groups (only when any exist).
 * Each chip saves that group into a folder when clicked — a discoverable
 * entry point for the group → folder conversion.
 */
async function renderTabGroupsBar() {
  const bar     = document.getElementById('tabGroupsBar');
  const chipsEl = document.getElementById('tabGroupsBarChips');
  if (!bar || !chipsEl) return;

  let groups = [];
  try { if (typeof chrome !== 'undefined' && chrome.tabGroups) groups = await chrome.tabGroups.query({}); } catch {}

  if (!groups.length) { bar.style.display = 'none'; return; }

  chipsEl.innerHTML = groups.map(g => {
    const hex  = groupColorToHex(g.color) || '#9aa0a6';
    const name = escapeHtml(g.title || 'group');
    return `<button class="group-chip" data-action="group-to-folder" data-group-id="${g.id}" title="Save “${name}” to a folder">
      <span class="group-chip-dot" style="background:${hex}"></span>
      <span class="group-chip-name">${name}</span>
      <span class="group-chip-arrow">→ folder</span>
    </button>`;
  }).join('');
  bar.style.display = 'flex';
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
let toastTimer = null;
function showToast(message, undoFn) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;

  // Drop any previous Undo button
  const oldBtn = toast.querySelector('.toast-undo');
  if (oldBtn) oldBtn.remove();

  if (typeof undoFn === 'function') {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.type = 'button';
    btn.textContent = 'Undo';
    btn.addEventListener('click', async () => {
      clearTimeout(toastTimer);
      toast.classList.remove('visible');
      await undoFn();
    });
    toast.appendChild(btn);
  }

  toast.classList.add('visible');
  clearTimeout(toastTimer);
  // Give undoable actions a little longer to act
  toastTimer = setTimeout(() => toast.classList.remove('visible'), undoFn ? 5500 : 2500);
}

/**
 * flashItem(deferredId)
 *
 * Plays a brief highlight on a saved tab after it moves, so the eye can
 * follow it to its new location.
 */
function flashItem(deferredId) {
  if (!deferredId) return;
  const el = document.querySelector(`.deferred-item[data-deferred-id="${deferredId}"]`);
  if (!el) return;
  el.classList.remove('just-moved');
  // reflow to restart the animation
  void el.offsetWidth;
  el.classList.add('just-moved');
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return 'just now';
  if (diffMins < 60)  return diffMins + ' min ago';
  if (diffHours < 24) return diffHours + ' hr' + (diffHours !== 1 ? 's' : '') + ' ago';
  if (diffDays === 1) return 'yesterday';
  return diffDays + ' days ago';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * escapeHtml(str)
 *
 * Escapes HTML special characters before inserting user-controlled text
 * (tab titles, URLs) into innerHTML. Prevents XSS if a malicious page
 * sets document.title to something containing HTML tags.
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * favIcon(pageUrl, size)
 *
 * Returns a favicon URL for a page. Prefers Chrome's built-in, locally
 * cached favicon service (chrome-extension://<id>/_favicon/…, requires the
 * "favicon" permission) — that's offline-friendly, works for intranet sites,
 * and sends NO request to any external server. Falls back to a domain-based
 * service only when that API isn't available (e.g. the preview harness).
 * The returned string is already safe to drop into an HTML attribute.
 */
function favIcon(pageUrl, size = 16) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const u = new URL(chrome.runtime.getURL('/_favicon/'));
      u.searchParams.set('pageUrl', pageUrl || '');
      u.searchParams.set('size', String(size));
      return escapeHtml(u.toString());
    }
  } catch {}
  let domain = '';
  try { domain = new URL(pageUrl).hostname; } catch {}
  return domain ? `https://www.google.com/s2/favicons?domain=${escapeHtml(domain)}&sz=${size}` : '';
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Atlas pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const safeUrl  = escapeHtml(tab.url || '');
    const dupeTag  = count > 1
      ? ` <button class="chip-dupe-badge" data-action="dedup-one-url" data-dupe-url="${safeUrl}" title="Close ${count - 1} duplicate${count - 1 !== 1 ? 's' : ''}, keep one">${count}×</button>`
      : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = favIcon(tab.url, 16);
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" draggable="true" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" draggable="false">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-primary);background:rgba(var(--accent-rgb),0.12);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const safeUrl  = escapeHtml(tab.url || '');
    const dupeTag  = count > 1
      ? ` <button class="chip-dupe-badge" data-action="dedup-one-url" data-dupe-url="${safeUrl}" title="Close ${count - 1} duplicate${count - 1 !== 1 ? 's' : ''}, keep one">${count}×</button>`
      : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeTitle = escapeHtml(label);
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = favIcon(tab.url, 16);
    return `<div class="page-chip clickable${chipClass}" data-action="focus-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" draggable="true" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" draggable="false">` : ''}
      <span class="chip-text">${safeTitle}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="Save for later">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
        </button>
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card ${hasDupes ? 'has-primary-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
// Live search query shared by all columns (lowercased; '' = no filter)
let savedQuery = '';

/**
 * parseSearch(q)
 *
 * Splits a query into operators (domain:, url:) and free-text terms.
 */
function parseSearch(q) {
  const f = { domain: [], url: [], text: [] };
  for (const part of (q || '').split(/\s+/).filter(Boolean)) {
    if (part.startsWith('domain:'))   f.domain.push(part.slice(7));
    else if (part.startsWith('url:')) f.url.push(part.slice(4));
    else                              f.text.push(part);
  }
  return f;
}

/**
 * recordMatches(url, title, parsed)
 *
 * True when a {url, title} record satisfies every term in a parsed query.
 */
function recordMatches(url, title, f) {
  url   = (url   || '').toLowerCase();
  title = (title || '').toLowerCase();
  let domain = '';
  try { domain = new URL(url).hostname.toLowerCase(); } catch {}
  for (const d of f.domain) if (!domain.includes(d)) return false;
  for (const u of f.url)    if (!url.includes(u))    return false;
  for (const t of f.text)   if (!(title.includes(t) || url.includes(t) || domain.includes(t))) return false;
  return true;
}

/**
 * savedMatches(item)
 *
 * True when a saved tab matches the current search query.
 */
function savedMatches(item) {
  if (!savedQuery) return true;
  return recordMatches(item.url, item.title, parseSearch(savedQuery));
}

async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();
    const folders = await getFolders();

    // Inbox = active saved tabs that haven't been filed into a folder.
    const inboxAll = active.filter(t => !t.folderId);
    const inbox    = inboxAll.filter(savedMatches);

    // Keep the column visible whenever there's an inbox, an archive, OR any
    // folders exist — so the inbox stays available as a drag-back target.
    if (inboxAll.length === 0 && archived.length === 0 && folders.length === 0) {
      column.style.display = 'none';
      return;
    }

    column.style.display = 'block';

    // Render active checklist items (inbox only)
    if (inbox.length > 0) {
      countEl.textContent = `${inbox.length} item${inbox.length !== 1 ? 's' : ''}`;
      list.innerHTML = inbox.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.innerHTML = '';
      list.style.display = 'none';
      countEl.textContent = '';
      empty.textContent = savedQuery
        ? 'No matches in the inbox.'
        : (folders.length > 0
            ? 'Inbox empty — drop a tab here to bring it back.'
            : 'Nothing saved. Living in the moment.');
      empty.style.display = 'block';
    }

    // Render archive section (archive keeps its own separate search box)
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = favIcon(item.url, 16);
  const ago = timeAgo(item.savedAt);
  const safeUrl   = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(item.title || item.url || '');
  const safeDomain = escapeHtml(domain);

  return `
    <div class="deferred-item" data-deferred-id="${item.id}" draggable="true">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener" class="deferred-title" title="${safeTitle}">
          <img src="${faviconUrl}" alt="" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px">${safeTitle}
        </a>
        <div class="deferred-meta">
          <span>${safeDomain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeUrl   = escapeHtml(item.url || '');
  const safeTitle = escapeHtml(item.title || item.url || '');
  return `
    <div class="archive-item">
      <a href="${safeUrl}" target="_blank" rel="noopener" class="archive-item-title" title="${safeTitle}">
        ${safeTitle}
      </a>
      <span class="archive-item-date">${ago}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   FOLDERS — Render Column
   ---------------------------------------------------------------- */

// Chevron (points right; rotated to point down when the folder is open)
const ICON_FOLDER_CHEVRON = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.4" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>`;
// Vertical "…" options icon
const ICON_DOTS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 20.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`;
// Six-dot drag grip
const ICON_GRIP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;

/**
 * renderFoldersColumn()
 *
 * Renders the "Folders" column: a list of folders, each with its filed
 * tabs. Folders can be collapsed. The column appears whenever there are
 * folders OR there are saved tabs available to file.
 */
async function renderFoldersColumn() {
  const column = document.getElementById('foldersColumn');
  const listEl = document.getElementById('foldersList');
  const emptyEl = document.getElementById('foldersEmpty');
  if (!column) return;

  try {
    const folders = await getFolders();
    const { active } = await getSavedTabs();

    // Nothing to organize and no folders yet → hide the whole column
    if (folders.length === 0 && active.length === 0) {
      column.style.display = 'none';
      updateLayoutWidth();
      return;
    }

    column.style.display = 'block';

    if (folders.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';

      // Bucket active tabs by their folderId
      const byFolder = {};
      for (const t of active) {
        if (t.folderId) (byFolder[t.folderId] = byFolder[t.folderId] || []).push(t);
      }

      const rendered = folders.map((f, i) => {
        const allItems = byFolder[f.id] || [];
        const items    = allItems.filter(savedMatches);
        // While searching, skip folders with no matching tabs
        if (savedQuery && items.length === 0) return '';
        const expanded = savedQuery ? true : !f.collapsed;
        const color    = folderColor(f);
        const accentStyle = color ? ` style="--folder-accent:${color}"` : '';
        const safeName = escapeHtml(f.name);
        const bodyInner = items.length
          ? items.map(item => renderDeferredItem(item)).join('')
          : `<div class="folder-empty-hint">Empty — drag tabs here</div>`;
        return `
          <div class="folder" data-folder-id="${f.id}" data-droppable="folder"${accentStyle}>
            <div class="folder-header" data-action="toggle-folder" data-folder-id="${f.id}">
              <span class="folder-drag-handle" draggable="true" title="Drag to reorder">${ICON_GRIP}</span>
              <span class="folder-dot"></span>
              <span class="folder-chevron ${expanded ? 'open' : ''}">${ICON_FOLDER_CHEVRON}</span>
              <span class="folder-name" title="${safeName}">${safeName}</span>
              <span class="folder-count">${allItems.length}</span>
              <button class="folder-menu-btn" data-action="folder-menu" data-folder-id="${f.id}" title="Folder options" type="button">${ICON_DOTS}</button>
            </div>
            <div class="folder-body"${expanded ? '' : ' style="display:none"'}>${bodyInner}</div>
          </div>`;
      }).join('');

      listEl.innerHTML = (savedQuery && rendered.trim() === '')
        ? `<div class="folder-empty-hint" style="padding:8px 2px">No matches in folders.</div>`
        : rendered;
    }
  } catch (err) {
    console.warn('[tab-out] Could not load folders:', err);
    column.style.display = 'none';
  }

  updateLayoutWidth();
}

/**
 * updateLayoutWidth()
 *
 * Widens the container when any side column (Saved for later / Folders)
 * is visible, so three columns have room to breathe. Falls back to the
 * narrow single-column width when only Open tabs is showing.
 */
function updateLayoutWidth() {
  const container = document.querySelector('.container');
  const deferred  = document.getElementById('deferredColumn');
  const folders   = document.getElementById('foldersColumn');
  const wide = (deferred && deferred.style.display !== 'none') ||
               (folders  && folders.style.display  !== 'none');
  if (container) container.classList.toggle('dashboard-wide', wide);
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // --- Group tabs by domain ---
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // Sort: landing pages first, then domains from landing page sites, then by tab count
  // Collect exact hostnames and suffix patterns for priority sorting
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsSectionCount.innerHTML = `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  // --- Footer stats ---
  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;

  // --- Check for duplicate Tab Atlas tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();

  // --- Render "Folders" column ---
  await renderFoldersColumn();

  // --- Open Chrome tab groups bar ---
  await renderTabGroupsBar();

  // --- Re-apply the open-tabs filter if one is active ---
  if (openQuery.trim()) applyOpenFilter();

  // --- Re-paint the multi-select highlight + bar for the surviving tabs ---
  updateSelectionUI();

  // Remember what we just rendered so auto-refresh can skip no-op redraws
  lastTabSignature = tabsSignature(openTabs);
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Open the shortcut button's link ----
  if (action === 'open-homepage') {
    const url = actionEl.dataset.homepageUrl;
    if (url) chrome.tabs.create({ url });
    return;
  }

  // ---- Edit-button dialog ----
  if (action === 'homepage-save')   { saveHomepageFromDialog(); return; }
  if (action === 'homepage-cancel') { closeHomepageDialog();    return; }

  // ---- Speed-dial shortcuts ----
  if (action === 'speeddial-open') {
    const url = actionEl.dataset.url;
    if (!url) return;
    if (e.ctrlKey || e.metaKey) { try { chrome.tabs.create({ url }); } catch {} }
    else                        { window.location.href = url; }
    return;
  }
  if (action === 'speeddial-add')    { openSpeedDialDialog(null);                  return; }
  if (action === 'speeddial-save')   { saveSpeedDialFromDialog();                   return; }
  if (action === 'speeddial-cancel') { closeSpeedDialDialog();                      return; }

  // ---- Multi-select bulk actions ----
  if (action === 'select-clear') { clearSelection();        return; }
  if (action === 'select-close') { await closeSelectedTabs(); return; }
  if (action === 'select-save')  { await saveSelectedTabs(null); return; }
  if (action === 'select-move')  {
    const rect = actionEl.getBoundingClientRect();
    await openSelectionMoveMenu(rect.left, rect.top);
    return;
  }

  // ---- Reveal the inline "new folder" name input ----
  if (action === 'new-folder') {
    const row   = document.getElementById('newFolderInputRow');
    const input = document.getElementById('newFolderInput');
    if (row && input) {
      row.style.display = 'block';
      input.value = '';
      input.focus();
    }
    return;
  }

  // ---- Save an open Chrome tab group into a folder (tab-groups bar chip) ----
  if (action === 'group-to-folder') {
    const gid = Number(actionEl.dataset.groupId);
    if (Number.isFinite(gid)) await groupToFolder(gid);
    return;
  }

  // ---- Collapse / expand ALL folders (DOM-only, no re-render → no flicker) ----
  if (action === 'toggle-all-folders') {
    const folders = await getFolders();
    const collapse = folders.some(f => !f.collapsed); // any open → collapse all
    document.querySelectorAll('#foldersList .folder').forEach(folderEl => {
      const body    = folderEl.querySelector('.folder-body');
      const chevron = folderEl.querySelector('.folder-chevron');
      if (!body) return;
      body.style.display = collapse ? 'none' : '';
      if (chevron) chevron.classList.toggle('open', !collapse);
    });
    await setAllFoldersCollapsed(collapse);
    return;
  }

  // ---- Collapse / expand a folder (DOM-only, no re-render → no flicker) ----
  if (action === 'toggle-folder') {
    if (e.target.closest('.folder-drag-handle')) return; // ignore clicks on the grip
    const fid       = actionEl.dataset.folderId;
    const folderEl  = actionEl.closest('.folder');
    if (!folderEl) return;
    const body      = folderEl.querySelector('.folder-body');
    const chevron   = folderEl.querySelector('.folder-chevron');
    const collapsed = body.style.display !== 'none';
    body.style.display = collapsed ? 'none' : '';
    if (chevron) chevron.classList.toggle('open', !collapsed);
    await setFolderCollapsed(fid, collapsed);
    return;
  }

  // ---- Folder "…" options menu ----
  if (action === 'folder-menu') {
    e.stopPropagation(); // don't also toggle the folder
    const fid  = actionEl.dataset.folderId;
    const rect = actionEl.getBoundingClientRect();
    await openFolderContextMenu(rect.right, rect.bottom, fid);
    return;
  }

  // ---- Folder delete dialog buttons ----
  if (action === 'folder-delete-cancel') {
    closeFolderDeleteDialog();
    return;
  }
  if (action === 'folder-delete-keep' || action === 'folder-delete-all') {
    const mode = action === 'folder-delete-all' ? 'delete' : 'inbox';
    let snapshot = null;
    if (pendingDeleteFolderId) snapshot = await deleteFolder(pendingDeleteFolderId, mode);
    closeFolderDeleteDialog();
    await refreshSavedAndFolders();
    const undo = snapshot ? async () => { await restoreDeletedFolder(snapshot); await refreshSavedAndFolders(); } : undefined;
    showToast(mode === 'delete' ? 'Folder and its tabs deleted' : 'Folder deleted — tabs moved to inbox', undo);
    return;
  }

  // ---- Close duplicate Tab Atlas tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Atlas tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab (modifier-clicks drive multi-select) ----
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSelect(tabUrl);   return; }
    if (e.shiftKey)             { e.preventDefault(); rangeSelectTo(tabUrl);  return; }
    if (selectedTabUrls.size) clearSelection(); // a plain click drops the selection
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed', async () => {
      try { await chrome.tabs.create({ url: tabUrl, active: false }); } catch {}
      await fetchOpenTabs();
      await renderStaticDashboard();
    });
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    let savedId;
    try {
      savedId = await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Close the tab in Chrome
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast('Saved for later', async () => {
      try { await chrome.tabs.create({ url: tabUrl, active: false }); } catch {}
      if (savedId) await dismissSavedTab(savedId);
      await fetchOpenTabs();
      await renderStaticDashboard();
    });
    await refreshSavedAndFolders();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          refreshSavedAndFolders(); // refresh counts, archive & folders
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely, with Undo) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await dismissSavedTab(id);

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        refreshSavedAndFolders();
      }, 300);
    }
    showToast('Removed', async () => {
      await undismissSavedTab(id);
      await refreshSavedAndFolders();
      flashItem(id);
    });
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`, async () => {
      for (const u of urls) { try { await chrome.tabs.create({ url: u, active: false }); } catch {} }
      await fetchOpenTabs();
      await renderStaticDashboard();
    });

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-primary-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close duplicates of one URL (click the “2×” badge on a tab) ----
  if (action === 'dedup-one-url') {
    e.stopPropagation(); // don't also focus the tab
    const url = actionEl.dataset.dupeUrl;
    if (!url) return;

    // Count how many copies there are, so Undo can reopen the closed ones
    const copies = openTabs.filter(t => t.url === url).length;
    const extras = Math.max(0, copies - 1);

    await closeDuplicateTabs([url], true);
    playCloseSound();
    await renderStaticDashboard();

    showToast(`Closed ${extras} duplicate${extras !== 1 ? 's' : ''}, kept one`, async () => {
      for (let i = 0; i < extras; i++) { try { await chrome.tabs.create({ url, active: false }); } catch {} }
      await fetchOpenTabs();
      await renderStaticDashboard();
    });
    return;
  }

  // ---- Close ALL open tabs (ask about pinned tabs first) ----
  if (action === 'close-all-open-tabs') {
    const closable    = closableTabs(true);   // includes pinned
    const pinnedCount = closable.filter(t => t.pinned).length;
    if (pinnedCount > 0) {
      openCloseAllDialog(pinnedCount);         // ask: keep pinned or close them too?
    } else {
      await doCloseAll(true);
    }
    return;
  }

  // ---- Close-all dialog buttons ----
  if (action === 'close-all-cancel')      { closeCloseAllDialog(); return; }
  if (action === 'close-all-keep-pinned') { closeCloseAllDialog(); await doCloseAll(false); return; }
  if (action === 'close-all-with-pinned') { closeCloseAllDialog(); await doCloseAll(true);  return; }

  // ---- Toggle privacy mode ----
  if (action === 'toggle-privacy') {
    e.stopPropagation();
    togglePrivacy();
    return;
  }

  // ---- Toggle the speed-dial shortcut strip ----
  if (action === 'toggle-shortcuts') {
    e.stopPropagation();
    setSpeedDialEnabled(!speedDialEnabled());
    renderSpeedDial();
    updateShortcutsToggleTitle();
    return;
  }

  // ---- Open the theme picker ----
  if (action === 'toggle-theme-menu') {
    e.stopPropagation();
    const rect = actionEl.getBoundingClientRect();
    openThemeMenu(rect.right, rect.bottom + 6);
    return;
  }
});

/**
 * closableTabs(includePinned)
 *
 * The real web tabs we're allowed to bulk-close (skips chrome://, about:,
 * and Tab Atlas's own pages). Pinned tabs are excluded unless includePinned.
 */
function closableTabs(includePinned) {
  return openTabs.filter(t =>
    t.url &&
    !t.url.startsWith('chrome') &&
    !t.url.startsWith('about:') &&
    !t.isTabOut &&
    (includePinned || !t.pinned)
  );
}

/**
 * doCloseAll(includePinned)
 *
 * Closes the closable tabs (optionally including pinned), with a confetti
 * send-off and an Undo toast that reopens them.
 */
async function doCloseAll(includePinned) {
  const targets = closableTabs(includePinned);
  const urls = targets.map(t => t.url);
  const ids  = targets.map(t => t.id);
  if (ids.length === 0) { showToast('Nothing to close'); return; }

  try { await chrome.tabs.remove(ids); } catch {}
  await fetchOpenTabs();
  playCloseSound();

  document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
    shootConfetti(
      c.getBoundingClientRect().left + c.offsetWidth / 2,
      c.getBoundingClientRect().top  + c.offsetHeight / 2
    );
    animateCardOut(c);
  });

  // Re-render shortly after the animation so any kept pinned tabs reappear
  setTimeout(() => renderStaticDashboard(), 360);

  const kept = closableTabs(true).length; // pinned still open, if any kept
  const msg = (!includePinned && kept > 0)
    ? `Closed ${ids.length} tab${ids.length !== 1 ? 's' : ''} — kept ${kept} pinned`
    : 'All tabs closed. Fresh start.';
  showToast(msg, async () => {
    for (const u of urls) { try { await chrome.tabs.create({ url: u, active: false }); } catch {} }
    await fetchOpenTabs();
    await renderStaticDashboard();
  });
}

function openCloseAllDialog(pinnedCount) {
  const dialog = document.getElementById('closeAllDialog');
  const text   = document.getElementById('closeAllText');
  if (text) text.textContent =
    `You have ${pinnedCount} pinned tab${pinnedCount !== 1 ? 's' : ''}. Close ${pinnedCount !== 1 ? 'them' : 'it'} too, or keep ${pinnedCount !== 1 ? 'them' : 'it'}?`;
  if (dialog) dialog.style.display = 'flex';
}

function closeCloseAllDialog() {
  const dialog = document.getElementById('closeAllDialog');
  if (dialog) dialog.style.display = 'none';
}

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || '<div style="font-size:12px;color:var(--muted);padding:8px 0">No results</div>';
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   FOLDERS — Interactions (drag & drop, context menus, dialogs)
   ---------------------------------------------------------------- */

/**
 * refreshSavedAndFolders()
 *
 * Re-renders both right-hand columns after a folder/move operation.
 */
async function refreshSavedAndFolders() {
  await renderDeferredColumn();
  await renderFoldersColumn();
}

// ─── Custom context menu engine ───────────────────────────────────────────────

/**
 * showContextMenu(x, y, items)
 *
 * Renders a small context menu at (x, y). `items` is an array of:
 *   { label, onClick, danger? }   — a clickable row
 *   { heading: true, label }       — a non-clickable section label
 *   { separator: true }            — a divider
 * The menu is repositioned to stay within the viewport.
 */
function showContextMenu(x, y, items) {
  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.innerHTML = '';

  for (const it of items) {
    if (it.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
    } else if (it.heading) {
      const h = document.createElement('div');
      h.className = 'context-menu-heading';
      h.textContent = it.label;
      menu.appendChild(h);
    } else if (it.swatches) {
      const row = document.createElement('div');
      row.className = 'context-menu-swatches';
      // "No colour" option
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'swatch swatch-none' + (!it.current ? ' active' : '');
      none.title = 'No colour';
      none.textContent = '✕';
      none.addEventListener('click', async (ev) => {
        ev.stopPropagation(); closeContextMenu(); if (it.onPick) await it.onPick(null);
      });
      row.appendChild(none);
      for (const c of FOLDER_COLORS) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'swatch' + (it.current === c ? ' active' : '');
        sw.style.background = c;
        sw.addEventListener('click', async (ev) => {
          ev.stopPropagation(); closeContextMenu(); if (it.onPick) await it.onPick(c);
        });
        row.appendChild(sw);
      }
      menu.appendChild(row);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'context-menu-item' + (it.danger ? ' danger' : '');
      if (it.swatchColor) {
        btn.innerHTML =
          `<span class="context-menu-theme-sw" style="background:${escapeHtml(it.swatchColor)}"></span>` +
          escapeHtml(it.label) + (it.checked ? ' ✓' : '');
      } else {
        btn.textContent = it.label;
      }
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        closeContextMenu();
        if (it.onClick) await it.onClick();
      });
      menu.appendChild(btn);
    }
  }

  // Show first (so we can measure), then clamp into the viewport
  menu.style.display = 'block';
  menu.style.left = '0px';
  menu.style.top  = '0px';
  const rect = menu.getBoundingClientRect();
  let px = x, py = y;
  if (px + rect.width  > window.innerWidth  - 8) px = window.innerWidth  - rect.width  - 8;
  if (py + rect.height > window.innerHeight - 8) py = window.innerHeight - rect.height - 8;
  menu.style.left = Math.max(8, px) + 'px';
  menu.style.top  = Math.max(8, py) + 'px';
}

function closeContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none') {
    menu.style.display = 'none';
    menu.innerHTML = '';
  }
}

/**
 * openTabContextMenu(x, y, deferredId)
 *
 * Builds the right-click menu for a saved tab: open, move to inbox/folder,
 * create a new folder, or remove.
 */
async function openTabContextMenu(x, y, deferredId) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === deferredId);
  if (!tab) return;
  const folders = await getFolders();

  const items = [];
  items.push({ label: 'Open in new tab', onClick: () => { if (tab.url) chrome.tabs.create({ url: tab.url }); } });
  items.push({ separator: true });
  items.push({ heading: true, label: 'Move to' });

  if (tab.folderId) {
    items.push({ label: '↩  Inbox', onClick: async () => {
      await moveTabToFolder(deferredId, null);
      await refreshSavedAndFolders();
      flashItem(deferredId);
      showToast('Moved to inbox');
    }});
  }
  for (const f of folders) {
    if (f.id === tab.folderId) continue;
    items.push({ label: '🗂  ' + f.name, onClick: async () => {
      await moveTabToFolder(deferredId, f.id);
      await refreshSavedAndFolders();
      flashItem(deferredId);
      showToast(`Moved to “${f.name}”`);
    }});
  }
  items.push({ label: '＋  New folder…', onClick: async () => {
    const name = (window.prompt('New folder name:') || '').trim();
    if (!name) return;
    const folder = await createFolder(name);
    if (folder) {
      await moveTabToFolder(deferredId, folder.id);
      await refreshSavedAndFolders();
      flashItem(deferredId);
      showToast(`Moved to “${folder.name}”`);
    }
  }});
  items.push({ separator: true });
  items.push({ label: 'Remove', danger: true, onClick: async () => {
    await dismissSavedTab(deferredId);
    await refreshSavedAndFolders();
    showToast('Removed', async () => {
      await undismissSavedTab(deferredId);
      await refreshSavedAndFolders();
      flashItem(deferredId);
    });
  }});

  showContextMenu(x, y, items);
}

/**
 * openFolderContextMenu(x, y, folderId)
 *
 * Builds the right-click / "…" menu for a folder: collapse/expand,
 * rename, or delete.
 */
async function openFolderContextMenu(x, y, folderId) {
  const folders = await getFolders();
  const f = folders.find(ff => ff.id === folderId);
  if (!f) return;

  showContextMenu(x, y, [
    { label: f.collapsed ? 'Expand' : 'Collapse', onClick: async () => {
      await setFolderCollapsed(folderId, !f.collapsed);
      await renderFoldersColumn();
    }},
    { label: 'Rename', onClick: () => startFolderRename(folderId) },
    { label: 'Open as tab group', onClick: () => folderToGroup(folderId) },
    { separator: true },
    { heading: true, label: 'Color' },
    { swatches: true, current: f.color || null, onPick: async (color) => {
      await setFolderColor(folderId, color);
      await renderFoldersColumn();
    }},
    { separator: true },
    { label: 'Delete folder', danger: true, onClick: () => openFolderDeleteDialog(folderId) },
  ]);
}

/**
 * startFolderRename(folderId)
 *
 * Swaps a folder's name label for an inline text input. Enter / blur saves,
 * Escape cancels.
 */
function startFolderRename(folderId) {
  const header = document.querySelector(`.folder-header[data-folder-id="${folderId}"]`);
  if (!header) return;
  const nameSpan = header.querySelector('.folder-name');
  if (!nameSpan) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-rename-input';
  input.value = nameSpan.textContent;
  input.maxLength = 60;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim()) await renameFolder(folderId, input.value);
    await renderFoldersColumn();
  };
  input.addEventListener('click',    (ev) => ev.stopPropagation());
  input.addEventListener('mousedown',(ev) => ev.stopPropagation());
  input.addEventListener('keydown',  (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter')  { ev.preventDefault(); commit(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

// ─── Folder delete dialog ─────────────────────────────────────────────────────

let pendingDeleteFolderId = null;

async function openFolderDeleteDialog(folderId) {
  const folders = await getFolders();
  const f = folders.find(ff => ff.id === folderId);
  if (!f) return;

  const { active } = await getSavedTabs();
  const count = active.filter(t => t.folderId === folderId).length;

  pendingDeleteFolderId = folderId;
  document.getElementById('folderDeleteTitle').textContent = `Delete “${f.name}”?`;
  document.getElementById('folderDeleteText').textContent = count > 0
    ? `This folder has ${count} tab${count !== 1 ? 's' : ''}. Keep them (move to inbox) or delete them along with the folder?`
    : 'This folder is empty.';
  const dialog = document.getElementById('folderDeleteDialog');
  if (dialog) dialog.style.display = 'flex';
}

function closeFolderDeleteDialog() {
  const dialog = document.getElementById('folderDeleteDialog');
  if (dialog) dialog.style.display = 'none';
  pendingDeleteFolderId = null;
}

// ─── New-folder inline input (Enter to create, Esc/blur to cancel) ─────────────

document.addEventListener('keydown', async (e) => {
  if (!e.target || e.target.id !== 'newFolderInput') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const name = e.target.value.trim();
    document.getElementById('newFolderInputRow').style.display = 'none';
    e.target.value = '';
    if (name) {
      await createFolder(name);
      await renderFoldersColumn();
      showToast(`Folder “${name}” created`);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    document.getElementById('newFolderInputRow').style.display = 'none';
    e.target.value = '';
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target && e.target.id === 'newFolderInput') {
    // Delay so a pending Enter keydown can finish first
    setTimeout(() => {
      const row = document.getElementById('newFolderInputRow');
      if (row) row.style.display = 'none';
    }, 150);
  }
});

// ─── Drag & drop ───────────────────────────────────────────────────────────────
// Handles three kinds of drags:
//   { kind:'saved',  id }          — a saved tab → into a folder or the inbox
//   { kind:'open',   url, title }  — an open-tab chip → saved into a folder/inbox
//   { kind:'folder', id }          — a folder header → reordered among folders
let dragData = null;

document.addEventListener('dragstart', (e) => {
  const item   = e.target.closest('.deferred-item');
  const chip   = e.target.closest('.page-chip[data-action="focus-tab"]');
  const header = e.target.closest('.folder-header');
  if (item) {
    dragData = { kind: 'saved', id: item.dataset.deferredId };
    item.classList.add('dragging');
  } else if (chip) {
    const url = chip.dataset.tabUrl;
    // Dragging a chip that's part of a 2+ selection drags the whole group
    if (selectedTabUrls.size > 1 && selectedTabUrls.has(url)) {
      dragData = { kind: 'open-multi', urls: [...selectedTabUrls] };
      allSelectableChips().forEach(c => {
        if (selectedTabUrls.has(c.dataset.tabUrl)) c.classList.add('dragging');
      });
    } else {
      dragData = { kind: 'open', url, title: chip.dataset.tabTitle || url };
      chip.classList.add('dragging');
    }
  } else if (header) {
    dragData = { kind: 'folder', id: header.dataset.folderId };
    const fEl = header.closest('.folder');
    if (fEl) fEl.classList.add('dragging');
  } else {
    return;
  }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragData.id || dragData.url || (dragData.urls && dragData.urls[0]) || '');
  }
});

document.addEventListener('dragend', () => {
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  dragData = null;
});

document.addEventListener('dragover', (e) => {
  if (!dragData) return;
  let target = null;
  if (dragData.kind === 'folder') {
    const f = e.target.closest('.folder');
    if (f && f.dataset.folderId !== dragData.id) target = f;
  } else {
    target = e.target.closest('[data-droppable]');
  }
  if (!target) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  if (!target.classList.contains('drop-target')) {
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    target.classList.add('drop-target');
  }
});

document.addEventListener('dragleave', (e) => {
  const zone = e.target.closest('.drop-target');
  if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drop-target');
});

document.addEventListener('drop', async (e) => {
  if (!dragData) return;
  const data = dragData;
  dragData = null;
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));

  // Folder reorder
  if (data.kind === 'folder') {
    const targetFolder = e.target.closest('.folder');
    if (targetFolder && targetFolder.dataset.folderId !== data.id) {
      e.preventDefault();
      await reorderFolders(data.id, targetFolder.dataset.folderId);
      await renderFoldersColumn();
    }
    return;
  }

  const zone = e.target.closest('[data-droppable]');
  if (!zone) return;
  e.preventDefault();

  const targetFolderId = zone.dataset.droppable === 'folder' ? zone.dataset.folderId : null;
  const folders = await getFolders();
  const tname = targetFolderId
    ? ((folders.find(f => f.id === targetFolderId) || {}).name || 'folder')
    : 'inbox';

  if (data.kind === 'saved') {
    // No-op if dropped back into the same place — avoids a needless re-render
    const { deferred = [] } = await chrome.storage.local.get('deferred');
    const tab = deferred.find(t => t.id === data.id);
    const current = tab ? (tab.folderId || null) : null;
    if (current === targetFolderId) return;

    await moveTabToFolder(data.id, targetFolderId);
    await refreshSavedAndFolders();
    flashItem(data.id);
    showToast(targetFolderId ? `Moved to “${tname}”` : 'Moved to inbox');
  } else if (data.kind === 'open') {
    // Save the open tab into the target, then close it (mirrors Save-for-later)
    const newId = await saveTabForLater({ url: data.url, title: data.title }, targetFolderId);
    try {
      const allTabs = await chrome.tabs.query({});
      const match = allTabs.find(t => t.url === data.url);
      if (match) await chrome.tabs.remove(match.id);
      await fetchOpenTabs();
    } catch {}
    await renderStaticDashboard();
    flashItem(newId);
    showToast(targetFolderId ? `Saved to “${tname}”` : 'Saved to inbox');
  } else if (data.kind === 'open-multi') {
    // Drop a multi-selection: save every picked tab into the target, then close
    // them. saveSelectedTabs reads the (still-intact) selection and toasts/undos.
    await saveSelectedTabs(targetFolderId);
  }
});

// ─── Right-click → open the relevant context menu ──────────────────────────────

document.addEventListener('contextmenu', async (e) => {
  const item      = e.target.closest('.deferred-item');
  const folder    = e.target.closest('.folder-header');
  const homeBtn   = e.target.closest('#homepageBtn');
  const speedTile = e.target.closest('.speed-tile[data-action="speeddial-open"]');
  if (homeBtn) {
    e.preventDefault();
    openHomepageDialog();
  } else if (speedTile) {
    e.preventDefault();
    const id = speedTile.dataset.id;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Edit',   onClick: () => openSpeedDialDialog(id) },
      { label: 'Remove', danger: true, onClick: () => removeSpeedDial(id) },
    ]);
  } else if (item) {
    e.preventDefault();
    await openTabContextMenu(e.clientX, e.clientY, item.dataset.deferredId);
  } else if (folder) {
    e.preventDefault();
    await openFolderContextMenu(e.clientX, e.clientY, folder.dataset.folderId);
  } else {
    closeContextMenu();
  }
});

// ─── Dismiss menus / dialog on outside interaction ─────────────────────────────

document.addEventListener('mousedown', (e) => {
  // Close the context menu when clicking outside of it
  const menu = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none' && !e.target.closest('#contextMenu')) {
    closeContextMenu();
  }
  // Close dialogs when clicking their backdrop
  const fd = document.getElementById('folderDeleteDialog');
  if (fd && fd.style.display !== 'none' && e.target === fd) closeFolderDeleteDialog();
  const cd = document.getElementById('closeAllDialog');
  if (cd && cd.style.display !== 'none' && e.target === cd) closeCloseAllDialog();
  const hp = document.getElementById('homepageDialog');
  if (hp && hp.style.display !== 'none' && e.target === hp) closeHomepageDialog();
  const sd = document.getElementById('speedDialDialog');
  if (sd && sd.style.display !== 'none' && e.target === sd) closeSpeedDialDialog();
});

// Enter saves / Escape closes the edit-button dialog inputs
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t || (t.id !== 'homepageLabelInput' && t.id !== 'homepageUrlInput')) return;
  if (e.key === 'Enter')  { e.preventDefault(); saveHomepageFromDialog(); }
  if (e.key === 'Escape') { e.preventDefault(); closeHomepageDialog(); }
});

// Enter saves / Escape closes the speed-dial editor inputs
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t || (t.id !== 'speedDialLabelInput' && t.id !== 'speedDialUrlInput')) return;
  if (e.key === 'Enter')  { e.preventDefault(); saveSpeedDialFromDialog(); }
  if (e.key === 'Escape') { e.preventDefault(); closeSpeedDialDialog(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  // Privacy mode always wins: if it's on, Esc exits it.
  if (privacyOn) { setPrivacy(false); return; }

  // Let focused fields handle their own Escape (search, rename, new folder)
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;

  // Esc first dismisses any open menu/dialog/selection; only then enters privacy
  let closed = false;
  const menu = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none') { closeContextMenu(); closed = true; }
  const fd = document.getElementById('folderDeleteDialog');
  if (fd && fd.style.display !== 'none') { closeFolderDeleteDialog(); closed = true; }
  const cd = document.getElementById('closeAllDialog');
  if (cd && cd.style.display !== 'none') { closeCloseAllDialog(); closed = true; }
  const hp = document.getElementById('homepageDialog');
  if (hp && hp.style.display !== 'none') { closeHomepageDialog(); closed = true; }
  const sd = document.getElementById('speedDialDialog');
  if (sd && sd.style.display !== 'none') { closeSpeedDialDialog(); closed = true; }
  if (!closed && selectedTabUrls.size) { clearSelection(); closed = true; }
  if (!closed) setPrivacy(true);
});

window.addEventListener('scroll', () => closeContextMenu(), true);


/* ----------------------------------------------------------------
   OPEN-TABS FILTER ("/" to focus; supports domain: and url: operators)
   ---------------------------------------------------------------- */

let openQuery = '';

/**
 * applyOpenFilter()
 *
 * Filters the open-tabs cards in place (no re-render). When the query is
 * cleared, re-renders once to restore the normal "+N more" overflow state.
 */
function applyOpenFilter() {
  const q = openQuery.trim().toLowerCase();
  const missions = document.getElementById('openTabsMissions');
  if (!missions) return;

  if (!q) { renderStaticDashboard(); return; }

  const f = parseSearch(q);
  missions.querySelectorAll('.mission-card').forEach(card => {
    // Reveal any collapsed overflow so matches hidden behind "+N more" show
    const overflow = card.querySelector('.page-chips-overflow');
    if (overflow) overflow.style.display = 'contents';
    const moreBtn = card.querySelector('[data-action="expand-chips"]');
    if (moreBtn) moreBtn.style.display = 'none';

    let anyVisible = false;
    card.querySelectorAll('.page-chip[data-action="focus-tab"]').forEach(chip => {
      const show = recordMatches(chip.dataset.tabUrl, chip.dataset.tabTitle, f);
      chip.style.display = show ? '' : 'none';
      if (show) anyVisible = true;
    });
    card.style.display = anyVisible ? '' : 'none';
  });
}

// ─── Unified search: one box filters open tabs + inbox + folders ───────────────

async function runGlobalSearch(value) {
  const q = (value || '').trim().toLowerCase();
  savedQuery = q;
  openQuery  = q;
  // Re-render saved + folders (filtered), then filter the open-tabs grid
  await refreshSavedAndFolders();
  applyOpenFilter();
}

// Focus the search box when the user presses "/"
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const input = document.getElementById('globalSearch');
  if (input) { e.preventDefault(); input.focus(); }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'globalSearch') return;
  runGlobalSearch(e.target.value);
});

document.addEventListener('keydown', (e) => {
  if (e.target && e.target.id === 'globalSearch' && e.key === 'Escape') {
    e.preventDefault();
    e.target.value = '';
    runGlobalSearch('');
    e.target.blur();
  }
});


/* ----------------------------------------------------------------
   PRIVACY MODE — a clock screen that hides the dashboard
   ---------------------------------------------------------------- */

let privacyOn = false;
let privacyTimer = null;

function paintPrivacyClock() {
  const now = new Date();
  const clock = document.getElementById('privacyClock');
  const date  = document.getElementById('privacyDate');
  if (clock) clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date)  date.textContent  = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function setPrivacy(on) {
  privacyOn = on;
  // Persist + mirror onto <html> so a new tab restores the same state pre-paint
  try { localStorage.setItem('tabout-privacy', on ? '1' : '0'); } catch {}
  document.documentElement.dataset.privacy = on ? 'on' : '';
  const screen = document.getElementById('privacyScreen');
  if (!screen) return;
  if (on) {
    paintPrivacyClock();
    screen.style.display = 'flex';
    clearInterval(privacyTimer);
    privacyTimer = setInterval(paintPrivacyClock, 1000);
  } else {
    screen.style.display = 'none';
    clearInterval(privacyTimer);
    privacyTimer = null;
  }
}

function togglePrivacy() { setPrivacy(!privacyOn); }


/* ----------------------------------------------------------------
   THEMES — switch the colour palette via [data-theme] (saved locally)
   ---------------------------------------------------------------- */

const THEME_OPTIONS = [
  { id: 'default',    label: 'Default',          color: '#78a8c8', group: 'dark' },
  { id: 'graphite',   label: 'Graphite',         color: '#d4af37', group: 'dark' },
  { id: 'solarized',  label: 'Solarized',        color: '#2f9bd8', group: 'dark' },
  { id: 'dracula',    label: 'Dracula',          color: '#bd93f9', group: 'dark' },
  { id: 'tokyonight', label: 'Tokyo Night',      color: '#7aa2f7', group: 'dark' },
  { id: 'gruvbox',    label: 'Gruvbox',          color: '#fabd2f', group: 'dark' },
  { id: 'mocha',      label: 'Catppuccin Mocha', color: '#cba6f7', group: 'dark' },
  { id: 'monokai',    label: 'Monokai',          color: '#a6e22e', group: 'dark' },
  { id: 'obsidian',   label: 'Obsidian',         color: '#818cf8', group: 'dark' },
  { id: 'paper',      label: 'Paper (light)',    color: '#c0623a', group: 'light' },
  { id: 'latte',      label: 'Catppuccin Latte', color: '#8839ef', group: 'light' },
];

function currentTheme() {
  let t = 'default';
  try { t = localStorage.getItem('tabout-theme') || 'default'; } catch {}
  // Fall back to default if the saved theme no longer exists (e.g. removed)
  return THEME_OPTIONS.some(o => o.id === t) ? t : 'default';
}

function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('tabout-theme', id); } catch {}
}

function openThemeMenu(x, y) {
  const cur = currentTheme();
  const items = [];
  const addGroup = (label, group) => {
    items.push({ heading: true, label });
    for (const t of THEME_OPTIONS.filter(o => o.group === group)) {
      items.push({
        label: t.label,
        swatchColor: t.color,
        checked: t.id === cur,
        onClick: () => { applyTheme(t.id); showToast(`Theme: ${t.label}`); },
      });
    }
  };
  addGroup('Dark', 'dark');
  addGroup('Light', 'light');
  showContextMenu(x, y, items);
}


/* ----------------------------------------------------------------
   HEADER SHORTCUT BUTTON — editable label + URL (saved in localStorage)
   ---------------------------------------------------------------- */

const HOMEPAGE_DEFAULTS = { label: 'Open Shir-Man', url: 'https://shir-man.com/homepage/' };

function getHomepage() {
  try {
    return {
      label: localStorage.getItem('tabout-homepage-label') || HOMEPAGE_DEFAULTS.label,
      url:   localStorage.getItem('tabout-homepage-url')   || HOMEPAGE_DEFAULTS.url,
    };
  } catch { return { ...HOMEPAGE_DEFAULTS }; }
}

function applyHomepageButton() {
  const btn = document.getElementById('homepageBtn');
  if (!btn) return;
  const { label, url } = getHomepage();
  btn.textContent = label;
  btn.dataset.homepageUrl = url;
}

function openHomepageDialog() {
  const { label, url } = getHomepage();
  const li = document.getElementById('homepageLabelInput');
  const ui = document.getElementById('homepageUrlInput');
  if (li) li.value = label;
  if (ui) ui.value = url;
  const d = document.getElementById('homepageDialog');
  if (d) d.style.display = 'flex';
  if (li) { li.focus(); li.select(); }
}

function closeHomepageDialog() {
  const d = document.getElementById('homepageDialog');
  if (d) d.style.display = 'none';
}

function saveHomepageFromDialog() {
  let label = (document.getElementById('homepageLabelInput')?.value || '').trim();
  let url   = (document.getElementById('homepageUrlInput')?.value || '').trim();
  if (!label) label = HOMEPAGE_DEFAULTS.label;
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    localStorage.setItem('tabout-homepage-label', label);
    localStorage.setItem('tabout-homepage-url', url);
  } catch {}
  applyHomepageButton();
  closeHomepageDialog();
  showToast('Button updated');
}


/* ----------------------------------------------------------------
   MULTI-SELECT — pick several open tabs, then act on them in bulk

   Ctrl/⌘-click toggles a tab into the selection; Shift-click selects a
   range. A floating bar offers Close / Save for later / Move to folder.
   Selection is keyed by URL so it survives re-renders (a background tab
   updating its favicon won't lose your picks).
   ---------------------------------------------------------------- */

const selectedTabUrls = new Set();
let lastSelectAnchorUrl = null;

// Every open-tab chip that can be focused/selected (includes hidden overflow)
function allSelectableChips() {
  return Array.from(document.querySelectorAll('#openTabsMissions .page-chip[data-action="focus-tab"]'));
}

/**
 * updateSelectionUI()
 *
 * Prunes the selection down to tabs still on screen, paints the highlight
 * on selected chips, and shows/hides the floating action bar.
 */
function updateSelectionUI() {
  const chips   = allSelectableChips();
  const present = new Set(chips.map(c => c.dataset.tabUrl));
  for (const u of [...selectedTabUrls]) if (!present.has(u)) selectedTabUrls.delete(u);

  chips.forEach(c => c.classList.toggle('selected', selectedTabUrls.has(c.dataset.tabUrl)));

  const bar   = document.getElementById('selectionBar');
  const count = document.getElementById('selectionCount');
  const n = selectedTabUrls.size;
  if (n > 0) {
    if (count) count.textContent = `${n} selected`;
    if (bar) bar.style.display = 'flex';
  } else {
    if (bar) bar.style.display = 'none';
    lastSelectAnchorUrl = null;
  }
}

function clearSelection() { selectedTabUrls.clear(); updateSelectionUI(); }

function toggleSelect(url) {
  if (!url) return;
  if (selectedTabUrls.has(url)) selectedTabUrls.delete(url);
  else                          selectedTabUrls.add(url);
  lastSelectAnchorUrl = url;
  updateSelectionUI();
}

// Shift-click: select every visible chip between the anchor and this one
function rangeSelectTo(url) {
  if (!url) return;
  const urls = allSelectableChips().filter(c => c.offsetParent !== null).map(c => c.dataset.tabUrl);
  const b = urls.indexOf(url);
  if (b === -1) { toggleSelect(url); return; }
  const a = lastSelectAnchorUrl ? urls.indexOf(lastSelectAnchorUrl) : -1;
  if (a === -1) { toggleSelect(url); return; }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) selectedTabUrls.add(urls[i]);
  updateSelectionUI();
}

// Chrome tab ids for the currently-selected URLs (a URL may match several tabs)
async function selectedTabIds() {
  const urlSet = new Set(selectedTabUrls);
  const all = await chrome.tabs.query({});
  return all.filter(t => urlSet.has(t.url)).map(t => t.id);
}

/**
 * closeSelectedTabs()
 *
 * Closes every selected tab at once, with confetti and an Undo that
 * reopens them.
 */
async function closeSelectedTabs() {
  const urls = [...selectedTabUrls];
  if (!urls.length) return;
  const ids = await selectedTabIds();
  if (!ids.length) { clearSelection(); return; }

  try { await chrome.tabs.remove(ids); } catch {}
  await fetchOpenTabs();
  playCloseSound();

  const bar = document.getElementById('selectionBar');
  if (bar) { const r = bar.getBoundingClientRect(); shootConfetti(r.left + r.width / 2, r.top); }

  clearSelection();
  await renderStaticDashboard();
  showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''}`, async () => {
    for (const u of urls) { try { await chrome.tabs.create({ url: u, active: false }); } catch {} }
    await fetchOpenTabs();
    await renderStaticDashboard();
  });
}

/**
 * saveSelectedTabs(folderId)
 *
 * Saves every selected tab into a folder (or the inbox when folderId is
 * null), then closes them — mirroring Save-for-later, but in bulk.
 */
async function saveSelectedTabs(folderId) {
  const urls = [...selectedTabUrls];
  if (!urls.length) return;

  let folderName = null;
  if (folderId) {
    const f = (await getFolders()).find(x => x.id === folderId);
    folderName = f ? f.name : null;
  }

  const titleFor = (u) => { const t = openTabs.find(x => x.url === u); return t ? (t.title || u) : u; };
  const savedIds = [];
  for (const u of urls) {
    try { savedIds.push(await saveTabForLater({ url: u, title: titleFor(u) }, folderId || null)); } catch {}
  }

  const ids = await selectedTabIds();
  if (ids.length) { try { await chrome.tabs.remove(ids); } catch {} }
  await fetchOpenTabs();

  clearSelection();
  await renderStaticDashboard();

  const dest = folderName ? `“${folderName}”` : 'inbox';
  showToast(`Saved ${urls.length} tab${urls.length !== 1 ? 's' : ''} to ${dest}`, async () => {
    for (const u of urls)      { try { await chrome.tabs.create({ url: u, active: false }); } catch {} }
    for (const id of savedIds) { try { await dismissSavedTab(id); } catch {} }
    await fetchOpenTabs();
    await renderStaticDashboard();
  });
}

/**
 * openSelectionMoveMenu(x, y)
 *
 * Folder picker for the selected tabs (inbox, an existing folder, or a
 * brand-new one).
 */
async function openSelectionMoveMenu(x, y) {
  const folders = await getFolders();
  const items = [];
  items.push({ label: '↩  Inbox', onClick: () => saveSelectedTabs(null) });
  if (folders.length) {
    items.push({ separator: true }, { heading: true, label: 'Folders' });
    for (const f of folders) {
      items.push({ label: '🗂  ' + f.name, onClick: () => saveSelectedTabs(f.id) });
    }
  }
  items.push({ separator: true });
  items.push({ label: '＋  New folder…', onClick: async () => {
    const name = (window.prompt('New folder name:') || '').trim();
    if (!name) return;
    const folder = await createFolder(name);
    if (folder) await saveSelectedTabs(folder.id);
  }});
  showContextMenu(x, y, items);
}


/* ----------------------------------------------------------------
   SPEED DIAL — an editable grid of site shortcuts (saved in localStorage)

   Stored as JSON under "tabout-speeddial"; visibility under
   "tabout-speeddial-enabled" (default on). Tiles open in the current tab,
   or a new tab with Ctrl/⌘. The whole strip can be hidden and brought back.
   ---------------------------------------------------------------- */

const SPEEDDIAL_KEY         = 'tabout-speeddial';
const SPEEDDIAL_ENABLED_KEY = 'tabout-speeddial-enabled';

function getSpeedDialItems() {
  try {
    const arr = JSON.parse(localStorage.getItem(SPEEDDIAL_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveSpeedDialItems(items) {
  try { localStorage.setItem(SPEEDDIAL_KEY, JSON.stringify(items)); } catch {}
}
function speedDialEnabled() {
  try { return localStorage.getItem(SPEEDDIAL_ENABLED_KEY) !== '0'; } catch { return true; }
}
function setSpeedDialEnabled(on) {
  try { localStorage.setItem(SPEEDDIAL_ENABLED_KEY, on ? '1' : '0'); } catch {}
}

/**
 * renderSpeedDial()
 *
 * Paints the shortcut strip. When disabled the element is removed from the
 * layout entirely (no placeholder); bring it back from the theme menu.
 */
function renderSpeedDial() {
  const el = document.getElementById('speedDial');
  if (!el) return;

  if (!speedDialEnabled()) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const tiles = getSpeedDialItems().map(it => {
    const safeUrl   = escapeHtml(it.url || '');
    const safeLabel = escapeHtml(it.label || it.url || '');
    const fav       = favIcon(it.url, 32);
    return `<button class="speed-tile" data-action="speeddial-open" data-id="${escapeHtml(it.id)}" data-url="${safeUrl}" title="${safeLabel}" type="button">
      ${fav ? `<img class="speed-tile-fav" src="${fav}" alt="">` : ''}
      <span class="speed-tile-label">${safeLabel}</span>
    </button>`;
  }).join('');

  const addTile = `<button class="speed-tile speed-tile-add" data-action="speeddial-add" title="Add shortcut" type="button">
    <span class="speed-tile-plus">＋</span><span class="speed-tile-label">Add</span>
  </button>`;

  el.innerHTML = `<div class="speed-dial-tiles">${tiles}${addTile}</div>`;
  el.style.display = 'flex';
}

/**
 * updateShortcutsToggleTitle()
 *
 * Keeps the corner toggle's tooltip in sync with the strip's visibility.
 */
function updateShortcutsToggleTitle() {
  const btn = document.getElementById('shortcutsToggle');
  if (btn) btn.title = speedDialEnabled() ? 'Hide shortcuts' : 'Show shortcuts';
}

let pendingSpeedDialId = null;

function openSpeedDialDialog(id) {
  pendingSpeedDialId = id || null;
  const item = id ? getSpeedDialItems().find(i => i.id === id) : null;
  const title = document.getElementById('speedDialDialogTitle');
  const li    = document.getElementById('speedDialLabelInput');
  const ui    = document.getElementById('speedDialUrlInput');
  if (title) title.textContent = item ? 'Edit shortcut' : 'Add shortcut';
  if (li) li.value = item ? item.label : '';
  if (ui) ui.value = item ? item.url   : '';
  const d = document.getElementById('speedDialDialog');
  if (d) d.style.display = 'flex';
  if (li) { li.focus(); li.select(); }
}

function closeSpeedDialDialog() {
  const d = document.getElementById('speedDialDialog');
  if (d) d.style.display = 'none';
  pendingSpeedDialId = null;
}

function saveSpeedDialFromDialog() {
  let label = (document.getElementById('speedDialLabelInput')?.value || '').trim();
  let url   = (document.getElementById('speedDialUrlInput')?.value   || '').trim();
  if (!url) { closeSpeedDialDialog(); return; }              // URL is required
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;    // tolerate bare URLs
  if (!label) { try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; } }

  const items = getSpeedDialItems();
  if (pendingSpeedDialId) {
    const it = items.find(i => i.id === pendingSpeedDialId);
    if (it) { it.label = label; it.url = url; }
  } else {
    items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, url });
  }
  saveSpeedDialItems(items);
  closeSpeedDialDialog();
  renderSpeedDial();
  showToast('Shortcut saved');
}

function removeSpeedDial(id) {
  saveSpeedDialItems(getSpeedDialItems().filter(i => i.id !== id));
  renderSpeedDial();
}


/* ----------------------------------------------------------------
   AUTO-REFRESH — keep the dashboard in sync with real tab changes
   ---------------------------------------------------------------- */

let autoRefreshTimer = null;
const pageOpenedAt = Date.now();

// Don't redraw while the user is mid-interaction — it would be disruptive.
function autoRefreshBlocked() {
  if (dragData) return true;
  if (privacyOn) return true;
  const menu    = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none') return true;
  for (const id of ['folderDeleteDialog', 'closeAllDialog', 'homepageDialog', 'speedDialDialog']) {
    const d = document.getElementById(id);
    if (d && d.style.display !== 'none') return true;
  }
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return true;
  return false;
}

function scheduleAutoRefresh() {
  clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(async () => {
    // Ignore the burst of tab events fired while this new-tab page is itself
    // opening — the initial render already shows the right tabs.
    if (Date.now() - pageOpenedAt < 1500) return;
    if (autoRefreshBlocked()) { scheduleAutoRefresh(); return; } // try again shortly

    // Only redraw if the relevant tab set actually changed. Background tabs
    // constantly fire onUpdated (favicon/title/loading) — those must not
    // re-render the whole dashboard, which is what caused the jitter.
    try {
      const sig = tabsSignature(await chrome.tabs.query({}));
      if (sig === lastTabSignature) return;
    } catch { return; }

    await renderStaticDashboard();
    if (openQuery.trim()) applyOpenFilter();
  }, 450);
}

try {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.onCreated.addListener(scheduleAutoRefresh);
    chrome.tabs.onRemoved.addListener(scheduleAutoRefresh);
    chrome.tabs.onUpdated.addListener(scheduleAutoRefresh);
    if (chrome.tabs.onMoved)    chrome.tabs.onMoved.addListener(scheduleAutoRefresh);
    if (chrome.tabs.onAttached) chrome.tabs.onAttached.addListener(scheduleAutoRefresh);
  }
} catch {}

// Keep the tab-groups bar live as groups are created/closed/renamed/recoloured
try {
  if (typeof chrome !== 'undefined' && chrome.tabGroups) {
    const refreshBar = () => renderTabGroupsBar();
    chrome.tabGroups.onCreated.addListener(refreshBar);
    chrome.tabGroups.onRemoved.addListener(refreshBar);
    chrome.tabGroups.onUpdated.addListener(refreshBar);
  }
} catch {}


/* ----------------------------------------------------------------
   FAVICON FALLBACK

   Favicons are injected via innerHTML, so we can't use an inline
   onerror handler without it being an escaping/CSP liability. Instead
   we listen for image load errors in the capture phase (error events
   don't bubble) and hide any favicon that fails to load — restoring
   the graceful fallback that inline onerror used to provide. All
   favicons share the same Google s2 source, so one listener covers
   tab chips, the saved-for-later sidebar, and the archive.
   ---------------------------------------------------------------- */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && /\/s2\/favicons\?/.test(el.src)) {
    el.style.display = 'none';
  }
}, true);


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */

// Safety net: make sure a valid saved theme is applied even if theme-init.js
// didn't run (keeps the dashboard and the picker in sync, and heals a stored
// theme that has since been removed).
try {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  localStorage.setItem('tabout-theme', t);
} catch {}

// Apply the saved (editable) header-button label + URL
applyHomepageButton();

// Paint the speed-dial shortcut strip + sync its corner toggle tooltip
renderSpeedDial();
updateShortcutsToggleTitle();

// Restore persisted privacy mode (the clock screen is already up pre-paint;
// this starts its ticking and syncs the privacyOn flag)
try { if (localStorage.getItem('tabout-privacy') === '1') setPrivacy(true); } catch {}

renderDashboard();
