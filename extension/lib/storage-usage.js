const MIB = 1024 * 1024;
const encoder = new TextEncoder();

export function storageQuota(storageArea) {
  return Number.isFinite(storageArea.QUOTA_BYTES) && storageArea.QUOTA_BYTES > 0
    ? storageArea.QUOTA_BYTES : 10 * MIB;
}

// Chrome counts each key plus the JSON-serialized value, including UTF-8 text.
export function storageBytes(values) {
  return Object.entries(values).reduce((bytes, [key, value]) =>
    bytes + encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length, 0);
}

export function storageUsage(used, quota) {
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(quota) || quota <= 0) {
    throw new TypeError('Storage usage is unavailable');
  }
  const ratio = used / quota;
  return { used, quota, percent: Math.min(100, Math.floor(ratio * 100)),
    level: ratio >= .95 ? 'critical' : ratio >= .8 ? 'warning' : 'normal' };
}

export function formatStorageBytes(bytes) {
  if (bytes < MIB) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / MIB).toFixed(1)} MB`;
}

export function storageWarningText(usage) {
  if (!usage || usage.level === 'normal') return '';
  return `${usage.level === 'critical' ? 'Storage almost full' : 'Storage filling up'} · ${usage.percent}% used. Remove unneeded saved links or workspaces to free space.`;
}

export async function readStorageUsage(storageArea) {
  if (typeof storageArea.getBytesInUse !== 'function') return null;
  return storageUsage(await storageArea.getBytesInUse(null), storageQuota(storageArea));
}

export async function readStorageDetails(storageArea) {
  const [usage, data] = await Promise.all([readStorageUsage(storageArea), storageArea.get(null)]);
  if (!usage) throw new Error('Storage usage is unavailable. Try opening Tab Atlas again.');
  const categories = [
    { label: 'Saved links & archive', key: 'deferred' },
    { label: 'Folders', key: 'folders' },
    { label: 'Workspaces', key: 'workspaceSnapshots' },
  ].map(({ label, key }) => ({ label, bytes: Object.hasOwn(data, key) ? storageBytes({ [key]: data[key] }) : 0 }));
  categories.push({ label: 'Other data', bytes: Math.max(0, usage.used - categories.reduce((sum, item) => sum + item.bytes, 0)) });
  return { ...usage, categories };
}

/** Check the final merged data, accounting for the keys that it replaces. */
export async function checkStorageCapacity(storageArea, update) {
  if (typeof storageArea.getBytesInUse !== 'function') return;
  const [used, replaced] = await Promise.all([
    storageArea.getBytesInUse(null), storageArea.getBytesInUse(Object.keys(update)),
  ]);
  const quota = storageQuota(storageArea);
  const projected = used - replaced + storageBytes(update);
  if (projected > quota) {
    throw new Error(`Not enough storage to import this backup. Free at least ${Math.ceil((projected - quota) / MIB * 10) / 10} MB by removing unneeded saved links or workspaces, then try again. Your existing data has not changed.`);
  }
}
