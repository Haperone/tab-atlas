export const ARCHIVE_RETENTION_KEY = 'tabout-archive-retention-days';
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 180;
export const ARCHIVE_RETENTION_OPTIONS = Object.freeze([0, 30, 90, 180]);

export function normalizeArchiveRetentionDays(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_ARCHIVE_RETENTION_DAYS;
  const days = Number(value);
  return ARCHIVE_RETENTION_OPTIONS.includes(days) ? days : DEFAULT_ARCHIVE_RETENTION_DAYS;
}

export function archiveRetentionLabel(days) {
  const normalized = normalizeArchiveRetentionDays(days);
  return normalized === 0 ? 'Off' : `${normalized} days`;
}

export function expiredArchiveRecordIds(records, retentionDays, now = Date.now()) {
  const days = normalizeArchiveRetentionDays(retentionDays);
  if (days === 0) return [];
  const cutoff = Number(now) - days * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cutoff)) return [];

  return (Array.isArray(records) ? records : [])
    .filter(record => {
      if (!record?.id || record.completed !== true || !record.completedAt) return false;
      const completedAt = Date.parse(record.completedAt);
      return Number.isFinite(completedAt) && completedAt <= cutoff;
    })
    .map(record => record.id);
}
