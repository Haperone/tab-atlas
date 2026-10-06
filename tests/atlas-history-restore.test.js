import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasCollectionWriter, ATLAS_REVISION_KEY } from '../extension/lib/atlas-collection-writer.js';
import { createAtlasRestorer, ATLAS_RESTORE_KEYS, ATLAS_RESTORE_RECEIPT_KEY, ATLAS_GENERATION_KEY,
  ATLAS_ARCHIVE_PROTECTION_KEY } from '../extension/lib/atlas-history-restore.js';
import { captureAtlasHistoryState } from '../extension/lib/atlas-history-model.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

const clone = structuredClone;
const past = () => ({ folders: [{ id: 'f', name: 'Work' }], deferred: [
  { id: 'old', folderId: 'f', url: 'https://example.test/old', title: 'Old', completed: false },
  { id: 'archive', folderId: 'f', url: 'https://example.test/archive', completed: true, completedAt: '2025-01-01T00:00:00Z' },
] });
const now = () => ({ folders: [{ id: 'f', name: 'Current work' }], deferred: [
  { id: 'new', folderId: 'f', url: 'https://example.test/new', title: 'New', completed: false },
] });

// Protocol fault injection, not a replacement for native IndexedDB acceptance checks.
function fixture() {
  const data = { ...now(), workspaceSnapshots: [{ id: 'workspace' }], quickSaveUndo: { id: 'short-undo' }, quickSaveFeedback: { ok: true } };
  const operations = new Map(), history = [], commits = [], order = [];
  let guard = null, pendingId = null, failure = null, failLocal = false, revisions = 0, ids = 0, owner;
  function fault(point) { if (failure === point) { failure = null; throw new Error(`${point} interrupted`); } }
  const storage = {
    async get(keys) { return clone(Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) { order.push('local'); if (failLocal) { failLocal = false; throw new Error('local interrupted'); } Object.assign(data, clone(update)); commits.push(clone(update)); },
    async getBytesInUse(keys) { return storageBytes(keys == null ? data : Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
  };
  const database = {
    async putOperation(op, { protect } = {}) {
      fault(op.phase); order.push(op.phase);
      operations.set(op.id, { ...clone(operations.get(op.id) || {}), ...clone(op) });
      if (op.phase === 'prepared') pendingId = op.id;
      if (['committed', 'abandoned'].includes(op.phase) && pendingId === op.id) pendingId = null;
      if (protect) guard = op.id;
      for (const id of operations.keys()) if (![op.id, guard, pendingId].includes(id)) operations.delete(id);
    },
    async operation(id) { return clone(operations.get(id) || null); },
    async pending() { return clone(operations.get(pendingId) || null); },
    async status() { return { lastRestore: clone(operations.get(guard) || null) }; },
    async append(state, options) {
      fault(options.kind); order.push(options.kind);
      const op = operations.get(options.operationId);
      if (op?.targetRecorded) return;
      history.push({ state: clone(state), ...clone(options) }); if (op) op.targetRecorded = true;
    },
    async seek(time) { return { state: past(), time: time === 100 ? 100 : null, gap: time === 200 }; },
  };
  function restart({ skipCommitted = false } = {}) {
    let restorer;
    const writer = createAtlasCollectionWriter(storage, { extraKeys: ATLAS_RESTORE_KEYS,
      key: () => `revision-${++revisions}`, clock: () => 1000,
      beforeChange: () => restorer.recoverPending(),
      onCommitted: async event => {
        if (skipCommitted && event.operationId) return;
        if (!await restorer.committed(event)) await database.append(event.after, { kind: 'change' });
      },
    });
    restorer = createAtlasRestorer({ storage, database, writer, clock: () => 1000, key: () => `operation-${++ids}` });
    owner = { writer, restorer }; return owner;
  }
  restart();
  return { data, storage, database, commits, operations, history, order, restart, get owner() { return owner; },
    fail: point => { failure = point; }, failLocal: () => { failLocal = true; } };
}
async function restore(f, extra = {}) {
  const preview = await f.owner.restorer.preview({ time: 100, ...extra });
  return await f.owner.restorer.restore({ time: 100, id: 'restore-one', expectedRevision: preview.revision, ...extra });
}

test('reactivation has an exact durable Undo and return-again, while timeline captures never include archived payloads', async () => {
  const f = fixture();
  const archived = { ...past().deferred[0], completed: true, completedAt: 55, title: 'Completed title' };
  const untouched = { id: 'untouched', url: 'https://example.test/untouched', completed: true, completedAt: 66 };
  f.data.deferred.push(archived, untouched);
  const before = { folders: clone(f.data.folders), deferred: clone(f.data.deferred) };
  await restore(f); f.restart();
  const restored = { folders: clone(f.data.folders), deferred: clone(f.data.deferred) };
  assert.equal(restored.deferred.filter(link => link.id === 'old').length, 1);
  assert.equal(restored.deferred.find(link => link.id === 'old').completed, false);
  assert.deepEqual(restored.deferred.find(link => link.id === 'untouched'), untouched);
  const preview = await f.owner.restorer.undoPreview('restore-one');
  await f.owner.restorer.undo({ id: 'undo-archive', operationId: 'restore-one', expectedRevision: preview.revision });
  assert.deepEqual({ folders: f.data.folders, deferred: f.data.deferred }, before);
  const back = await f.owner.restorer.undoPreview('undo-archive');
  await f.owner.restorer.undo({ id: 'return-archive', operationId: 'undo-archive', expectedRevision: back.revision });
  assert.deepEqual({ folders: f.data.folders, deferred: f.data.deferred }, restored);
  assert.ok(f.history.every(point => point.state.deferred.every(link => !link.completed)));
});

test('restore protects the exact before-state before a single local commit, and records a durable receipt and generation', async () => {
  const f = fixture(), before = now(), result = await restore(f);
  assert.equal(result.changed, true); assert.equal(result.recoveryPending, false); assert.equal(f.commits.length, 1);
  assert.deepEqual({ folders: f.data.folders, deferred: f.data.deferred }, captureAtlasHistoryState(past()));
  assert.deepEqual((await f.database.operation(result.id)).before, before);
  assert.deepEqual(f.order, ['before-restore', 'prepared', 'local', 'recovering', 'restore', 'committed']);
  assert.equal(f.data[ATLAS_RESTORE_RECEIPT_KEY].revision, f.data[ATLAS_REVISION_KEY].id);
  assert.equal(f.data[ATLAS_GENERATION_KEY], result.id); assert.equal(f.data.quickSaveUndo, null);
  assert.equal(f.data.quickSaveFeedback, null); assert.deepEqual(f.data.workspaceSnapshots, [{ id: 'workspace' }]);
});

test('preparation failure and local failure leave collections and the previous return point untouched', async () => {
  const f = fixture(); await restore(f); const guard = (await f.database.status()).lastRestore.id;
  await f.owner.writer.mutate(collections => ({ update: { deferred: [...collections.deferred, { id: 'later', url: 'https://example.test/later' }] } }));
  const before = clone(f.data), preview = await f.owner.restorer.preview({ time: 100 });
  f.fail('prepared');
  await assert.rejects(f.owner.restorer.restore({ id: 'second', time: 100, expectedRevision: preview.revision }), /prepared interrupted/);
  assert.deepEqual(f.data, before); assert.equal((await f.database.status()).lastRestore.id, guard);
  f.failLocal();
  await assert.rejects(f.owner.restorer.restore({ id: 'third', time: 100, expectedRevision: preview.revision }), /local interrupted/);
  assert.deepEqual(f.data, before); assert.equal((await f.database.status()).lastRestore.id, guard);
  f.restart(); assert.deepEqual(await f.owner.restorer.recover(), { id: 'third', committed: false });
  assert.deepEqual(f.data, before); assert.equal((await f.database.status()).lastRestore.id, guard);
});

test('worker termination after local commit is recovered without replaying or opening anything', async () => {
  const f = fixture(); f.restart({ skipCommitted: true }); await restore(f);
  assert.equal((await f.database.status()).lastRestore, null); assert.equal((await f.database.pending()).phase, 'prepared');
  const beforeRestart = clone(f.data); f.restart();
  assert.equal((await f.owner.restorer.recover()).committed, true);
  assert.deepEqual(f.data, beforeRestart); assert.equal(f.commits.length, 1);
  assert.equal((await f.database.status()).lastRestore.phase, 'committed');
  assert.deepEqual((await f.database.operation('restore-one')).before, now());
  assert.equal(await f.owner.restorer.recover(), null);
});

test('response loss after restore is idempotent for the same request id even with its stale original revision', async () => {
  const f = fixture(); await restore(f); f.restart();
  const repeated = await f.owner.restorer.restore({ id: 'restore-one', time: 100, expectedRevision: null });
  assert.equal(repeated.alreadyCommitted, true); assert.equal(f.commits.length, 1);
});

test('history failure after local commit reports pending recovery honestly and a later mutation waits for recovery', async () => {
  const f = fixture(); f.fail('recovering'); const result = await restore(f);
  assert.equal(result.changed, true); assert.equal(result.recoveryPending, true); assert.deepEqual(f.data.deferred, captureAtlasHistoryState(past()).deferred);
  const recoveryBefore = f.order.length;
  await f.owner.writer.mutate(collections => ({ update: { folders: collections.folders.map(folder => ({ ...folder, color: 'blue' })) } }));
  assert.equal(f.order[recoveryBefore], 'recovering'); assert.equal(f.commits.length, 2);
  assert.equal((await f.database.status()).lastRestore.phase, 'committed');
});

test('termination after recording the target does not produce a second restore point on recovery', async () => {
  const f = fixture(); f.fail('committed'); const result = await restore(f);
  assert.equal(result.recoveryPending, true); assert.equal(f.history.filter(event => event.kind === 'restore').length, 1);
  f.restart(); await f.owner.restorer.recover();
  assert.equal(f.history.filter(event => event.kind === 'restore').length, 1); assert.equal(f.commits.length, 1);
});

test('a receipt proves a committed restore even after an external edit; recovery protects before and preserves the external edit', async () => {
  const f = fixture(); f.restart({ skipCommitted: true }); await restore(f);
  f.data.deferred.push({ id: 'external', url: 'https://example.test/external' }); f.data[ATLAS_REVISION_KEY] = { id: 'external-revision' };
  f.restart(); await f.owner.restorer.recover();
  assert.equal(f.data.deferred.at(-1).id, 'external'); assert.deepEqual((await f.database.operation('restore-one')).before, now());
  assert.equal(f.history.at(-1).kind, 'recovered-changes'); assert.equal(f.commits.length, 1);
});

test('missing receipt never causes a prepared target to replay over newer collections', async () => {
  const f = fixture(); f.failLocal(); await assert.rejects(restore(f), /local interrupted/);
  f.data.folders[0].name = 'External edit'; f.restart(); await f.owner.restorer.recover();
  assert.equal(f.data.folders[0].name, 'External edit'); assert.equal(f.data.deferred[0].id, 'new');
  assert.equal((await f.database.status()).lastRestore, null);
  await assert.rejects(f.owner.restorer.restore({ id: 'restore-one', time: 100, expectedRevision: null }), { code: 'OPERATION_USED' });
});

test('durable Undo after restart returns before, protects the restored state for returning again, and repeated Undo writes nothing', async () => {
  const f = fixture(); await restore(f); f.restart();
  const preview = await f.owner.restorer.undoPreview('restore-one'); assert.equal(preview.changedSinceRestore, false);
  const undo = await f.owner.restorer.undo({ id: 'undo-one', operationId: 'restore-one', expectedRevision: preview.revision });
  assert.equal(undo.changed, true); assert.deepEqual(f.data.deferred, now().deferred);
  const protectedAfterUndo = await f.database.operation('undo-one'); assert.deepEqual(protectedAfterUndo.before, captureAtlasHistoryState(past()));
  assert.equal(protectedAfterUndo.undoOf, 'restore-one'); assert.equal(f.commits.length, 2);
  f.restart(); assert.equal((await f.owner.restorer.undo({ operationId: 'restore-one', expectedRevision: null })).alreadyUndone, true);
  assert.equal(f.commits.length, 2);
  const returnPreview = await f.owner.restorer.preview({ pointOperation: 'undo-one' });
  assert.deepEqual(returnPreview.target, captureAtlasHistoryState(past()));
  await f.owner.restorer.restore({ id: 'return-one', pointOperation: 'undo-one', expectedRevision: returnPreview.revision });
  assert.deepEqual(f.data.deferred, captureAtlasHistoryState(past()).deferred); assert.equal(f.commits.length, 3);
});

test('Undo after later edits requires explicit confirmation and protects those newer edits too', async () => {
  const f = fixture(); await restore(f);
  await f.owner.writer.mutate(collections => ({ update: { deferred: [...collections.deferred, { id: 'later', url: 'https://example.test/later' }] } }));
  const edited = clone(f.data.deferred), preview = await f.owner.restorer.undoPreview('restore-one'); assert.equal(preview.changedSinceRestore, true);
  await assert.rejects(f.owner.restorer.undo({ operationId: 'restore-one', expectedRevision: preview.revision }), { code: 'UNDO_CHANGED' });
  assert.deepEqual(f.data.deferred, edited); assert.equal(f.commits.length, 2);
  await f.owner.restorer.undo({ id: 'undo-edits', operationId: 'restore-one', expectedRevision: preview.revision, confirmChanged: true });
  assert.deepEqual((await f.database.operation('undo-edits')).before.deferred, edited); assert.deepEqual(f.data.deferred, now().deferred);
});

test('stale restore and stale Undo confirmations fail before protection or writes', async () => {
  const f = fixture(), preview = await f.owner.restorer.preview({ time: 100 });
  await f.owner.writer.mutate(collections => ({ update: { folders: collections.folders.map(folder => ({ ...folder, name: 'Edited' })) } }));
  await assert.rejects(f.owner.restorer.restore({ time: 100, expectedRevision: preview.revision }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.operations.size, 0); assert.equal(f.commits.length, 1);
  await restore(f); const undoPreview = await f.owner.restorer.undoPreview('restore-one');
  await f.owner.writer.mutate(collections => ({ update: { folders: collections.folders.map(folder => ({ ...folder, name: 'Edited again' })) } }));
  await assert.rejects(f.owner.restorer.undo({ operationId: 'restore-one', expectedRevision: undoPreview.revision, confirmChanged: true }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.commits.length, 3); assert.equal((await f.database.status()).lastRestore.id, 'restore-one');
});

test('unresolved folder decisions cannot prepare or commit, while a resolved mixed selection is one operation', async () => {
  const f = fixture(), selection = { folderIds: ['f'] };
  assert.equal((await f.owner.restorer.preview({ time: 100, selection })).status, 'conflict');
  await assert.rejects(restore(f, { selection }), { code: 'CHOICES_REQUIRED' });
  assert.equal(f.commits.length, 0); assert.equal(f.operations.size, 0);
  await restore(f, { selection, choices: { folderChoices: { f: { mode: 'merge' } } } });
  assert.equal(f.commits.length, 1); assert.equal(f.data.deferred.length, 2); assert.equal(f.data.folders[0].name, 'Current work');
});

test('historical archive is not restored and does not acquire retention grace', async () => {
  const f = fixture(); await restore(f);
  assert.equal(f.data.deferred.some(link => link.completed), false);
  assert.deepEqual(f.data[ATLAS_ARCHIVE_PROTECTION_KEY], {});
});

test('missing confirmation, absent/gap history and no-op restore make no destructive writes', async () => {
  const f = fixture();
  await assert.rejects(f.owner.restorer.restore({ time: 100 }), { code: 'CONFIRM_REQUIRED' });
  await assert.rejects(f.owner.restorer.preview({ time: 200 }), { code: 'MOMENT_GONE' });
  await assert.rejects(f.owner.restorer.restore({ time: 300, expectedRevision: null }), { code: 'MOMENT_GONE' });
  Object.assign(f.data, past()); assert.equal((await restore(f)).changed, false);
  assert.equal(f.operations.size, 0); assert.equal(f.commits.length, 0);
});

test('a concurrent preview or recovery cannot abandon a preparation whose local commit is still in flight', async () => {
  const f = fixture(); let entered, release;
  const began = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const set = f.storage.set;
  f.storage.set = async update => { entered(); await gate; await set(update); };
  const first = restore(f); await began;
  const concurrentPreview = f.owner.restorer.preview({ time: 100 }), concurrentRecovery = f.owner.restorer.recover();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.database.pending()).phase, 'prepared'); assert.equal(f.commits.length, 0);
  release(); await first;
  assert.equal((await concurrentPreview).revision, f.data[ATLAS_REVISION_KEY].id);
  assert.equal(await concurrentRecovery, null); assert.equal((await f.database.status()).lastRestore.phase, 'committed');
  assert.equal(f.commits.length, 1);
});

test('selective merge does not reset protection or grant a new grace period to unrelated archive links', async () => {
  const f = fixture();
  f.data.deferred.push({ id: 'unrelated', completed: true, completedAt: '2020-01-01T00:00:00Z', folderId: null, url: 'https://example.test/unrelated' });
  f.data[ATLAS_ARCHIVE_PROTECTION_KEY] = { unrelated: { completedAt: '2020-01-01T00:00:00Z', until: 500 } };
  await restore(f, { selection: { folderIds: ['f'] }, choices: { folderChoices: { f: { mode: 'merge' } } } });
  assert.equal(f.data[ATLAS_ARCHIVE_PROTECTION_KEY].unrelated.until, 500);
  assert.equal(f.data[ATLAS_ARCHIVE_PROTECTION_KEY].archive, undefined);
});
