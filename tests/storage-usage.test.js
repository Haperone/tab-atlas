import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStorageCapacity, readStorageDetails, readStorageUsage, storageBytes, storageUsage, storageWarningText } from '../extension/lib/storage-usage.js';

test('warnings follow the real quota, including older Chrome limits', () => {
  for (const quota of [5 * 1024 * 1024, 10 * 1024 * 1024]) {
    assert.equal(storageUsage(quota * .8 - 1, quota).level, 'normal');
    assert.equal(storageUsage(quota * .8, quota).level, 'warning');
    assert.equal(storageUsage(quota * .95, quota).level, 'critical');
    assert.equal(storageUsage(quota, quota).percent, 100);
    assert.equal(storageWarningText(storageUsage(0, quota)), '');
  }
});

test('unavailable measurements are never treated as empty storage', async () => {
  assert.throws(() => storageUsage(NaN, 100), /unavailable/);
  await assert.rejects(readStorageUsage({ async getBytesInUse() { throw new Error('Disconnected'); } }), /Disconnected/);
  assert.equal(await readStorageUsage({}), null);
});

test('capacity check accounts for replaced keys, Unicode and unrelated data', async () => {
  const current = { deferred: ['старое'], other: 'preserve me' };
  const update = { deferred: ['новое'] };
  const area = { QUOTA_BYTES: storageBytes(current), async getBytesInUse(keys) {
    return storageBytes(keys === null ? current : Object.fromEntries(keys.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]])));
  } };
  await checkStorageCapacity(area, update);
  await assert.rejects(checkStorageCapacity(area, { deferred: ['намного длиннее'] }), /existing data has not changed/);
});

test('storage details account for archives, workspaces and other keys', async () => {
  const data = { deferred: [{ completed: true, url: 'https://example.com/' }], folders: [], workspaceSnapshots: [], quickSaveUndo: { after: 'data' } };
  const details = await readStorageDetails({ QUOTA_BYTES: 1000,
    async getBytesInUse() { return storageBytes(data); }, async get() { return data; } });
  assert.equal(details.categories.length, 4);
  assert.equal(details.categories.reduce((sum, item) => sum + item.bytes, 0), details.used);
  assert.equal(details.categories[3].bytes, storageBytes({ quickSaveUndo: data.quickSaveUndo }));
});
