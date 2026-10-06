import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasHistoryService, ATLAS_HISTORY_PREFIX as H } from '../extension/lib/atlas-history-service.js';
import { ATLAS_COLLECTION_PREFIX as C } from '../extension/lib/atlas-collection-commands.js';
import { ATLAS_HISTORY_LIMITS, captureAtlasState, emptyAtlasState, diffAtlasStates, expandAtlasComparison } from '../extension/lib/atlas-history-model.js';
import { ATLAS_RESTORE_RECEIPT_KEY, ATLAS_GENERATION_KEY } from '../extension/lib/atlas-history-restore.js';
import { ATLAS_REVISION_KEY } from '../extension/lib/atlas-collection-writer.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

// Service protocol checks; native IndexedDB/lifecycle acceptance lives in the browser fixture.
function fixture({ enabled = false } = {}) {
  const data = { folders: [{ id: 'f', name: 'Work' }], deferred: [{ id: 'old', folderId: 'f', title: 'Old', url: 'https://example.test/old' }], workspaceSnapshots: [] };
  const events = [], operations = new Map(), listeners = [], commits = [], tabCalls = [];
  let prefs = { enabled, paused: false, stopped: null }, guard = null, pending = null, wallTime = 1000, broken = false;
  const db = {
    async status() { if (broken) throw new Error('Damaged history. Clear history from its menu.'); return { ...prefs, bytes: 100, budget: ATLAS_HISTORY_LIMITS.budget, oldest: events[0]?.time || null, latest: events.at(-1)?.time || null, lastRestore: structuredClone(operations.get(guard) || null) }; },
    async storageStatus() { return { bytes: broken ? null : 100, budget: ATLAS_HISTORY_LIMITS.budget }; },
    async configure(settings) { Object.assign(prefs, settings); },
    async current() { return structuredClone(events.at(-1)?.state || emptyAtlasState()); },
    async append(state, options = {}) {
      if (broken) throw new Error('Damaged history. Clear history from its menu.');
      const operation = operations.get(options.operationId);
      if (operation?.targetRecorded) return { changed: false };
      if (!options.boundary && !Object.keys(diffAtlasStates(await db.current(), state)).length) return { changed: false };
      const time = Math.max(options.wallTime || wallTime, (events.at(-1)?.time || 0) + 1);
      events.push({ state: structuredClone(state), time, ...options });
      if (operation) operation.targetRecorded = true;
      return { changed: true, time };
    },
    async seek(time) { const moment = events.findLast(item => item.time <= time); return structuredClone(moment || { state: emptyAtlasState(), time: null, gap: false }); },
    async putOperation(input, { protect } = {}) {
      operations.set(input.id, { ...structuredClone(operations.get(input.id) || {}), ...structuredClone(input) });
      if (input.phase === 'prepared') pending = input.id;
      if (['committed', 'abandoned'].includes(input.phase) && pending === input.id) pending = null;
      if (protect) guard = input.id;
    },
    async operation(id) { return structuredClone(operations.get(id) || null); },
    async pending() { return structuredClone(operations.get(pending) || null); },
    async clear() { events.length = 0; operations.clear(); guard = pending = null; broken = false; prefs.stopped = null; },
  };
  const area = {
    async get(keys) { return structuredClone(Object.fromEntries([].concat(keys).filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) {
      const changes = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { oldValue: structuredClone(data[key]), newValue: structuredClone(value) }]));
      Object.assign(data, structuredClone(update)); commits.push(structuredClone(update));
      for (const listener of listeners) listener(changes, 'local');
    },
    async getBytesInUse(keys) { return storageBytes(keys == null ? data : Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
  };
  const sender = { id: 'atlas-id', url: 'chrome-extension://atlas-id/index.html', tab: { id: 9, windowId: 7 } };
  let tabs = [], browserEvents = 0, normal = true, owner;
  const chrome = { runtime: { id: sender.id, getURL: file => `chrome-extension://atlas-id/${file}` },
    storage: { local: area, onChanged: { addListener: listener => listeners.push(listener) } },
    tabs: {
      onCreated: { addListener: () => browserEvents++ }, onRemoved: { addListener: () => browserEvents++ }, onUpdated: { addListener: () => browserEvents++ },
      async query(options) { tabCalls.push(['query', options]); return tabs.filter(tab => tab.windowId === options.windowId); },
      async update(id, options) { tabCalls.push(['update', id, options]); return { id }; },
      async create(options) { tabCalls.push(['create', options]); return { id: 42 }; },
    }, windows: { async get(id) { tabCalls.push(['window', id]); return { id, type: normal ? 'normal' : 'popup', incognito: false }; },
      async create() { assert.fail('History must never create a browser window'); } },
  };
  function restart() { owner = createAtlasHistoryService(chrome, { database: db, clock: () => wallTime }); return owner; }
  restart();
  return { data, db, area, events, operations, commits, tabCalls, sender, chrome, restart, get owner() { return owner; },
    advance: () => wallTime += 100, breakHistory: () => { broken = true; }, tabs: value => { tabs = value; }, nonNormal: () => { normal = false; }, browserEvents: () => browserEvents,
    async call(action, request = {}, from = sender) { return await owner.handleMessage({ type: H + action, ...request }, from); },
    async change(action, request = {}) { return await owner.handleMessage({ type: C + action, ...request }, sender); },
    async drain() { await owner.writer.exclusive(async () => {}); },
  };
}

test('timestamp-only timeline and nearest navigation use the history queue and sender checks without changing collections', async () => {
  const f = fixture({ enabled: true }); await f.owner.start();
  let calls = 0;
  f.db.timeline = async request => { calls++; return { start: request.start, end: request.end, total: 1, buckets: [{ index: 0, first: 1000, last: 1000, count: 1 }] }; };
  f.db.nearest = async () => { calls++; return 1000; };
  const before = structuredClone(f.data);
  const points = await f.call('timeline', { start: 1000, end: 2000, bins: 10 });
  assert.equal(points.ok, true); assert.equal(points.data.total, 1);
  assert.equal((await f.call('nearest', { time: 1500 })).data, 1000);
  assert.equal((await f.call('timeline', { start: 0, end: 2000 }, { id: 'another-extension', url: 'https://example.com' })).code, 'NOT_ALLOWED');
  assert.equal(calls, 2); assert.deepEqual(f.data, before);
});
test('history metadata and navigation wait for an in-flight collection commit and expose its fresh revision', async () => {
  const f = fixture({ enabled: true }); await f.owner.start(); f.advance();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const set = f.area.set;
  f.area.set = async update => { entered(); await gate; return await set(update); };
  f.db.step = async time => f.events.findLast(event => event.time < time)?.time ?? null;
  const rename = f.change('folder-edit', { id: 'f', fields: { name: 'Updated work' } });
  await started;
  let metadataReturned = false;
  const metadata = f.call('status').then(value => { metadataReturned = true; return value; });
  const earlier = f.call('step', { time: 1100, direction: -1 });
  await Promise.resolve(); assert.equal(metadataReturned, false, 'Metadata bypassed a pending commit');
  release(); assert.equal((await rename).ok, true);
  const status = await metadata;
  assert.equal(status.ok, true); assert.equal(status.data.revision, f.data[ATLAS_REVISION_KEY].id);
  assert.equal(status.data.latest, 1100); assert.equal((await earlier).data, 1000);
  assert.equal(f.data.folders[0].name, 'Updated work');
});

test('explicitly disabled history records only after enable; pause/resume preserve a real boundary', async () => {
  const f = fixture(); f.owner.register(); await f.owner.start();
  assert.equal(f.browserEvents(), 0); assert.equal(f.events.length, 0);
  assert.equal((await f.change('folder-edit', { id: 'f', fields: { name: 'Before enable' } })).ok, true);
  assert.equal(f.events.length, 0); assert.equal((await f.call('enable')).ok, true);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].state.folders[0].name, 'Before enable');
  f.advance(); await f.change('save', { page: { url: 'https://example.test/new' }, folderId: 'f' });
  assert.equal(f.events.length, 2); assert.equal(f.events.at(-1).kind, 'save');
  await f.call('pause'); await f.change('folder-edit', { id: 'f', fields: { name: 'During pause' } });
  assert.equal(f.events.length, 2); f.advance(); await f.call('resume');
  assert.equal(f.events.length, 3); assert.equal(f.events.at(-1).kind, 'resume'); assert.equal(f.events.at(-1).boundary, true);
  assert.equal(f.events.at(-1).state.folders[0].name, 'During pause');
  await f.call('disable'); await f.change('folder-edit', { id: 'f', fields: { name: 'After disable' } });
  assert.equal(f.events.length, 3); assert.equal(f.tabCalls.length, 0);
});

test('enabled startup captures one automatic baseline, restart and repeated enable do not duplicate it, explicit off survives restart', async () => {
  const f = fixture({ enabled: true }); await f.owner.start();
  assert.equal(f.events.length, 1); assert.equal(f.events[0].kind, 'baseline');
  assert.deepEqual(f.events[0].state, captureAtlasState(f.data)); assert.equal(f.commits.length, 0);
  await f.restart().start(); assert.equal(f.events.length, 1);
  assert.equal((await f.call('enable')).ok, true); assert.equal(f.events.length, 1);
  await f.call('disable'); await f.restart().start();
  assert.equal((await f.call('status')).data.enabled, false);
  await f.change('folder-edit', { id: 'f', fields: { name: 'Changed while off' } });
  assert.equal(f.events.length, 1);
  f.advance(); await f.call('enable'); assert.equal(f.events.length, 2);
  assert.equal(f.events.at(-1).state.folders[0].name, 'Changed while off');
});

test('automatic history excludes archive on startup and commits; archive-only edits and cleanup create no moments', async () => {
  const f = fixture({ enabled: true });
  f.data.deferred.push({ id: 'archive', url: 'https://example.test/archive', completed: true, completedAt: 1, title: 'Archived' });
  await f.owner.start();
  assert.deepEqual(f.events[0].state.deferred.map(link => link.id), ['old']);
  await f.owner.writer.mutate(collections => ({ update: { deferred: collections.deferred.map(link => link.completed ? { ...link, title: 'Archive edit' } : link) } }));
  assert.equal(f.events.length, 1);
  await f.owner.writer.mutate(collections => ({ update: { deferred: collections.deferred.filter(link => !link.completed) } }));
  assert.equal(f.events.length, 1);
  await f.owner.writer.mutate(collections => ({ update: { deferred: collections.deferred.map(link => ({ ...link, completed: true, completedAt: 2 })) } }));
  assert.equal(f.events.length, 2); assert.deepEqual(f.events[1].state.deferred, []);
  await f.restart().start(); assert.equal(f.events.length, 2);
  assert.deepEqual((await f.call('seek', { time: f.events[0].time })).data.current.deferred, []);
  const past = (await f.call('seek', { time: f.events[0].time, comparisonFormat: 'compact-v1' })).data;
  assert.equal(Object.hasOwn(past, 'current'), false);
  assert.equal(expandAtlasComparison(past.state, past.comparison).links.get('old').present, false);
});

test('paused recording still broadcasts current collection changes for live comparison without creating points', async () => {
  const f = fixture({ enabled: true }); let notifications = 0;
  const owner = createAtlasHistoryService(f.chrome, { database: f.db, notify: () => notifications++ });
  await owner.start();
  await owner.handleMessage({ type: H + 'pause' }, f.sender); const before = notifications;
  await owner.handleMessage({ type: C + 'folder-edit', id: 'f', fields: { name: 'Changed during pause' } }, f.sender);
  assert.ok(notifications > before); assert.equal(f.events.length, 1);
  const legacy = await owner.handleMessage({ type: H + 'compare' }, f.sender);
  assert.equal(legacy.data.current.folders[0].name, 'Changed during pause');
  const compared = await owner.handleMessage({ type: H + 'compare', time: f.events[0].time, comparisonFormat: 'compact-v1' }, f.sender);
  assert.equal(expandAtlasComparison(f.events[0].state, compared.data.comparison).folders.get('f').description, 'Currently named Changed during pause');
});

test('foreign changes reconcile fresh collections once; identical writes and legacy tombstone cleanup make no snapshot', async () => {
  const f = fixture(); f.owner.register(); await f.call('enable');
  await f.area.set({ folders: structuredClone(f.data.folders) }); await f.drain(); assert.equal(f.events.length, 1);
  await f.area.set({ deferred: [...f.data.deferred, { id: 'tombstone', url: 'https://example.test/deleted', dismissed: true }] });
  await f.drain(); assert.equal(f.events.length, 1);
  await f.change('purge-legacy'); await f.drain(); assert.equal(f.events.length, 1);
  await f.area.set({ folders: [{ id: 'f', name: 'External' }] }); await f.drain();
  assert.equal(f.events.length, 2); assert.equal(f.events[1].kind, 'external-change'); assert.equal(f.events[1].boundary, true);
});

test('a history failure leaves ordinary saves usable and reports committed journal failure honestly', async () => {
  const f = fixture(); await f.call('enable'); f.breakHistory();
  const first = await f.change('save', { page: { url: 'https://example.test/saved' }, folderId: 'f' });
  assert.equal(first.ok, true); assert.equal(first.data.historyError, true); assert.equal(f.data.deferred.at(-1).url, 'https://example.test/saved');
  const second = await f.change('folder-edit', { id: 'f', fields: { name: 'Still usable' } });
  assert.equal(second.ok, true); assert.equal(f.data.folders[0].name, 'Still usable');
  const before = structuredClone(f.data); assert.equal((await f.call('restore', { time: 1000, expectedRevision: f.data[ATLAS_REVISION_KEY].id })).ok, false);
  assert.deepEqual(f.data, before);
});

test('explicit Clear repairs a broken history without initialization or changing current collections', async () => {
  const f = fixture(); await f.call('enable'); const before = structuredClone(f.data); f.breakHistory(); f.restart();
  assert.equal((await f.call('status')).ok, false);
  const usage = await f.call('storage-status'); assert.equal(usage.ok, true); assert.equal(usage.data.bytes, null);
  const cleared = await f.call('clear'); assert.equal(cleared.ok, true); assert.deepEqual(f.data, before);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].kind, 'baseline'); assert.equal(cleared.data.lastRestore, null);
});

test('service accepts only its dashboard sender, excluding foreign webpages, popup and incognito', async () => {
  const f = fixture();
  for (const sender of [{ ...f.sender, id: 'other' }, { ...f.sender, url: 'https://example.test/' },
    { ...f.sender, url: f.chrome.runtime.getURL('popup.html') }, { ...f.sender, tab: { ...f.sender.tab, incognito: true } }]) {
    assert.equal((await f.call('enable', {}, sender)).code, 'NOT_ALLOWED');
    assert.equal((await f.owner.handleMessage({ type: C + 'save', page: { url: 'https://example.test/bad' } }, sender)).code, 'NOT_ALLOWED');
  }
  assert.equal(f.commits.length, 0); assert.equal(f.events.length, 0);
  assert.equal((await f.call('status', {}, { ...f.sender, url: f.sender.url + '?theme=soft' })).ok, true);
});

test('opening a historical link targets only the current normal window and focuses an exact existing URL there', async () => {
  const f = fixture(); await f.call('enable'); const before = structuredClone(f.data);
  f.tabs([{ id: 1, windowId: 8, url: f.data.deferred[0].url }]);
  assert.equal((await f.call('open-link', { time: 1000, linkId: 'old' })).data.existing, false);
  assert.deepEqual(f.tabCalls.at(-1), ['create', { windowId: 7, url: 'https://example.test/old', active: true }]);
  f.tabs([{ id: 2, windowId: 7, url: 'https://example.test/old?query=1' }, { id: 3, windowId: 7, url: 'https://example.test/old' }]);
  assert.equal((await f.call('open-link', { time: 1000, linkId: 'old' })).data.existing, true);
  assert.deepEqual(f.tabCalls.at(-1), ['update', 3, { active: true }]);
  assert.deepEqual(f.data, before); assert.equal(f.events.length, 1);
  f.nonNormal(); assert.equal((await f.call('open-link', { time: 1000, linkId: 'old' })).ok, false);
  assert.equal((await f.call('open-link', { time: 1000, linkId: 'missing' })).ok, false);
});

test('cold receipt recovery records one target point without a duplicate baseline or rewriting local data', async () => {
  const f = fixture(), target = { folders: [], deferred: [] }, before = captureAtlasState(f.data);
  await f.db.configure({ enabled: true });
  await f.db.putOperation({ id: 'pending', phase: 'prepared', before, target, kind: 'restore', createdAt: 900, commitRevision: 'committed-revision' });
  Object.assign(f.data, target, { [ATLAS_REVISION_KEY]: { id: 'committed-revision' }, [ATLAS_GENERATION_KEY]: 'pending',
    [ATLAS_RESTORE_RECEIPT_KEY]: { id: 'pending', revision: 'committed-revision', at: 900 } });
  const current = structuredClone(f.data); f.restart(); await f.owner.start();
  assert.deepEqual(f.data, current); assert.equal(f.commits.length, 0); assert.equal(f.events.length, 1);
  assert.equal(f.events[0].kind, 'restore'); assert.equal((await f.db.status()).lastRestore.id, 'pending');
});
