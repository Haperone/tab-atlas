import { makeStorageId } from './ids.js';
import { findSavedPage, websiteUrl, savePage, undoSave, QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY, QUICK_SAVE_ERRORS } from './quick-save-core.js';
import { QUICK_SAVE_APPEARANCE_KEY } from './quick-save-appearance.js';
import { showQuickSaveNotification } from './quick-save-notification.js';
import { createAtlasCollectionWriter } from './atlas-collection-writer.js';

export const QUICK_SAVE_PREFIX = 'tab-atlas/quick-save/';
export const SAVE_MENU_ID = 'tab-atlas-save-page';
const INBOX_MENU_ID = `${SAVE_MENU_ID}:inbox`;
const FOLDER_MENU_PREFIX = `${SAVE_MENU_ID}:folder:`;

export function createQuickSaveService(chromeApi, { openDashboard, updateBadge, playSaveSound, playUndoSound, collectionWriter }) {
  // These queues serialize in-flight operations only; durable data lives in storage.
  let writes = Promise.resolve();
  let menus = Promise.resolve();
  const area = chromeApi.storage.local;
  const writer = collectionWriter || createAtlasCollectionWriter(area, { extraKeys: [QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY] });
  const serialize = operation => {
    const previous = writes;
    const result = (async () => { await previous; return operation(); })();
    writes = result.catch(() => {});
    return result;
  };

  async function collections() {
    const data = await area.get(['deferred', 'folders', QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY]);
    return { ...data, deferred: Array.isArray(data.deferred) ? data.deferred : [], folders: Array.isArray(data.folders) ? data.folders : [] };
  }

  async function activePage(tabId) {
    if (Number.isInteger(tabId)) return chromeApi.tabs.get(tabId);
    const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return tab || {};
  }

  async function state(tabId) {
    const data = await collections();
    const page = await activePage(tabId);
    return { ok: true, page: { id: page.id, title: page.title, url: page.url }, supported: !!websiteUrl(page.url),
      folders: data.folders, saved: websiteUrl(page.url) ? findSavedPage(data.deferred, page.url) : null,
      undo: data[QUICK_SAVE_UNDO_KEY] || null, feedback: data[QUICK_SAVE_FEEDBACK_KEY] || null };
  }

  async function save(page, folderId, contextMenu = false, createName = null) {
    const committed = await writer.mutate(data => {
      let created = false;
      if (createName) {
        const folder = { id: makeStorageId(new Set(data.folders.map(item => item.id))), name: createName,
          collapsed: false, locked: false, color: null, createdAt: new Date().toISOString() };
        data.folders.push(folder); folderId = folder.id; created = true;
      }
      const result = savePage(data.deferred, data.folders, page, folderId);
      const feedback = { ok: result.ok, error: result.error, folderName: result.folderName, kind: result.kind,
        pageTitle: page.title || page.url, createdAt: new Date().toISOString() };
      const update = { [QUICK_SAVE_FEEDBACK_KEY]: feedback };
      if (created && result.ok) update.folders = data.folders;
      if (result.changed) Object.assign(update, { deferred: result.records, [QUICK_SAVE_UNDO_KEY]: result.undo });
      return { update, result };
    }, { kind: createName ? 'create-folder-and-save' : 'quick-save' });
    const result = committed.result;
    if (contextMenu) {
      try {
        await chromeApi.action.setBadgeText({ text: result.ok ? '✓' : '!' });
        await chromeApi.action.setBadgeBackgroundColor({ color: result.ok ? '#3d7a4a' : '#b35a5a' });
        await chromeApi.action.setTitle({ title: result.ok ? `Saved to ${result.folderName} — click to review or undo` : 'Could not save page — click for details' });
      } catch (error) { console.warn('[tab-atlas] Save badge unavailable:', error); }
    }
    return { ok: result.ok, error: result.error, changed: result.changed, folderName: result.folderName, kind: result.kind,
      ...(result.undo ? { undoId: result.undo.id } : {}) };
  }

  async function handleMessage(request) {
    const action = request.type.slice(QUICK_SAVE_PREFIX.length);
    try {
      if (action === 'state') return await state(request.tabId);
      if (action === 'acknowledge') {
        await updateBadge(); await chromeApi.action.setTitle({ title: 'Tab Atlas' });
        return { ok: true };
      }
      if (action === 'dashboard') { await openDashboard(); return { ok: true }; }
      return await serialize(async () => {
        if (action === 'save') {
          const page = await activePage(request.tabId);
          if (request.expectedUrl && page.url !== request.expectedUrl) return { ok: false, error: 'PAGE_CHANGED' };
          const result = await save(page, request.folderId || null);
          if (request.notify && result.ok) await notifyPage(page, result);
          return result;
        }
        if (action === 'create-folder') {
          const name = String(request.name || '').trim().slice(0, 120);
          if (!name) return { ok: false, error: 'EMPTY_NAME' };
          const page = await activePage(request.tabId);
          if (request.expectedUrl && page.url !== request.expectedUrl) return { ok: false, error: 'PAGE_CHANGED' };
          if (!websiteUrl(page.url)) return { ok: false, error: 'UNSUPPORTED_PAGE' };
          const result = await save(page, null, false, name);
          if (request.notify && result.ok) await notifyPage(page, result);
          return result;
        }
        if (action === 'undo') {
          const committed = await writer.mutate((data, stored) => {
            const undo = stored[QUICK_SAVE_UNDO_KEY];
            if (!undo || undo.id !== request.undoId) return { update: {}, result: { ok: false, error: 'UNDO_GONE' } };
            const result = undoSave(data.deferred, data.folders, undo);
            if (!result.ok) return { update: {}, result };
            return { update: { deferred: result.records, [QUICK_SAVE_UNDO_KEY]: null,
              [QUICK_SAVE_FEEDBACK_KEY]: { ok: true, kind: 'undone', createdAt: new Date().toISOString() } }, result: { ok: true } };
          }, { kind: 'quick-save-undo' });
          if (!committed.result.ok) return committed.result;
          await playSoundIfEnabled(playUndoSound);
          return { ok: true };
        }
        return { ok: false, error: 'UNKNOWN_ACTION' };
      });
    } catch { return { ok: false, error: 'STORAGE_ERROR' }; }
  }

  // Callback menu APIs also work on Chrome 109–122 without Promise support.
  function menuCall(method, ...args) {
    return new Promise((resolve, reject) => {
      chromeApi.contextMenus[method](...args, () => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve();
      });
    });
  }

  function syncMenus() {
    const run = async () => {
      const { folders } = await collections();
      await menuCall('removeAll');
      const contexts = ['page', 'frame', 'selection', 'link', 'editable', 'image', 'video', 'audio'];
      const base = { contexts, documentUrlPatterns: ['http://*/*', 'https://*/*'] };
      await menuCall('create', { ...base, id: SAVE_MENU_ID, title: 'Save page to Tab Atlas' });
      await menuCall('create', { ...base, id: INBOX_MENU_ID, parentId: SAVE_MENU_ID, title: 'Saved for later' });
      for (const folder of folders) {
        // Locks allow new links in, while the save handler protects moves out.
        await menuCall('create', { ...base, id: `${FOLDER_MENU_PREFIX}${folder.id}`, parentId: SAVE_MENU_ID,
          title: String(folder.name || 'Untitled folder').replaceAll('%', '％') });
      }
    };
    const previous = menus;
    const result = (async () => { await previous; return run(); })();
    menus = result.catch(() => {});
    return result;
  }

  async function handleContextClick(info, tab) {
    const id = String(info.menuItemId);
    if (id !== INBOX_MENU_ID && !id.startsWith(FOLDER_MENU_PREFIX)) return null;
    const folderId = id === INBOX_MENU_ID ? null : id.slice(FOLDER_MENU_PREFIX.length);
    let result;
    try { result = await serialize(() => save(tab || { url: info.pageUrl }, folderId, true)); }
    catch {
      try {
        await chromeApi.action.setBadgeText({ text: '!' });
        await chromeApi.action.setTitle({ title: 'Could not save page — click to retry' });
      } catch { /* Chrome may be shutting down; no false success is reported. */ }
      try { await area.set({ [QUICK_SAVE_FEEDBACK_KEY]: { ok: false, error: 'STORAGE_ERROR', createdAt: new Date().toISOString() } }); }
      catch { /* Failed storage cannot retain feedback; the toolbar still offers retry. */ }
      result = { ok: false, error: 'STORAGE_ERROR' };
    }
    await notifyPage(tab, result);
    return result;
  }

  async function notifyPage(tab, result) {
    // Both entry points share feedback after the commit; painting cannot fail the save.
    let appearance;
    try { appearance = (await area.get([QUICK_SAVE_APPEARANCE_KEY]))[QUICK_SAVE_APPEARANCE_KEY]; } catch {}
    if (Number.isInteger(tab?.id) && websiteUrl(tab.url) && chromeApi.scripting) {
      try {
        const text = result.ok ? `${result.kind === 'existing' ? 'Already saved in' : 'Saved to'} ${result.folderName}`
          : QUICK_SAVE_ERRORS[result.error] || QUICK_SAVE_ERRORS.STORAGE_ERROR;
        await chromeApi.scripting.executeScript({ target: { tabId: tab.id }, func: showQuickSaveNotification,
          args: [{ ok: result.ok, text, ...(result.undoId ? { undoId: result.undoId } : {}) }, appearance || null, tab.url] });
      } catch { /* The toolbar receipt remains available when Chrome disallows page injection. */ }
    }
    if (result.ok && result.changed && appearance?.sound !== false && playSaveSound) {
      try { await playSaveSound(); } catch { /* Audio never changes the committed save result. */ }
    }
  }

  async function playSoundIfEnabled(play) {
    if (!play) return;
    try {
      const data = await area.get([QUICK_SAVE_APPEARANCE_KEY]);
      if (data[QUICK_SAVE_APPEARANCE_KEY]?.sound !== false) await play();
    } catch { /* Sound is optional after the mutation has succeeded. */ }
  }

  return { handleMessage, handleContextClick, syncMenus };
}
