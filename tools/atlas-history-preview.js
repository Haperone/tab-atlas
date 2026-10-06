import { createAtlasHistoryDatabase, AtlasHistoryStorageError } from '../extension/lib/atlas-history-db.js';
import { createAtlasHistoryService, ATLAS_HISTORY_PREFIX } from '../extension/lib/atlas-history-service.js';
import { ATLAS_COLLECTION_PREFIX } from '../extension/lib/atlas-collection-commands.js';

/** Real collection owner/IDB with disposable synthetic Chrome APIs; no profile collections or browser windows. */
export async function setupAtlasHistoryPreview(chromeApi, params) {
  const name = `tab-atlas-collections-preview-${crypto.randomUUID()}`, database = createAtlasHistoryDatabase({ name });
  const listeners = new Set(); chromeApi.runtime.onMessage = { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) };
  const sender = { id: chromeApi.runtime.id, url: chromeApi.runtime.getURL('index.html'), tab: { id: 999, windowId: 1 } };
  const service = createAtlasHistoryService(chromeApi, { database, notify: () => { for (const listener of listeners) listener({ type: ATLAS_HISTORY_PREFIX + 'changed' }); } });
  const send = chromeApi.runtime.sendMessage.bind(chromeApi.runtime);
  chromeApi.runtime.sendMessage = (request, callback) => {
    if (request?.type?.startsWith(ATLAS_HISTORY_PREFIX) || request?.type?.startsWith(ATLAS_COLLECTION_PREFIX)) {
      const response = service.handleMessage(request, sender);
      if (typeof callback === 'function') { void (async () => callback(await response))(); return; }
      return response;
    }
    return send(request, callback);
  };
  if (params.has('time-machine') && !params.has('history-first-run')) {
    const current = await chromeApi.storage.local.get(['folders', 'deferred']), past = structuredClone(current), time = Date.now();
    past.folders[0].name = 'Earlier reading';
    past.deferred = past.deferred.slice(0, -2);
    past.deferred.push({ id: 'history-only-link', folderId: past.folders[0].id, title: 'A link from an earlier Atlas', url: 'https://example.com/earlier?version=1#section', completed: false, savedAt: new Date(time - 86400000).toISOString() });
    if (params.has('history-comparison-preview')) {
      past.deferred.push({ id: 'history-missing-standalone', folderId: null, title: 'An earlier saved link missing today', url: 'https://example.com/saved-earlier', completed: false });
      const folderId = 'history-removed-folder';
      past.folders.push({ id: folderId, name: 'Weekend reading', collapsed: false, color: null });
      const moved = { id: 'history-moved-link', folderId, title: 'A link moved to Reading', url: 'https://example.com/moved', completed: false };
      past.deferred.push(moved, { id: 'history-removed-link', folderId, title: 'A link missing from today’s Atlas', url: 'https://example.com/missing', completed: false });
      past.folders.push({ id: 'history-missing-folder', name: 'Old ideas', collapsed: false, color: null });
      past.deferred.push(
        { id: 'history-old-idea-1', folderId: 'history-missing-folder', title: 'An idea saved last week', url: 'https://example.com/ideas/1', completed: false },
        { id: 'history-old-idea-2', folderId: 'history-missing-folder', title: 'A reference for the idea', url: 'https://example.com/ideas/2', completed: false },
      );
      current.deferred.push({ ...moved, folderId: current.folders[0].id });
      await chromeApi.storage.local.set(current);
    }
    if (params.has('history-timeline-preview')) {
      const sample = structuredClone(past);
      for (let month = 0; month < 30; month++) {
        sample.folders[0].name = `Reading ${month + 1}`;
        await database.append(sample, { wallTime: new Date(2024, month, 1, 12).getTime(), boundary: month === 0 });
      }
      for (let index = 0; index < 80; index++) {
        sample.folders[0].name = `Dense moment ${index + 1}`;
        await database.append(sample, { wallTime: time - 3 * 86400000 + index * 1000 });
      }
    }
    await database.append(past, { wallTime: time - 2 * 86400000, boundary: true, kind: 'baseline' });
    const second = structuredClone(past); second.folders[0].name = 'Past design'; second.deferred[0].completed = true; second.deferred[0].completedAt = '2025-01-01T00:00:00Z';
    const archivedInFolder = second.deferred.find(link => link.folderId === second.folders[0].id);
    archivedInFolder.completed = true; archivedInFolder.completedAt = '2025-02-01T00:00:00Z';
    await database.append(second, { wallTime: time - 86400000 }); await database.configure({ enabled: true });
  }
  const fault = params.get('history-fault');
  if (fault === 'quota') await database.configure({ stopped: 'Atlas history reached its storage quota.' });
  if (fault === 'corrupt' || fault === 'newer-schema') {
    database.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, fault === 'newer-schema' ? 3 : 2);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { if (fault === 'newer-schema') request.result.createObjectStore('future-fixture').put('Preserve future data', 'sentinel'); };
      request.onsuccess = () => {
        const connection = request.result;
        if (fault === 'newer-schema') { connection.close(); resolve(); return; }
        const tx = connection.transaction('meta', 'readwrite'), store = tx.objectStore('meta'), root = store.get('root');
        root.onsuccess = () => { const row = root.result; row.data.model = 'damaged-fixture'; store.put(row); };
        tx.oncomplete = () => { connection.close(); resolve(); };
        tx.onabort = () => { connection.close(); reject(tx.error); };
      };
    });
    document.body.dataset.atlasHistoryFixtureDatabase = name;
  }
  if (fault === 'blocked') {
    // Controlled unavailable-storage boundary, not evidence of native upgrade blocking.
    const original = Object.fromEntries(Object.entries(database).filter(([key]) => key !== 'close'));
    for (const key of Object.keys(original)) database[key] = async () => { throw new AtlasHistoryStorageError('Close other Atlas pages to update history storage, then retry.', 'BLOCKED'); };
    document.addEventListener('atlas-fixture-unblock', () => Object.assign(database, original), { once: true });
  }
  service.register();
  try { await service.start(); } catch (error) { if (!fault) throw error; }
  window.addEventListener('pagehide', () => { database.close(); indexedDB.deleteDatabase(name); }, { once: true });
  return service;
}
