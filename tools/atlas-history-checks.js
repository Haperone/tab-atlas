import { createAtlasHistoryDatabase } from '../extension/lib/atlas-history-db.js';
import { ATLAS_HISTORY_LIMITS, atlasRecordJSON, captureAtlasHistoryState, planAtlasRestore } from '../extension/lib/atlas-history-model.js';
import { createQuotaFaultFactory } from './time-machine-quota-fixture.js';
import { createAtlasCollectionWriter } from '../extension/lib/atlas-collection-writer.js';
import { createAtlasRestorer, ATLAS_RESTORE_KEYS } from '../extension/lib/atlas-history-restore.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

const output = document.querySelector('#results'), run = document.querySelector('#run');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => assert(atlasRecordJSON(a) === atlasRecordJSON(b), 'Collection state differs');
const equalHistory = (actual, expected) => equal(actual, captureAtlasHistoryState(expected));
const request = input => new Promise((resolve, reject) => { input.onsuccess = () => resolve(input.result); input.onerror = () => reject(input.error); });
const sample = (count = 10, revision = 0) => ({
  folders: [{ id: 'work', name: 'Работа 🌙', color: '#73937a', locked: false, collapsed: false }, { id: 'read', name: 'Read' }],
  deferred: Array.from({ length: count }, (_, i) => ({ id: `link-${i}`, folderId: i % 2 ? 'read' : 'work',
    url: `https://atlas.example/${i}?revision=${revision}#section`, title: `Ссылка ${i} — ${revision} 🌙`,
    completed: i % 3 === 0, ...(i % 3 === 0 ? { completedAt: '2026-01-01T00:00:00Z' } : {}) })),
});
async function audit(db) {
  const result = await db.audit();
  assert(result.recorded === result.measured, 'UTF-8 ledger differs from native stored rows');
  assert(!result.missing.length, 'Dictionary references are missing');
  assert(!result.unreachable.length, 'Dictionary contains unreachable versions');
  return result;
}

function protocolOwner(database, data, { skipCommitted = false, failLocal = false } = {}) {
  let restorer, commits = 0;
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) { if (failLocal) throw new Error('Synthetic local failure'); Object.assign(data, structuredClone(update)); commits++; },
    async getBytesInUse(keys) { return storageBytes(keys == null ? data : Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
  };
  const writer = createAtlasCollectionWriter(storage, { extraKeys: ATLAS_RESTORE_KEYS,
    beforeChange: () => restorer.recoverPending(),
    onCommitted: async event => {
      if (skipCommitted && event.operationId) return;
      if (!await restorer.committed(event)) await database.append(event.after);
    },
  });
  restorer = createAtlasRestorer({ database, storage, writer });
  return { writer, restorer, commits: () => commits };
}

run.addEventListener('click', async () => {
  run.disabled = true; const results = [];
  const write = running => {
    const passed = results.filter(item => item.passed).length;
    document.querySelector('#summary').textContent = `${running ? 'Running — ' : ''}${passed}/${results.length} passed${results.some(item => !item.passed) ? ' — inspect failed checks below' : ''}`;
    output.textContent = JSON.stringify({ running, passed: results.every(item => item.passed), results,
    environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory },
    note: 'Native IndexedDB, synthetic Atlas collections; local storage is injected; reopening is not installed-worker/browser lifecycle evidence' }, null, 2); };
  async function check(name, action, options = {}) {
    const databaseName = `tab-atlas-collections-test-${crypto.randomUUID()}`;
    const db = createAtlasHistoryDatabase({ name: databaseName, ...options }), started = performance.now();
    try { const evidence = await action(db, databaseName); results.push({ name, passed: true, ms: performance.now() - started, evidence }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    finally { db.close(); await request(indexedDB.deleteDatabase(databaseName)); }
    write(true);
  }
  write(true);
  await check('Version 1 upgrades its size index without rewriting snapshots or protected Undo', async (db, name) => {
    const before = sample(8, 0), target = sample(8, 1);
    await db.append(before, { wallTime: 1000 }); await db.append(target, { boundary: true, wallTime: 1001 });
    await db.putOperation({ id: 'upgrade-safe', phase: 'committed', before, target }, { protect: true });
    const expected = await db.audit(), raw = await request(indexedDB.open(name));
    const stores = [...raw.objectStoreNames], read = raw.transaction(stores), rows = await Promise.all(stores.map(store => request(read.objectStore(store).getAll())));
    raw.close(); const legacyName = name + '-legacy'; let upgraded;
    try {
      const opening = indexedDB.open(legacyName, 1);
      opening.onupgradeneeded = () => {
        for (const name of stores) {
          const store = opening.result.createObjectStore(name, { keyPath: 'id' });
          if (name === 'records') store.createIndex('json', 'data', { unique: true });
          if (['events', 'checkpoints'].includes(name)) store.createIndex('time', 'time');
        }
      };
      const legacy = await request(opening), tx = legacy.transaction(stores, 'readwrite');
      const committed = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      for (const [index, name] of stores.entries()) for (const row of rows[index]) tx.objectStore(name).put(row);
      await committed; legacy.close();
      upgraded = createAtlasHistoryDatabase({ name: legacyName });
      equal(await upgraded.audit(), expected);
      equalHistory((await upgraded.seek(1000)).state, before); equalHistory((await upgraded.seek(1001)).state, target);
      equal((await upgraded.operation('upgrade-safe')).before, before);
      const inspect = await request(indexedDB.open(legacyName));
      assert(inspect.version === 2 && inspect.transaction('records').objectStore('records').indexNames.contains('bytes'), 'Size-index upgrade was not committed'); inspect.close();
      await upgraded.append(sample(8, 2), { wallTime: 1002 }); return await audit(upgraded);
    } finally { upgraded?.close(); await request(indexedDB.deleteDatabase(legacyName)); }
  });
  await check('Compaction uses size metadata, keeps shared records and reconstructs every retained moment', async db => {
    const original = IDBObjectStore.prototype.openCursor; let payloadScans = 0;
    IDBObjectStore.prototype.openCursor = function (...args) { if (this.name === 'records') payloadScans++; return original.apply(this, args); };
    const moments = new Map(), before = sample(8, 0), target = sample(8, 1);
    try {
      const first = await db.append(before, { boundary: true, wallTime: 1000 }); moments.set(first.time, before);
      await db.putOperation({ id: 'compact-safe', phase: 'committed', before, target }, { protect: true });
      for (let index = 1; index <= 30; index++) {
        const state = sample(8, 0); state.deferred[index % 8].title = 'Changed ' + index;
        if (index % 3 === 0) state.deferred.reverse();
        const point = await db.append(state, { boundary: index % 4 === 0, wallTime: 1000 + index }); moments.set(point.time, state);
      }
      const status = await db.status(); assert(status.oldest > first.time && status.bytes <= 12000, 'Compaction was not exercised');
      assert(payloadScans === 0, 'Compaction/restore preparation scanned dictionary payloads');
      for (const [time, state] of moments) if (time >= status.oldest) equalHistory((await db.seek(time)).state, state);
      const protection = await db.operation('compact-safe'); equal(protection.before, before); equal(protection.target, target);
    } finally { IDBObjectStore.prototype.openCursor = original; }
    return await audit(db);
  }, { limits: { ...ATLAS_HISTORY_LIMITS, budget: 12000, trimTo: 7000 } });
  await check('Timeline metadata counts each retained moment once, uses bounded timestamp buckets, and selects indexed neighbours', async db => {
    const state = sample(8);
    const times = [];
    for (let index = 0; index < 205; index++) {
      state.folders[0].name = `Moment ${index}`;
      times.push((await db.append(state, { wallTime: 1000 + index * 100, boundary: index === 0 })).time);
    }
    const overview = await db.timeline({ start: 1000, end: times.at(-1), bins: 12 });
    assert(overview.total === 205 && overview.buckets.length <= 12, 'Checkpoints are duplicated or timestamp aggregation is unbounded');
    assert(overview.buckets[0].first === 1000 && overview.buckets.at(-1).last === times.at(-1), 'Timeline omits endpoints');
    assert(!JSON.stringify(overview).includes('Ссылка') && !JSON.stringify(overview).includes('patch'), 'Timeline decodes collection payloads');
    assert(await db.nearest(1050) === 1000 && await db.nearest(1051) === 1100, 'Closest snapshot lookup skips a neighbour or resolves ties incorrectly');
    const single = await db.timeline({ start: 1100, end: 1100, bins: 1 });
    assert(single.total === 1 && single.buckets[0].first === 1100, 'Single-moment range is not selectable');
    await db.configure({ paused: true }); await db.configure({ paused: false });
    state.folders[0].name = 'After pause'; const after = await db.append(state, { wallTime: 50000 });
    assert(await db.nearest(49000) === after.time, 'Empty recording gap does not select a real neighbour');
    await db.clear(); assert((await db.timeline({ start: 0, end: 60000 })).total === 0 && await db.nearest(1000) === null, 'Cleared history leaves phantom points');
  });
  await check('Automatic recording is the default; explicit off and pause survive native reopening and Clear', async (db, name) => {
    assert((await db.status()).enabled, 'New history does not record automatically');
    await db.configure({ enabled: false }); db.close();
    const reopened = createAtlasHistoryDatabase({ name });
    try {
      assert(!(await reopened.status()).enabled, 'Reopening reset explicit off');
      await reopened.clear(); assert(!(await reopened.status()).enabled, 'Clear reset explicit off');
      await reopened.configure({ enabled: true, paused: true }); reopened.close();
      const status = await reopened.status(); assert(status.enabled && status.paused, 'Reopening reset explicit pause');
    } finally { reopened.close(); }
  });
  await check('History created with longer checkpoint spacing remains exactly navigable after reopening with current limits', async (db, name) => {
    db.close();
    const previous = createAtlasHistoryDatabase({ name, limits: { ...ATLAS_HISTORY_LIMITS, checkpointEvents: 500, checkpointMs: Number.MAX_SAFE_INTEGER } });
    const state = sample(8), times = [];
    try {
      for (let index = 0; index < 250; index++) {
        state.folders[0].name = `Older cadence ${index}`;
        times.push((await previous.append(state, { wallTime: 1000 + index })).time);
      }
    } finally { previous.close(); }
    for (const index of [0, 199, 200, 201, 249]) {
      const moment = await db.seek(times[index]);
      assert(moment.time === times[index] && moment.state.folders[0].name === `Older cadence ${index}`, 'Replay stopped at the current write limit');
    }
    for (const direction of [-1, 1]) {
      let time = direction < 0 ? times.at(-1) : times[0];
      for (let count = 1; count < times.length; count++) {
        time = await db.step(time, direction);
        const index = direction < 0 ? times.length - 1 - count : count;
        assert(time === times[index] && (await db.seek(time)).time === time, 'Adjacent navigation repeated or skipped a recorded moment');
      }
      assert(await db.step(time, direction) === null, 'Navigation continues beyond the stored endpoints');
    }
    return { moments: times.length, steps: 2 * (times.length - 1), ...await audit(db) };
  });
  await check('Active collections round-trip without archival data with an exact UTF-8 ledger', async db => {
    assert((await db.status()).enabled, 'New history is not enabled by default');
    await db.configure({ enabled: true }); const state = sample();
    const point = await db.append(state, { boundary: true, wallTime: 1000 });
    equalHistory(await db.current(), state); equalHistory((await db.seek(point.time)).state, state);
    return await audit(db);
  });
  await check('No-op capture reuses records; active replay preserves edits, removals, completion and order', async db => {
    const before = sample(); await db.append(before, { wallTime: 1000 });
    const first = await audit(db); const reorderedProperties = JSON.parse(atlasRecordJSON(before));
    assert(!(await db.append(reorderedProperties, { wallTime: 1001 })).changed, 'No-op produced a snapshot');
    equal(await db.audit(), first);
    const after = structuredClone(before); after.folders.reverse(); after.deferred.reverse();
    after.deferred[0].title = 'Edited'; after.deferred[1].completed = !after.deferred[1].completed;
    after.deferred.splice(3, 1); const point = await db.append(after, { wallTime: 1002 });
    equalHistory((await db.seek(point.time)).state, after); equalHistory((await db.seek(1000)).state, before);
    return await audit(db);
  });
  await check('Checkpoint replay is bounded; history older than 30 days is retained by size', async db => {
    const start = Date.now() - 100 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 13; i++) await db.append(sample(5, i), { wallTime: start + i });
    const status = await db.status(); assert(status.oldest === start, 'History unexpectedly expires by age');
    equalHistory((await db.seek(start + 10)).state, sample(5, 10));
    const result = await audit(db); assert(result.totals.checkpoints.count === 3, 'Checkpoint interval differs'); return result;
  }, { limits: { ...ATLAS_HISTORY_LIMITS, checkpointEvents: 5, checkpointMs: Number.MAX_SAFE_INTEGER } });
  await check('Pause and clock rollback disclose gaps without reversing event sequence', async db => {
    await db.append(sample(), { wallTime: 1000 }); await db.configure({ paused: true });
    await db.configure({ paused: false }); await db.append(sample(10, 1), { wallTime: 2000, boundary: true, kind: 'resume' });
    assert((await db.seek(1500)).gap, 'Paused interval was presented as a recorded snapshot');
    const result = await db.append(sample(10, 2), { wallTime: 900 });
    assert(result.time === 2001 && result.seq === 3, 'Clock rollback reversed order');
    assert((await db.status()).segments.at(-1).reason === 'clock-change', 'Clock boundary missing');
    return await audit(db);
  });
  await check('Protected Before restore survives trimming and database reopening', async (db, name) => {
    const before = sample(8, 0), target = sample(8, 1); await db.append(before, { wallTime: 1000 });
    await db.putOperation({ id: 'restore', status: 'prepared', startedAt: 1001, before, target }, { protect: true });
    await db.append(target, { wallTime: 1002, operationId: 'restore', kind: 'restore' });
    for (let i = 2; i < 35; i++) await db.append(sample(8, i), { wallTime: 1002 + i });
    assert((await db.status()).bytes <= 16000, 'History exceeded its budget');
    assert((await db.status()).oldest > 1000, 'The test did not actually trim history');
    equal((await db.operation('restore')).before, before);
    db.close(); const reopened = createAtlasHistoryDatabase({ name, limits: { ...ATLAS_HISTORY_LIMITS, budget: 16000, trimTo: 12000 } });
    try { equal((await reopened.operation('restore')).before, before); equal((await reopened.operation('restore')).target, target); return await audit(reopened); }
    finally { reopened.close(); }
  }, { limits: { ...ATLAS_HISTORY_LIMITS, budget: 16000, trimTo: 12000 } });
  await check('An oversized preparation aborts atomically and keeps the existing protected return point', async db => {
    const state = sample(4); await db.append(state, { wallTime: 1000 });
    await db.putOperation({ id: 'safe', status: 'complete', before: state, target: state }, { protect: true });
    const old = await db.audit(); let rejected = false;
    try { await db.putOperation({ id: 'too-big', status: 'prepared', before: state, target: sample(500, 3) }, { protect: true }); }
    catch (error) { rejected = error.code === 'BUDGET'; }
    assert(rejected, 'Oversized preparation was accepted');
    assert((await db.status()).lastRestore.id === 'safe', 'Old Undo protection was replaced');
    equal(await db.audit(), old); equalHistory(await db.current(), state); return await audit(db);
  }, { limits: { ...ATLAS_HISTORY_LIMITS, budget: 10000, trimTo: 8000 } });
  const eventFault = createQuotaFaultFactory(indexedDB, 'events');
  await check('Native rollback and exactly one quota retry do not leave stale dictionary IDs', async db => {
    await db.append(sample(), { wallTime: 1000 }); eventFault.arm(1);
    await db.append(sample(10, 1), { wallTime: 1001 }); assert(eventFault.faults.count === 1, 'Unexpected retries');
    eventFault.arm(2); let failed = false;
    try { await db.append(sample(10, 2), { wallTime: 1002 }); } catch (error) { failed = error.name === 'QuotaExceededError'; }
    assert(failed && eventFault.faults.count === 2, 'Quota did not stop after one retry');
    equalHistory(await db.current(), sample(10, 1)); await db.append(sample(10, 2), { wallTime: 1003 }); return await audit(db);
  }, { indexedDB: eventFault.factory });
  const recordFault = createQuotaFaultFactory(indexedDB, 'records');
  await check('Batched record quota rollback leaves no partial collection or stale cache and retries once', async db => {
    await db.append(sample(1000), { wallTime: 1000 }); recordFault.arm(1);
    await db.append(sample(1000, 1), { wallTime: 1001 }); assert(recordFault.faults.count === 1, 'Record retry was not bounded');
    recordFault.arm(2); let failed = false;
    try { await db.append(sample(1000, 2), { wallTime: 1002 }); } catch (error) { failed = error.name === 'QuotaExceededError'; }
    assert(failed && recordFault.faults.count === 2, 'Batched record failure did not stop after one retry');
    equalHistory(await db.current(), sample(1000, 1)); await audit(db);
    await db.append(sample(1000, 2), { wallTime: 1003 }); equalHistory(await db.current(), sample(1000, 2));
    return await audit(db);
  }, { indexedDB: recordFault.factory });
  const operationFault = createQuotaFaultFactory(indexedDB, 'operations');
  await check('Quota failure while protecting restore keeps prior Undo and retries only once', async db => {
    const state = sample(); await db.append(state, { wallTime: 1000 });
    await db.putOperation({ id: 'safe', status: 'complete', before: state, target: state }, { protect: true });
    operationFault.arm(2); let failed = false;
    try { await db.putOperation({ id: 'new', status: 'prepared', before: state, target: sample(10, 1) }, { protect: true }); }
    catch (error) { failed = error.name === 'QuotaExceededError'; }
    assert(failed && operationFault.faults.count === 2, 'Protection retry was not bounded');
    assert((await db.status()).lastRestore.id === 'safe', 'Prior Undo vanished');
    assert(!(await db.operation('new')), 'Failed protection partially committed'); return await audit(db);
  }, { indexedDB: operationFault.factory });
  await check('Preparing the next restore retains previous Undo until explicit protection switches', async db => {
    const state = sample(); await db.append(state);
    await db.putOperation({ id: 'first', status: 'complete', before: state, target: state }, { protect: true });
    await db.putOperation({ id: 'next', status: 'prepared', before: state, target: sample(10, 1) });
    assert((await db.status()).lastRestore.id === 'first', 'Preparation displaced Undo');
    await db.putOperation({ id: 'next', status: 'complete' }, { protect: true });
    assert((await db.status()).lastRestore.id === 'next', 'Protection did not switch');
    assert(!(await db.operation('first')), 'Obsolete operation metadata was not bounded'); return await audit(db);
  });
  await check('Explicit Clear removes history and rollback, preserving recording preferences', async db => {
    const state = sample(); await db.configure({ enabled: true, paused: true }); await db.append(state);
    await db.putOperation({ id: 'safe', status: 'complete', before: state, target: state }, { protect: true });
    await db.clear(); const status = await db.status();
    assert(status.enabled && status.paused && !status.lastRestore && !status.oldest, 'Clear changed preferences or kept Undo');
    equal(await db.current(), { folders: [], deferred: [] }); return await audit(db);
  });
  await check('Explicit Clear remains available for missing protection and corrupt model metadata', async (db, name) => {
    await db.configure({ enabled: true, paused: true }); await db.append(sample());
    const raw = await request(indexedDB.open(name));
    const changeRoot = async change => {
      const tx = raw.transaction('meta', 'readwrite'), store = tx.objectStore('meta'), row = await request(store.get('root'));
      change(row); await request(store.put(row));
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    };
    try {
      await changeRoot(row => { row.data.protectedOperation = 'missing-operation'; });
      let failed = false; try { await db.status(); } catch (error) { failed = error.code === 'CORRUPT'; }
      assert(failed, 'Missing protection was hidden'); assert((await db.storageStatus()).bytes > 0, 'Storage management requires intact protection');
      await db.clear(); assert((await db.status()).enabled && (await db.status()).paused, 'Valid preferences were discarded');
      await changeRoot(row => { row.data.model = 'corrupt-fixture'; });
      assert((await db.storageStatus()).bytes === null, 'Corrupt ledger was presented as valid usage');
      await db.clear(); assert((await db.status()).enabled && !(await db.status()).paused, 'Repair did not reset corrupt settings to automatic recording');
      equal(await db.current(), { folders: [], deferred: [] }); return await audit(db);
    } finally { raw.close(); }
  });
  await check('Batched dictionary reads reject missing rows even after a cached seek; explicit repair preserves input', async (db, name) => {
    const input = sample(1000), original = structuredClone(input);
    await db.append(input, { wallTime: 1000 }); equalHistory((await db.seek(1000)).state, input);
    const raw = await request(indexedDB.open(name));
    try {
      const tx = raw.transaction(['meta', 'records'], 'readwrite');
      const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      const root = await request(tx.objectStore('meta').get('root'));
      await request(tx.objectStore('records').delete(root.data.current.deferred[12].valueId)); await done;
      let failed = false; try { await db.seek(1000); } catch (error) { failed = error.code === 'CORRUPT'; }
      assert(failed, 'A cached/missing dictionary row was silently accepted'); equal(input, original);
      await db.clear(); await db.append(input, { wallTime: 2000 }); equalHistory((await db.seek(2000)).state, original);
      return await audit(db);
    } finally { raw.close(); }
  });
  await check('Seek replays the maximum 199 edits before the next checkpoint and preserves active order', async db => {
    const state = sample(100); await db.append(state, { wallTime: 1000 });
    for (let i = 1; i <= 199; i++) {
      state.deferred[i % state.deferred.length].title = `Revision ${i}`;
      if (i % 10 === 0) state.deferred.reverse();
      await db.append(state, { wallTime: 1000 + i });
    }
    const started = performance.now(), selected = await db.seek(1199), seekMs = performance.now() - started;
    equalHistory(selected.state, state); assert((await db.audit()).totals.checkpoints.count === 1, 'Fixture did not exercise 199-event replay');
    return { ...await audit(db), seekMs, replayedEvents: 199 };
  });
  await check('Native durable restore preparation survives reopening; receipt recovery and Undo preserve both collection states', async (db, name) => {
    const past = sample(8), before = sample(8, 1), local = structuredClone(before);
    await db.append(past, { wallTime: 1000 }); await db.append(before, { wallTime: 1100 });
    const first = protocolOwner(db, local, { skipCommitted: true });
    await first.restorer.restore({ id: 'native-restore', time: 1000, expectedRevision: null });
    const restored = planAtlasRestore(before, past).target;
    equal({ folders: local.folders, deferred: local.deferred }, restored);
    assert((await db.pending()).phase === 'prepared', 'Pending restore was not durable');
    assert(!(await db.status()).lastRestore, 'Unfinished restore was reported committed');
    db.close(); const reopened = createAtlasHistoryDatabase({ name });
    try {
      const next = protocolOwner(reopened, local); assert((await next.restorer.recover()).committed, 'Receipt recovery failed');
      const op = await reopened.operation('native-restore'); equal(op.before, before); equal(op.target, restored);
      assert(op.phase === 'committed' && op.targetRecorded && op.commitRevision, 'Operation phase update lost metadata');
      assert(!(await reopened.pending()), 'Pending operation was not settled');
      const preview = await next.restorer.undoPreview('native-restore');
      await next.restorer.undo({ id: 'native-undo', operationId: 'native-restore', expectedRevision: preview.revision });
      equal({ folders: local.folders, deferred: local.deferred }, before);
      equal((await reopened.operation('native-undo')).before, restored);
      assert((await next.restorer.undo({ operationId: 'native-restore' })).alreadyUndone, 'Repeated Undo is not idempotent');
      assert(first.commits() === 1 && next.commits() === 1, 'Recovery or repeated Undo rewrote local collections');
      const report = await audit(reopened); return { ...report, firstCommits: first.commits(), recoveryAndUndoCommits: next.commits() };
    } finally { reopened.close(); }
  });
  await check('Native abandoned preparation retains prior guaranteed Undo after a failed local write', async db => {
    const past = sample(6), local = sample(6, 1); await db.append(past, { wallTime: 1000 });
    const first = protocolOwner(db, local); await first.restorer.restore({ id: 'first', time: 1000, expectedRevision: null });
    await first.writer.mutate(collections => ({ update: { deferred: [...collections.deferred, { id: 'later', url: 'https://atlas.example/later' }] } }));
    const beforeFailed = structuredClone(local), next = protocolOwner(db, local, { failLocal: true });
    const preview = await next.restorer.preview({ time: 1000 }); let failed = false;
    try { await next.restorer.restore({ id: 'failed', time: 1000, expectedRevision: preview.revision }); }
    catch (error) { failed = error.message === 'Synthetic local failure'; }
    assert(failed, 'Synthetic local failure did not happen');
    equal(local, beforeFailed); assert((await db.pending()).id === 'failed', 'Preparation disappeared before recovery');
    assert(!(await next.restorer.recover()).committed, 'Uncommitted restore was replayed');
    assert((await db.status()).lastRestore.id === 'first', 'Previous Undo was displaced by failed local write');
    assert((await db.operation('failed')).phase === 'abandoned', 'Preparation was not marked abandoned');
    return await audit(db);
  });
  const restoreFault = createQuotaFaultFactory(indexedDB, 'operations');
  await check('Native restore protection quota failure commits no local replacement and keeps the old Undo', async db => {
    const past = sample(6), local = sample(6, 1); await db.append(past, { wallTime: 1000 });
    const owner = protocolOwner(db, local); await owner.restorer.restore({ id: 'first', time: 1000, expectedRevision: null });
    await owner.writer.mutate(collections => ({ update: { deferred: [...collections.deferred, { id: 'later', url: 'https://atlas.example/later' }] } }));
    const beforeFailed = structuredClone(local), count = owner.commits(), preview = await owner.restorer.preview({ time: 1000 });
    restoreFault.arm(2); let failed = false;
    try { await owner.restorer.restore({ id: 'quota', time: 1000, expectedRevision: preview.revision }); }
    catch (error) { failed = error.name === 'QuotaExceededError'; }
    assert(failed && restoreFault.faults.count === 2, 'Restore protection quota retry was not bounded');
    equal(local, beforeFailed); assert(owner.commits() === count, 'Quota failure still replaced local collections');
    assert((await db.status()).lastRestore.id === 'first', 'Quota discarded prior Undo');
    assert(!(await db.operation('quota')) && !(await db.pending()), 'Quota left a partially written preparation');
    return await audit(db);
  }, { indexedDB: restoreFault.factory });
  for (const count of [100, 1000, 10000]) await check(`Collection storage timings: ${count} saved links`, async db => {
    const state = sample(count);
    state.deferred = state.deferred.map(({ completedAt, ...link }) => ({ ...link, completed: false }));
    const started = performance.now(); await db.append(state, { wallTime: 1000 });
    const writeMs = performance.now() - started, seeks = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now(), result = await db.seek(1000);
      assert(result.state.deferred.length === count, 'Seek lost saved links'); seeks.push(performance.now() - start);
    }
    seeks.sort((a, b) => a - b); const p95SeekMs = seeks[18];
    if (count === 1000) assert(p95SeekMs <= 250, 'The 1,000-link seek target failed');
    return { count, writeMs, p95SeekMs, bytes: (await db.status()).bytes };
  });
  write(false); run.disabled = false;
});
