import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { createBackupEnvelope } from '../extension/lib/backup-data.js';
import {
  createUndoStore,
  deleteFolderRecords,
  purgeDismissedRecords,
  removeSavedRecords,
  restoreFolderRecords,
  restoreSavedRecords,
} from '../extension/lib/saved-records.js';
import { createStorageRepository } from '../extension/lib/storage-repository.js';

const records = () => [
  { id: 'a', title: 'First', folderId: null, completed: false },
  { id: 'b', title: 'Second', folderId: 'f1', completed: false },
  { id: 'c', title: 'Third', folderId: 'f1', completed: true },
  { id: 'd', title: 'Fourth', folderId: null, completed: false },
];

function storageFixture(initial) {
  const state = structuredClone(initial);
  const writes = [];
  return {
    state,
    writes,
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter(key => key in state).map(key => [key, structuredClone(state[key])]));
    },
    async set(update) {
      writes.push(structuredClone(update));
      Object.assign(state, structuredClone(update));
    },
  };
}

test('single and bulk deletion persist physical removal immediately and Undo restores exact order', async () => {
  const storage = storageFixture({ deferred: records() });
  const repository = createStorageRepository(storage);
  const removed = removeSavedRecords(await repository.getDeferred(), ['b', 'd']);
  await repository.setDeferred(removed.records);
  assert.deepEqual(storage.state.deferred.map(item => item.id), ['a', 'c']);
  await repository.setDeferred(restoreSavedRecords(await repository.getDeferred(), removed.removed));
  assert.deepEqual(storage.state.deferred, records());
});

test('Undo store expires callbacks, consumes once, and remains bounded in memory', () => {
  let now = 100;
  const store = createUndoStore({ now: () => now, ttlMs: 10, maxEntries: 2 });
  const first = store.add(() => 'first');
  const second = store.add(() => 'second');
  const third = store.add(() => 'third');
  assert.equal(store.size(), 2);
  assert.equal(store.take(first), null);
  assert.equal(store.take(second)(), 'second');
  assert.equal(store.take(second), null);
  now = 111;
  assert.equal(store.take(third), null);
  assert.equal(store.size(), 0);
});

test('legacy tombstone purge is idempotent and preserves active and archived records', () => {
  const source = [
    { id: 'active', completed: false },
    { id: 'archived', completed: true },
    { id: 'gone', dismissed: true, completed: false },
  ];
  const first = purgeDismissedRecords(source);
  const second = purgeDismissedRecords(first.records);
  assert.deepEqual(first.records.map(item => item.id), ['active', 'archived']);
  assert.equal(first.removedCount, 1);
  assert.equal(second.removedCount, 0);
  assert.deepEqual(second.records, first.records);
});

test('delete-folder modes and Undo restore membership, records, and positions exactly', () => {
  const folders = [{ id: 'f0' }, { id: 'f1', name: 'Reading' }, { id: 'f2' }];
  const deleted = deleteFolderRecords(folders, records(), 'f1', 'delete');
  assert.deepEqual(deleted.records.map(item => item.id), ['a', 'd']);
  assert.deepEqual(restoreFolderRecords(deleted.folders, deleted.records, deleted.snapshot), {
    folders,
    records: records(),
  });

  const inbox = deleteFolderRecords(folders, records(), 'f1', 'inbox');
  assert.deepEqual(inbox.records.filter(item => ['b', 'c'].includes(item.id)).map(item => item.folderId), [null, null]);
  assert.deepEqual(restoreFolderRecords(inbox.folders, inbox.records, inbox.snapshot), {
    folders,
    records: records(),
  });
});

test('archive single removal and clear use the same reversible physical snapshots', () => {
  const source = records();
  const single = removeSavedRecords(source, 'c');
  assert.equal(single.records.some(item => item.id === 'c'), false);
  assert.deepEqual(restoreSavedRecords(single.records, single.removed), source);
  const cleared = removeSavedRecords(source, source.filter(item => item.completed).map(item => item.id));
  assert.equal(cleared.records.some(item => item.completed), false);
  assert.deepEqual(restoreSavedRecords(cleared.records, cleared.removed), source);
});

test('backup export excludes legacy dismissed tombstones defensively', () => {
  const envelope = createBackupEnvelope({
    deferred: [{ id: 'keep', dismissed: false }, { id: 'drop', dismissed: true }],
    folders: [],
    workspaceSnapshots: [],
  }, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(envelope.data.deferred.map(item => item.id), ['keep']);
  assert.equal(envelope.data.deferred.some(item => item.dismissed === true), false);
});

test('application routes single, bulk, folder, archive, and Focus Sweep cleanup through physical deletion', async () => {
  const source = await fs.readFile(new URL('../extension/app.js', import.meta.url), 'utf8');
  assert.match(source, /const removed = await dismissSavedTab\(id\)/);
  assert.match(source, /const removed = await dismissSavedTabs\(tabIds\)/);
  assert.match(source, /deleteFolderRecords\(folders, deferred, id, mode\)/);
  assert.match(source, /action === 'remove-archive-item'/);
  assert.match(source, /action === 'restore-archive-item'/);
  assert.match(source, /showToast\('Restored to Saved for later'/);
  assert.match(source, /action === 'clear-archive'/);
  assert.match(source, /for \(const id of savedIds\).*dismissSavedTab\(id\)/s);
  assert.doesNotMatch(source, /\.dismissed\s*=\s*true/);
});
