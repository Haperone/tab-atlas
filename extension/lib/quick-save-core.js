import { makeStorageId } from './ids.js';

export const QUICK_SAVE_UNDO_KEY = 'quickSaveUndo';
export const QUICK_SAVE_FEEDBACK_KEY = 'quickSaveFeedback';

export function websiteUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function findSavedPage(records, url) {
  const canonical = websiteUrl(url);
  if (!canonical) return null;
  const matches = records.filter(record => !record.dismissed && websiteUrl(record.url) === canonical);
  return matches.find(record => !record.completed) || matches[0] || null;
}

function placement(record) {
  return { folderId: record.folderId || null, completed: !!record.completed,
    dismissed: !!record.dismissed, completedAt: record.completedAt || null };
}

function locked(folders, id) {
  return folders.some(folder => folder.id === id && folder.locked);
}

export function savePage(records, folders, page, folderId = null, now = new Date().toISOString()) {
  const url = websiteUrl(page?.url);
  if (!url) return { ok: false, error: 'UNSUPPORTED_PAGE' };
  const folder = folders.find(item => item.id === folderId);
  if (folderId && !folder) return { ok: false, error: 'FOLDER_GONE' };
  const existing = findSavedPage(records, url);
  const folderName = folder?.name || 'Saved for later';
  if (existing && (existing.folderId || null) !== folderId && locked(folders, existing.folderId)) {
    return { ok: false, error: 'SOURCE_LOCKED' };
  }
  if (existing && !existing.completed && (existing.folderId || null) === folderId) {
    return { ok: true, changed: false, folderName, record: existing, kind: 'existing' };
  }
  const ids = new Set(records.map(record => record.id));
  let record;
  if (existing) {
    const { completedAt: _completedAt, ...previous } = existing;
    record = { ...previous, folderId, completed: false, dismissed: false };
  } else {
    record = { id: makeStorageId(ids), url, title: page.title || new URL(url).hostname,
      savedAt: now, completed: false, dismissed: false, folderId };
  }
  const next = existing ? records.map(item => item.id === existing.id ? record : item) : [...records, record];
  const kind = !existing ? 'saved' : existing.completed ? 'restored' : 'moved';
  return { ok: true, changed: true, records: next, record, folderName, kind,
    undo: { id: makeStorageId(new Set()), recordId: record.id, before: existing ? placement(existing) : null,
      after: structuredClone(record), folderName, kind } };
}

/** Undo only the latest save, preserving unrelated additions and later edits. */
export function undoSave(records, folders, undo) {
  if (!undo?.recordId || !undo.after) return { ok: false, error: 'UNDO_GONE' };
  const record = records.find(item => item.id === undo.recordId);
  if (!record || record.url !== undo.after.url
    || JSON.stringify(placement(record)) !== JSON.stringify(placement(undo.after))
    || (!undo.before && JSON.stringify(record) !== JSON.stringify(undo.after))) {
    return { ok: false, error: 'UNDO_CHANGED' };
  }
  const before = undo.before;
  if (locked(folders, record.folderId) && (!before || before.folderId !== record.folderId || before.completed)) {
    return { ok: false, error: 'SOURCE_LOCKED' };
  }
  if (!before) return { ok: true, records: records.filter(item => item.id !== record.id) };
  const restored = { ...record, folderId: folders.some(folder => folder.id === before.folderId) ? before.folderId : null,
    completed: before.completed, dismissed: before.dismissed };
  if (before.completedAt) restored.completedAt = before.completedAt;
  else delete restored.completedAt;
  return { ok: true, records: records.map(item => item.id === record.id ? restored : item) };
}

export const QUICK_SAVE_ERRORS = Object.freeze({
  UNSUPPORTED_PAGE: 'Open a website to save a page.',
  FOLDER_GONE: 'This folder was removed. Choose another folder.',
  SOURCE_LOCKED: 'This page is in a locked folder. Unlock it in Tab Atlas to move or remove it.',
  PAGE_CHANGED: 'The page changed. Check its title and choose a folder again.',
  UNDO_GONE: 'There is no save to undo.',
  UNDO_CHANGED: 'This saved page changed since then. Manage it in Tab Atlas.',
  EMPTY_NAME: 'Enter a folder name.',
  STORAGE_ERROR: 'Could not save the change. Try again.',
});
