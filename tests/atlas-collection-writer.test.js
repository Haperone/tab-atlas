import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasCollectionWriter, ATLAS_REVISION_KEY } from '../extension/lib/atlas-collection-writer.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

function fixture(options = {}) {
  const data = { folders: [{ id: 'f', name: 'Work' }], deferred: [{ id: 'one', folderId: 'f', url: 'https://example.test/one' }], workspaceSnapshots: [] };
  let serial = 0, failure = false; const commits = [];
  const storage = { QUOTA_BYTES: 10 * 1024 * 1024,
    async get(keys) { return structuredClone(Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) { if (failure) { failure = false; throw new Error('Storage interrupted'); } Object.assign(data, structuredClone(update)); commits.push(structuredClone(update)); },
    async getBytesInUse(keys) { return storageBytes(keys == null ? data : Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
  };
  const writer = createAtlasCollectionWriter(storage, { key: () => `revision-${++serial}`, clock: () => 1000, ...options });
  return { data, storage, writer, commits, failNext: () => { failure = true; } };
}
const add = (records, id) => [...records, { id, folderId: 'f', url: `https://example.test/${id}` }];

test('recovery and durable preparation occur inside the queue before the single local commit', async () => {
  const sequence = [], f = fixture({ extraKeys: ['receipt'], beforeChange: () => sequence.push('recover'), onCommitted: () => sequence.push('record') });
  const saved = f.storage.set; f.storage.set = async update => { sequence.push('commit'); await saved(update); };
  await f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two'), receipt: { id: 'operation' } } }), {
    receiptKey: 'receipt', prepare: event => { sequence.push('prepare'); assert.equal(event.stamp.id, 'revision-1'); assert.equal(event.before.deferred.length, 1); },
  });
  assert.deepEqual(sequence, ['recover', 'prepare', 'commit', 'record']);
  assert.equal(f.data.receipt.revision, f.data[ATLAS_REVISION_KEY].id);
});

test('failed preparation or recovery never commits a replacement; no-op changes do not prepare', async () => {
  const f = fixture(); let prepared = 0;
  await assert.rejects(f.writer.mutate(() => ({ update: { folders: [], deferred: [] } }), { prepare: () => { throw new Error('Return point quota'); } }), /quota/);
  assert.equal(f.commits.length, 0);
  await f.writer.mutate(collections => ({ update: { folders: collections.folders } }), { prepare: () => { prepared++; } });
  assert.equal(prepared, 0);
  const blocked = fixture({ beforeChange: () => { throw new Error('Recovery needed'); } });
  await assert.rejects(blocked.writer.mutate(() => ({ update: { deferred: [] } })), /Recovery/);
  assert.equal(blocked.commits.length, 0);
});

test('a gated dashboard change and concurrent popup save read fresh collections and retain both updates', async () => {
  const f = fixture(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const first = f.writer.mutate(async collections => {
    entered(); await gate; return { update: { folders: collections.folders.map(folder => ({ ...folder, name: 'Renamed' })) } };
  });
  await began;
  const second = f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two') }, result: 'saved' }));
  assert.equal(f.commits.length, 0); release(); await first;
  assert.equal((await second).result, 'saved');
  assert.equal(f.data.folders[0].name, 'Renamed'); assert.equal(f.data.deferred.length, 2);
  assert.equal(f.data[ATLAS_REVISION_KEY].id, 'revision-2');
});

test('a stale restore revision is rejected before its command runs or any write occurs', async () => {
  const f = fixture(), { revision } = await f.writer.read();
  await f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two') } }));
  let ran = false;
  await assert.rejects(f.writer.mutate(() => { ran = true; return { update: { deferred: [] } }; }, { expectedRevision: revision }), { code: 'REVISION_CONFLICT' });
  assert.equal(ran, false); assert.equal(f.commits.length, 1); assert.equal(f.data.deferred.length, 2);
});

test('folder and link changes share one commit and one consistent history callback', async () => {
  const history = [], f = fixture({ onCommitted: event => history.push(event) });
  const result = await f.writer.mutate(() => ({ update: { folders: [], deferred: [] } }), { expectedRevision: null, kind: 'restore', operationId: 'operation' });
  assert.equal(result.changed, true); assert.equal(f.commits.length, 1); assert.equal(history.length, 1);
  assert.equal(history[0].before.folders.length, 1); assert.equal(history[0].before.deferred.length, 1);
  assert.deepEqual(history[0].after, { folders: [], deferred: [] }); assert.equal(history[0].operationId, 'operation');
  assert.equal(history[0].kind, 'restore');
});

test('workspace-only and identical updates do not create Atlas history or change its revision', async () => {
  let calls = 0; const f = fixture({ onCommitted: () => { calls++; } });
  assert.equal((await f.writer.mutate(collections => ({ update: { folders: collections.folders } }))).changed, false);
  assert.equal((await f.writer.mutate(() => ({ update: { workspaceSnapshots: [{ id: 'workspace' }] } }))).revision, null);
  assert.equal(calls, 0); assert.equal(f.data[ATLAS_REVISION_KEY], undefined);
});

test('history write failure reports a committed save honestly and does not break the next queued action', async () => {
  let failures = 0; const f = fixture({ onCommitted: () => { throw new Error('History unavailable'); }, onHistoryError: () => { failures++; } });
  const saved = await f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two') }, result: 'saved' }));
  assert.equal(saved.result, 'saved'); assert.equal(saved.historyError, true); assert.equal(f.data.deferred.length, 2);
  await f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'three') } }));
  assert.equal(f.data.deferred.length, 3); assert.equal(failures, 2);
});

test('a failed local write produces neither history nor revision and the queue remains usable', async () => {
  let calls = 0; const f = fixture({ onCommitted: () => { calls++; } }); f.failNext();
  await assert.rejects(f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two') } })), /interrupted/);
  assert.equal(f.data.deferred.length, 1); assert.equal(f.data[ATLAS_REVISION_KEY], undefined); assert.equal(calls, 0);
  await f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'three') } }));
  assert.equal(f.data.deferred.length, 2); assert.equal(calls, 1);
});

test('capacity includes revision metadata and invalid collections/settings cannot write anything', async () => {
  const f = fixture(); f.storage.QUOTA_BYTES = storageBytes(f.data);
  await assert.rejects(f.writer.mutate(collections => ({ update: { deferred: add(collections.deferred, 'two') } })), /Not enough storage to update Atlas/);
  await assert.rejects(f.writer.mutate(() => ({ update: { theme: 'glass' } })), /cannot change/);
  await assert.rejects(f.writer.mutate(() => ({ update: { folders: 'wrong' } })), /arrays/);
  assert.equal(f.commits.length, 0); assert.equal(f.data.deferred.length, 1);
});

test('returned/read data and command input are isolated from durable arrays', async () => {
  const f = fixture(), before = await f.writer.read(); before.collections.folders[0].name = 'Mutated';
  assert.equal(f.data.folders[0].name, 'Work');
  await f.writer.mutate(collections => { collections.folders[0].name = 'Uncommitted'; return { update: {} }; });
  assert.equal(f.data.folders[0].name, 'Work'); assert.equal(f.data[ATLAS_REVISION_KEY], undefined);
});
