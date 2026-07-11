import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_APP_NAME,
  BACKUP_SCHEMA_VERSION,
  backupItemSignature,
  createBackupEnvelope,
  mergeBackupCollections,
  workspaceSnapshotSignature,
} from '../extension/lib/backup-data.js';
import { makeStorageId } from '../extension/lib/ids.js';
import {
  STORAGE_KEYS,
  createStorageRepository,
} from '../extension/lib/storage-repository.js';
import { isInternalBrowserUrl } from '../extension/lib/urls.js';

function createMemoryStorage(seed = {}) {
  let state = structuredClone(seed);
  return {
    async get(keys) {
      const selected = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(selected.map(key => [key, structuredClone(state[key])]));
    },
    async set(update) {
      state = { ...state, ...structuredClone(update) };
    },
    snapshot() {
      return structuredClone(state);
    },
  };
}

test('makeStorageId avoids existing identifiers deterministically', () => {
  const ids = new Set(['1000i']);
  const values = [0.5, 0.75];
  const id = makeStorageId(ids, { now: () => 1000, random: () => values.shift() });
  assert.equal(id, '1000r');
  assert.equal(ids.has(id), true);
});

test('URL classification preserves web and file URLs', () => {
  for (const value of ['', 'chrome://settings', 'chrome-extension://id/page', 'about:blank', 'edge://flags', 'brave://settings']) {
    assert.equal(isInternalBrowserUrl(value), true, value);
  }
  for (const value of ['https://example.com', 'http://localhost:3000', 'file:///tmp/test.html']) {
    assert.equal(isInternalBrowserUrl(value), false, value);
  }
});

test('storage repository reads defaults and persists the stable keys', async () => {
  const area = createMemoryStorage();
  const repository = createStorageRepository(area);
  assert.deepEqual(await repository.getCollections(), {
    deferred: [], folders: [], workspaceSnapshots: [],
  });
  await repository.setCollections({
    deferred: [{ id: 'd1' }],
    folders: [{ id: 'f1' }],
    workspaceSnapshots: [{ id: 'w1' }],
  });
  assert.deepEqual(area.snapshot(), {
    [STORAGE_KEYS.deferred]: [{ id: 'd1' }],
    [STORAGE_KEYS.folders]: [{ id: 'f1' }],
    [STORAGE_KEYS.workspaceSnapshots]: [{ id: 'w1' }],
  });
});

test('storage repository supports read-modify-write arrays', async () => {
  const area = createMemoryStorage({ deferred: [{ id: 'one' }] });
  const repository = createStorageRepository(area);
  const deferred = await repository.getDeferred();
  deferred.push({ id: 'two' });
  await repository.setDeferred(deferred);
  assert.deepEqual(area.snapshot().deferred, [{ id: 'one' }, { id: 'two' }]);
});

test('backup envelope preserves schema-v1 collection shape', () => {
  const backup = createBackupEnvelope({
    deferred: [{ id: 'd1' }], folders: [{ id: 'f1' }], workspaceSnapshots: [{ id: 'w1' }],
  }, '2026-07-10T00:00:00.000Z');
  assert.deepEqual(backup, {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-07-10T00:00:00.000Z',
    data: {
      deferred: [{ id: 'd1' }], folders: [{ id: 'f1' }], workspaceSnapshots: [{ id: 'w1' }],
    },
  });
});

test('backup signatures ignore workspace IDs but retain saved-item state', () => {
  assert.equal(
    workspaceSnapshotSignature({ id: 'one', name: 'Work' }),
    workspaceSnapshotSignature({ id: 'two', name: 'Work' }),
  );
  assert.notEqual(
    backupItemSignature({ url: 'https://example.com', completed: false }),
    backupItemSignature({ url: 'https://example.com', completed: true }),
  );
});

test('backup merge maps folders, skips duplicates, and retains schema-v1 fields', () => {
  let sequence = 0;
  const result = mergeBackupCollections(
    {
      deferred: [{ id: 'd0', url: 'https://existing.test', title: 'Existing', completed: false, dismissed: false, folderId: null }],
      folders: [{ id: 'f0', name: 'Existing', collapsed: false, color: null, createdAt: '2026-01-01' }],
      workspaceSnapshots: [],
    },
    {
      data: {
        folders: [{ id: 'old-existing', name: 'Existing' }, { id: 'old-new', name: 'New' }],
        deferred: [{ url: 'https://new.test', title: 'New tab', folderId: 'old-new' }],
        workspaceSnapshots: [{ id: 'old-workspace', name: 'Workspace', windows: [] }],
      },
    },
    {
      now: () => '2026-07-10T00:00:00.000Z',
      makeId: ids => {
        const id = `generated-${++sequence}`;
        ids.add(id);
        return id;
      },
    },
  );
  assert.deepEqual(result.imported, { savedTabs: 1, folders: 1, workspaces: 1, skipped: 1 });
  assert.equal(result.collections.deferred.at(-1).folderId, 'generated-1');
  assert.match(result.collections.workspaceSnapshots[0].id, /^generated-/);
});
