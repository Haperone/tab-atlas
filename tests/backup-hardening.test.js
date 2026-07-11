import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_APP_NAME,
  BACKUP_LIMITS,
  BACKUP_SCHEMA_VERSION,
  importBackupDocument,
  normalizeBackupDocument,
  normalizeWorkspaceSnapshots,
  parseBackupFile,
} from '../extension/lib/backup-data.js';
import { readProjectJson } from './helpers.js';

function deterministicOptions() {
  let sequence = 0;
  return {
    now: () => '2026-07-10T00:00:00.000Z',
    makeId: used => {
      const id = `fresh-${++sequence}`;
      used.add(id);
      return id;
    },
  };
}

function emptyBackup(overrides = {}) {
  return {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-07-10T00:00:00.000Z',
    data: { folders: [], deferred: [], workspaceSnapshots: [], ...overrides },
  };
}

test('5 MiB size limit is checked before reading file text', async () => {
  let textCalled = false;
  const file = {
    size: BACKUP_LIMITS.fileBytes + 1,
    async text() {
      textCalled = true;
      return '{}';
    },
  };
  await assert.rejects(parseBackupFile(file), /5 MiB limit/);
  assert.equal(textCalled, false);
});

test('empty schema-v1 backup remains a valid no-op document', () => {
  const normalized = normalizeBackupDocument(emptyBackup(), deterministicOptions());
  assert.deepEqual(normalized.data, { deferred: [], folders: [], workspaceSnapshots: [] });
  assert.equal(normalized.importSkipped, 0);
});

test('malformed JSON is rejected with a specific parse error', async () => {
  await assert.rejects(
    parseBackupFile({ size: 8, async text() { return '{broken'; } }),
    /valid JSON/,
  );
});

test('valid schema-v1 fixture receives fresh IDs and recomputed counts', async () => {
  const source = await readProjectJson('tests/fixtures/backup-valid-v1.json');
  const normalized = normalizeBackupDocument(source, deterministicOptions());
  assert.equal(normalized.data.folders[0].id, 'fresh-1');
  assert.equal(normalized.data.deferred[0].id, 'fresh-2');
  assert.equal(normalized.data.deferred[0].folderId, 'fresh-1');
  assert.equal(normalized.data.workspaceSnapshots[0].id, 'fresh-4');
  assert.equal(normalized.data.workspaceSnapshots[0].windowCount, 1);
  assert.equal(normalized.data.workspaceSnapshots[0].tabCount, 1);
  assert.deepEqual(Object.keys(normalized.data.workspaceSnapshots[0].groups), ['fresh-3']);
  assert.equal('unknownRoot' in normalized, false);
});

test('malicious fixture drops unsafe protocols, supplied IDs, counts, and unknown fields', async () => {
  const source = await readProjectJson('tests/fixtures/backup-malicious-v1.json');
  const normalized = normalizeBackupDocument(source, deterministicOptions());
  assert.equal(normalized.data.deferred.length, 1);
  assert.equal(normalized.importSkipped, 2);
  assert.match(normalized.data.deferred[0].id, /^fresh-/);
  assert.equal(normalized.data.workspaceSnapshots[0].id.includes('data-action'), false);
  assert.equal(normalized.data.workspaceSnapshots[0].windowCount, 1);
  assert.equal(normalized.data.workspaceSnapshots[0].tabCount, 1);
  assert.equal(Object.keys(normalized.data.workspaceSnapshots[0].groups).length, 0);
  assert.equal('unknown' in normalized.data.workspaceSnapshots[0], false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('only http, https, and file URLs survive normalization', () => {
  const source = emptyBackup({
    deferred: [
      { url: 'http://example.com/a' },
      { url: 'https://example.com/b' },
      { url: 'file:///tmp/c' },
      { url: 'chrome://settings' },
      { url: 'javascript:alert(1)' },
      { url: 'data:text/plain,bad' },
    ],
  });
  const normalized = normalizeBackupDocument(source, deterministicOptions());
  assert.deepEqual(normalized.data.deferred.map(item => new URL(item.url).protocol), ['http:', 'https:', 'file:']);
  assert.equal(normalized.importSkipped, 3);
});

test('collection and string limits reject with actionable errors', () => {
  assert.throws(
    () => normalizeBackupDocument(emptyBackup({ folders: Array(BACKUP_LIMITS.folders + 1).fill({}) })),
    /Backup folders exceeds the limit/,
  );
  assert.throws(
    () => normalizeBackupDocument(emptyBackup({ folders: [{ name: 'x'.repeat(BACKUP_LIMITS.nameLength + 1) }] })),
    /Folder name exceeds 120 characters/,
  );
});

test('boundary-length and special-character text is preserved as inert data', () => {
  const name = `<>&"'${'x'.repeat(BACKUP_LIMITS.nameLength - 5)}`;
  const normalized = normalizeBackupDocument(emptyBackup({
    folders: [{ id: '__proto__', name }],
    deferred: [{
      url: 'https://example.com/?q=%3Cscript%3E',
      title: '<button data-action="delete">not markup</button>',
      folderId: '__proto__',
    }],
  }), deterministicOptions());
  assert.equal(normalized.data.folders[0].name, name);
  assert.equal(normalized.data.deferred[0].title, '<button data-action="delete">not markup</button>');
  assert.equal(normalized.data.deferred[0].folderId, null);
});

test('legacy dismissed records are skipped instead of being re-persisted', () => {
  const normalized = normalizeBackupDocument(emptyBackup({
    deferred: [{ url: 'https://gone.test', dismissed: true }],
  }), deterministicOptions());
  assert.deepEqual(normalized.data.deferred, []);
  assert.equal(normalized.importSkipped, 1);
});

test('malformed nested workspace structure rejects the whole document', () => {
  assert.throws(
    () => normalizeBackupDocument(emptyBackup({ workspaceSnapshots: [{ name: 'Broken', windows: {} }] })),
    /Workspace windows must be an array/,
  );
});

test('invalid backup never reaches repository read or write', async () => {
  let reads = 0;
  let writes = 0;
  const repository = {
    async getCollections() { reads += 1; return {}; },
    async setCollections() { writes += 1; },
  };
  await assert.rejects(
    importBackupDocument(repository, { app: 'Wrong', schemaVersion: 1, data: {} }),
    /schema-v1/,
  );
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 0 });
});

test('stored workspace normalization preserves safe IDs and replaces unsafe IDs', async () => {
  const valid = await readProjectJson('tests/fixtures/backup-valid-v1.json');
  const source = valid.data.workspaceSnapshots;
  source.push({ ...structuredClone(source[0]), id: '" data-action="bad' });
  const normalized = normalizeWorkspaceSnapshots(source, {
    ...deterministicOptions(),
    preserveIds: true,
    preserveGroupKeys: true,
    strict: false,
  });
  assert.equal(normalized.snapshots[0].id, 'source-workspace');
  assert.match(normalized.snapshots[1].id, /^fresh-/);
  assert.equal(normalized.snapshots[0].windowCount, 1);
  assert.equal(normalized.snapshots[0].tabCount, 1);
});
