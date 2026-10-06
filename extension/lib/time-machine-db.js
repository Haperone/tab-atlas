import { TIME_MACHINE_LIMITS, emptyHistoryState, diffHistoryStates, applyHistoryPatch } from './time-machine-model.js';

const STORES = ['meta', 'strings', 'events', 'checkpoints', 'operations'];
const encoder = new TextEncoder();
const requestValue = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const rowBytes = row => encoder.encode(JSON.stringify(row)).byteLength;
function sizedRow(id, data, fields = {}) {
  const row = { id, ...fields, data, bytes: 0 };
  for (let i = 0; i < 4; i++) row.bytes = rowBytes(row);
  return row;
}
const initialMeta = () => ({ seq: 0, time: 0, wallTime: 0, total: 0, stringSeq: 0,
  enabled: false, paused: false, stopped: null, current: emptyHistoryState(),
  segment: null, segments: [], checkpointSeq: 0, checkpointTime: 0, epoch: null });

export class HistoryStorageError extends Error {
  constructor(message, code) { super(message); this.name = 'HistoryStorageError'; this.code = code; }
}

async function visit(store, range, fn, direction = 'next') {
  await new Promise((resolve, reject) => {
    const request = store.openCursor(range, direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      try { fn(cursor.value, cursor); cursor.continue(); } catch (error) { reject(error); }
    };
  });
}
async function first(store, range, direction = 'next') {
  const request = store.openCursor(range, direction);
  return await new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.value || null);
  });
}

function mapText(state, convert) {
  return {
    tabs: Object.fromEntries(Object.entries(state.tabs).map(([key, tab]) => [key, convert(tab, ['url', 'title'])])),
    windows: structuredClone(state.windows),
    groups: Object.fromEntries(Object.entries(state.groups).map(([key, group]) => [key, convert(group, ['title'])])),
  };
}
function references(state, set) {
  for (const tab of Object.values(state.tabs || {})) { set.add(tab.urlId); set.add(tab.titleId); }
  for (const group of Object.values(state.groups || {})) set.add(group.titleId);
}

/** Only the worker writes. Every mutation updates the ledger in its transaction. */
export function createTimeMachineDatabase({ indexedDB = globalThis.indexedDB,
  IDBKeyRange = globalThis.IDBKeyRange, name = 'tab-atlas-time-machine', limits = TIME_MACHINE_LIMITS } = {}) {
  let connection = null, opening = null;
  const textIds=new Map();
  async function open() {
    if (connection) return connection;
    if (opening) return await opening;
    if (!indexedDB) throw new HistoryStorageError('History storage is unavailable. Try opening Tab Atlas again.', 'UNAVAILABLE');
    opening = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message, code) => { if (!settled) { settled = true; reject(new HistoryStorageError(message, code)); } };
      const request = indexedDB.open(name, 1);
      const timer = setTimeout(() => fail('History storage is busy. Close other Tab Atlas pages and retry.', 'BLOCKED'), 8000);
      request.onblocked = () => { clearTimeout(timer); fail('Close other Tab Atlas pages to update history storage, then retry.', 'BLOCKED'); };
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeName of STORES) {
          const store = db.createObjectStore(storeName, { keyPath: 'id' });
          if (storeName === 'strings') store.createIndex('text', 'data', { unique: true });
          if (['events', 'checkpoints'].includes(storeName)) store.createIndex('time', 'time');
        }
      };
      request.onerror = () => {
        clearTimeout(timer);
        fail(request.error?.name === 'VersionError' ? 'History was created by a newer version. Update Tab Atlas to use it.' : 'Unable to open history storage. Retry without clearing your saved links.', request.error?.name || 'OPEN_FAILED');
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true; connection = request.result;
        connection.onversionchange = () => { connection?.close(); connection = null; textIds.clear(); };
        connection.onclose = () => { connection = null; textIds.clear(); };
        resolve(connection);
      };
    });
    try { return await opening; } finally { opening = null; }
  }

  async function transaction(mode, body) {
    const db = await open(), tx = db.transaction(STORES, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new HistoryStorageError('History write was interrupted. Retry.', 'ABORTED'));
      tx.onerror = () => {}; // abort is the authoritative transaction result.
    });
    void done.catch(() => {});
    const stores = Object.fromEntries(STORES.map(store => [store, tx.objectStore(store)]));
    try { const result = await body(stores, tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
  }

  async function context(stores) {
    const old = await requestValue(stores.meta.get('root'));
    const meta = old?.data || initialMeta();
    async function put(store, row) {
      const previous = await requestValue(stores[store].get(row.id));
      await requestValue(stores[store].put(row)); meta.total += row.bytes - (previous?.bytes || 0);
    }
    async function erase(store, range) {
      await visit(stores[store], range, (row, cursor) => { meta.total -= row.bytes; cursor.delete(); });
    }
    async function save() {
      const subtotal = meta.total - (old?.bytes || 0);
      let row;
      for (let i = 0; i < 5; i++) { row = sizedRow('root', meta); meta.total = subtotal + row.bytes; }
      row = sizedRow('root', meta);
      await requestValue(stores.meta.put(row));
    }
    function projected() {
      const value = { ...meta }, subtotal = meta.total - (old?.bytes || 0);
      for (let i = 0; i < 5; i++) value.total = subtotal + sizedRow('root', value).bytes;
      return value.total;
    }
    return { stores, meta, put, erase, save, projected };
  }

  async function encode(ctx, state) {
    const texts = new Set();
    for (const tab of Object.values(state.tabs)) { texts.add(tab.url); texts.add(tab.title); }
    for (const group of Object.values(state.groups)) texts.add(group.title);
    const ids = new Map();
    await Promise.all([...texts].map(async text => {
      if(textIds.has(text)){ids.set(text,textIds.get(text));return;}
      const row = await requestValue(ctx.stores.strings.index('text').get(text));
      if (row) {ids.set(text, row.id);textIds.set(text,row.id);}
    }));
    for (const text of texts) {
      if (ids.has(text)) continue;
      const id = ++ctx.meta.stringSeq;
      await ctx.put('strings', sizedRow(id, text)); ids.set(text, id);textIds.set(text,id);
    }
    return mapText(state, (value, fields) => {
      const result = { ...value };
      for (const field of fields) { delete result[field]; result[`${field}Id`] = ids.get(value[field]); }
      return result;
    });
  }

  async function decode(stores, state) {
    const ids = new Set(); references(state, ids);
    const values = new Map();
    await Promise.all([...ids].map(async id => {
      const row = await requestValue(stores.strings.get(id));
      if (!row) throw new HistoryStorageError('Some history data is missing. Retry or clear history from its menu.', 'CORRUPT');
      values.set(id, row.data);
      textIds.set(row.data,id);
    }));
    return mapText(state, (value, fields) => {
      const result = { ...value };
      for (const field of fields) { result[field] = values.get(result[`${field}Id`]); delete result[`${field}Id`]; }
      return result;
    });
  }

  async function collectStrings(ctx) {
    textIds.clear(); // Deleted dictionary IDs must never survive in a worker cache.
    const reachable = new Set(); references(ctx.meta.current, reachable);
    await visit(ctx.stores.checkpoints, null, row => references(row.data.state, reachable));
    await visit(ctx.stores.events, null, row => {
      references({ tabs: Object.fromEntries((row.data.patch.tabs?.put || []).map(t => [t.key, t])),
        groups: Object.fromEntries((row.data.patch.groups?.put || []).map(g => [g.key, g])) }, reachable);
    });
    await visit(ctx.stores.strings, null, (row, cursor) => { if (!reachable.has(row.id)) { ctx.meta.total -= row.bytes; cursor.delete(); } });
  }

  async function compact(ctx, { force = false } = {}) {
    const meta = ctx.meta;
    const cutoff = Date.now() - limits.maxAge;
    const needsSize = force || ctx.projected() > limits.budget - limits.operationReserve;
    if (!needsSize && meta.oldest >= cutoff) return;
    let checkpoints = await requestValue(ctx.stores.checkpoints.getAll());
    if (!checkpoints.length) return;
    if ((needsSize || (checkpoints.at(-1).time < cutoff && meta.time >= cutoff)) && checkpoints.at(-1).id !== meta.seq) {
      const row = sizedRow(meta.seq, { state: meta.current, segment: meta.segment, wallTime:meta.wallTime }, { time: meta.time });
      await ctx.put('checkpoints', row); checkpoints.push(row);
      meta.checkpointSeq = meta.seq; meta.checkpointTime = meta.time;
    }
    let cut = 0;
    while (cut + 1 < checkpoints.length && checkpoints[cut].time < cutoff) cut++;
    if (force) cut = checkpoints.length - 1;
    if (cut) {
      await ctx.erase('checkpoints', IDBKeyRange.upperBound(checkpoints[cut].id, true));
      await ctx.erase('events', IDBKeyRange.upperBound(checkpoints[cut].id, true));
      checkpoints = checkpoints.slice(cut);
    }
    if (cut || needsSize) await collectStrings(ctx);
    while (needsSize && ctx.projected() > limits.trimTo - limits.operationReserve && checkpoints.length > 1) {
      checkpoints.shift();
      await ctx.erase('checkpoints', IDBKeyRange.upperBound(checkpoints[0].id, true));
      await ctx.erase('events', IDBKeyRange.upperBound(checkpoints[0].id, true));
      await collectStrings(ctx);
    }
    const earliest = checkpoints[0].time;
    meta.oldest = earliest;
    meta.markers=(meta.markers || []).filter(marker=>marker.time>=earliest).slice(-50);
    meta.segments = meta.segments.filter(segment => segment.end == null || segment.end >= earliest);
    if (meta.segments[0]) meta.segments[0].start = Math.max(meta.segments[0].start, earliest);
    if (ctx.projected() > limits.budget - limits.operationReserve) {
      throw new HistoryStorageError('The current tabs exceed the history budget. Recording has stopped; saved links are unchanged.', 'BUDGET');
    }
  }

  async function append(state, { kind = 'change', boundary = false, wallTime = Date.now(), operationId = null } = {}) {
    async function write() {
      return await transaction('readwrite', async stores => {
        const ctx = await context(stores), meta = ctx.meta;
        const encoded = await encode(ctx, state), patch = diffHistoryStates(meta.current, encoded);
        const clockJump = meta.wallTime && wallTime < meta.wallTime;
        boundary ||= !!clockJump;
        if (!boundary && !Object.keys(patch).length) return { changed: false, seq: meta.seq };
        const time = Math.max(wallTime, meta.time + 1);
        if (boundary || !meta.segment) {
          if (meta.segments.length) meta.segments.at(-1).end = meta.time;
          meta.segment = crypto.randomUUID();
          meta.segments.push({ id: meta.segment, start: time, end: null, reason: clockJump ? 'clock-change' : kind });
        }
        meta.current = encoded; meta.seq++; meta.time = time; meta.wallTime = wallTime;
        meta.stopped = null;
        meta.markers ||= [];
        if(operationId && !meta.markers.some(marker=>marker.operationId===operationId))meta.markers.push({time,seq:meta.seq,label:'Restore / Undo',operationId});
        if(kind==='window-removed')meta.markers.push({time,seq:meta.seq,label:'Window closed'});
        if(kind==='removed'){
          const burst=meta.removalBurst;
          meta.removalBurst={at:time,count:burst && time-burst.at<1000 ? burst.count+1 : 1};
          if(meta.removalBurst.count===3)meta.markers.push({time,seq:meta.seq,label:'Several tabs closed'});
        }else meta.removalBurst=null;
        meta.markers=meta.markers.slice(-50);
        const event = { patch, kind, operationId, segment: meta.segment, wallTime };
        await ctx.put('events', sizedRow(meta.seq, event, { time }));
        if (boundary || !meta.checkpointSeq || meta.seq - meta.checkpointSeq >= limits.checkpointEvents || time - meta.checkpointTime >= limits.checkpointMs) {
          await ctx.put('checkpoints', sizedRow(meta.seq, { state: encoded, segment: meta.segment, wallTime }, { time }));
          meta.checkpointSeq = meta.seq; meta.checkpointTime = time;
        }
        await compact(ctx); await ctx.save();
        return { changed: true, seq: meta.seq };
      });
    }
    try { return await write(); }
    catch (error) {
      textIds.clear(); // A rolled-back allocation is not a durable string ID.
      if (error.name !== 'QuotaExceededError') throw error;
      await transaction('readwrite', async stores => { const ctx = await context(stores); await compact(ctx, { force: true }); await ctx.save(); });
      try { return await write(); } // exactly one retry; caller pauses recording on failure.
      catch(retryError){textIds.clear();throw retryError;}
    }
  }

  async function status() {
    return await transaction('readonly', async stores => {
      const meta = (await requestValue(stores.meta.get('root')))?.data || initialMeta();
      const earliest = await first(stores.checkpoints);
      const operations = await requestValue(stores.operations.getAll());
      const latestOperation = operations.filter(row => row.data.status !== 'planned').sort((a,b) => b.data.startedAt - a.data.startedAt)[0];
      return { enabled: meta.enabled, paused: meta.paused, stopped: meta.stopped,
        bytes: meta.total, budget: limits.budget, oldest: earliest?.time || null,
        oldestWallTime:earliest?.data.wallTime ?? earliest?.time ?? null,latestWallTime:meta.wallTime || null,
        latest: meta.time || null, latestSeq: meta.seq, segments: meta.segments, markers:meta.markers || [], epoch: meta.epoch,
        lastRestore: latestOperation?.data || null };
    });
  }

  async function maintain() {
    const meta=await transaction('readonly',async stores=>(await requestValue(stores.meta.get('root')))?.data);
    const cutoff=Date.now()-limits.maxAge;
    if(!meta?.time || meta.oldest>=cutoff)return;
    await transaction('readwrite',async stores=>{
      const ctx=await context(stores);
      if(ctx.meta.time<cutoff){
        textIds.clear();
        for(const name of ['events','checkpoints','strings'])await ctx.erase(name);
        Object.assign(ctx.meta,{seq:0,time:0,wallTime:0,current:emptyHistoryState(),segments:[],markers:[],removalBurst:null,segment:null,checkpointSeq:0,checkpointTime:0,oldest:0});
        await visit(stores.operations,null,(row,cursor)=>{if(row.data.startedAt<cutoff){ctx.meta.total-=row.bytes;cursor.delete();}});
      }else await compact(ctx);
      await ctx.save();
    });
  }

  async function current() {
    return await transaction('readonly', async stores => {
      const meta = (await requestValue(stores.meta.get('root')))?.data || initialMeta();
      return await decode(stores, meta.current);
    });
  }

  async function seek(time) {
    return await transaction('readonly', async stores => {
      const meta = (await requestValue(stores.meta.get('root')))?.data || initialMeta();
      const checkpoint = await first(stores.checkpoints.index('time'), IDBKeyRange.upperBound(time), 'prev');
      if (!checkpoint) return { state: emptyHistoryState(), time: null, gap: false, seq: 0 };
      const segment = meta.segments.find(s => s.id === checkpoint.data.segment);
      if (!segment || (segment.end != null && time > segment.end)) return { state: emptyHistoryState(), time, gap: true, seq: checkpoint.id };
      let state = checkpoint.data.state, seq = checkpoint.id, selectedTime = checkpoint.time,wallTime=checkpoint.data.wallTime ?? checkpoint.time;
      const events = await requestValue(stores.events.getAll(IDBKeyRange.lowerBound(checkpoint.id, true), limits.checkpointEvents));
      for (const row of events) {
        if (row.time > time || row.data.segment !== checkpoint.data.segment) break;
        state = applyHistoryPatch(state, row.data.patch); seq = row.id; selectedTime = row.time;wallTime=row.data.wallTime;
      }
      return { state: await decode(stores, state), time: selectedTime, wallTime, gap: false, seq };
    });
  }

  async function step(sequence, direction, time = null) {
    return await transaction('readonly', async stores => {
      // A gap has no event sequence of its own. Navigate from its actual position.
      const value=time ?? sequence;
      const range = direction < 0 ? IDBKeyRange.upperBound(value, true) : IDBKeyRange.lowerBound(value, true);
      const row = await first(time == null ? stores.events : stores.events.index('time'), range, direction < 0 ? 'prev' : 'next');
      return row?.time || null;
    });
  }

  async function configure(values) {
    await transaction('readwrite', async stores => {
      const ctx = await context(stores);
      for (const field of ['enabled', 'paused', 'stopped', 'epoch']) if (Object.hasOwn(values, field)) ctx.meta[field] = values[field];
      if (values.paused || values.stopped) {
        if (ctx.meta.segments.length) ctx.meta.segments.at(-1).end = ctx.meta.time;
      }
      await ctx.save();
    });
  }

  async function clear() {
    textIds.clear();
    await transaction('readwrite', async stores => {
      const old = (await requestValue(stores.meta.get('root')))?.data || initialMeta();
      await Promise.all(STORES.map(store => requestValue(stores[store].clear())));
      const meta = { ...initialMeta(), enabled: old.enabled, paused: old.paused, epoch: old.epoch };
      for (let i = 0; i < 4; i++) meta.total = sizedRow('root', meta).bytes;
      await requestValue(stores.meta.put(sizedRow('root', meta)));
    });
  }

  async function putOperation(operation) {
    const write = () => transaction('readwrite', async stores => {
      const ctx = await context(stores);
      const row = sizedRow(operation.id, operation);
      if (row.bytes > limits.operationReserve) throw new HistoryStorageError('This restore is too large. Select fewer tabs and retry.', 'OPERATION_BUDGET');
      await ctx.put('operations', row);
      // A preparation must not erase Undo. Unknown old request IDs can never start again.
      await visit(stores.operations, null, (previous, cursor) => {
        const obsolete = operation.status === 'planned' ? previous.data.status === 'planned' : previous.data.status !== 'planned';
        if (previous.id !== row.id && obsolete) { ctx.meta.total -= previous.bytes; cursor.delete(); }
      });
      let operationBytes = 0;
      await visit(stores.operations, null, record => { operationBytes += record.bytes; });
      if (operationBytes > limits.operationReserve) throw new HistoryStorageError('The restore selection is too large. Select fewer tabs and retry.', 'OPERATION_BUDGET');
      await compact(ctx); await ctx.save();
      if (ctx.meta.total > limits.budget) throw new HistoryStorageError('History storage is full. Clear older history and retry.', 'BUDGET');
    });
    try { await write(); }
    catch (error) {
      textIds.clear();
      if (error.name !== 'QuotaExceededError') throw error;
      await transaction('readwrite', async stores => { const ctx = await context(stores); await compact(ctx, { force: true }); await ctx.save(); });
      try { await write(); } // One bounded cleanup and one retry, including ownership writes.
      catch (retryError) { textIds.clear(); throw retryError; }
    }
  }

  async function operation(id) {
    return await transaction('readonly', async stores => (await requestValue(stores.operations.get(id)))?.data || null);
  }

  async function audit() {
    return await transaction('readonly', async stores => {
      const totals = {}, ids = new Set(); let sum = 0;
      for (const name of STORES) {
        totals[name] = { count: 0, bytes: 0 };
        await visit(stores[name], null, row => { totals[name].count++; totals[name].bytes += row.bytes; sum += row.bytes; if (name === 'strings') ids.add(row.id); });
      }
      const referenced = new Set();
      const meta = (await requestValue(stores.meta.get('root')))?.data || initialMeta(); references(meta.current, referenced);
      await visit(stores.checkpoints, null, row => references(row.data.state, referenced));
      await visit(stores.events, null, row => references({ tabs: Object.fromEntries((row.data.patch.tabs?.put || []).map(t => [t.key, t])), groups: Object.fromEntries((row.data.patch.groups?.put || []).map(g => [g.key, g])) }, referenced));
      return { totals, measured: sum, recorded: meta.total, missing: [...referenced].filter(id => !ids.has(id)), unreachable: [...ids].filter(id => !referenced.has(id)) };
    });
  }

  function close() { connection?.close(); connection = null; textIds.clear(); }
  return { append, status, current, seek, step, configure, clear, maintain, putOperation, operation, audit, close };
}
