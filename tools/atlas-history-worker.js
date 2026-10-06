import { createAtlasHistoryDatabase } from '../extension/lib/atlas-history-db.js';
import { createAtlasHistoryService } from '../extension/lib/atlas-history-service.js';
import { storageBytes } from '../extension/lib/storage-usage.js';
import { ATLAS_HISTORY_LIMITS, atlasRecordJSON } from '../extension/lib/atlas-history-model.js';
import { createQuickSaveService } from '../extension/lib/quick-save-service.js';

// Disposable fixture only. Native IDB substitutes for chrome.storage.local so
// collections and their atomic receipt survive actual Worker.terminate().
let localDB, owner, gate = null, clock = 2000;
let fixtureDatabase;
let quickSave, quickFeedback;
const sender = { id: 'atlas-worker-fixture', url: 'chrome-extension://atlas-worker-fixture/index.html', tab: { windowId: 1 } };
async function stopAt(point, operationId) {
  if (gate?.point !== point || (gate.id && gate.id !== operationId)) return;
  postMessage({ event: 'boundary', point, operationId });
  await new Promise(() => {}); // Parent terminates the worker at this durable boundary.
}
async function localTransaction(mode, action) {
  return await new Promise((resolve, reject) => {
    const tx = localDB.transaction('local', mode), request = tx.objectStore('local').get('state');
    let result;
    request.onsuccess = () => {
      try { result = action(request.result || { values: {}, commits: 0 }, tx.objectStore('local')); }
      catch (error) { reject(error); tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('Fixture local transaction aborted'));
    tx.onerror = () => {}; // onabort owns the transaction failure.
  });
}
function pick(values, keys) {
  if (keys == null) return structuredClone(values);
  const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
  const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(defaults);
  return Object.fromEntries(names.filter(key => Object.hasOwn(values, key) || Object.hasOwn(defaults, key))
    .map(key => [key, structuredClone(Object.hasOwn(values, key) ? values[key] : defaults[key])]));
}
async function initialize(request) {
  localDB = await new Promise((resolve, reject) => {
    const open = indexedDB.open(request.name + '-local', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('local');
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  if (request.seed) await localTransaction('readwrite', (row, store) => {
    row.values = structuredClone(request.seed.current); store.put(row, 'state');
  });
  const database = createAtlasHistoryDatabase({ name: request.name });
  fixtureDatabase = database;
  if (request.seed) {
    await database.append(request.seed.past, { wallTime: 1000, boundary: true });
    await database.configure({ enabled: true, paused: false });
  }
  const hooked = { ...database,
    async putOperation(operation, options) {
      const result = await database.putOperation(operation, options);
      await stopAt(operation.phase, operation.id); return result;
    },
    async append(state, options) {
      const result = await database.append(state, options);
      if (options?.operationId) await stopAt('target-recorded', options.operationId);
      return result;
    },
  };
  const storage = {
    QUOTA_BYTES: 10 * 1024 * 1024,
    get: keys => localTransaction('readonly', row => pick(row.values, keys)),
    async set(update) {
      await localTransaction('readwrite', (row, store) => {
        Object.assign(row.values, structuredClone(update)); row.commits++; store.put(row, 'state');
      });
      if (update.atlasRestoreReceipt) await stopAt('local-receipt', update.atlasRestoreReceipt.id);
    },
    getBytesInUse: keys => localTransaction('readonly', row => storageBytes(pick(row.values, keys))),
  };
  const unavailable = async () => { throw new Error('Collection restore attempted a browser mutation'); };
  const chromeApi = { runtime: { id: sender.id, getURL: path => `chrome-extension://${sender.id}/${path}` },
    storage: { local: storage, onChanged: { addListener() {} } },
    tabs: { create: unavailable, update: unavailable, remove: unavailable, query: unavailable },
    windows: { create: unavailable, remove: unavailable, get: unavailable } };
  owner = createAtlasHistoryService(chromeApi, { database: hooked, clock: () => ++clock });
  await owner.start();
  quickFeedback = { receipts: 0, saveSounds: 0, undoSounds: 0 };
  const popupPage = { id: 20, url: 'https://worker.example/popup', title: 'Popup fixture' };
  // The real services share one writer, as in background.js. Chrome UI and
  // scripting/audio are only recorded here; browser mutations still throw.
  quickSave = createQuickSaveService({ ...chromeApi,
    tabs: { ...chromeApi.tabs, get: async () => popupPage },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    scripting: { executeScript: async () => { quickFeedback.receipts++; } },
  }, { collectionWriter: owner.writer, openDashboard: unavailable, updateBadge: async () => {},
    playSaveSound: async () => { quickFeedback.saveSounds++; },
    playUndoSound: async () => { quickFeedback.undoSounds++; } });
  return await owner.database.status();
}
function sample(count, version = 0, titleLength = 0) {
  const folders = Array.from({ length: Math.min(100, Math.ceil(count / 10)) }, (_, index) => ({ id: 'f-' + index, name: 'Research ' + index, color: null, collapsed: false }));
  return { folders, deferred: Array.from({ length: count }, (_, index) => ({ id: 'link-' + index,
    folderId: folders[index % folders.length].id, title: `Research ${index} · version ${version} · Тест ` + 'x'.repeat(titleLength),
    url: `https://worker.example/research/${index}?version=original#section`, completed: false,
    savedAt: '2026-09-01T00:00:00Z' })) };
}
async function performanceSeed(count, nearBudget) {
  const measures = [], append = async (value, time) => {
    const started = performance.now(); await fixtureDatabase.append(value, { boundary: true, wallTime: time });
    measures.push({ count: value.deferred.length, wallTime: time, writeMs: performance.now() - started });
  };
  await fixtureDatabase.clear();
  const normal = sample(count); await append(normal, 10000);
  const base = await fixtureDatabase.status();
  if (nearBudget) {
    // Historical collections, each below local's 10 MiB limit, contain
    // genuinely distinct immutable records. No fake quota or byte metadata.
    // Normal versions 3/4 also remain reachable; reserve their actual record cost.
    const desired = ATLAS_HISTORY_LIMITS.budget * .95, overheadPerLink = 420;
    const versions = Math.max(2, Math.ceil(desired / (8 * 1024 * 1024)));
    const length = Math.max(0, Math.floor((desired - 3 * base.bytes) / versions / 1000) - overheadPerLink);
    for (let index = 0; index < versions; index++) await append(sample(1000, 100 + index, length), 11000 + index);
  }
  await append(sample(count, 3), 13000); await append(sample(count, 4), 14000);
  const current = sample(count, 4);
  // One missing link per folder makes the previous moment a real recovery preview.
  current.deferred = current.deferred.slice(current.folders.length);
  await append(current, 15000);
  const archived = Array.from({ length: count / 5 }, (_, index) => ({ id: 'archived-only-' + index,
    folderId: normal.folders[index % normal.folders.length].id, title: `Архивная ссылка ${index}`,
    url: `https://worker.example/archive/${index}`, completed: true, completedAt: '2026-09-01T00:00:00Z' }));
  await localTransaction('readwrite', (row, store) => {
    row.values = { ...current, deferred: [...current.deferred, ...archived],
      workspaceSnapshots: [{ id: 'workspace', name: 'Keep workspace' }] }; store.put(row, 'state');
  });
  clock = 16000;
  await fixtureDatabase.configure({ enabled: true, paused: false, stopped: null });
  const status = await fixtureDatabase.status();
  return { status, measures, activeCount: count, currentActiveCount: current.deferred.length, missingCount: current.folders.length,
    archivedCount: archived.length, previewTimes: [13000, 14000], payloadRatio: status.bytes / status.budget,
    audit: await fixtureDatabase.audit(), localBytes: await localTransaction('readonly', row => storageBytes(row.values)) };
}
async function performanceRestoreAndGC() {
  const call = async (action, data = {}) => {
    const response = await owner.handleMessage({ type: 'tab-atlas/time-machine/' + action, ...data }, sender);
    if (!response.ok) throw new Error(response.error); return response.data;
  };
  const before = await localTransaction('readonly', row => structuredClone(row.values));
  const preview = await call('preview-restore', { time: 13000 });
  let started = performance.now();
  const restored = await call('restore', { id: 'performance-restore', time: 13000, expectedRevision: preview.revision });
  const restoreMs = performance.now() - started;
  const restoredCollections = await localTransaction('readonly', row => structuredClone(row.values));
  const undoPreview = await call('preview-undo', { operationId: restored.id }); started = performance.now();
  const undone = await call('undo', { id: 'performance-undo', operationId: restored.id, expectedRevision: undoPreview.revision });
  const undoMs = performance.now() - started;
  const after = await localTransaction('readonly', row => structuredClone(row.values));
  const equal = (a, b) => atlasRecordJSON(a) === atlasRecordJSON(b);
  if (!equal(before.folders, after.folders) || !equal(before.deferred, after.deferred) || !equal(before.workspaceSnapshots, after.workspaceSnapshots)) throw new Error('Performance Undo lost collections or workspace');
  const beforeGC = await fixtureDatabase.status(); started = performance.now();
  for (let index = 0; index < Math.ceil(ATLAS_HISTORY_LIMITS.budget / (8 * 1024 * 1024)) + 1; index++) {
    await fixtureDatabase.append(sample(1000, 1000 + index, 8000), { boundary: true, wallTime: ++clock });
    if ((await fixtureDatabase.status()).oldest > beforeGC.oldest) break;
  }
  const gcWriteMs = performance.now() - started, afterGC = await fixtureDatabase.status();
  const operation = await fixtureDatabase.operation(undone.id);
  if (!operation || !equal(operation.before.deferred, restoredCollections.deferred) || !equal(operation.target.deferred, before.deferred)) {
    throw new Error('GC lost the protected return point');
  }
  if (!equal(operation.before.deferred.filter(link => link.completed), before.deferred.filter(link => link.completed))
    || !equal(operation.target.deferred.filter(link => link.completed), before.deferred.filter(link => link.completed))) throw new Error('Restore/Undo or GC changed unselected archive');
  return { restoreMs, undoMs, gcWriteMs, bytesBeforeGC: beforeGC.bytes, bytesAfterGC: afterGC.bytes,
    earliestBeforeGC: beforeGC.oldest, earliestAfterGC: afterGC.oldest, protectedOperation: afterGC.lastRestore?.id,
    localCommits: await localTransaction('readonly', row => row.commits), audit: await fixtureDatabase.audit() };
}
async function performanceBoundedReplay() {
  // Dedicated disposable database case: default 200-event checkpoint policy.
  await fixtureDatabase.clear();
  const state = sample(1000); await fixtureDatabase.append(state, { boundary: true, wallTime: 10000 });
  const started = performance.now();
  for (let index = 1; index <= 199; index++) {
    state.deferred[index % 1000].title = 'Edited revision ' + index;
    if (index % 10 === 0) state.deferred.reverse();
    await fixtureDatabase.append(state, { wallTime: 10000 + index });
  }
  const write199Ms = performance.now() - started, seeks = [];
  const audit = await fixtureDatabase.audit();
  if (audit.totals.checkpoints.count !== 1 || audit.totals.events.count !== 200) throw new Error('Replay fixture skipped the 199-event boundary');
  for (let index = 0; index < 20; index++) {
    const seekStarted = performance.now(), moment = await fixtureDatabase.seek(10199);
    seeks.push(performance.now() - seekStarted);
    if (atlasRecordJSON(moment.state) !== atlasRecordJSON(state)) throw new Error('Bounded replay lost order/archive/edits');
  }
  return { count: 1000, replayedEvents: 199, write199Ms, seekSamplesMs: seeks,
    p95SeekMs: [...seeks].sort((a, b) => a - b)[18], audit };
}
self.onmessage = async ({ data: request }) => {
  try {
    let result;
    if (request.action === 'init') result = await initialize(request);
    else if (request.action === 'arm') { gate = { point: request.point, id: request.operationId }; result = true; }
    else if (request.action === 'command') result = await owner.handleMessage(request.request, sender);
    else if (request.action === 'quick-command') result = await quickSave.handleMessage(request.request);
    else if (request.action === 'context-save') result = await quickSave.handleContextClick(request.info, request.page);
    else if (request.action === 'performance-seed') result = await performanceSeed(request.count, request.nearBudget);
    else if (request.action === 'performance-restore-gc') result = await performanceRestoreAndGC();
    else if (request.action === 'performance-bounded-replay') result = await performanceBoundedReplay();
    else if (request.action === 'inspect') result = { local: await localTransaction('readonly', row => row),
      status: await owner.database.status(), feedback: quickFeedback, pending: await owner.database.pending(),
      operation: request.operationId ? await owner.database.operation(request.operationId) : null,
      audit: await owner.database.audit() };
    else throw new Error('Unknown fixture command');
    postMessage({ id: request.id, result });
  } catch (error) { postMessage({ id: request.id, error: error.message }); }
};
