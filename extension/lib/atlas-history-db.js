import { ATLAS_HISTORY_LIMITS, emptyAtlasState, captureAtlasState, captureAtlasHistoryState, atlasRecordJSON,
  diffAtlasStates, applyAtlasPatch, replayAtlas } from './atlas-history-model.js';

const names = ['meta', 'records', 'events', 'checkpoints', 'operations'];
const collections = ['folders', 'deferred'];
const encoder = new TextEncoder();
const value = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const bytes = row => encoder.encode(JSON.stringify(row)).byteLength;
function sized(id, data, fields = {}) {
  const row = { id, ...fields, data, bytes: 0 };
  for (let i = 0; i < 5; i++) row.bytes = bytes(row);
  return row;
}
const initial = () => ({ model: 'atlas-collections-v1', seq: 0, time: 0, wallTime: 0, total: 0, recordSeq: 0,
  historyProjection: 'active-v1',
  current: emptyAtlasState(), enabled: true, paused: false, stopped: null,
  segments: [], segment: null, checkpointSeq: 0, checkpointTime: 0, protectedOperation: null, pendingOperation: null });

export class AtlasHistoryStorageError extends Error {
  constructor(message, code) { super(message); this.name = 'AtlasHistoryStorageError'; this.code = code; }
}
const damaged = () => new AtlasHistoryStorageError('Some Atlas history is missing or damaged. Retry or clear history from its menu.', 'CORRUPT');

async function visit(store, range, action, direction = 'next') {
  await new Promise((resolve, reject) => {
    const request = store.openCursor(range, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      try { action(cursor.value, cursor); cursor.continue(); } catch (error) { reject(error); }
    };
  });
}
async function first(store, range, direction = 'next') {
  return await new Promise((resolve, reject) => {
    const request = store.openCursor(range, direction);
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}
async function recordSizes(store, action) {
  await new Promise((resolve, reject) => {
    const request = store.index('bytes').openKeyCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return resolve();
      try { action(cursor.primaryKey, cursor.key); cursor.continue(); } catch (error) { reject(error); }
    };
  });
}
function references(state, ids) {
  for (const name of collections) for (const item of state?.[name] || []) ids.add(item.valueId);
}
function patchReferences(patch, ids) {
  for (const name of collections) for (const item of patch?.[name]?.put || []) ids.add(item.valueId);
}

/** Separate database: old browser history is neither converted nor deleted. One worker owns writes. */
export function createAtlasHistoryDatabase({ indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange,
  name = 'tab-atlas-collections-history', limits = ATLAS_HISTORY_LIMITS } = {}) {
  let connection = null, opening = null, projectionReady = null;
  const recordIds = new Map();
  async function open() {
    if (connection) return connection;
    if (opening) return await opening;
    if (!indexedDB) throw new AtlasHistoryStorageError('Atlas history storage is unavailable. Retry.', 'UNAVAILABLE');
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message, code) => {
        if (settled) return; settled = true; reject(new AtlasHistoryStorageError(message, code));
      };
      const request = indexedDB.open(name, 2);
      const timer = setTimeout(() => fail('Atlas history storage is busy. Close other Atlas pages and retry.', 'BLOCKED'), 8000);
      request.onblocked = () => { clearTimeout(timer); fail('Close other Atlas pages to update history storage, then retry.', 'BLOCKED'); };
      request.onupgradeneeded = () => {
        for (const storeName of names) {
          if (request.result.objectStoreNames.contains(storeName)) continue;
          const store = request.result.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'records') store.createIndex('json', 'data', { unique: true });
          if (['events', 'checkpoints'].includes(storeName)) store.createIndex('time', 'time');
        }
        // Existing v1 records already carry exact ledger sizes. Index them
        // natively without rewriting history or protected return points.
        const records = request.transaction.objectStore('records');
        if (!records.indexNames.contains('bytes')) records.createIndex('bytes', 'bytes');
      };
      request.onerror = () => {
        clearTimeout(timer); fail(request.error?.name === 'VersionError'
          ? 'Atlas history belongs to a newer version. Update Tab Atlas.'
          : 'Unable to open Atlas history. Retry without clearing saved links.', request.error?.name || 'OPEN_FAILED');
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true; connection = request.result;
        connection.onversionchange = () => { connection?.close(); connection = null; projectionReady = null; recordIds.clear(); };
        connection.onclose = () => { connection = null; projectionReady = null; recordIds.clear(); };
        resolve(connection);
      };
    });
    try { return await opening; } finally { opening = null; }
  }
  async function transaction(mode, action, migrating = false) {
    const database = await open();
    if (!migrating) await ensureActiveProjection();
    const tx = database.transaction(names, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new AtlasHistoryStorageError('Atlas history write was interrupted. Retry.', 'ABORTED'));
      tx.onerror = () => {};
    });
    void done.catch(() => {});
    const stores = Object.fromEntries(names.map(store => [store, tx.objectStore(store)]));
    try { const result = await action(stores); await done; return result; }
    catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); recordIds.clear(); throw error; }
  }
  async function metadata(stores) {
    const row = await value(stores.meta.get('root'));
    if (row && row.data?.model !== 'atlas-collections-v1') throw damaged();
    return row;
  }
  async function context(stores) {
    const old = await metadata(stores), meta = old?.data || initial();
    async function put(store, row) {
      const previous = await value(stores[store].get(row.id));
      await value(stores[store].put(row)); meta.total += row.bytes - (previous?.bytes || 0);
    }
    function root(total = meta.total) {
      const subtotal = total - (old?.bytes || 0), data = { ...meta };
      for (let i = 0; i < 6; i++) data.total = subtotal + sized('root', data).bytes;
      return sized('root', data);
    }
    async function save() { const row = root(); meta.total = row.data.total; await value(stores.meta.put(row)); }
    return { stores, meta, put, projected: (freed = 0) => root(meta.total - freed).data.total, save };
  }

  async function ensureActiveProjection() {
    if (!projectionReady) projectionReady = transaction('readwrite', async stores => {
      const root = await metadata(stores);
      if (!root || root.data.historyProjection === 'active-v1') return;
      if (root.data.historyProjection != null) throw damaged();
      const ctx = await context(stores), records = new Map();
      await visit(stores.records, null, row => {
        try { records.set(row.id, JSON.parse(row.data)); } catch { throw damaged(); }
      });
      const active = state => {
        for (const name of collections) for (const reference of state[name]) {
          const record = records.get(reference.valueId);
          if (!record || record.id !== reference.id) throw damaged();
        }
        return { folders: state.folders, deferred: state.deferred.filter(reference => {
          const record = records.get(reference.valueId); return !record.completed && !record.dismissed;
        }) };
      };
      const checkpoints = await value(stores.checkpoints.getAll());
      const events = await value(stores.events.getAll());
      let previous = emptyAtlasState(), original = checkpoints[0]?.data.state;
      if (ctx.meta.seq && !original) throw damaged();
      // Rebuild deltas from each original moment before removing archived versions.
      // Filtering put/remove lists alone would lose active -> archive transitions.
      for (const row of events) {
        if (row.id < checkpoints[0].id) continue;
        if (row.id !== checkpoints[0].id) original = applyAtlasPatch(original, row.data.patch);
        const projected = active(original);
        await ctx.put('events', sized(row.id, { ...row.data, patch: diffAtlasStates(previous, projected) }, { time: row.time }));
        previous = projected;
      }
      for (const row of checkpoints) {
        await ctx.put('checkpoints', sized(row.id, { ...row.data, state: active(row.data.state) }, { time: row.time }));
      }
      ctx.meta.current = active(ctx.meta.current);
      await visit(stores.operations, null, row => { active(row.data.before); active(row.data.target); });
      ctx.meta.historyProjection = 'active-v1';
      // Protected operations stay exact so an already promised Undo remains valid.
      await collect(ctx); await ctx.save();
    }, true);
    try { await projectionReady; } catch (error) { projectionReady = null; throw error; }
  }
  async function encode(ctx, state) {
    const texts = new Set(collections.flatMap(name => state[name].map(atlasRecordJSON))), ids = new Map();
    await Promise.all([...texts].map(async text => {
      if (recordIds.has(text)) { ids.set(text, recordIds.get(text)); return; }
      const row = await value(ctx.stores.records.index('json').get(text));
      if (row) { ids.set(text, row.id); recordIds.set(text, row.id); }
    }));
    const missing = [...texts].filter(text => !ids.has(text));
    for (let offset = 0; offset < missing.length; offset += 500) {
      // The whole write remains one atomic transaction. Bounded batches avoid
      // serial native round trips for each of 10,000 imported/restored records.
      await Promise.all(missing.slice(offset, offset + 500).map(async text => {
        const id = ++ctx.meta.recordSeq; await ctx.put('records', sized(id, text));
        ids.set(text, id); recordIds.set(text, id);
      }));
    }
    return Object.fromEntries(collections.map(name => [name, state[name].map(item => ({ id: item.id, valueId: ids.get(atlasRecordJSON(item)) }))]));
  }
  async function decode(stores, state) {
    const ids = new Set(); references(state, ids); const records = new Map();
    const sorted = [...ids];
    if (sorted.some(id => !Number.isSafeInteger(id) || id < 1)) throw damaged();
    sorted.sort((a, b) => a - b);
    const ranges = [];
    for (const id of sorted) {
      const last = ranges.at(-1);
      if (last && id === last.end + 1 && last.end - last.start < 499) last.end = id;
      else ranges.push({ start: id, end: id });
    }
    // Read only referenced rows, batching contiguous dictionary IDs. Cold seeks
    // should not need one native request per link or load unrelated old versions.
    await Promise.all(ranges.map(async ({ start, end }) => {
      const rows = await value(stores.records.getAll(IDBKeyRange.bound(start, end)));
      if (rows.length !== end - start + 1) throw damaged();
      for (const row of rows) {
        if (typeof row.data !== 'string' || !ids.has(row.id)) throw damaged();
        try { records.set(row.id, JSON.parse(row.data)); } catch { throw damaged(); }
        recordIds.set(row.data, row.id);
      }
    }));
    const result = Object.fromEntries(collections.map(name => [name, state[name].map(item => {
      const record = records.get(item.valueId); if (record?.id !== item.id) throw damaged(); return structuredClone(record);
    })]));
    return captureAtlasState(result);
  }
  async function reachable(stores, meta) {
    const ids = new Set(); references(meta.current, ids);
    await visit(stores.checkpoints, null, row => references(row.data.state, ids));
    await visit(stores.events, null, row => patchReferences(row.data.patch, ids));
    await visit(stores.operations, null, row => { references(row.data.before, ids); references(row.data.target, ids); });
    return ids;
  }
  async function collect(ctx) {
    recordIds.clear(); const ids = await reachable(ctx.stores, ctx.meta);
    await recordSizes(ctx.stores.records, (id, size) => { if (!ids.has(id)) { ctx.meta.total -= size; ctx.stores.records.delete(id); } });
  }
  async function compact(ctx, force = false) {
    if (!force && ctx.projected() <= limits.budget) return;
    let checkpoints = await value(ctx.stores.checkpoints.getAll());
    if (ctx.meta.seq && checkpoints.at(-1)?.id !== ctx.meta.seq) {
      const row = sized(ctx.meta.seq, { state: ctx.meta.current, segment: ctx.meta.segment, wallTime: ctx.meta.wallTime }, { time: ctx.meta.time });
      await ctx.put('checkpoints', row); checkpoints.push(row);
      ctx.meta.checkpointSeq = ctx.meta.seq; ctx.meta.checkpointTime = ctx.meta.time;
    }
    const [events, operations] = await Promise.all([value(ctx.stores.events.getAll()), value(ctx.stores.operations.getAll())]);
    const counts = new Map(), sizes = new Map();
    const stateIds = state => { const ids = new Set(); references(state, ids); return ids; };
    const eventIds = row => { const ids = new Set(); patchReferences(row.data.patch, ids); return ids; };
    const add = ids => { for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1); };
    add(stateIds(ctx.meta.current));
    for (const row of operations) { add(stateIds(row.data.before)); add(stateIds(row.data.target)); }
    for (const row of checkpoints) add(stateIds(row.data.state));
    for (const row of events) add(eventIds(row));
    await recordSizes(ctx.stores.records, (id, size) => sizes.set(id, size));
    let freed = 0, eventIndex = 0, checkpointIndex = 0;
    for (const [id, size] of sizes) if (!counts.has(id)) freed += size;
    const remove = ids => {
      for (const id of ids) {
        const count = counts.get(id); if (!count || !sizes.has(id)) throw damaged();
        if (count === 1) { counts.delete(id); freed += sizes.get(id); } else counts.set(id, count - 1);
      }
    };
    // Calculate the oldest retained checkpoint using small reference/size
    // metadata, rather than rescanning every record after each discarded point.
    let retained = checkpoints[0];
    for (const candidate of force ? checkpoints.slice(-1) : checkpoints) {
      while (eventIndex < events.length && events[eventIndex].id < candidate.id) {
        const row = events[eventIndex++]; freed += row.bytes; remove(eventIds(row));
      }
      while (checkpointIndex < checkpoints.length && checkpoints[checkpointIndex].id < candidate.id) {
        const row = checkpoints[checkpointIndex++]; freed += row.bytes; remove(stateIds(row.data.state));
      }
      retained = candidate;
      if (ctx.projected(freed) <= limits.trimTo) break;
    }
    const oldest = retained?.time ?? ctx.meta.time;
    if (retained) {
      await Promise.all([value(ctx.stores.events.delete(IDBKeyRange.upperBound(retained.id, true))), value(ctx.stores.checkpoints.delete(IDBKeyRange.upperBound(retained.id, true)))]);
    }
    for (const id of sizes.keys()) if (!counts.has(id)) ctx.stores.records.delete(id);
    ctx.meta.total -= freed; recordIds.clear();
    ctx.meta.segments = ctx.meta.segments.filter(segment => segment.end == null || segment.end >= oldest);
    if (ctx.meta.segments[0]) ctx.meta.segments[0].start = Math.max(ctx.meta.segments[0].start, oldest);
    if (ctx.projected() > limits.budget) throw new AtlasHistoryStorageError('History cannot fit this Atlas and its protected return point.', 'BUDGET');
  }
  async function retryQuota(write) {
    try { return await write(); }
    catch (error) {
      if (error.name !== 'QuotaExceededError') throw error;
      await transaction('readwrite', async stores => { const ctx = await context(stores); await compact(ctx, true); await ctx.save(); });
      return await write(); // Exactly one retry. Protected operations are retained during cleanup.
    }
  }
  async function append(input, { kind = 'change', boundary = false, wallTime = Date.now(), operationId = null } = {}) {
    const state = captureAtlasHistoryState(input);
    return await retryQuota(() => transaction('readwrite', async stores => {
      const ctx = await context(stores), meta = ctx.meta;
      const operation = operationId ? await value(stores.operations.get(operationId)) : null;
      if (operation?.data.targetRecorded) return { changed: false, seq: operation.data.targetSeq };
      const encoded = await encode(ctx, state);
      const patch = diffAtlasStates(meta.current, encoded), clockJump = meta.wallTime && wallTime < meta.wallTime;
      if (!boundary && !clockJump && !Object.keys(patch).length) return { changed: false, seq: meta.seq };
      const time = Math.max(wallTime, meta.time + 1);
      if (boundary || clockJump || !meta.segment) {
        if (meta.segments.length) meta.segments.at(-1).end = meta.time;
        meta.segment = crypto.randomUUID(); meta.segments.push({ id: meta.segment, start: time, end: null, reason: clockJump ? 'clock-change' : kind });
      }
      Object.assign(meta, { current: encoded, seq: meta.seq + 1, time, wallTime, stopped: null });
      await ctx.put('events', sized(meta.seq, { patch, kind, operationId, segment: meta.segment, wallTime }, { time }));
      if (operation) await ctx.put('operations', sized(operationId, { ...operation.data, targetRecorded: true, targetSeq: meta.seq }));
      if (boundary || clockJump || !meta.checkpointSeq || meta.seq - meta.checkpointSeq >= limits.checkpointEvents || time - meta.checkpointTime >= limits.checkpointMs) {
        await ctx.put('checkpoints', sized(meta.seq, { state: encoded, segment: meta.segment, wallTime }, { time }));
        meta.checkpointSeq = meta.seq; meta.checkpointTime = time;
      }
      await compact(ctx); await ctx.save(); return { changed: true, seq: meta.seq, time };
    }));
  }
  async function status() {
    return await transaction('readonly', async stores => {
      const meta = (await metadata(stores))?.data || initial(), earliest = await first(stores.checkpoints);
      const row = meta.protectedOperation ? await value(stores.operations.get(meta.protectedOperation)) : null;
      if (meta.protectedOperation && !row) throw damaged();
      return { enabled: meta.enabled, paused: meta.paused, stopped: meta.stopped, bytes: meta.total, budget: limits.budget, trimTo: limits.trimTo,
        latest: meta.time || null, latestSeq: meta.seq, latestWallTime: meta.wallTime || null,
        oldest: earliest?.time || null, oldestWallTime: earliest?.data.wallTime || null, segments: meta.segments,
        lastRestore: row ? { ...row.data, before: undefined, target: undefined } : null };
    });
  }
  async function current() {
    return await transaction('readonly', async stores => decode(stores, (await metadata(stores))?.data.current || emptyAtlasState()));
  }
  async function seek(time) {
    if (!Number.isFinite(time) || time < 0) throw new Error('Choose an available Atlas snapshot.');
    return await transaction('readonly', async stores => {
      const meta = (await metadata(stores))?.data || initial();
      const checkpoint = await first(stores.checkpoints.index('time'), IDBKeyRange.upperBound(time), 'prev');
      if (!checkpoint) return { state: emptyAtlasState(), time: null, seq: 0, gap: false };
      const segment = meta.segments.find(item => item.id === checkpoint.data.segment);
      if (!segment) throw damaged();
      if (segment.end != null && time > segment.end) return { state: emptyAtlasState(), time, seq: checkpoint.id, gap: true };
      let selected = checkpoint;
      const replay = [];
      // Bound replay by the stored time window. An older checkpoint cadence may
      // exceed today's write limit; truncating it returns the same earlier moment.
      const events = time > checkpoint.time ? await value(stores.events.index('time').getAll(IDBKeyRange.bound(checkpoint.time, time, true, false))) : [];
      for (const row of events) {
        if (row.time > time || row.data.segment !== segment.id) break;
        replay.push({ patch: row.data.patch }); selected = row;
      }
      const state = replayAtlas(checkpoint.data.state, replay);
      return { state: captureAtlasHistoryState(await decode(stores, state)), time: selected.time, wallTime: selected.data.wallTime, seq: selected.id, gap: false };
    });
  }
  async function step(time, direction) {
    if (!Number.isFinite(time) || ![-1, 1].includes(direction)) throw new Error('Choose an earlier or later Atlas snapshot.');
    return await transaction('readonly', async stores => {
      const range = direction < 0 ? IDBKeyRange.upperBound(time, true) : IDBKeyRange.lowerBound(time, true);
      return (await first(stores.events.index('time'), range, direction < 0 ? 'prev' : 'next'))?.time || null;
    });
  }
  async function timeline({ start, end, bins = 24 } = {}) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || !Number.isInteger(bins) || bins < 1 || bins > 200) throw new Error('Choose an available history period.');
    return await transaction('readonly', async stores => {
      const earliest = await first(stores.checkpoints);
      if (!earliest) return { start, end, total: 0, buckets: [] };
      const index = stores.events.index('time'), countBins = start === end ? 1 : bins;
      // Bounded index requests, independent of the number of recorded changes.
      // count() runs in IndexedDB; key cursors fetch only each bucket's endpoints.
      const buckets = await Promise.all(Array.from({ length: countBins }, async (_, bucketIndex) => {
        const from = Math.max(earliest.time, start + (end - start) * bucketIndex / countBins);
        const to = start + (end - start) * (bucketIndex + 1) / countBins, openEnd = bucketIndex < countBins - 1;
        if (from > to || from === to && openEnd) return null;
        const range = IDBKeyRange.bound(from, to, false, openEnd);
        const [count, firstKey, lastKey] = await Promise.all([value(index.count(range)), value(index.openKeyCursor(range)), value(index.openKeyCursor(range, 'prev'))]);
        const baseline = earliest.time >= from && (earliest.time < to || !openEnd && earliest.time === to) && firstKey?.key !== earliest.time;
        if (!count && !baseline) return null;
        return { index: bucketIndex, first: baseline ? earliest.time : firstKey.key, last: lastKey?.key ?? earliest.time, count: count + Number(baseline) };
      }));
      const rows = buckets.filter(Boolean);
      return { start, end, total: rows.reduce((total, bucket) => total + bucket.count, 0), buckets: rows };
    });
  }
  async function nearest(time) {
    if (!Number.isFinite(time) || time < 0) throw new Error('Choose an available Atlas snapshot.');
    return await transaction('readonly', async stores => {
      const earliest = await first(stores.checkpoints); if (!earliest) return null;
      const index = stores.events.index('time');
      const neighbours = await Promise.all([
        value(index.openKeyCursor(IDBKeyRange.upperBound(time), 'prev')),
        value(index.openKeyCursor(IDBKeyRange.lowerBound(time), 'next')),
      ]);
      const candidates = [earliest.time, ...neighbours.filter(Boolean).map(cursor => cursor.key)].filter(candidate => candidate >= earliest.time);
      return candidates.sort((a, b) => Math.abs(a - time) - Math.abs(b - time) || a - b)[0];
    });
  }
  async function configure(settings) {
    await transaction('readwrite', async stores => {
      const ctx = await context(stores);
      for (const key of ['enabled', 'paused', 'stopped']) if (Object.hasOwn(settings, key)) ctx.meta[key] = settings[key];
      if ((settings.paused || settings.stopped || settings.enabled === false) && ctx.meta.segments.length) ctx.meta.segments.at(-1).end = ctx.meta.time;
      await ctx.save();
    });
  }
  async function putOperation(operation, { protect = false } = {}) {
    if (typeof operation?.id !== 'string' || !operation.id) throw new Error('This restore operation is unavailable.');
    const input = structuredClone(operation);
    const before = input.before ? captureAtlasState(input.before) : null, target = input.target ? captureAtlasState(input.target) : null;
    await retryQuota(() => transaction('readwrite', async stores => {
      const ctx = await context(stores), previous = await value(stores.operations.get(input.id));
      const data = { ...previous?.data, ...input, before: before ? await encode(ctx, before) : previous?.data.before,
        target: target ? await encode(ctx, target) : previous?.data.target };
      if (!data.before || !data.target) throw new Error('Protect the current Atlas before restoring it.');
      await ctx.put('operations', sized(input.id, data));
      if (input.phase === 'prepared') ctx.meta.pendingOperation = input.id;
      if (['committed', 'abandoned'].includes(input.phase) && ctx.meta.pendingOperation === input.id) ctx.meta.pendingOperation = null;
      if (protect) ctx.meta.protectedOperation = input.id;
      // At most the durable rollback and the current preparation. An expired id cannot start again.
      let referencesChanged = !!before || !!target;
      await visit(stores.operations, null, (row, cursor) => {
        if (row.id !== input.id && row.id !== ctx.meta.protectedOperation && row.id !== ctx.meta.pendingOperation) {
          ctx.meta.total -= row.bytes; cursor.delete(); referencesChanged = true;
        }
      });
      // Phase/receipt metadata leaves the record graph unchanged. Avoid scanning
      // the whole journal and discarding its dictionary cache for those updates.
      if (referencesChanged) await collect(ctx);
      await compact(ctx); await ctx.save();
    }));
  }
  async function operation(id) {
    return await transaction('readonly', async stores => {
      const row = await value(stores.operations.get(id)); if (!row) return null;
      return { ...row.data, before: await decode(stores, row.data.before), target: await decode(stores, row.data.target) };
    });
  }
  async function pending() {
    const id = await transaction('readonly', async stores => (await metadata(stores))?.data.pendingOperation);
    return id ? await operation(id) : null;
  }
  async function clear() {
    recordIds.clear();
    await transaction('readwrite', async stores => {
      const row = await value(stores.meta.get('root'));
      const old = row?.data?.model === 'atlas-collections-v1' ? row.data : initial();
      await Promise.all(names.map(store => value(stores[store].clear())));
      const meta = { ...initial(), enabled: old.enabled, paused: old.paused };
      for (let i = 0; i < 6; i++) meta.total = sized('root', meta).bytes;
      await value(stores.meta.put(sized('root', meta)));
    }, true);
    projectionReady = null;
  }
  async function storageStatus() {
    // Storage management does not decode history or require an intact rollback record.
    return await transaction('readonly', async stores => {
      const row = await value(stores.meta.get('root')), meta = row?.data;
      return { bytes: meta?.model === 'atlas-collections-v1' && Number.isFinite(meta.total) ? meta.total : null, budget: limits.budget, trimTo: limits.trimTo };
    }, true);
  }
  async function audit() {
    return await transaction('readonly', async stores => {
      const meta = (await metadata(stores))?.data || initial(), referenced = await reachable(stores, meta);
      const totals = {}, present = new Set(); let measured = 0;
      for (const name of names) {
        totals[name] = { count: 0, bytes: 0 };
        await visit(stores[name], null, row => {
          totals[name].count++; totals[name].bytes += bytes(row); measured += bytes(row);
          if (name === 'records') present.add(row.id);
        });
      }
      return { totals, measured, recorded: meta.total, missing: [...referenced].filter(id => !present.has(id)), unreachable: [...present].filter(id => !referenced.has(id)) };
    });
  }
  function close() { connection?.close(); connection = null; projectionReady = null; recordIds.clear(); }
  return { append, status, storageStatus, current, seek, step, timeline, nearest, configure, putOperation, operation, pending, clear, audit, close };
}
