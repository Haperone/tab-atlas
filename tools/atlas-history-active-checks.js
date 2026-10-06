import { createAtlasHistoryDatabase } from '../extension/lib/atlas-history-db.js';
import { captureAtlasHistoryState, atlasRecordJSON, diffAtlasStates, ATLAS_HISTORY_LIMITS } from '../extension/lib/atlas-history-model.js';
import { createAtlasHistoryService } from '../extension/lib/atlas-history-service.js';
import { createAtlasCollectionWriter } from '../extension/lib/atlas-collection-writer.js';
import { createAtlasRestorer, ATLAS_RESTORE_KEYS } from '../extension/lib/atlas-history-restore.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const equal = (a, b) => assert(atlasRecordJSON(a) === atlasRecordJSON(b), 'States differ');
const value = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
const folder = { id: 'f', name: 'Original' };
const link = (id, extra = {}) => ({ id, folderId: 'f', url: `https://fixture.example/${id}`, title: id, completed: false, ...extra });
const sample = () => ({ folders: [folder], deferred: [link('restored'), link('archive-only', { completed: true, completedAt: 22, title: 'UNUSED_ARCHIVE_PAYLOAD' }), link('inbox', { folderId: null })] });
function sized(id, data, fields = {}) {
  const row = { id, ...fields, data, bytes: 0 };
  for (let index = 0; index < 6; index++) row.bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
  return row;
}
async function raw(name, action) {
  const db = await value(indexedDB.open(name)), tx = db.transaction(['meta', 'records', 'events', 'checkpoints', 'operations'], 'readwrite'), finished = done(tx);
  try { const result = await action(Object.fromEntries([...db.objectStoreNames].map(name => [name, tx.objectStore(name)]))); await finished; return result; }
  finally { db.close(); }
}
async function ledger(db) {
  const audit = await db.audit(); assert(audit.measured === audit.recorded, 'Ledger differs');
  assert(!audit.missing.length && !audit.unreachable.length, 'Invalid dictionary graph'); return audit;
}
async function seedLegacy(db, name, { protectedUndo = false, damage = false } = {}) {
  // Native rows in the exact previous schema, including an active -> archive -> active transition.
  await db.configure({ enabled: false, paused: true }); db.close();
  const states = [sample(), sample(), sample()];
  states[1].deferred[0] = link('restored', { completed: true, completedAt: 33 });
  states[2].folders[0] = { ...folder, name: 'Renamed' }; states[2].deferred[0].title = 'Returned';
  await raw(name, async stores => {
    const root = await value(stores.meta.get('root')), dictionary = new Map(), rows = [];
    const encode = state => Object.fromEntries(['folders', 'deferred'].map(key => [key, state[key].map(item => {
      const text = atlasRecordJSON(item); if (!dictionary.has(text)) { dictionary.set(text, dictionary.size + 1); rows.push(sized(dictionary.get(text), text)); }
      return { id: item.id, valueId: dictionary.get(text) };
    })]));
    const encoded = states.map(encode), events = encoded.map((state, index) => sized(index + 1, {
      patch: diffAtlasStates(index ? encoded[index - 1] : { folders: [], deferred: [] }, state), kind: 'legacy', segment: 'legacy', wallTime: 1000 + index,
    }, { time: 1000 + index }));
    const checkpoints = [sized(1, { state: encoded[0], segment: 'legacy', wallTime: 1000 }, { time: 1000 }), sized(3, { state: encoded[2], segment: 'legacy', wallTime: 1002 }, { time: 1002 })];
    const operations = protectedUndo ? [sized('legacy-undo', { id: 'legacy-undo', phase: 'committed', kind: 'restore', before: encoded[1], target: encoded[2], createdAt: 1002 })] : [];
    const meta = { ...root.data, seq: 3, time: 1002, wallTime: 1002, current: encoded[2], recordSeq: rows.length, segment: 'legacy', checkpointSeq: 3, checkpointTime: 1002,
      segments: [{ id: 'legacy', start: 1000, end: null, reason: 'baseline' }], protectedOperation: protectedUndo ? 'legacy-undo' : null };
    delete meta.historyProjection;
    const subtotal = [...rows, ...events, ...checkpoints, ...operations].reduce((sum, row) => sum + row.bytes, 0);
    for (let index = 0; index < 6; index++) meta.total = subtotal + sized('root', meta).bytes;
    for (const [key, data] of Object.entries({ records: rows, events, checkpoints, operations })) for (const row of data) await value(stores[key].put(row));
    await value(stores.meta.put(sized('root', meta)));
    if (damage) await value(stores.records.delete(damage === 'folder' ? encoded[0].folders[0].valueId : encoded[1].deferred[0].valueId));
  });
  return states;
}
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true; const results = [];
  const write = running => { document.querySelector('#summary').textContent = `${results.filter(row => row.passed).length}/${results.length} passed`;
    document.querySelector('#results').textContent = JSON.stringify({ running, passed: results.every(row => row.passed), results, note: 'Native IndexedDB; disposable synthetic data and injected local storage, not installed Chrome lifecycle evidence' }, null, 2); };
  async function check(name, action) {
    const databaseName = `atlas-active-test-${crypto.randomUUID()}`, db = createAtlasHistoryDatabase({ name: databaseName });
    try { results.push({ name, passed: true, evidence: await action(db, databaseName) }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    finally { db.close(); await value(indexedDB.deleteDatabase(databaseName)); }
    write(true);
  }
  write(true);
  await check('Active projection excludes archive from native dictionary and handles completion without archiving payloads', async (db, name) => {
    const state = sample(); await db.append(state, { wallTime: 1000 }); equal(await db.current(), captureAtlasHistoryState(state));
    const rows = await raw(name, stores => value(stores.records.getAll())); assert(!JSON.stringify(rows).includes('UNUSED_ARCHIVE_PAYLOAD'), 'Archive was persisted');
    const completed = structuredClone(state); completed.deferred[0].completed = true; completed.deferred[0].completedAt = 55;
    await db.append(completed, { wallTime: 1001 }); equal((await db.seek(1000)).state, captureAtlasHistoryState(state));
    equal((await db.seek(1001)).state, captureAtlasHistoryState(completed));
    completed.deferred[0].title = 'Changed only in archive'; assert(!(await db.append(completed, { wallTime: 1002 })).changed, 'Archive-only edit made a moment');
    return await ledger(db);
  });
  await check('Legacy migration retains dates, sequences, folders and active transitions, and frees archive-only records', async (db, name) => {
    const states = await seedLegacy(db, name);
    for (let index = 0; index < states.length; index++) equal((await db.seek(1000 + index)).state, captureAtlasHistoryState(states[index]));
    const status = await db.status(); assert(status.latestSeq === 3 && status.oldest === 1000, 'Timeline changed'); assert(!status.enabled && status.paused, 'Preferences changed');
    const rows = await raw(name, stores => value(stores.records.getAll())); assert(!rows.some(row => JSON.parse(row.data).completed), 'Unused archived record survived');
    db.close(); equal(await db.current(), captureAtlasHistoryState(states[2])); return await ledger(db);
  });
  await check('Migration preserves existing protected Undo exactly; only operation references may retain archival data', async (db, name) => {
    const states = await seedLegacy(db, name, { protectedUndo: true });
    const operation = await db.operation('legacy-undo'); equal(operation.before, states[1]); equal(operation.target, states[2]);
    for (let index = 0; index < states.length; index++) equal((await db.seek(1000 + index)).state, captureAtlasHistoryState(states[index]));
    assert((await db.status()).lastRestore.id === 'legacy-undo', 'Promised Undo lost'); return await ledger(db);
  });
  await check('Damaged legacy migration aborts atomically and explicit Clear remains available', async (db, name) => {
    for (const damage of ['link', 'folder']) {
    await seedLegacy(db, name, { damage });
    const before = await raw(name, async stores => ({ root: await value(stores.meta.get('root')), events: await value(stores.events.getAll()) }));
    let failed = false; try { await db.status(); } catch (error) { failed = error.code === 'CORRUPT'; }
    assert(failed, 'Missing legacy record was ignored');
    const after = await raw(name, async stores => ({ root: await value(stores.meta.get('root')), events: await value(stores.events.getAll()) })); equal(after, before);
    assert((await db.storageStatus()).bytes != null, 'Storage management unavailable');
    await db.clear(); equal(await db.current(), { folders: [], deferred: [] });
    }
    return await ledger(db);
  });
  await check('Native protected reactivation, reopening, Undo and return-again preserve unselected archive and exact identities', async (db, name) => {
    const past = sample(); await db.append(past, { wallTime: 1000 });
    const local = { folders: [], deferred: [link('restored', { completed: true, completedAt: 90 }), link('unselected', { completed: true, completedAt: 91 })] }, before = structuredClone(local);
    const storage = { async get(keys) { return structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(local, key)).map(key => [key, local[key]]))); },
      async set(update) { Object.assign(local, structuredClone(update)); }, async getBytesInUse() { return storageBytes(local); } };
    let restorer, writer;
    const owner = () => { writer = createAtlasCollectionWriter(storage, { extraKeys: ATLAS_RESTORE_KEYS, beforeChange: () => restorer.recoverPending(), onCommitted: event => restorer.committed(event) });
      restorer = createAtlasRestorer({ database: db, writer, storage }); };
    owner(); const request = { time: 1000, selection: { linkIds: ['restored'] } };
    const preview = await restorer.preview(request); assert(preview.status === 'ready', 'Original missing folder was not restored automatically');
    await restorer.restore({ ...request, expectedRevision: preview.revision, id: 'restore' });
    const restored = { folders: structuredClone(local.folders), deferred: structuredClone(local.deferred) };
    assert(restored.folders[0].id === 'f' && restored.deferred[0].folderId === 'f' && !restored.deferred[0].completed, 'Link did not return to original folder');
    equal(restored.deferred[1], before.deferred[1]); db.close(); owner();
    const undo = await restorer.undoPreview('restore'); await restorer.undo({ id: 'undo', operationId: 'restore', expectedRevision: undo.revision }); equal({ folders: local.folders, deferred: local.deferred }, before);
    const back = await restorer.undoPreview('undo'); await restorer.undo({ id: 'back', operationId: 'undo', expectedRevision: back.revision }); equal({ folders: local.folders, deferred: local.deferred }, restored);
    assert((await db.current()).deferred.every(link => !link.completed), 'Undo polluted ordinary timeline'); return await ledger(db);
  });
  await check('History budget failure preserves an ordinary committed save, stops recording honestly and rejects unprotected restoration', async (db, name) => {
    db.close();
    const limited = createAtlasHistoryDatabase({ name, limits: { ...ATLAS_HISTORY_LIMITS, budget: 6000, trimTo: 4500 } });
    const local = { folders: [folder], deferred: [link('original')] }; let commits = 0;
    const storage = {
      async get(keys) { return structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(local, key)).map(key => [key, local[key]]))); },
      async set(update) { commits++; Object.assign(local, structuredClone(update)); }, async getBytesInUse() { return storageBytes(local); },
    };
    const owner = createAtlasHistoryService({ runtime: { id: 'quota-fixture', getURL: file => `chrome-extension://quota-fixture/${file}` },
      storage: { local: storage, onChanged: { addListener() {} } } }, { database: limited });
    try {
      await owner.start();
      const saved = await owner.collectionCommand({ action: 'save', page: { url: 'https://fixture.example/saved-despite-history-budget', title: 'Тест '.repeat(4000) }, folderId: 'f' });
      assert(saved.changed && saved.historyError && local.deferred.length === 2 && commits === 1, 'History failure discarded or repeated the ordinary save');
      const status = await limited.status();
      assert(status.stopped && !status.stopped.includes('No saved links were changed'), 'Recording stopped with a false claim about the committed save');
      const next = await owner.collectionCommand({ action: 'folder-edit', id: 'f', fields: { name: 'Still editable' } });
      assert(next.changed && local.folders[0].name === 'Still editable' && commits === 2, 'Stopped history blocked the next ordinary edit');
      const before = structuredClone(local), preview = await owner.restorer.preview({ time: status.oldest }); let rejected = false;
      try { await owner.restorer.restore({ id: 'unprotected-budget-restore', time: status.oldest, expectedRevision: preview.revision }); }
      catch (error) { rejected = error.code === 'BUDGET'; }
      assert(rejected && commits === 2, 'Restore wrote without enough space for its return point'); equal(local, before);
      return { commits, stopped: status.stopped, audit: await ledger(limited) };
    } finally { limited.close(); }
  });
  write(false); document.querySelector('#run').disabled = false;
};
