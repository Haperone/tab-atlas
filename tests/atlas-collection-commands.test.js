import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasCollectionWriter } from '../extension/lib/atlas-collection-writer.js';
import { createAtlasCollectionCommands } from '../extension/lib/atlas-collection-commands.js';
import { ATLAS_GENERATION_KEY, ATLAS_RESTORE_KEYS, ATLAS_ARCHIVE_PROTECTION_KEY } from '../extension/lib/atlas-history-restore.js';
import { createQuickSaveService, QUICK_SAVE_PREFIX } from '../extension/lib/quick-save-service.js';
import { createAtlasCollectionClient } from '../extension/lib/atlas-collection-client.js';
import { createBackupEnvelope } from '../extension/lib/backup-data.js';
import { createSharePackage, encodeTa1Package } from '../extension/lib/ta1-codec.js';
import { storageBytes } from '../extension/lib/storage-usage.js';

function fixture() {
  const data = { folders: [{ id: 'f', name: 'Work', color: 'blue' }, { id: 'locked', name: 'Locked', locked: true }], deferred: [
    { id: 'one', folderId: 'f', url: 'https://example.test/one', completed: false },
    { id: 'keep', folderId: 'locked', url: 'https://example.test/keep', completed: false },
  ], workspaceSnapshots: [] }, commits = [], events = [];
  const storage = { QUOTA_BYTES: 10 * 1024 * 1024,
    async get(keys) { return structuredClone(Object.fromEntries([].concat(keys).filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
    async set(update) { Object.assign(data, structuredClone(update)); commits.push(structuredClone(update)); },
    async getBytesInUse(keys) { return storageBytes(keys == null ? data : Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))); },
  };
  const writer = createAtlasCollectionWriter(storage, { extraKeys: ATLAS_RESTORE_KEYS, onCommitted: event => events.push(event) });
  return { data, storage, writer, commands: createAtlasCollectionCommands(writer), commits, events };
}
const command = (f, action, extra = {}) => f.commands({ action, ...extra });

test('dashboard intentions and popup/menu writes share one owner and preserve concurrent rename/save/move', async () => {
  const f = fixture(), page = { id: 7, url: 'https://example.test/new', title: 'New page' };
  const quickSave = createQuickSaveService({ storage: { local: f.storage }, tabs: { async get() { return page; } } }, { collectionWriter: f.writer });
  const [rename, save, move] = await Promise.all([
    command(f, 'folder-edit', { id: 'f', fields: { name: 'Renamed' } }),
    quickSave.handleMessage({ type: QUICK_SAVE_PREFIX + 'save', tabId: 7, folderId: 'f' }),
    command(f, 'move-links', { ids: ['one'], folderId: null }),
  ]);
  assert.equal(rename.result, true); assert.equal(save.ok, true); assert.equal(move.result.changed, true);
  assert.equal(f.data.folders[0].name, 'Renamed'); assert.equal(f.data.deferred.find(link => link.id === 'one').folderId, null);
  assert.equal(f.data.deferred.find(link => link.url === page.url).folderId, 'f'); assert.equal(f.events.length, 3);
});

test('folder deletion and Undo commit links/folders consistently; physical cleanup preserves locked records', async () => {
  const f = fixture(), removed = await command(f, 'folder-delete', { id: 'f', mode: 'delete' });
  assert.equal(f.events.length, 1); assert.deepEqual(f.data.deferred.map(link => link.id), ['keep']);
  assert.ok(f.commits[0].folders && f.commits[0].deferred);
  await command(f, 'folder-undo-delete', { snapshot: removed.result });
  assert.deepEqual(f.data.deferred.map(link => link.id), ['one', 'keep']); assert.equal(f.data.folders[0].id, 'f');
  assert.equal((await command(f, 'folder-delete', { id: 'locked', mode: 'delete' })).result, null);
  assert.equal((await command(f, 'remove-links', { ids: ['one', 'keep'] })).result.length, 1);
  assert.deepEqual(f.data.deferred.map(link => link.id), ['keep']);
});

test('stale dashboard mutations and old Undo cannot affect a replacement generation even when ids match', async () => {
  const f = fixture(); f.data[ATLAS_GENERATION_KEY] = 'restored';
  for (const request of [
    { action: 'folder-edit', id: 'f', fields: { name: 'Stale' } },
    { action: 'restore-links', snapshots: [{ index: 0, record: { id: 'stale', url: 'https://example.test/stale' } }] },
    { action: 'completion', id: 'one', completed: false },
    { action: 'move-links', ids: ['one'], folderId: null },
  ]) await assert.rejects(f.commands({ ...request, expectedGeneration: null }), { code: 'GENERATION_CHANGED' });
  assert.equal(f.commits.length, 0); assert.equal(f.data.folders[0].name, 'Work');
  await command(f, 'folder-edit', { id: 'f', fields: { name: 'Fresh' }, expectedGeneration: 'restored' });
  assert.equal(f.data.folders[0].name, 'Fresh');
});

test('automatic retention respects restored archive grace and locks, while explicit deletion stays possible with reversible snapshots', async () => {
  const f = fixture(), old = '2020-01-01T00:00:00Z';
  f.data.deferred.push({ id: 'protected', folderId: null, url: 'https://example.test/protected', completed: true, completedAt: old },
    { id: 'expired', folderId: null, url: 'https://example.test/expired', completed: true, completedAt: old },
    { id: 'locked-old', folderId: 'locked', url: 'https://example.test/locked', completed: true, completedAt: old });
  f.data[ATLAS_ARCHIVE_PROTECTION_KEY] = { protected: { completedAt: old, until: Date.now() + 86400000 } };
  const cleanup = await command(f, 'cleanup-archive', { days: 180 }); assert.deepEqual(cleanup.result.removed.map(item => item.record.id), ['expired']);
  const manual = await command(f, 'remove-links', { ids: ['protected'] }); assert.equal(manual.result.length, 1);
  await command(f, 'restore-links', { snapshots: manual.result }); assert.ok(f.data.deferred.some(link => link.id === 'protected'));
  assert.ok(f.data.deferred.some(link => link.id === 'locked-old'));
});

test('backup and encrypted sharing validate before mutation and merge once against fresh collections', async () => {
  const f = fixture(); const backup = createBackupEnvelope({ folders: [], deferred: [{ id: 'incoming', folderId: null, title: 'Incoming', url: 'https://example.test/incoming' }], workspaceSnapshots: [] });
  await assert.rejects(command(f, 'import-backup', { document: { app: 'bad' } }));
  await assert.rejects(command(f, 'import-share', { fragment: '#bad' })); assert.equal(f.commits.length, 0);
  const shared = await encodeTa1Package(createSharePackage({ name: 'Shared', items: [{ url: 'https://example.test/shared', title: 'Shared page' }] }));
  await Promise.all([command(f, 'import-backup', { document: backup }), command(f, 'import-share', { fragment: shared.fragment }),
    command(f, 'save', { page: { url: 'https://example.test/concurrent', title: 'Concurrent' } })]);
  for (const url of ['one', 'keep', 'incoming', 'shared', 'concurrent']) assert.ok(f.data.deferred.some(link => link.url === `https://example.test/${url}`));
  assert.equal(f.data.folders.at(-1).name, 'Shared'); assert.equal(f.events.length, 3);
});

test('capacity failure and invalid/missing targets make no partial collection updates', async () => {
  const f = fixture(); f.storage.QUOTA_BYTES = storageBytes(f.data);
  await assert.rejects(command(f, 'save', { page: { url: 'https://example.test/no-room' } }), /Not enough storage/);
  await assert.rejects(command(f, 'save', { page: { url: 'javascript:alert(1)' } }), /cannot be saved/);
  await assert.rejects(command(f, 'move-links', { ids: ['one'], folderId: 'missing' }), /removed/);
  await assert.rejects(command(f, 'folder-edit', { id: 'f', fields: { unknown: true } }), /cannot be changed/);
  assert.equal(f.commits.length, 0); assert.equal(f.events.length, 0);
});

test('bulk and native-group saves produce one consistent collection commit, preserving ordered successes and skipping unsupported links', async () => {
  const f = fixture();
  const result = await command(f, 'save-many', { createFolder: { name: 'From Chrome group', color: '#73937a' }, pages: [
    { url: 'https://example.test/group-one', title: 'First' }, { url: 'chrome://settings/' },
    { url: 'https://example.test/group-two', title: 'Second' }, { url: 'https://example.test/group-one', title: 'Duplicate' },
  ] });
  assert.equal(f.commits.length, 1); assert.equal(f.events.length, 1); assert.equal(f.events[0].kind, 'save-many');
  assert.deepEqual(result.result.savedIndexes, [0, 2, 3]); assert.deepEqual(result.result.failedIndexes, [1]);
  assert.equal(result.result.savedIds[2], null); assert.equal(result.result.folder.color, '#73937a');
  assert.ok(f.commits[0].folders && f.commits[0].deferred);
  assert.deepEqual(f.data.deferred.filter(link => link.folderId === result.result.folder.id).map(link => link.title), ['First', 'Second']);
  const before = structuredClone(f.data); f.storage.QUOTA_BYTES = storageBytes(f.data);
  await assert.rejects(command(f, 'save-many', { createFolder: { name: 'Cannot fit' }, pages: [{ url: 'https://example.test/no-room' }] }), /Not enough storage/);
  assert.deepEqual(f.data, before); assert.equal(f.commits.length, 1);
  const failed = await command(f, 'save-many', { createFolder: { name: 'Empty' }, pages: [{ url: 'about:blank' }] });
  assert.equal(failed.result.folder, null); assert.equal(f.commits.length, 1);
});

test('workspace intentions preserve concurrent backup additions and never enter Atlas history or lose their Undo', async () => {
  const f = fixture(), snapshot = { id: 'workspace', name: 'Workspace', createdAt: '2026-01-01T00:00:00Z', windows: [{ id: 1, tabs: [{ url: 'https://example.test/workspace', title: 'Workspace', index: 0 }] }], groups: {} };
  await command(f, 'workspace-add', { snapshot }); assert.equal(f.data.workspaceSnapshots.length, 1); assert.equal(f.events.length, 0);
  const removed = await command(f, 'workspace-delete', { id: 'workspace' }); assert.equal(f.data.workspaceSnapshots.length, 0);
  f.data[ATLAS_GENERATION_KEY] = 'after-restore';
  await command(f, 'workspace-undo-delete', removed.result); assert.equal(f.data.workspaceSnapshots.length, 1);
  await command(f, 'workspace-rename', { id: 'workspace', name: 'Renamed' }); assert.equal(f.data.workspaceSnapshots[0].name, 'Renamed');
  assert.equal(f.events.length, 0);
});

test('client preserves an originally null generation across an event arriving while send is awaiting', async () => {
  const listeners = [], sent = []; let current = null;
  const chrome = { storage: { local: { async get() { return { [ATLAS_GENERATION_KEY]: current }; } }, onChanged: { addListener: listener => listeners.push(listener) } },
    runtime: { async sendMessage(request) { sent.push(request); return { ok: true, data: { result: true } }; } } };
  const client = createAtlasCollectionClient(chrome); await client.command('save', { page: { url: 'https://example.test/first' } });
  const pending = client.command('save', { page: { url: 'https://example.test/old-action' } }); current = 'restored';
  for (const listener of listeners) listener({ [ATLAS_GENERATION_KEY]: { newValue: current } }, 'local'); await pending;
  assert.equal(sent.at(-1).expectedGeneration, null);
  await client.command('save'); assert.equal(sent.at(-1).expectedGeneration, 'restored');
});

test('client Undo binds the old generation; browser-only and workspace Undo remain usable', async () => {
  const f = fixture(), listeners = [];
  const chrome = { storage: { local: f.storage, onChanged: { addListener: listener => listeners.push(listener) } }, runtime: { async sendMessage(request) {
    try { return { ok: true, data: await f.commands({ ...request, action: request.type.split('/').at(-1) }) }; }
    catch (error) { return { ok: false, code: error.code, error: error.message }; }
  } } };
  const client = createAtlasCollectionClient(chrome); await client.command('folder-edit', { id: 'f', fields: { color: 'red' } });
  const oldUndo = client.guardUndo(() => client.command('folder-edit', { id: 'f', fields: { color: 'blue' } })), browserUndo = client.guardUndo(async () => 42);
  f.data[ATLAS_GENERATION_KEY] = 'restored'; for (const listener of listeners) listener({ [ATLAS_GENERATION_KEY]: { newValue: 'restored' } }, 'local');
  await assert.rejects(oldUndo(), { code: 'GENERATION_CHANGED' }); assert.equal(f.data.folders[0].color, 'red');
  assert.equal(await browserUndo(), 42);
  await client.command('folder-edit', { id: 'f', fields: { color: 'green' } }); assert.equal(f.data.folders[0].color, 'green');
});

test('an action captures its Undo generation before awaiting a delayed receipt or browser work', async () => {
  const f = fixture(), listeners = [];
  const chrome = { storage: { local: f.storage, onChanged: { addListener: listener => listeners.push(listener) } }, runtime: { async sendMessage(request) {
    try { return { ok: true, data: await f.commands({ ...request, action: request.type.split('/').at(-1) }) }; }
    catch (error) { return { ok: false, code: error.code, error: error.message }; }
  } } };
  const client = createAtlasCollectionClient(chrome); await client.command('folder-edit', { id: 'f', fields: {} });
  const guard = client.captureUndoGuard();
  await client.command('folder-edit', { id: 'f', fields: { name: 'Action completed' } });
  f.data[ATLAS_GENERATION_KEY] = 'restored-before-receipt';
  for (const listener of listeners) listener({ [ATLAS_GENERATION_KEY]: { newValue: 'restored-before-receipt' } }, 'local');
  // Receipt is displayed now, after a restore; its Undo must still belong to the old action.
  const undo = client.guardUndo(guard(() => client.command('folder-edit', { id: 'f', fields: { name: 'Stale Undo' } })));
  await assert.rejects(undo(), { code: 'GENERATION_CHANGED' });
  assert.equal(f.data.folders[0].name, 'Action completed');
  assert.equal(await guard(async () => 'browser-only')(), 'browser-only');
  await client.captureUndoGuard()(() => client.command('folder-edit', { id: 'f', fields: { name: 'Fresh Undo' } }))();
  assert.equal(f.data.folders[0].name, 'Fresh Undo');
});
