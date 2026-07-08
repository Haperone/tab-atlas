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

function isInternalBrowserUrl(url) {
  const value = url || '';
  return (
    !value ||
    value.startsWith('chrome://') ||
    value.startsWith('chrome-extension://') ||
    value.startsWith('about:') ||
    value.startsWith('edge://') ||
    value.startsWith('brave://')
  );
}

function isSnapshotTab(tab) {
  return tab && tab.url && !isInternalBrowserUrl(tab.url);
}

const WORKSPACE_SNAPSHOTS_KEY = 'workspaceSnapshots';

async function getWorkspaceSnapshots() {
  const data = await chrome.storage.local.get(WORKSPACE_SNAPSHOTS_KEY);
  const snapshots = data[WORKSPACE_SNAPSHOTS_KEY];
  return Array.isArray(snapshots) ? snapshots : [];
}

async function setWorkspaceSnapshots(snapshots) {
  await chrome.storage.local.set({ [WORKSPACE_SNAPSHOTS_KEY]: snapshots });
}

function snapshotDefaultName() {
  return `Workspace ${new Date().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

async function captureWorkspaceSnapshot(name) {
  const [windows, groups] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }),
    chrome.tabGroups ? chrome.tabGroups.query({}) : Promise.resolve([]),
  ]);

  const groupById = {};
  for (const group of groups || []) {
    groupById[group.id] = {
      title: group.title || '',
      color: group.color || 'grey',
      collapsed: !!group.collapsed,
    };
  }

  const capturedWindows = windows
    .map(win => {
      const tabs = (win.tabs || [])
        .filter(isSnapshotTab)
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(tab => ({
          url: tab.url,
          title: tab.title || tab.url,
          pinned: !!tab.pinned,
          active: !!tab.active,
          index: tab.index || 0,
          groupKey: tab.groupId != null && tab.groupId >= 0 ? String(tab.groupId) : null,
        }));

      return {
        id: win.id,
        state: win.state || 'normal',
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
        focused: !!win.focused,
        tabs,
      };
    })
    .filter(win => win.tabs.length > 0);

  const usedGroupKeys = new Set();
  capturedWindows.forEach(win => {
    win.tabs.forEach(tab => {
      if (tab.groupKey) usedGroupKeys.add(tab.groupKey);
    });
  });

  const capturedGroups = {};
  for (const key of usedGroupKeys) {
    capturedGroups[key] = groupById[key] || { title: '', color: 'grey', collapsed: false };
  }

  const tabCount = capturedWindows.reduce((sum, win) => sum + win.tabs.length, 0);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: (name || snapshotDefaultName()).trim() || snapshotDefaultName(),
    createdAt: new Date().toISOString(),
    windowCount: capturedWindows.length,
    tabCount,
    windows: capturedWindows,
    groups: capturedGroups,
  };
}

async function saveCurrentWorkspaceSnapshot() {
  const defaultName = snapshotDefaultName();
  const name = (window.prompt('Snapshot name', defaultName) || '').trim();
  if (!name) return;

  const snapshot = await captureWorkspaceSnapshot(name);
  if (!snapshot.tabCount) {
    showToast('No restorable tabs to snapshot');
    return;
  }

  const snapshots = await getWorkspaceSnapshots();
  snapshots.unshift(snapshot);
  await setWorkspaceSnapshots(snapshots.slice(0, 20));
  await renderWorkspacePanel();
  showToast(`Saved “${snapshot.name}”`);
}

async function deleteWorkspaceSnapshot(snapshotId) {
  const snapshots = await getWorkspaceSnapshots();
  const next = snapshots.filter(s => s.id !== snapshotId);
  await setWorkspaceSnapshots(next);
  await renderWorkspacePanel();
  showToast('Snapshot deleted');
}

async function renameWorkspaceSnapshot(snapshotId) {
  const snapshots = await getWorkspaceSnapshots();
  const snapshot = snapshots.find(s => s.id === snapshotId);
  if (!snapshot) return;
  const name = (window.prompt('Snapshot name', snapshot.name || 'Workspace') || '').trim();
  if (!name) return;
  snapshot.name = name;
  await setWorkspaceSnapshots(snapshots);
  await renderWorkspacePanel();
  showToast('Snapshot renamed');
}

async function restoreWorkspaceSnapshot(snapshotId) {
  const snapshots = await getWorkspaceSnapshots();
  const snapshot = snapshots.find(s => s.id === snapshotId);
  if (!snapshot) return;
  if (!window.confirm(`Open “${snapshot.name}” as ${snapshot.windowCount} saved window${snapshot.windowCount !== 1 ? 's' : ''}? Existing tabs stay open.`)) return;

  let firstWindowId = null;
  for (const savedWindow of snapshot.windows || []) {
    const tabs = (savedWindow.tabs || []).filter(t => t.url);
    if (!tabs.length) continue;

    const first = tabs[0];
    const createOptions = {
      url: first.url,
      focused: false,
    };
    if (savedWindow.state === 'normal') {
      for (const key of ['left', 'top', 'width', 'height']) {
        if (typeof savedWindow[key] === 'number') createOptions[key] = savedWindow[key];
      }
    }

    const createdWindow = await chrome.windows.create(createOptions);
    if (!firstWindowId) firstWindowId = createdWindow.id;
    const createdTabs = [];
    if (createdWindow.tabs && createdWindow.tabs[0]) {
      createdTabs.push({ saved: first, tab: createdWindow.tabs[0] });
      if (first.pinned) await chrome.tabs.update(createdWindow.tabs[0].id, { pinned: true });
    }

    for (const savedTab of tabs.slice(1)) {
      const createdTab = await chrome.tabs.create({
        windowId: createdWindow.id,
        url: savedTab.url,
        active: false,
      });
      if (savedTab.pinned && createdTab?.id != null) await chrome.tabs.update(createdTab.id, { pinned: true });
      createdTabs.push({ saved: savedTab, tab: createdTab });
    }

    const groupsByKey = {};
    for (const pair of createdTabs) {
      if (!pair.saved.groupKey || !pair.tab || pair.tab.id == null) continue;
      (groupsByKey[pair.saved.groupKey] ||= []).push(pair.tab.id);
    }

    for (const [groupKey, tabIds] of Object.entries(groupsByKey)) {
      if (!tabIds.length || !chrome.tabGroups) continue;
      try {
        const newGroupId = await chrome.tabs.group({ tabIds });
        const savedGroup = snapshot.groups?.[groupKey] || {};
        await chrome.tabGroups.update(newGroupId, {
          title: savedGroup.title || '',
          color: savedGroup.color || 'grey',
          collapsed: !!savedGroup.collapsed,
        });
      } catch (err) {
        console.warn('[tab-atlas] Could not restore tab group:', err);
      }
    }

    const activePair = createdTabs.find(pair => pair.saved.active) || createdTabs[0];
    if (activePair?.tab?.id != null) {
      await chrome.tabs.update(activePair.tab.id, { active: true });
    }

    if (savedWindow.state && savedWindow.state !== 'normal') {
      try { await chrome.windows.update(createdWindow.id, { state: savedWindow.state }); } catch {}
    }
  }

  if (firstWindowId != null) {
    try { await chrome.windows.update(firstWindowId, { focused: true }); } catch {}
  }
  await fetchOpenTabs();
  await renderStaticDashboard();
  showToast(`Restored “${snapshot.name}”`);
}

async function renderWorkspacePanel() {
  const panel = document.getElementById('workspacePanel');
  const list = document.getElementById('workspaceList');
  if (!panel || !list) return;

  let snapshots = [];
  try { snapshots = await getWorkspaceSnapshots(); } catch {}

  if (!snapshots.length) {
    list.innerHTML = '<div class="workspace-empty">No saved states yet.</div>';
    return;
  }

  list.innerHTML = snapshots.map(snapshot => {
    const safeName = escapeHtml(snapshot.name || 'Workspace');
    const created = timeAgo(snapshot.createdAt);
    return `
      <div class="workspace-item">
        <div class="workspace-item-main" title="${safeName}">
          <div class="workspace-item-title">${safeName}</div>
          <div class="workspace-item-meta">${snapshot.windowCount || 0} window${snapshot.windowCount !== 1 ? 's' : ''} · ${snapshot.tabCount || 0} tab${snapshot.tabCount !== 1 ? 's' : ''} · ${created}</div>
        </div>
        <div class="workspace-item-actions">
          <button class="workspace-mini-btn workspace-icon-btn" data-action="restore-workspace-snapshot" data-snapshot-id="${snapshot.id}" type="button" aria-label="Open ${safeName}" title="Open">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>
          </button>
          <button class="workspace-mini-btn workspace-icon-btn" data-action="rename-workspace-snapshot" data-snapshot-id="${snapshot.id}" type="button" aria-label="Rename ${safeName}" title="Rename">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.1" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
          </button>
          <button class="workspace-mini-btn workspace-delete-btn danger" data-action="delete-workspace-snapshot" data-snapshot-id="${snapshot.id}" type="button" aria-label="Delete ${safeName}" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.6" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        </div>`;
  }).join('');
}

function setWorkspaceDrawerOpen(open) {
  const drawer = document.getElementById('workspaceDrawer');
  const handles = document.querySelectorAll('[data-action="toggle-workspace-drawer"]');
  if (!drawer) return;
  drawer.style.display = open ? 'grid' : 'none';
  document.body.classList.toggle('workspace-drawer-open', open);
  handles.forEach(handle => handle.setAttribute('aria-expanded', open ? 'true' : 'false'));
  if (open) positionWorkspaceDrawer();
}

function toggleWorkspaceDrawer() {
  const drawer = document.getElementById('workspaceDrawer');
  setWorkspaceDrawerOpen(!(drawer && drawer.style.display !== 'none'));
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
      id:           t.id,
      url:          t.url,
      title:        t.title,
      windowId:     t.windowId,
      index:        t.index,
      groupId:      Number.isFinite(t.groupId) ? t.groupId : -1,
      active:       t.active,
      pinned:       !!t.pinned,
      audible:      !!t.audible,
      mutedInfo:    t.mutedInfo || null,
      discarded:    !!t.discarded,
      incognito:    !!t.incognito,
      lastAccessed: t.lastAccessed || null,
      favIconUrl:   t.favIconUrl || '',
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

function tabUndoSnapshot(tabOrUrl) {
  if (!tabOrUrl) return null;
  if (typeof tabOrUrl === 'string') return tabOrUrl ? { url: tabOrUrl, pinned: false } : null;
  if (!tabOrUrl.url) return null;
  return {
    url: tabOrUrl.url,
    pinned: !!tabOrUrl.pinned,
  };
}

async function restoreUndoTab(snapshot) {
  const tab = tabUndoSnapshot(snapshot);
  if (!tab) return null;
  const created = await chrome.tabs.create({ url: tab.url, active: false });
  if (tab.pinned && created?.id != null) {
    try { await chrome.tabs.update(created.id, { pinned: true }); } catch {}
  }
  return created;
}

async function restoreUndoTabs(snapshots) {
  for (const snapshot of snapshots || []) {
    try { await restoreUndoTab(snapshot); } catch {}
  }
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
  const undoTabs = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) {
          toClose.push(tab.id);
          undoTabs.push(tabUndoSnapshot(tab));
        }
      }
    } else {
      for (const tab of matching) {
        toClose.push(tab.id);
        undoTabs.push(tabUndoSnapshot(tab));
      }
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
  return undoTabs.filter(Boolean);
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
 * uncheckSavedTab(id)
 *
 * Reverses checkOffSavedTab() — used by the "Undo" toast action.
 */
async function uncheckSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = false;
    delete tab.completedAt;
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
   BACKUP / IMPORT — local JSON for chrome.storage.local data
   ---------------------------------------------------------------- */

const BACKUP_APP_NAME = 'Tab Atlas';
const BACKUP_SCHEMA_VERSION = 1;

function makeStorageId(existingIds = new Set()) {
  let id = '';
  do {
    id = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  } while (existingIds.has(id));
  existingIds.add(id);
  return id;
}

function cloneStorageArray(value) {
  return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
}

async function buildTabAtlasBackup() {
  const data = await chrome.storage.local.get(['deferred', 'folders', WORKSPACE_SNAPSHOTS_KEY]);
  return {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      deferred: cloneStorageArray(data.deferred),
      folders: cloneStorageArray(data.folders),
      workspaceSnapshots: cloneStorageArray(data[WORKSPACE_SNAPSHOTS_KEY]),
    },
  };
}

function backupFileTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '-' + [pad(date.getHours()), pad(date.getMinutes())].join('-');
}

function downloadBackupFile(backup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-atlas-backup-${backupFileTimestamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function parseBackupFile(file) {
  if (!file) throw new Error('No backup file selected');
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Backup file is not valid JSON');
  }

  if (
    !parsed ||
    parsed.app !== BACKUP_APP_NAME ||
    parsed.schemaVersion !== BACKUP_SCHEMA_VERSION ||
    !parsed.data ||
    !Array.isArray(parsed.data.deferred) ||
    !Array.isArray(parsed.data.folders) ||
    !Array.isArray(parsed.data.workspaceSnapshots)
  ) {
    throw new Error('This is not a Tab Atlas backup file');
  }

  return parsed;
}

function normalizeBackupFolderName(name) {
  return String(name || '').trim().toLowerCase();
}

function backupItemSignature(item, folderId = item?.folderId || null) {
  return JSON.stringify([
    String(item?.url || ''),
    String(item?.title || item?.url || ''),
    !!item?.completed,
    !!item?.dismissed,
    folderId || null,
  ]);
}

function workspaceSnapshotSignature(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot || {}));
  delete copy.id;
  return JSON.stringify(copy);
}

async function mergeBackupData(backup) {
  const storage = await chrome.storage.local.get(['deferred', 'folders', WORKSPACE_SNAPSHOTS_KEY]);
  const deferred = cloneStorageArray(storage.deferred);
  const folders = cloneStorageArray(storage.folders);
  const workspaceSnapshots = cloneStorageArray(storage[WORKSPACE_SNAPSHOTS_KEY]);
  const imported = { savedTabs: 0, folders: 0, workspaces: 0, skipped: 0 };

  const folderIds = new Set(folders.map(folder => String(folder.id || '')).filter(Boolean));
  const folderNameToId = new Map();
  for (const folder of folders) {
    const key = normalizeBackupFolderName(folder.name);
    if (key && !folderNameToId.has(key)) folderNameToId.set(key, folder.id);
  }

  const folderIdMap = new Map();
  for (const folder of backup.data.folders) {
    const name = String(folder?.name || '').trim();
    if (!name) continue;

    const nameKey = normalizeBackupFolderName(name);
    const existingId = folderNameToId.get(nameKey);
    if (existingId) {
      if (folder.id) folderIdMap.set(folder.id, existingId);
      imported.skipped += 1;
      continue;
    }

    const id = makeStorageId(folderIds);
    const nextFolder = {
      id,
      name,
      collapsed: !!folder.collapsed,
      color: typeof folder.color === 'string' && folder.color ? folder.color : null,
      createdAt: typeof folder.createdAt === 'string' ? folder.createdAt : new Date().toISOString(),
    };
    folders.push(nextFolder);
    folderNameToId.set(nameKey, id);
    if (folder.id) folderIdMap.set(folder.id, id);
    imported.folders += 1;
  }

  const deferredIds = new Set(deferred.map(item => String(item.id || '')).filter(Boolean));
  const savedSignatures = new Set(deferred.map(item => backupItemSignature(item)));
  for (const item of backup.data.deferred) {
    if (!item || typeof item.url !== 'string' || !item.url.trim()) continue;
    const targetFolderId = item.folderId ? (folderIdMap.get(item.folderId) || null) : null;
    const candidate = {
      id: makeStorageId(deferredIds),
      url: item.url,
      title: typeof item.title === 'string' && item.title ? item.title : item.url,
      savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
      completed: !!item.completed,
      dismissed: !!item.dismissed,
      folderId: targetFolderId,
    };
    if (item.completedAt) candidate.completedAt = item.completedAt;
    const signature = backupItemSignature(candidate, targetFolderId);
    if (savedSignatures.has(signature)) {
      imported.skipped += 1;
      deferredIds.delete(candidate.id);
      continue;
    }
    savedSignatures.add(signature);
    deferred.push(candidate);
    imported.savedTabs += 1;
  }

  const workspaceIds = new Set(workspaceSnapshots.map(snapshot => String(snapshot.id || '')).filter(Boolean));
  const workspaceSignatures = new Set(workspaceSnapshots.map(workspaceSnapshotSignature));
  for (const snapshot of backup.data.workspaceSnapshots) {
    if (!snapshot || typeof snapshot !== 'object') continue;
    const signature = workspaceSnapshotSignature(snapshot);
    if (workspaceSignatures.has(signature)) {
      imported.skipped += 1;
      continue;
    }
    const nextSnapshot = JSON.parse(JSON.stringify(snapshot));
    if (!nextSnapshot.id || workspaceIds.has(nextSnapshot.id)) {
      nextSnapshot.id = makeStorageId(workspaceIds);
    } else {
      workspaceIds.add(nextSnapshot.id);
    }
    workspaceSnapshots.unshift(nextSnapshot);
    workspaceSignatures.add(signature);
    imported.workspaces += 1;
  }

  await chrome.storage.local.set({
    deferred,
    folders,
    [WORKSPACE_SNAPSHOTS_KEY]: workspaceSnapshots,
  });
  return imported;
}

async function exportTabAtlasBackup() {
  const backup = await buildTabAtlasBackup();
  downloadBackupFile(backup);
  const savedCount = backup.data.deferred.length;
  const folderCount = backup.data.folders.length;
  const workspaceCount = backup.data.workspaceSnapshots.length;
  showToast(`Exported ${savedCount} saved tabs, ${folderCount} folders, ${workspaceCount} workspaces`);
}

function openBackupMenu(x, y) {
  showContextMenu(x, y, [
    { heading: true, label: 'Backup' },
    { label: 'Export backup', onClick: exportTabAtlasBackup },
    {
      label: 'Import backup',
      onClick: () => {
        const input = document.getElementById('backupImportInput');
        if (input) input.click();
      },
    },
  ]);
}

async function importTabAtlasBackupFile(file) {
  try {
    const backup = await parseBackupFile(file);
    const summary = await mergeBackupData(backup);
    await refreshSavedAndFolders();
    await renderWorkspacePanel();
    updateLayoutWidth();
    positionWorkspaceDrawer();
    showToast(`Imported ${summary.savedTabs} saved tabs, ${summary.folders} folders, ${summary.workspaces} workspaces · skipped ${summary.skipped} duplicates`);
  } catch (err) {
    console.warn('[tab-atlas] Backup import failed:', err);
    showToast(err?.message || 'Could not import backup');
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

async function renameTabGroup(groupId) {
  if (!chrome.tabGroups) return;
  let group;
  try { group = await chrome.tabGroups.get(groupId); } catch { return; }
  const current = group.title || 'Tab group';
  const title = (window.prompt('Group name', current) || '').trim();
  if (!title) return;
  await chrome.tabGroups.update(groupId, { title });
  await renderTabGroupsBar();
  showToast(`Renamed group to “${title}”`);
}

function openTabGroupColorMenu(x, y, groupId) {
  const items = Object.keys(CHROME_GROUP_COLORS).map(name => ({
    label: name[0].toUpperCase() + name.slice(1),
    swatchColor: groupColorToHex(name) || '#9aa0a6',
    onClick: async () => {
      try {
        await chrome.tabGroups.update(groupId, { color: name });
        await renderTabGroupsBar();
        showToast(`Group color: ${name}`);
      } catch {}
    },
  }));
  showContextMenu(x, y, items);
}

/**
 * renderTabGroupsBar()
 *
 * Shows the currently-open Chrome tab groups as a compact control center.
 * It keeps the original group → folder conversion, and adds live native
 * controls: focus, collapse/expand, rename and recolor.
 */
async function renderTabGroupsBar() {
  const bar     = document.getElementById('tabGroupsBar');
  const chipsEl = document.getElementById('tabGroupsBarChips');
  if (!bar || !chipsEl) return;

  let groups = [];
  try { if (typeof chrome !== 'undefined' && chrome.tabGroups) groups = await chrome.tabGroups.query({}); } catch {}

  if (!groups.length) {
    bar.style.display = 'none';
    updateLayoutWidth();
    return;
  }

  const withCounts = [];
  for (const group of groups) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({ groupId: group.id }); } catch {}
    withCounts.push({ group, tabs });
  }

  chipsEl.innerHTML = withCounts.map(({ group, tabs }) => {
    const hex  = groupColorToHex(group.color) || '#9aa0a6';
    const name = escapeHtml(group.title || 'Untitled group');
    const actionLabel = group.collapsed ? 'Expand group' : 'Collapse group';
    const collapseText = group.collapsed ? '+' : '-';
    return `<div class="group-control" data-group-id="${group.id}">
      <div class="group-control-edge" style="background:${hex}"></div>
      <div class="group-control-main" title="${name}">
        <span class="group-chip-name">${name}</span>
        <span class="group-chip-count">${tabs.length}</span>
      </div>
      <button class="group-control-btn" data-action="start-focus-sweep-group" data-group-id="${group.id}" title="Sweep group" aria-label="Sweep ${name}" type="button">W</button>
      <button class="group-control-btn" data-action="toggle-tab-group-collapse" data-group-id="${group.id}" title="${actionLabel}" aria-label="${actionLabel}" type="button">${collapseText}</button>
      <button class="group-control-btn" data-action="rename-tab-group" data-group-id="${group.id}" title="Rename group" aria-label="Rename ${name}" type="button">R</button>
      <button class="group-control-btn group-color-btn" data-action="group-color-menu" data-group-id="${group.id}" title="Group color" aria-label="Change color for ${name}" type="button"><span style="background:${hex}"></span></button>
      <button class="group-control-btn" data-action="group-to-folder" data-group-id="${group.id}" title="Save group as folder" aria-label="Save ${name} as folder" type="button">S</button>
    </div>`;
  }).join('');
  bar.style.display = 'block';
  positionTabGroupsDock();
  updateLayoutWidth();
}

function positionTabGroupsDock() {
  const dock = document.getElementById('tabGroupsBar');
  if (!dock || dock.style.display === 'none') return;

  if (window.innerWidth <= 800) {
    dock.style.left = '16px';
    dock.style.right = '16px';
    dock.style.top = 'auto';
    dock.style.bottom = '18px';
    return;
  }

  const folders = document.getElementById('foldersColumn');
  const deferred = document.getElementById('deferredColumn');
  const openTabs = document.getElementById('openTabsSection');
  const anchor = folders && folders.style.display !== 'none'
    ? folders
    : (deferred && deferred.style.display !== 'none' ? deferred : openTabs);
  const rect = anchor ? anchor.getBoundingClientRect() : null;
  const dockWidth = Math.max(dock.offsetWidth || 0, 240);
  const gap = 10;
  const viewportPad = 14;
  const left = rect
    ? Math.min(rect.right + gap, window.innerWidth - dockWidth - viewportPad)
    : window.innerWidth - dockWidth - viewportPad;
  const top = rect ? Math.max(72, rect.top + 36) : 120;

  dock.style.left = `${Math.max(viewportPad, left)}px`;
  dock.style.right = 'auto';
  dock.style.top = `${top}px`;
  dock.style.bottom = 'auto';
}

function workspaceCornerReserve() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const buttons = Array.from(document.querySelectorAll('.corner-btn'))
    .filter(button => {
      const style = window.getComputedStyle(button);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  const leftEdges = buttons
    .map(button => button.getBoundingClientRect().left)
    .filter(value => Number.isFinite(value));
  if (!leftEdges.length) return 18;

  const workspaceWidth = viewportWidth <= 700 ? 112 : 138;
  const reserve = Math.ceil(viewportWidth - Math.min(...leftEdges) + 12);
  const maxReserve = Math.max(16, viewportWidth - workspaceWidth - 12);
  return Math.min(Math.max(18, reserve), maxReserve);
}

function positionWorkspaceDrawer() {
  const shell = document.getElementById('workspacePanel');
  if (!shell) return;

  if (window.innerWidth <= 700) {
    shell.style.setProperty('--workspace-inline-right', `${workspaceCornerReserve()}px`);
    return;
  }

  const folders = document.getElementById('foldersColumn');
  const container = document.querySelector('.container');
  const anchor = folders && folders.style.display !== 'none'
    ? folders
    : container;
  const rect = anchor ? anchor.getBoundingClientRect() : null;
  const baseRight = rect
    ? Math.max(18, Math.round(window.innerWidth - rect.right))
    : 18;
  const right = Math.max(baseRight, workspaceCornerReserve());
  shell.style.setProperty('--workspace-inline-right', `${right}px`);
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
const LANDING_PAGE_PATTERNS = [
  { hostname: 'mail.google.com', test: (p, h) =>
      !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
  { hostname: 'x.com',               pathExact: ['/home'] },
  { hostname: 'www.linkedin.com',    pathExact: ['/'] },
  { hostname: 'github.com',          pathExact: ['/'] },
  { hostname: 'www.youtube.com',     pathExact: ['/'] },
  // Merge personal patterns when a fork defines them before app.js.
  ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
];

function isLandingPageUrl(url) {
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

let domainGroups = [];

// Domain cards whose "+N more" overflow the user has expanded — remembered so
// re-renders (dedup, auto-refresh) keep them open instead of snapping shut.
const expandedOverflowCards = new Set();


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
  return openTabs.filter(t => !isInternalBrowserUrl(t.url));
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

function renderTabChip(tab, groupDomain, urlCounts = {}) {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), groupDomain || '');
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}

  const count    = urlCounts[tab.url] || 1;
  const safeUrl  = escapeHtml(tab.url || '');
  const dupeTag  = count > 1
    ? ` <button class="chip-dupe-badge" data-action="dedup-one-url" data-dupe-url="${safeUrl}" title="Close ${count - 1} duplicate${count - 1 !== 1 ? 's' : ''}, keep one">${count}×</button>`
    : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeTitle = escapeHtml(label);
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
}

function buildOverflowChips(hiddenTabs, urlCounts = {}, expanded = false) {
  const hiddenChips = hiddenTabs.map(tab => renderTabChip(tab, '', urlCounts)).join('');

  return `
    <div class="page-chips-overflow" style="display:${expanded ? 'contents' : 'none'}">${hiddenChips}</div>
    ${expanded ? '' : `<div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`}`;
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

  const pageChips = visibleTabs.map(tab => renderTabChip(tab, group.domain, urlCounts)).join('')
    + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts, expandedOverflowCards.has(stableId)) : '');

  let actionsHtml = `
    <button class="action-btn" data-action="start-focus-sweep-domain" data-domain-source="${escapeHtml(group.domain)}">
      Sweep
    </button>
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
      clearSavedSelection();
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
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" title="Dismiss" aria-label="Dismiss ${safeTitle}">
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
 * Marks which dashboard zones are visible so CSS Grid can choose a stable
 * responsive layout instead of relying on flex wrapping.
 */
function updateLayoutWidth() {
  const container = document.querySelector('.container');
  const dashboard  = document.getElementById('dashboardColumns');
  const sideRail   = document.getElementById('dashboardSideRail');
  const deferred  = document.getElementById('deferredColumn');
  const folders   = document.getElementById('foldersColumn');
  const hasDeferred = !!(deferred && deferred.style.display !== 'none');
  const hasFolders = !!(folders && folders.style.display !== 'none');
  const hasSideRail = hasDeferred || hasFolders;

  if (container) container.classList.toggle('dashboard-wide', hasSideRail);
  if (dashboard) {
    dashboard.classList.toggle('has-deferred', hasDeferred);
    dashboard.classList.toggle('has-folders', hasFolders);
    dashboard.classList.toggle('has-side-rail', hasSideRail);
  }
  if (sideRail) sideRail.style.display = hasSideRail ? '' : 'none';
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
  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules when a fork defines them before app.js.
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
      if (isLandingPageUrl(tab.url)) {
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
  updateSavedSelectionUI();

  // --- Open Chrome tab groups bar ---
  await renderTabGroupsBar();
  positionWorkspaceDrawer();

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
  const savedSelectItem = getSelectableSavedItem(e.target);
  if (savedSelectItem && (suppressNextSavedBrushClick || e.ctrlKey || e.metaKey || e.shiftKey)) {
    e.preventDefault();
    if (suppressNextSavedBrushClick) {
      suppressNextSavedBrushClick = false;
      return;
    }
    const id = savedSelectItem.dataset.deferredId;
    if (e.ctrlKey || e.metaKey) { toggleSavedSelect(id); return; }
    if (e.shiftKey)             { rangeSavedSelectTo(id); return; }
  }

  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // ---- Guided onboarding ----
  if (action === 'start-onboarding')  { startOnboarding({ manual: true });       return; }
  if (action === 'onboarding-skip')   { finishOnboarding({ skipped: true });     return; }
  if (action === 'onboarding-prev')   { moveOnboarding(-1);                      return; }
  if (action === 'onboarding-next')   { moveOnboarding(1);                       return; }

  // ---- Backup / import ----
  if (action === 'backup-menu') {
    e.stopPropagation();
    const rect = actionEl.getBoundingClientRect();
    openBackupMenu(rect.right, rect.bottom + 6);
    return;
  }

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

  // ---- Workspace snapshots ----
  if (action === 'toggle-workspace-drawer') {
    toggleWorkspaceDrawer();
    return;
  }
  if (action === 'save-workspace-snapshot') {
    await saveCurrentWorkspaceSnapshot();
    setWorkspaceDrawerOpen(true);
    return;
  }
  if (action === 'restore-workspace-snapshot') {
    await restoreWorkspaceSnapshot(actionEl.dataset.snapshotId);
    return;
  }
  if (action === 'rename-workspace-snapshot') {
    await renameWorkspaceSnapshot(actionEl.dataset.snapshotId);
    return;
  }
  if (action === 'delete-workspace-snapshot') {
    const id = actionEl.dataset.snapshotId;
    if (id && window.confirm('Delete this workspace snapshot?')) await deleteWorkspaceSnapshot(id);
    return;
  }

  // ---- Multi-select bulk actions ----
  if (action === 'select-clear') { clearSelection();        return; }
  if (action === 'select-close') { await closeSelectedTabs(); return; }
  if (action === 'select-save')  { await saveSelectedTabs(null); return; }
  if (action === 'select-move')  {
    const rect = actionEl.getBoundingClientRect();
    await openSelectionMoveMenu(rect.left, rect.top);
    return;
  }
  if (action === 'start-focus-sweep-selection') { await startFocusSweep('selection'); return; }
  if (action === 'start-focus-sweep-all')       { await startFocusSweep('all');       return; }
  if (action === 'start-focus-sweep-domain')    { await startFocusSweepV2({ scope: 'domain', sourceId: actionEl.dataset.domainSource || '' }); return; }
  if (action === 'start-focus-sweep-group')     { await startFocusSweepV2({ scope: 'group', sourceId: actionEl.dataset.groupId || '' }); return; }
  if (action === 'focus-sweep-mode-toggle')     { toggleFocusSweepMode();             return; }
  if (action === 'focus-sweep-keep')            { await keepFocusSweepTab();          return; }
  if (action === 'focus-sweep-prev')            { moveFocusSweepIndex(-1);            return; }
  if (action === 'focus-sweep-next')            { moveFocusSweepIndex(1);             return; }
  if (action === 'focus-sweep-save')            { await saveFocusSweepTab();          return; }
  if (action === 'focus-sweep-save-menu')       { await openFocusSweepSaveMenuFromButton(actionEl); return; }
  if (action === 'focus-sweep-close')           { await closeFocusSweepTab();         return; }
  if (action === 'focus-sweep-jump')            { await jumpToFocusSweepTab();        return; }
  if (action === 'focus-sweep-save-rest-domain'){ await stageFocusSweepRestFromDomain('save'); return; }
  if (action === 'focus-sweep-close-rest-domain'){ await stageFocusSweepRestFromDomain('close'); return; }
  if (action === 'focus-sweep-keep-rest-domain'){ await stageFocusSweepRestFromDomain('keep'); return; }
  if (action === 'focus-sweep-apply')           { await applyFocusSweepActions();     return; }
  if (action === 'focus-sweep-discard')         { discardFocusSweepActions();         return; }
  if (action === 'focus-sweep-exit')            { exitFocusSweep();                   return; }

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
  if (action === 'toggle-tab-group-collapse') {
    const gid = Number(actionEl.dataset.groupId);
    if (Number.isFinite(gid) && chrome.tabGroups) {
      try {
        const group = await chrome.tabGroups.get(gid);
        await chrome.tabGroups.update(gid, { collapsed: !group.collapsed });
        await renderTabGroupsBar();
      } catch {}
    }
    return;
  }
  if (action === 'rename-tab-group') {
    const gid = Number(actionEl.dataset.groupId);
    if (Number.isFinite(gid)) await renameTabGroup(gid);
    return;
  }
  if (action === 'group-color-menu') {
    const gid = Number(actionEl.dataset.groupId);
    if (Number.isFinite(gid)) {
      const rect = actionEl.getBoundingClientRect();
      openTabGroupColorMenu(rect.left, rect.bottom + 4, gid);
    }
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

  // ---- Expand overflow chips ("+N more") — remember it so re-renders keep it open ----
  if (action === 'expand-chips') {
    const expandCard = actionEl.closest('.mission-card');
    if (expandCard && expandCard.dataset.domainId) expandedOverflowCards.add(expandCard.dataset.domainId);
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
    if (suppressNextBrushClick) {
      suppressNextBrushClick = false;
      e.preventDefault();
      return;
    }
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
    const undoTabs = [tabUndoSnapshot(match || tabUrl)].filter(Boolean);
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
      await restoreUndoTabs(undoTabs);
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
    const undoTabs = [tabUndoSnapshot(match || tabUrl)].filter(Boolean);
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
      await restoreUndoTabs(undoTabs);
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
    showToast('Archived', async () => {
      await uncheckSavedTab(id);
      await refreshSavedAndFolders();
      flashItem(id);
    });
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
    const undoTabs  = group.tabs.map(tabUndoSnapshot).filter(Boolean);
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
      await restoreUndoTabs(undoTabs);
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

    const undoTabs = await closeDuplicateTabs([url], true);
    playCloseSound();
    await renderStaticDashboard();

    showToast(`Closed ${extras} duplicate${extras !== 1 ? 's' : ''}, kept one`, async () => {
      await restoreUndoTabs(undoTabs);
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
  const undoTabs = targets.map(tabUndoSnapshot).filter(Boolean);
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
    await restoreUndoTabs(undoTabs);
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
  updateSavedSelectionUI();
  positionWorkspaceDrawer();
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
 * openTabContextMenu(x, y, deferredIds)
 *
 * Builds the right-click menu for saved tabs: open, move to inbox/folder,
 * create a new folder, or remove. Accepts one id or a selected batch.
 */
async function openTabContextMenu(x, y, deferredIds) {
  const ids = [...new Set((Array.isArray(deferredIds) ? deferredIds : [deferredIds]).filter(Boolean))];
  if (!ids.length) return;

  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tabs = ids
    .map(id => deferred.find(t => t.id === id))
    .filter(tab => tab && !tab.dismissed);
  if (!tabs.length) return;

  const folders = await getFolders();
  const single = tabs.length === 1;
  const first = tabs[0];
  const tabIds = tabs.map(tab => tab.id);

  async function moveSavedSelection(folderId, label) {
    for (const id of tabIds) await moveTabToFolder(id, folderId);
    await refreshSavedAndFolders();
    clearSavedSelection();
    if (single) flashItem(first.id);
    showToast(label);
  }

  async function removeSavedSelection() {
    for (const id of tabIds) await dismissSavedTab(id);
    await refreshSavedAndFolders();
    clearSavedSelection();
    showToast(single ? 'Removed' : `Removed ${tabIds.length}`, async () => {
      for (const id of tabIds) await undismissSavedTab(id);
      await refreshSavedAndFolders();
      flashItem(first.id);
    });
  }

  const items = [];
  if (!single) items.push({ heading: true, label: `${tabs.length} selected` });
  items.push({
    label: single ? 'Open in new tab' : `Open ${tabs.length} in new tabs`,
    onClick: async () => {
      for (const tab of tabs) {
        if (tab.url) {
          try { await chrome.tabs.create({ url: tab.url, active: single }); } catch {}
        }
      }
      showToast(single ? 'Opened saved tab' : `Opened ${tabs.length} saved tabs`);
    },
  });
  items.push({ separator: true });
  items.push({ heading: true, label: 'Move to' });

  if (tabs.some(tab => tab.folderId)) {
    items.push({ label: '↩  Inbox', onClick: async () => {
      await moveSavedSelection(null, single ? 'Moved to inbox' : `Moved ${tabs.length} to inbox`);
    }});
  }
  for (const f of folders) {
    if (tabs.every(tab => tab.folderId === f.id)) continue;
    items.push({ label: '🗂  ' + f.name, onClick: async () => {
      await moveSavedSelection(f.id, single ? `Moved to “${f.name}”` : `Moved ${tabs.length} to “${f.name}”`);
    }});
  }
  items.push({ label: '＋  New folder…', onClick: async () => {
    const name = (window.prompt('New folder name:') || '').trim();
    if (!name) return;
    const folder = await createFolder(name);
    if (folder) {
      await moveSavedSelection(folder.id, single ? `Moved to “${folder.name}”` : `Moved ${tabs.length} to “${folder.name}”`);
    }
  }});
  items.push({ separator: true });
  items.push({ label: single ? 'Remove' : `Remove ${tabs.length}`, danger: true, onClick: removeSavedSelection });

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
  const speedTile = e.target.closest('.speed-tile[data-action="speeddial-open"]');
  if (speedTile) {
    e.preventDefault();
    const id = speedTile.dataset.id;
    showContextMenu(e.clientX, e.clientY, [
      { label: 'Edit',   onClick: () => openSpeedDialDialog(id) },
      { label: 'Remove', danger: true, onClick: () => removeSpeedDial(id) },
    ]);
  } else if (item) {
    e.preventDefault();
    const id = item.dataset.deferredId;
    if (!selectedSavedIds.has(id)) {
      clearSavedSelection();
      selectedSavedIds.add(id);
      lastSavedSelectAnchorId = id;
      updateSavedSelectionUI();
    }
    await openTabContextMenu(e.clientX, e.clientY, [...selectedSavedIds]);
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
  const workspaceDrawer = document.getElementById('workspaceDrawer');
  if (workspaceDrawer && workspaceDrawer.style.display !== 'none' && !e.target.closest('#workspacePanel')) {
    setWorkspaceDrawerOpen(false);
  }
  // Close dialogs when clicking their backdrop
  const fd = document.getElementById('folderDeleteDialog');
  if (fd && fd.style.display !== 'none' && e.target === fd) closeFolderDeleteDialog();
  const cd = document.getElementById('closeAllDialog');
  if (cd && cd.style.display !== 'none' && e.target === cd) closeCloseAllDialog();
  const sd = document.getElementById('speedDialDialog');
  if (sd && sd.style.display !== 'none' && e.target === sd) closeSpeedDialDialog();
});

// Enter saves / Escape closes the speed-dial editor inputs
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t || (t.id !== 'speedDialLabelInput' && t.id !== 'speedDialUrlInput')) return;
  if (e.key === 'Enter')  { e.preventDefault(); saveSpeedDialFromDialog(); }
  if (e.key === 'Escape') { e.preventDefault(); closeSpeedDialDialog(); }
});

document.addEventListener('keydown', (e) => {
  if (!handleOnboardingKeydown(e)) return;
  e.stopImmediatePropagation();
}, true);

document.addEventListener('keydown', async (e) => {
  if (!focusSweep.active) return;

  const menu = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none') {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeContextMenu();
    }
    return;
  }

  const key = e.key;
  let action = null;

  if (key === 'Escape') action = () => exitFocusSweep();
  else if (key === ' ' || key === 'j' || key === 'J' || key === 'ArrowRight') action = () => keepFocusSweepTab();
  else if (key === 'k' || key === 'K' || key === 'ArrowLeft') action = () => moveFocusSweepIndex(-1);
  else if ((key === 's' || key === 'S') && e.shiftKey) action = () => openFocusSweepSaveMenuFromButton();
  else if (key === 's' || key === 'S') action = () => saveFocusSweepTab();
  else if (key === 'x' || key === 'X' || key === 'Delete') action = () => closeFocusSweepTab();
  else if (key === 'Enter') action = () => jumpToFocusSweepTab();

  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  await action();
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
  const sd = document.getElementById('speedDialDialog');
  if (sd && sd.style.display !== 'none') { closeSpeedDialDialog(); closed = true; }
  const drawer = document.getElementById('workspaceDrawer');
  if (drawer && drawer.style.display !== 'none') { setWorkspaceDrawerOpen(false); closed = true; }
  if (!closed && (selectedTabUrls.size || selectedSavedIds.size)) {
    clearSelection();
    clearSavedSelection();
    closed = true;
  }
  if (!closed) setPrivacy(true);
});

window.addEventListener('scroll', () => {
  closeContextMenu();
  positionTabGroupsDock();
  positionWorkspaceDrawer();
  scheduleOnboardingPosition();
}, true);
window.addEventListener('resize', () => {
  positionTabGroupsDock();
  positionWorkspaceDrawer();
  scheduleOnboardingPosition();
});


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

document.addEventListener('change', (e) => {
  if (e.target.id !== 'backupImportInput') return;
  const [file] = e.target.files || [];
  e.target.value = '';
  if (file) importTabAtlasBackupFile(file);
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
  { id: 'tokyonight', label: 'Tokyo Night',      color: '#7aa2f7', group: 'dark' },
  { id: 'mocha',      label: 'Catppuccin Mocha', color: '#cba6f7', group: 'dark' },
  { id: 'monokai',    label: 'Monokai',          color: '#a6e22e', group: 'dark' },
  { id: 'obsidian',   label: 'Obsidian',         color: '#818cf8', group: 'dark' },
  { id: 'paper',      label: 'Paper (light)',    color: '#c0623a', group: 'light' },
  { id: 'latte',      label: 'Catppuccin Latte', color: '#8839ef', group: 'light' },
  { id: 'papersoft',  label: 'Paper Soft',       color: '#b85c33', group: 'light' },
  { id: 'lattesoft',  label: 'Latte Soft',       color: '#8839ef', group: 'light' },
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
   MULTI-SELECT — pick several open tabs, then act on them in bulk

   Ctrl/⌘-click toggles a tab into the selection; Shift-click selects a
   range. A floating bar offers Close / Save for later / Move to folder.
   Selection is keyed by URL so it survives re-renders (a background tab
   updating its favicon won't lose your picks).
   ---------------------------------------------------------------- */

const selectedTabUrls = new Set();
let lastSelectAnchorUrl = null;
const selectedSavedIds = new Set();
let lastSavedSelectAnchorId = null;

// Every open-tab chip that can be focused/selected (includes hidden overflow)
function allSelectableChips() {
  return Array.from(document.querySelectorAll('#openTabsMissions .page-chip[data-action="focus-tab"]'));
}

function allSelectableSavedItems() {
  return Array.from(document.querySelectorAll('.deferred-item[data-deferred-id]'));
}

function getSelectableSavedItem(target) {
  if (!target || target.closest('.deferred-checkbox, .deferred-dismiss, button')) return null;
  return target.closest('.deferred-item[data-deferred-id]');
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

function updateSavedSelectionUI() {
  const items   = allSelectableSavedItems();
  const present = new Set(items.map(item => item.dataset.deferredId));
  for (const id of [...selectedSavedIds]) if (!present.has(id)) selectedSavedIds.delete(id);

  items.forEach(item => {
    item.classList.toggle('selected', selectedSavedIds.has(item.dataset.deferredId));
  });

  if (!selectedSavedIds.size) lastSavedSelectAnchorId = null;
}

function clearSelection() { selectedTabUrls.clear(); updateSelectionUI(); }

function clearSavedSelection() {
  selectedSavedIds.clear();
  updateSavedSelectionUI();
}

function toggleSelect(url) {
  if (!url) return;
  if (selectedSavedIds.size) clearSavedSelection();
  if (selectedTabUrls.has(url)) selectedTabUrls.delete(url);
  else                          selectedTabUrls.add(url);
  lastSelectAnchorUrl = url;
  updateSelectionUI();
}

// Shift-click: select every visible chip between the anchor and this one
function rangeSelectTo(url) {
  if (!url) return;
  if (selectedSavedIds.size) clearSavedSelection();
  const urls = allSelectableChips().filter(c => c.offsetParent !== null).map(c => c.dataset.tabUrl);
  const b = urls.indexOf(url);
  if (b === -1) { toggleSelect(url); return; }
  const a = lastSelectAnchorUrl ? urls.indexOf(lastSelectAnchorUrl) : -1;
  if (a === -1) { toggleSelect(url); return; }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) selectedTabUrls.add(urls[i]);
  updateSelectionUI();
}

function toggleSavedSelect(id) {
  if (!id) return;
  if (selectedTabUrls.size) clearSelection();
  if (selectedSavedIds.has(id)) selectedSavedIds.delete(id);
  else                          selectedSavedIds.add(id);
  lastSavedSelectAnchorId = id;
  updateSavedSelectionUI();
}

function rangeSavedSelectTo(id) {
  if (!id) return;
  if (selectedTabUrls.size) clearSelection();
  const ids = allSelectableSavedItems()
    .filter(item => item.offsetParent !== null)
    .map(item => item.dataset.deferredId);
  const b = ids.indexOf(id);
  if (b === -1) { toggleSavedSelect(id); return; }
  const a = lastSavedSelectAnchorId ? ids.indexOf(lastSavedSelectAnchorId) : -1;
  if (a === -1) { toggleSavedSelect(id); return; }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) selectedSavedIds.add(ids[i]);
  updateSavedSelectionUI();
}

// Chrome tab ids for the currently-selected URLs (a URL may match several tabs)
/**
 * closeSelectedTabs()
 *
 * Closes every selected tab at once, with confetti and an Undo that
 * reopens them.
 */
async function closeSelectedTabs() {
  const urls = [...selectedTabUrls];
  if (!urls.length) return;
  const urlSet = new Set(selectedTabUrls);
  const allTabs = await chrome.tabs.query({});
  const targets = allTabs.filter(t => urlSet.has(t.url));
  const ids = targets.map(t => t.id);
  const undoTabs = targets.map(tabUndoSnapshot).filter(Boolean);
  if (!ids.length) { clearSelection(); return; }

  try { await chrome.tabs.remove(ids); } catch {}
  await fetchOpenTabs();
  playCloseSound();

  const bar = document.getElementById('selectionBar');
  if (bar) { const r = bar.getBoundingClientRect(); shootConfetti(r.left + r.width / 2, r.top); }

  clearSelection();
  await renderStaticDashboard();
  showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''}`, async () => {
    await restoreUndoTabs(undoTabs);
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

  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const targets = allTabs.filter(t => urlSet.has(t.url));
  const undoTabs = targets.map(tabUndoSnapshot).filter(Boolean);
  const titleFor = (u) => {
    const t = targets.find(x => x.url === u) || openTabs.find(x => x.url === u);
    return t ? (t.title || u) : u;
  };
  const savedIds = [];
  for (const u of urls) {
    try { savedIds.push(await saveTabForLater({ url: u, title: titleFor(u) }, folderId || null)); } catch {}
  }

  const ids = targets.map(t => t.id);
  if (ids.length) { try { await chrome.tabs.remove(ids); } catch {} }
  await fetchOpenTabs();

  clearSelection();
  await renderStaticDashboard();

  const dest = folderName ? `“${folderName}”` : 'inbox';
  showToast(`Saved ${urls.length} tab${urls.length !== 1 ? 's' : ''} to ${dest}`, async () => {
    await restoreUndoTabs(undoTabs);
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
   FOCUS SWEEP — keyboard triage for open tabs
   ---------------------------------------------------------------- */

const FOCUS_SWEEP_MODE_KEY = 'focusSweepActionMode';

const focusSweep = {
  active: false,
  queue: [],
  index: 0,
  scope: 'all',
  scopeLabel: 'All tabs sweep',
  actionMode: 'review',
  saveFolderId: null,
  saveFolderName: 'Inbox',
  stagedActions: new Map(),
  reviewedIds: new Set(),
  selfActionIds: new Set(),
  busyAction: false,
  applied: false,
  appliedSummary: null,
  kept: 0,
  closed: 0,
  saved: 0,
  skipped: 0,
  batchSkipped: 0,
  lastFocusEl: null,
};

let focusSweepGoneTimer = null;
let focusSweepVerifyToken = 0;

function resetFocusSweepState() {
  focusSweep.active = false;
  focusSweep.queue = [];
  focusSweep.index = 0;
  focusSweep.scope = 'all';
  focusSweep.scopeLabel = 'All tabs sweep';
  focusSweep.actionMode = getFocusSweepModePreference();
  focusSweep.saveFolderId = null;
  focusSweep.saveFolderName = 'Inbox';
  focusSweep.stagedActions = new Map();
  focusSweep.reviewedIds = new Set();
  focusSweep.selfActionIds = new Set();
  focusSweep.busyAction = false;
  focusSweep.applied = false;
  focusSweep.appliedSummary = null;
  focusSweep.kept = 0;
  focusSweep.closed = 0;
  focusSweep.saved = 0;
  focusSweep.skipped = 0;
  focusSweep.batchSkipped = 0;
  focusSweep.lastFocusEl = null;
  clearTimeout(focusSweepGoneTimer);
}

function getFocusSweepModePreference() {
  try {
    const mode = localStorage.getItem(FOCUS_SWEEP_MODE_KEY);
    return mode === 'instant' ? 'instant' : 'review';
  } catch {
    return 'review';
  }
}

function setFocusSweepModePreference(mode) {
  try { localStorage.setItem(FOCUS_SWEEP_MODE_KEY, mode === 'instant' ? 'instant' : 'review'); } catch {}
}

function focusSweepDomainLabel(url) {
  try { return friendlyDomain(new URL(url).hostname); }
  catch { return 'Unknown'; }
}

function focusSweepDomainKey(url) {
  try {
    if (url && url.startsWith('file://')) return 'local-files';
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizeFocusSweepUrl(url) {
  return (url || '').trim();
}

function currentFocusSweepItem() {
  return focusSweep.queue[focusSweep.index] || null;
}

async function getFocusSweepGroupMetaMap() {
  const map = new Map();
  try {
    if (!chrome.tabGroups) return map;
    const groups = await chrome.tabGroups.query({});
    for (const group of groups) map.set(group.id, group);
  } catch {}
  return map;
}

function toFocusSweepItem(tab, groupMetaMap = new Map()) {
  const normalizedUrl = normalizeFocusSweepUrl(tab.url);
  const groupId = Number.isFinite(tab.groupId) ? tab.groupId : -1;
  return {
    id:             tab.id,
    url:            tab.url,
    title:          tab.title || tab.url || 'Untitled tab',
    windowId:       tab.windowId,
    index:          Number.isFinite(tab.index) ? tab.index : 0,
    groupId,
    domain:         focusSweepDomainKey(tab.url),
    normalizedUrl,
    pinned:         !!tab.pinned,
    audible:        !!tab.audible,
    mutedInfo:      tab.mutedInfo || null,
    discarded:      !!tab.discarded,
    incognito:      !!tab.incognito,
    active:         !!tab.active,
    favIconUrl:     tab.favIconUrl || '',
    groupMeta:      groupId >= 0 ? (groupMetaMap.get(groupId) || null) : null,
    gone:           false,
  };
}

function focusSweepItemsFromTabs(tabs, groupMetaMap) {
  return tabs
    .filter(tab => Number.isFinite(tab.id))
    .map(tab => toFocusSweepItem(tab, groupMetaMap));
}

function focusSweepDomainGroup(sourceId) {
  return domainGroups.find(group => group.domain === sourceId) || null;
}

function focusSweepSelectionQueue(tabs, groupMetaMap) {
  if (!selectedTabUrls.size) return [];
  const selectedUrls = new Set(selectedTabUrls);
  const byUrl = new Map();
  for (const tab of tabs) {
    if (!selectedUrls.has(tab.url)) continue;
    if (!byUrl.has(tab.url)) byUrl.set(tab.url, []);
    byUrl.get(tab.url).push(tab);
  }

  const usedIds = new Set();
  const queue = [];
  const orderedUrls = allSelectableChips()
    .map(chip => chip.dataset.tabUrl)
    .filter(url => selectedUrls.has(url));

  for (const url of orderedUrls) {
    const matches = byUrl.get(url) || [];
    for (const tab of matches) {
      if (usedIds.has(tab.id)) continue;
      usedIds.add(tab.id);
      queue.push(toFocusSweepItem(tab, groupMetaMap));
    }
  }

  return queue;
}

async function buildFocusSweepQueueV2({ scope = 'all', sourceId = '' } = {}) {
  const tabs = getRealTabs().filter(tab => Number.isFinite(tab.id));
  const groupMetaMap = await getFocusSweepGroupMetaMap();
  let queue = [];
  let label = 'All tabs sweep';

  if (scope === 'selection') {
    queue = focusSweepSelectionQueue(tabs, groupMetaMap);
    label = 'Selection sweep';
  } else if (scope === 'domain') {
    const group = focusSweepDomainGroup(sourceId);
    let sourceTabs = tabs.filter(tab => focusSweepDomainKey(tab.url) === sourceId);
    if (group?.domain === '__landing-pages__') {
      sourceTabs = tabs.filter(tab => isLandingPageUrl(tab.url));
    } else if (group?.label) {
      const ids = new Set((group.tabs || []).map(tab => tab.id));
      sourceTabs = tabs.filter(tab => ids.has(tab.id));
    }
    queue = focusSweepItemsFromTabs(sourceTabs, groupMetaMap);
    label = group
      ? `${group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain))} sweep`
      : `${friendlyDomain(sourceId)} sweep`;
  } else if (scope === 'group') {
    const groupId = Number(sourceId);
    const group = groupMetaMap.get(groupId);
    queue = focusSweepItemsFromTabs(tabs.filter(tab => tab.groupId === groupId), groupMetaMap);
    label = `${group?.title || 'Tab group'} group sweep`;
  } else {
    queue = focusSweepItemsFromTabs(tabs, groupMetaMap);
    label = 'All tabs sweep';
  }

  return { queue, label };
}

async function startFocusSweep(mode) {
  const scope = mode === 'selection' ? 'selection' : 'all';
  await startFocusSweepV2({ scope });
}

async function startFocusSweepV2({ scope = 'all', sourceId = '', actionMode = null, options = {} } = {}) {
  await fetchOpenTabs();
  const { queue, label } = await buildFocusSweepQueueV2({ scope, sourceId });
  if (!queue.length) {
    showToast('No tabs to sweep');
    return;
  }

  focusSweep.active = true;
  focusSweep.queue = queue;
  focusSweep.index = 0;
  focusSweep.scope = scope;
  focusSweep.scopeLabel = label;
  focusSweep.actionMode = actionMode === 'instant' || actionMode === 'review'
    ? actionMode
    : getFocusSweepModePreference();
  focusSweep.saveFolderId = options.folderId || null;
  focusSweep.saveFolderName = options.folderName || 'Inbox';
  focusSweep.stagedActions = new Map();
  focusSweep.reviewedIds = new Set();
  focusSweep.selfActionIds = new Set();
  focusSweep.busyAction = false;
  focusSweep.applied = false;
  focusSweep.appliedSummary = null;
  focusSweep.kept = 0;
  focusSweep.closed = 0;
  focusSweep.saved = 0;
  focusSweep.skipped = 0;
  focusSweep.batchSkipped = 0;
  focusSweep.lastFocusEl = document.activeElement;

  clearSelection();
  clearSavedSelection();

  const overlay = document.getElementById('focusSweepOverlay');
  document.documentElement.classList.add('focus-sweep-open');
  document.body.classList.add('focus-sweep-open');
  if (overlay) overlay.style.display = 'flex';
  renderFocusSweep();
  focusFocusSweepPrimary();
}

function exitFocusSweep() {
  const overlay = document.getElementById('focusSweepOverlay');
  if (overlay) overlay.style.display = 'none';
  document.documentElement.classList.remove('focus-sweep-open');
  document.body.classList.remove('focus-sweep-open');
  const previousFocus = focusSweep.lastFocusEl;
  resetFocusSweepState();
  if (previousFocus && typeof previousFocus.focus === 'function') {
    try { previousFocus.focus(); } catch {}
  }
}

function discardFocusSweepActions() {
  const hadActions = focusSweep.stagedActions.size > 0;
  exitFocusSweep();
  if (hadActions) showToast('Discarded staged actions');
}

function focusFocusSweepPrimary() {
  requestAnimationFrame(() => {
    const overlay = document.getElementById('focusSweepOverlay');
    if (!overlay || overlay.style.display === 'none') return;
    const primary = overlay.querySelector('[data-action="focus-sweep-keep"]');
    if (primary && typeof primary.focus === 'function') primary.focus();
  });
}

function focusSweepCounts() {
  if (focusSweep.appliedSummary) return focusSweep.appliedSummary;

  const staged = { kept: 0, saved: 0, closed: 0 };
  for (const action of focusSweep.stagedActions.values()) {
    if (action.type === 'keep') staged.kept += 1;
    if (action.type === 'save') staged.saved += 1;
    if (action.type === 'close') staged.closed += 1;
  }

  return {
    reviewed: focusSweep.reviewedIds.size,
    kept: focusSweep.kept + staged.kept,
    saved: focusSweep.saved + staged.saved,
    closed: focusSweep.closed + staged.closed,
    skipped: focusSweep.skipped + focusSweep.batchSkipped,
  };
}

function focusSweepPendingText() {
  if (focusSweep.applied) return 'Applied';
  const counts = { keep: 0, save: 0, close: 0 };
  for (const action of focusSweep.stagedActions.values()) {
    if (action.type === 'keep') counts.keep += 1;
    if (action.type === 'save') counts.save += 1;
    if (action.type === 'close') counts.close += 1;
  }
  const parts = [];
  if (counts.keep) parts.push(`${counts.keep} keep`);
  if (counts.save) parts.push(`${counts.save} save`);
  if (counts.close) parts.push(`${counts.close} close`);
  return parts.length ? `${parts.join(' · ')} staged` : 'No pending actions';
}

function focusSweepActionLabel(action) {
  if (!action) return '';
  if (action.type === 'keep') return 'Skipped';
  if (action.type === 'close') return 'Staged: Close';
  if (action.type === 'save') return `Staged: Save to ${action.folderName || 'Inbox'}`;
  return '';
}

function focusSweepRestFromCurrentDomain() {
  const item = currentFocusSweepItem();
  if (!item) return [];
  return focusSweep.queue.filter(entry => (
    entry.id !== item.id &&
    !entry.gone &&
    entry.domain === item.domain
  ));
}

function renderFocusSweep() {
  const overlay = document.getElementById('focusSweepOverlay');
  if (!overlay) return;

  const total = focusSweep.queue.length;
  const done = focusSweep.index >= total;
  const item = done ? null : currentFocusSweepItem();

  const scope = document.getElementById('focusSweepScope');
  const progress = document.getElementById('focusSweepProgress');
  const meter = document.getElementById('focusSweepMeterFill');
  const staged = document.getElementById('focusSweepStaged');
  const destination = document.getElementById('focusSweepDestination');
  const modeButton = document.getElementById('focusSweepMode');
  const body = document.getElementById('focusSweepBody');
  const contextActions = document.getElementById('focusSweepContextActions');
  const doneEl = document.getElementById('focusSweepDone');
  const doneTitle = document.getElementById('focusSweepDoneTitle');
  const doneMeta = document.getElementById('focusSweepDoneMeta');
  const favicon = document.getElementById('focusSweepFavicon');
  const domain = document.getElementById('focusSweepDomain');
  const pinned = document.getElementById('focusSweepPinned');
  const audible = document.getElementById('focusSweepAudible');
  const discarded = document.getElementById('focusSweepDiscarded');
  const group = document.getElementById('focusSweepGroup');
  const gone = document.getElementById('focusSweepGone');
  const title = document.getElementById('focusSweepTitle');
  const url = document.getElementById('focusSweepUrl');
  const actionState = document.getElementById('focusSweepActionState');

  overlay.classList.toggle('is-done', done);
  overlay.classList.toggle('is-busy', focusSweep.busyAction);

  if (scope) scope.textContent = focusSweep.scopeLabel;
  if (progress) progress.textContent = done ? `${total} of ${total}` : `${focusSweep.index + 1} of ${total}`;
  if (meter) meter.style.width = total ? `${Math.min(100, (Math.min(focusSweep.index + 1, total) / total) * 100)}%` : '0%';
  if (staged) staged.textContent = focusSweepPendingText();
  if (destination) destination.textContent = `Saving to: ${focusSweep.saveFolderName || 'Inbox'}`;
  if (modeButton) {
    modeButton.textContent = focusSweep.actionMode === 'instant' ? 'Instant' : 'Review';
    modeButton.setAttribute('aria-pressed', focusSweep.actionMode === 'instant' ? 'true' : 'false');
  }

  if (body) body.style.display = done ? 'none' : 'grid';
  if (contextActions) contextActions.style.display = done ? 'none' : 'flex';
  if (doneEl) doneEl.style.display = done ? 'block' : 'none';
  if (doneTitle) doneTitle.textContent = focusSweep.applied ? 'Applied' : 'Sweep complete';
  if (doneMeta) {
    const counts = focusSweepCounts();
    doneMeta.textContent =
      `${counts.reviewed} reviewed · ${counts.kept} left untouched · ${counts.saved} saved · ${counts.closed} closed · ${counts.skipped} skipped`;
  }

  if (!item) {
    setFocusSweepActionDisabled(true);
    renderFocusSweepDoneActions();
    return;
  }

  setFocusSweepActionDisabled(false);
  if (favicon) {
    const src = (item.favIconUrl || favIcon(item.url, 32)).replace(/&amp;/g, '&');
    favicon.style.display = src ? '' : 'none';
    favicon.src = src;
  }
  if (domain) domain.textContent = focusSweepDomainLabel(item.url);
  if (pinned) pinned.style.display = item.pinned ? '' : 'none';
  if (audible) audible.style.display = item.audible ? '' : 'none';
  if (discarded) discarded.style.display = item.discarded ? '' : 'none';
  if (group) {
    const label = item.groupMeta ? (item.groupMeta.title || 'Group') : '';
    group.textContent = label ? `Group: ${label}` : '';
    group.style.display = label ? '' : 'none';
  }
  if (gone) gone.style.display = item.gone ? '' : 'none';
  if (title) title.textContent = item.title || item.url || 'Untitled tab';
  if (url) url.textContent = item.url || '';
  if (actionState) {
    const label = focusSweepActionLabel(focusSweep.stagedActions.get(item.id));
    actionState.textContent = label;
    actionState.style.display = label ? '' : 'none';
  }

  renderFocusSweepContextLabels();
  renderFocusSweepDoneActions();

  if (!item.gone) verifyCurrentFocusSweepTab(item.id);
}

function renderFocusSweepContextLabels() {
  const overlay = document.getElementById('focusSweepOverlay');
  if (!overlay) return;
  const rest = focusSweepRestFromCurrentDomain();
  const actions = {
    'focus-sweep-save-rest-domain': rest.length ? `Save rest from domain (${rest.length})` : 'Save rest from domain',
    'focus-sweep-close-rest-domain': rest.length ? `Close rest from domain (${rest.length})` : 'Close rest from domain',
    'focus-sweep-keep-rest-domain': rest.length ? `Skip rest from domain (${rest.length})` : 'Skip rest from domain',
  };

  for (const [action, label] of Object.entries(actions)) {
    const button = overlay.querySelector(`[data-action="${action}"]`);
    if (button) button.textContent = label;
  }
}

function renderFocusSweepDoneActions() {
  const overlay = document.getElementById('focusSweepOverlay');
  if (!overlay) return;
  const done = focusSweep.index >= focusSweep.queue.length;
  const hasDestructive = [...focusSweep.stagedActions.values()].some(action => action.type === 'save' || action.type === 'close');
  const applyButtons = overlay.querySelectorAll('[data-action="focus-sweep-apply"]');
  applyButtons.forEach(button => {
    const inline = button.classList.contains('apply-inline');
    const shouldShow = !focusSweep.applied && focusSweep.actionMode === 'review' && hasDestructive;
    button.style.display = shouldShow && (inline ? !done : done) ? 'inline-flex' : 'none';
    button.disabled = focusSweep.busyAction;
  });

  const discard = overlay.querySelector('[data-action="focus-sweep-discard"]');
  if (discard) {
    discard.style.display = !focusSweep.applied && focusSweep.stagedActions.size ? '' : 'none';
    discard.disabled = focusSweep.busyAction;
  }

}

function setFocusSweepActionDisabled(done) {
  const overlay = document.getElementById('focusSweepOverlay');
  if (!overlay) return;
  const item = currentFocusSweepItem();
  const itemUnavailable = !item || item.gone;
  const disabled = done || focusSweep.busyAction || itemUnavailable;
  for (const action of [
    'focus-sweep-keep',
    'focus-sweep-save',
    'focus-sweep-save-menu',
    'focus-sweep-close',
    'focus-sweep-jump',
  ]) {
    const button = overlay.querySelector(`[data-action="${action}"]`);
    if (button) button.disabled = disabled;
  }

  const rest = focusSweepRestFromCurrentDomain();
  const contextual = {
    'focus-sweep-save-rest-domain': disabled || !rest.length,
    'focus-sweep-close-rest-domain': disabled || !rest.length,
    'focus-sweep-keep-rest-domain': disabled || !rest.length,
  };
  for (const [action, isDisabled] of Object.entries(contextual)) {
    const button = overlay.querySelector(`[data-action="${action}"]`);
    if (button) button.disabled = isDisabled;
  }

  const prev = overlay.querySelector('[data-action="focus-sweep-prev"]');
  if (prev) prev.disabled = !focusSweep.active || focusSweep.busyAction || focusSweep.index <= 0;
  const next = overlay.querySelector('[data-action="focus-sweep-next"]');
  if (next) next.disabled = !focusSweep.active || focusSweep.busyAction || focusSweep.index >= focusSweep.queue.length;
  const mode = overlay.querySelector('[data-action="focus-sweep-mode-toggle"]');
  if (mode) mode.disabled = focusSweep.busyAction;
}

async function verifyCurrentFocusSweepTab(tabId) {
  const token = ++focusSweepVerifyToken;
  let live = null;
  try { live = await chrome.tabs.get(tabId); } catch {}
  if (token !== focusSweepVerifyToken || !focusSweep.active) return;
  const current = currentFocusSweepItem();
  if (!current || current.id !== tabId || live) return;
  markFocusSweepTabGone(tabId);
}

function markFocusSweepTabGone(tabId) {
  if (focusSweep.selfActionIds.has(tabId)) {
    focusSweep.selfActionIds.delete(tabId);
    return;
  }

  const item = focusSweep.queue.find(entry => entry.id === tabId);
  if (!item || item.gone) return;
  item.gone = true;

  if (focusSweep.active && currentFocusSweepItem()?.id === tabId) {
    renderFocusSweep();
    clearTimeout(focusSweepGoneTimer);
    focusSweepGoneTimer = setTimeout(() => {
      if (!focusSweep.active || currentFocusSweepItem()?.id !== tabId) return;
      completeFocusSweepItem('skipped');
    }, 700);
  }
}

function completeFocusSweepItem(kind, { count = true } = {}) {
  const item = currentFocusSweepItem();
  if (item) focusSweep.reviewedIds.add(item.id);
  if (count) {
    if (kind === 'kept') focusSweep.kept += 1;
    if (kind === 'closed') focusSweep.closed += 1;
    if (kind === 'saved') focusSweep.saved += 1;
    if (kind === 'skipped') focusSweep.skipped += 1;
  }
  focusSweep.index = Math.min(focusSweep.index + 1, focusSweep.queue.length);
  skipAlreadyReviewedFocusSweepItems();
  renderFocusSweep();
}

function skipAlreadyReviewedFocusSweepItems() {
  while (
    focusSweep.index < focusSweep.queue.length &&
    focusSweep.reviewedIds.has(focusSweep.queue[focusSweep.index].id) &&
    focusSweep.stagedActions.has(focusSweep.queue[focusSweep.index].id)
  ) {
    focusSweep.index += 1;
  }
}

async function getCurrentFocusSweepLiveTab() {
  const item = currentFocusSweepItem();
  if (!item) return null;
  try {
    const tab = await chrome.tabs.get(item.id);
    if (!tab || isInternalBrowserUrl(tab.url)) throw new Error('Tab is unavailable');
    item.url = tab.url || item.url;
    item.title = tab.title || item.title;
    item.windowId = tab.windowId;
    item.index = Number.isFinite(tab.index) ? tab.index : item.index;
    item.groupId = Number.isFinite(tab.groupId) ? tab.groupId : -1;
    item.domain = focusSweepDomainKey(tab.url || item.url);
    item.normalizedUrl = normalizeFocusSweepUrl(tab.url || item.url);
    item.pinned = !!tab.pinned;
    item.audible = !!tab.audible;
    item.mutedInfo = tab.mutedInfo || null;
    item.discarded = !!tab.discarded;
    item.incognito = !!tab.incognito;
    item.active = !!tab.active;
    item.favIconUrl = tab.favIconUrl || item.favIconUrl || '';
    return tab;
  } catch {
    markFocusSweepTabGone(item.id);
    return null;
  }
}

function stageFocusSweepAction(item, type, folderId = null, options = {}) {
  if (!item || item.gone) return false;
  focusSweep.stagedActions.set(item.id, {
    type,
    folderId: type === 'save' ? (folderId || null) : null,
    folderName: type === 'save' ? (options.folderName || 'Inbox') : null,
  });
  focusSweep.reviewedIds.add(item.id);
  return true;
}

function isUnsafeFocusSweepBatchItem(item) {
  return !!(item && (item.pinned || item.audible || item.active));
}

async function runInstantFocusSweepBatch(items, type, options = {}) {
  if (focusSweep.busyAction) return;
  const usable = [];
  let skipped = 0;
  for (const item of items) {
    if (!item || item.gone) { skipped += 1; continue; }
    if (options.excludeUnsafe && isUnsafeFocusSweepBatchItem(item)) { skipped += 1; continue; }
    usable.push(item);
  }

  if (!usable.length) {
    if (skipped) focusSweep.batchSkipped += skipped;
    showToast(skipped ? `Skipped ${skipped} protected tab${skipped !== 1 ? 's' : ''}` : 'Nothing to apply');
    renderFocusSweep();
    return;
  }

  if (type === 'keep') {
    for (const item of usable) {
      focusSweep.reviewedIds.add(item.id);
      focusSweep.kept += 1;
    }
    if (skipped) focusSweep.batchSkipped += skipped;
    skipAlreadyReviewedFocusSweepItems();
    renderFocusSweep();
    showToast(`Skipped ${usable.length} tab${usable.length !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`);
    return;
  }

  focusSweep.busyAction = true;
  renderFocusSweep();

  const liveTabs = await chrome.tabs.query({});
  const liveById = new Map(liveTabs.map(tab => [tab.id, tab]));
  const closeIds = [];
  const undoTabs = [];
  const savedIds = [];
  let savedCount = 0;
  let closedCount = 0;

  for (const item of usable) {
    const tab = liveById.get(item.id);
    if (!tab || isInternalBrowserUrl(tab.url)) { skipped += 1; continue; }
    if (type === 'save') {
      try {
        const id = await saveTabForLater({ url: tab.url, title: tab.title || item.title }, options.folderId || null);
        savedIds.push(id);
        undoTabs.push(tabUndoSnapshot(tab));
        closeIds.push(tab.id);
        focusSweep.selfActionIds.add(tab.id);
        focusSweep.reviewedIds.add(tab.id);
        savedCount += 1;
      } catch {
        skipped += 1;
      }
    } else {
      undoTabs.push(tabUndoSnapshot(tab));
      closeIds.push(tab.id);
      focusSweep.selfActionIds.add(tab.id);
      focusSweep.reviewedIds.add(tab.id);
      closedCount += 1;
    }
  }

  if (closeIds.length) {
    try { await chrome.tabs.remove([...new Set(closeIds)]); } catch {}
    playCloseSound();
  }

  if (type === 'save') focusSweep.saved += savedCount;
  if (type === 'close') focusSweep.closed += closedCount;
  if (skipped) focusSweep.batchSkipped += skipped;

  await fetchOpenTabs();
  await renderStaticDashboard();
  focusSweep.busyAction = false;
  skipAlreadyReviewedFocusSweepItems();
  renderFocusSweep();

  const appliedCount = type === 'save' ? savedCount : closedCount;
  const actionLabel = type === 'save' ? 'Saved' : 'Closed';
  showToast(`${actionLabel} ${appliedCount} tab${appliedCount !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`, async () => {
    await restoreUndoTabs(undoTabs);
    for (const id of savedIds) { try { await dismissSavedTab(id); } catch {} }
    await fetchOpenTabs();
    await renderStaticDashboard();
  });
}

async function stageFocusSweepItems(items, type, options = {}) {
  if (focusSweep.actionMode === 'instant') {
    await runInstantFocusSweepBatch(items, type, options);
    return;
  }

  let staged = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item || item.gone) { skipped += 1; continue; }
    if (options.excludeUnsafe && isUnsafeFocusSweepBatchItem(item)) { skipped += 1; continue; }
    if (stageFocusSweepAction(item, type, options.folderId || focusSweep.saveFolderId, {
      folderName: options.folderName || focusSweep.saveFolderName,
    })) staged += 1;
  }

  if (skipped) focusSweep.batchSkipped += skipped;
  skipAlreadyReviewedFocusSweepItems();
  renderFocusSweep();

  const label = type === 'keep' ? 'Skipped' : type === 'save' ? 'Staged save for' : 'Staged close for';
  showToast(`${label} ${staged} tab${staged !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`);
}

async function keepFocusSweepTab() {
  if (!focusSweep.active) return;
  const tab = await getCurrentFocusSweepLiveTab();
  if (!tab) return;
  const item = currentFocusSweepItem();
  if (focusSweep.actionMode === 'review' && item) {
    stageFocusSweepAction(item, 'keep');
    completeFocusSweepItem('kept', { count: false });
    return;
  }
  completeFocusSweepItem('kept', { count: true });
}

function moveFocusSweepIndex(delta) {
  if (!focusSweep.active || !focusSweep.queue.length || focusSweep.busyAction) return;
  focusSweep.index = Math.max(0, Math.min(focusSweep.queue.length, focusSweep.index + delta));
  renderFocusSweep();
}

async function saveFocusSweepTab() {
  if (!focusSweep.active || focusSweep.busyAction) return;
  const item = currentFocusSweepItem();
  const tab = await getCurrentFocusSweepLiveTab();
  if (!item || !tab) return;

  if (focusSweep.actionMode === 'review') {
    stageFocusSweepAction(item, 'save', focusSweep.saveFolderId, { folderName: focusSweep.saveFolderName });
    completeFocusSweepItem('saved', { count: false });
    return;
  }

  focusSweep.busyAction = true;
  renderFocusSweep();

  let savedId = null;
  const undoTabs = [tabUndoSnapshot(tab)].filter(Boolean);
  try {
    savedId = await saveTabForLater({ url: tab.url, title: tab.title || item.title }, focusSweep.saveFolderId);
    focusSweep.selfActionIds.add(tab.id);
    await chrome.tabs.remove(tab.id);
    await fetchOpenTabs();
    await renderStaticDashboard();
    completeFocusSweepItem('saved');
    showToast(`Saved tab to ${focusSweep.saveFolderName || 'Inbox'}`, async () => {
      await restoreUndoTabs(undoTabs);
      if (savedId) { try { await dismissSavedTab(savedId); } catch {} }
      await fetchOpenTabs();
      await renderStaticDashboard();
    });
  } catch {
    showToast('Could not save tab');
  } finally {
    focusSweep.busyAction = false;
    renderFocusSweep();
  }
}

async function closeFocusSweepTab() {
  if (!focusSweep.active || focusSweep.busyAction) return;
  const item = currentFocusSweepItem();
  const tab = await getCurrentFocusSweepLiveTab();
  if (!item || !tab) return;

  if (focusSweep.actionMode === 'review') {
    stageFocusSweepAction(item, 'close');
    completeFocusSweepItem('closed', { count: false });
    return;
  }

  focusSweep.busyAction = true;
  renderFocusSweep();

  const undoTabs = [tabUndoSnapshot(tab)].filter(Boolean);
  try {
    focusSweep.selfActionIds.add(tab.id);
    await chrome.tabs.remove(tab.id);
    await fetchOpenTabs();
    await renderStaticDashboard();
    playCloseSound();
    completeFocusSweepItem('closed');
    showToast('Closed tab', async () => {
      await restoreUndoTabs(undoTabs);
      await fetchOpenTabs();
      await renderStaticDashboard();
    });
  } catch {
    showToast('Could not close tab');
  } finally {
    focusSweep.busyAction = false;
    renderFocusSweep();
  }
}

async function jumpToFocusSweepTab() {
  if (!focusSweep.active || focusSweep.busyAction) return;
  const tab = await getCurrentFocusSweepLiveTab();
  if (!tab) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    showToast('Could not jump to tab');
  }
}

async function stageFocusSweepRestFromDomain(type) {
  if (!focusSweep.active) return;
  const rest = focusSweepRestFromCurrentDomain();
  if (!rest.length) {
    showToast('No more tabs from this domain');
    return;
  }
  await stageFocusSweepItems(rest, type, {
    excludeUnsafe: type === 'save' || type === 'close',
    folderId: focusSweep.saveFolderId,
    folderName: focusSweep.saveFolderName,
  });
}

function toggleFocusSweepMode() {
  if (!focusSweep.active || focusSweep.busyAction) return;
  const next = focusSweep.actionMode === 'instant' ? 'review' : 'instant';
  if (next === 'instant' && focusSweep.stagedActions.size) {
    showToast('Apply or discard staged actions first');
    return;
  }
  focusSweep.actionMode = next;
  setFocusSweepModePreference(next);
  renderFocusSweep();
}

async function openFocusSweepSaveMenuFromButton(button = null) {
  if (!focusSweep.active) return;
  const target = button || document.querySelector('[data-action="focus-sweep-save-menu"]');
  const rect = target ? target.getBoundingClientRect() : { left: window.innerWidth / 2, bottom: window.innerHeight / 2 };
  await openFocusSweepSaveMenu(rect.left, rect.bottom + 4);
}

async function openFocusSweepSaveMenu(x, y) {
  const folders = await getFolders();
  const items = [
    { label: 'Save to Inbox', onClick: () => setFocusSweepSaveDestination(null, 'Inbox') },
  ];
  if (folders.length) {
    items.push({ separator: true }, { heading: true, label: 'Folders' });
    for (const folder of folders) {
      items.push({ label: `Save to ${folder.name}`, onClick: () => setFocusSweepSaveDestination(folder.id, folder.name) });
    }
  }
  items.push({ separator: true });
  items.push({ label: 'New folder...', onClick: async () => {
    const name = (window.prompt('New folder name:') || '').trim();
    if (!name) return;
    const folder = await createFolder(name);
    if (folder) setFocusSweepSaveDestination(folder.id, folder.name);
  }});
  showContextMenu(x, y, items);
}

function setFocusSweepSaveDestination(folderId, folderName) {
  focusSweep.saveFolderId = folderId || null;
  focusSweep.saveFolderName = folderName || 'Inbox';
  renderFocusSweep();
  showToast(`Saving to: ${focusSweep.saveFolderName}`);
}

async function applyFocusSweepActions() {
  if (!focusSweep.active || focusSweep.busyAction) return;

  const stagedEntries = [...focusSweep.stagedActions.entries()]
    .filter(([, action]) => action.type === 'save' || action.type === 'close');

  if (!stagedEntries.length) {
    exitFocusSweep();
    return;
  }

  focusSweep.busyAction = true;
  renderFocusSweep();

  const liveTabs = await chrome.tabs.query({});
  const liveById = new Map(liveTabs.map(tab => [tab.id, tab]));
  const closeIds = [];
  const undoTabs = [];
  const savedIds = [];
  let savedCount = 0;
  let closedCount = 0;
  let skippedCount = 0;

  for (const [tabId, action] of stagedEntries) {
    const item = focusSweep.queue.find(entry => entry.id === tabId);
    const tab = liveById.get(tabId);
    if (!item || !tab || isInternalBrowserUrl(tab.url)) {
      skippedCount += 1;
      continue;
    }

    if (action.type === 'save') {
      try {
        const savedId = await saveTabForLater(
          { url: tab.url, title: tab.title || item.title },
          action.folderId || null
        );
        savedIds.push(savedId);
        undoTabs.push(tabUndoSnapshot(tab));
        closeIds.push(tabId);
        focusSweep.selfActionIds.add(tabId);
        savedCount += 1;
      } catch {
        skippedCount += 1;
      }
    } else if (action.type === 'close') {
      undoTabs.push(tabUndoSnapshot(tab));
      closeIds.push(tabId);
      focusSweep.selfActionIds.add(tabId);
      closedCount += 1;
    }
  }

  if (closeIds.length) {
    try { await chrome.tabs.remove([...new Set(closeIds)]); } catch {}
    playCloseSound();
  }

  await fetchOpenTabs();
  await renderStaticDashboard();

  const stagedCounts = focusSweepCounts();
  focusSweep.applied = true;
  focusSweep.appliedSummary = {
    reviewed: stagedCounts.reviewed,
    kept: stagedCounts.kept,
    saved: savedCount,
    closed: closedCount,
    skipped: focusSweep.skipped + focusSweep.batchSkipped + skippedCount,
  };
  focusSweep.stagedActions = new Map();
  focusSweep.busyAction = false;
  focusSweep.index = focusSweep.queue.length;
  renderFocusSweep();

  const parts = [];
  if (savedCount) parts.push(`${savedCount} saved`);
  if (closedCount) parts.push(`${closedCount} closed`);
  const label = parts.length ? `Applied: ${parts.join(' · ')}` : 'Applied sweep';
  showToast(label, async () => {
    await restoreUndoTabs(undoTabs);
    for (const id of savedIds) { try { await dismissSavedTab(id); } catch {} }
    await fetchOpenTabs();
    await renderStaticDashboard();
  });
}

let brushSelecting = false;
let brushMode = 'add';
let brushTargetKind = null;
let suppressNextBrushClick = false;
let suppressNextSavedBrushClick = false;
const brushTouchedKeys = new Set();
const selectionBrushChipSelector = '#openTabsSection .page-chip[data-action="focus-tab"]';

function getSelectionBrushChip(target) {
  if (!target || target.closest('.chip-action, .chip-dupe-badge')) return null;
  return target.closest(selectionBrushChipSelector);
}

function getSelectionBrushTarget(target) {
  const chip = getSelectionBrushChip(target);
  if (chip && chip.dataset.tabUrl) return { kind: 'open', key: chip.dataset.tabUrl };

  const savedItem = getSelectableSavedItem(target);
  if (savedItem && savedItem.dataset.deferredId) return { kind: 'saved', key: savedItem.dataset.deferredId };

  return null;
}

function isBrushTargetSelected(target) {
  if (!target) return false;
  return target.kind === 'saved'
    ? selectedSavedIds.has(target.key)
    : selectedTabUrls.has(target.key);
}

function applySelectionBrush(target) {
  if (!target || target.kind !== brushTargetKind || !target.key) return;
  if (brushTouchedKeys.has(target.key)) return;
  brushTouchedKeys.add(target.key);

  if (target.kind === 'saved') {
    if (selectedTabUrls.size) clearSelection();
    if (brushMode === 'remove') selectedSavedIds.delete(target.key);
    else selectedSavedIds.add(target.key);
    lastSavedSelectAnchorId = target.key;
    updateSavedSelectionUI();
    return;
  }

  if (selectedSavedIds.size) clearSavedSelection();
  if (brushMode === 'remove') selectedTabUrls.delete(target.key);
  else selectedTabUrls.add(target.key);
  lastSelectAnchorUrl = target.key;
  updateSelectionUI();
}

function stopSelectionBrush() {
  if (!brushSelecting) return;
  brushSelecting = false;
  brushTargetKind = null;
  brushTouchedKeys.clear();
  document.body.classList.remove('selection-brush-active');
}

document.addEventListener('pointerdown', (e) => {
  if (!e.ctrlKey || e.button !== 0) return;
  const target = getSelectionBrushTarget(e.target);
  if (!target) return;
  e.preventDefault();
  suppressNextBrushClick = target.kind === 'open';
  suppressNextSavedBrushClick = target.kind === 'saved';
  brushSelecting = true;
  brushTargetKind = target.kind;
  brushMode = isBrushTargetSelected(target) ? 'remove' : 'add';
  brushTouchedKeys.clear();
  document.body.classList.add('selection-brush-active');
  applySelectionBrush(target);
});

document.addEventListener('pointerover', (e) => {
  if (!brushSelecting) return;
  if (!(e.buttons & 1)) {
    stopSelectionBrush();
    return;
  }
  const target = getSelectionBrushTarget(e.target);
  if (target) applySelectionBrush(target);
});

document.addEventListener('pointerup', stopSelectionBrush);
document.addEventListener('pointercancel', stopSelectionBrush);
document.addEventListener('mouseleave', stopSelectionBrush);
window.addEventListener('blur', stopSelectionBrush);
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') stopSelectionBrush();
});


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
   GUIDED ONBOARDING — first-run tour over the real dashboard UI
   ---------------------------------------------------------------- */

const ONBOARDING_COMPLETE_KEY = 'tabout-onboarding-v1-complete';

const ONBOARDING_STEPS = [
  {
    title: 'Open tabs',
    copy: 'Domain cards show what is open right now. Click a title to jump, bookmark to save, or close tabs when you are done.',
    targets: ['#openTabsSection'],
    fallback: '#dashboardColumns',
  },
  {
    title: 'Saved for later',
    copy: 'Saved for later is your inbox for tabs you want to keep without leaving them open.',
    targets: ['#deferredColumn'],
    fallback: '#dashboardColumns',
  },
  {
    title: 'Folders',
    copy: 'Folders organize saved tabs into compact groups for projects, research, videos, and tasks.',
    targets: ['#foldersColumn'],
    fallback: '#dashboardColumns',
  },
  {
    title: 'Search',
    copy: 'Search open and saved tabs with free text. Press / to focus search, or narrow with domain:github and url:docs.',
    targets: ['.global-search-row'],
    fallback: '#dashboardColumns',
  },
  {
    title: 'Sweep',
    copy: 'Sweep opens a fast triage mode for open tabs, so you can skip, save, or close decisions without digging through cards.',
    targets: ['[data-action="start-focus-sweep-all"]'],
    fallback: '#openTabsSection',
  },
  {
    title: 'Save workspace',
    copy: 'Use Save workspace when the whole browser setup is worth keeping as one restorable state.',
    targets: ['.workspace-edge-save', '[data-action="toggle-workspace-drawer"]'],
    fallback: '#workspacePanel',
    spotlightPadding: { top: 18, right: 8, bottom: 8, left: 8 },
  },
  {
    title: 'Workspaces',
    copy: 'Saved states let you restore windows and tabs later, then rename or remove old snapshots as needed.',
    targets: ['#workspacePanel'],
    fallback: '#dashboardColumns',
  },
  {
    title: 'Top-right controls',
    copy: 'Use Backup to export or import local data, Tour to reopen this guide, Shortcuts for keys, Theme for appearance, and Privacy when the screen should be hidden.',
    virtualTarget: 'cornerControls',
    spotlightPadding: { top: 8, right: 8, bottom: 8, left: 8 },
  },
  {
    title: 'Ready to go',
    copy: 'Tab Atlas is ready. Start with search, sweep, or a card action whenever the tab count gets heavy.',
    centered: true,
  },
];

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
  if (privacyOn || hasCompletedOnboarding()) return;
  onboardingAutoAttempted = true;
  window.setTimeout(() => {
    if (!privacyOn && !hasCompletedOnboarding() && !onboardingState.active) {
      startOnboarding({ manual: false });
    }
  }, 450);
}

function startOnboarding({ manual = false } = {}) {
  if (privacyOn) return;

  if (typeof closeContextMenu === 'function') closeContextMenu();
  if (focusSweep.active) exitFocusSweep();
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
  requestAnimationFrame(positionWorkspaceDrawer);

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

  requestAnimationFrame(() => {
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


/* ----------------------------------------------------------------
   AUTO-REFRESH — keep the dashboard in sync with real tab changes
   ---------------------------------------------------------------- */

let autoRefreshTimer = null;
const pageOpenedAt = Date.now();

// Don't redraw while the user is mid-interaction — it would be disruptive.
function autoRefreshBlocked() {
  if (dragData) return true;
  if (privacyOn) return true;
  if (focusSweep.active) return true;
  if (onboardingState.active) return true;
  const menu    = document.getElementById('contextMenu');
  if (menu && menu.style.display !== 'none') return true;
  for (const id of ['folderDeleteDialog', 'closeAllDialog', 'speedDialDialog']) {
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
    chrome.tabs.onRemoved.addListener((tabId) => markFocusSweepTabGone(tabId));
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

// Paint initial UI after all helpers are registered.
(async function initializeTabAtlas() {
  try {
    // Paint the speed-dial shortcut strip + sync its corner toggle tooltip
    renderSpeedDial();
    updateShortcutsToggleTitle();

    // Paint saved workspace snapshots.
    await renderWorkspacePanel();
    positionWorkspaceDrawer();

    // Restore persisted privacy mode (the clock screen is already up pre-paint;
    // this starts its ticking and syncs the privacyOn flag)
    try { if (localStorage.getItem('tabout-privacy') === '1') setPrivacy(true); } catch {}

    await renderDashboard();
    maybeStartOnboarding();
  } catch (err) {
    console.error('[tab-atlas] Failed to initialize:', err);
  }
})();
