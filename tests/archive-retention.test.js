import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHIVE_RETENTION_OPTIONS,
  DEFAULT_ARCHIVE_RETENTION_DAYS,
  archiveRetentionLabel,
  expiredArchiveRecordIds,
  normalizeArchiveRetentionDays,
} from '../extension/lib/archive-retention.js';

test('archive retention defaults to 180 days and supports an explicit Off state', () => {
  assert.equal(DEFAULT_ARCHIVE_RETENTION_DAYS, 180);
  assert.deepEqual(ARCHIVE_RETENTION_OPTIONS, [0, 30, 90, 180]);
  for (const missing of [null, undefined, '', 'invalid', 45]) {
    assert.equal(normalizeArchiveRetentionDays(missing), DEFAULT_ARCHIVE_RETENTION_DAYS);
  }
  assert.equal(normalizeArchiveRetentionDays('0'), 0);
  assert.equal(normalizeArchiveRetentionDays('90'), 90);
  assert.equal(archiveRetentionLabel(0), 'Off');
  assert.equal(archiveRetentionLabel(180), '180 days');
});

test('archive retention expires only completed records with a valid completion date', () => {
  const now = Date.parse('2026-07-12T00:00:00.000Z');
  const records = [
    { id: 'expired', completed: true, completedAt: '2026-06-12T00:00:00.000Z' },
    { id: 'recent', completed: true, completedAt: '2026-06-13T00:00:00.000Z' },
    { id: 'active', completed: false, completedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'legacy', completed: true },
    { id: 'invalid', completed: true, completedAt: 'not-a-date' },
  ];
  assert.deepEqual(expiredArchiveRecordIds(records, 30, now), ['expired']);
  assert.deepEqual(expiredArchiveRecordIds(records, 0, now), []);
});
