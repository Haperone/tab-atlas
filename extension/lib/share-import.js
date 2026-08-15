import { makeStorageId } from './ids.js';
import { decodeTa1Fragment, sanitizeShareUrl } from './ta1-codec.js';

function trimSafely(value, limit) {
  let text = value.slice(0, limit);
  if (/[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
  return text;
}

export function uniqueSharedFolderName(name, folders) {
  const existing = new Set((folders || []).map(folder => String(folder?.name || '').trim().toLowerCase()));
  const base = String(name || '').trim() || 'Shared folder';
  if (!existing.has(base.toLowerCase())) return trimSafely(base, 120);
  for (let number = 2; ; number += 1) {
    const suffix = ` (${number})`;
    const candidate = trimSafely(base, 120 - suffix.length) + suffix;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
}

/** Pure in-memory merge: it must run only after complete package validation. */
export function mergeSharedPackage(collections, pkg, options = {}) {
  const folders = Array.isArray(collections?.folders) ? collections.folders : [];
  const deferred = Array.isArray(collections?.deferred) ? collections.deferred : [];
  const now = options.now || Date.now;
  const idFactory = options.idFactory || makeStorageId;
  const existingUrls = new Set(deferred.filter(item => !item?.dismissed).map(item => {
    try { return sanitizeShareUrl(item.url).cleanedUrl; } catch { return item?.url; }
  }));
  const incomingUrls = new Set();
  const accepted = [];
  let skipped = 0;
  for (const item of pkg.items) {
    const url = sanitizeShareUrl(item.url).cleanedUrl;
    if (incomingUrls.has(url) || existingUrls.has(url)) { skipped += 1; continue; }
    incomingUrls.add(url);
    accepted.push({ ...item, url });
  }
  if (!accepted.length) return Object.freeze({ code: 'NO_NEW_LINKS', added: 0, skipped, folders, deferred });
  const folderIds = new Set(folders.map(folder => folder?.id).filter(Boolean));
  const deferredIds = new Set(deferred.map(item => item?.id).filter(Boolean));
  const stamp = now();
  const folder = {
    id: idFactory(folderIds, options),
    name: uniqueSharedFolderName(pkg.name, folders),
    collapsed: false,
    locked: false,
    color: null,
    createdAt: stamp,
  };
  const records = accepted.map(item => ({
    id: idFactory(deferredIds, options),
    url: item.url,
    title: item.title,
    savedAt: now(),
    completed: false,
    dismissed: false,
    folderId: folder.id,
  }));
  return Object.freeze({
    code: 'OK', added: records.length, skipped, folder,
    folders: [...folders, folder], deferred: [...deferred, ...records],
  });
}

export async function importSharedPackage(repository, fragment, options = {}) {
  // This order is intentional: bad encrypted data cannot trigger a storage read.
  const pkg = await decodeTa1Fragment(fragment, options);
  const collections = await repository.getCollections();
  const result = mergeSharedPackage(collections, pkg, options);
  if (result.code === 'NO_NEW_LINKS') return result;
  try {
    await repository.setCollections({ folders: result.folders, deferred: result.deferred });
  } catch (error) {
    return Object.freeze({ code: 'STORAGE_WRITE_FAILED', error, added: 0, skipped: result.skipped });
  }
  return result;
}
