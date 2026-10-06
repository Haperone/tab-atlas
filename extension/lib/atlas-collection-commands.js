import { makeStorageId } from './ids.js';
import { normalizeBackupDocument, mergeBackupCollections, normalizeWorkspaceSnapshots } from './backup-data.js';
import { decodeTa1Fragment } from './ta1-codec.js';
import { mergeSharedPackage } from './share-import.js';
import { removeSavedRecords, restoreSavedRecords, purgeDismissedRecords, setSavedRecordCompletion,
  deleteFolderRecords, restoreFolderRecords, moveSavedRecords } from './saved-records.js';
import { expiredArchiveRecordIds } from './archive-retention.js';
import { ATLAS_GENERATION_KEY, ATLAS_ARCHIVE_PROTECTION_KEY } from './atlas-history-restore.js';

export const ATLAS_COLLECTION_PREFIX = 'tab-atlas/collections/';
const cleanName = value => {
  let text = String(value || '').trim().slice(0, 120);
  if (/[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
  return text;
};
const idList = value => [...new Set((Array.isArray(value) ? value : [value]).filter(id => typeof id === 'string'))];
const locked = (folders, id) => !!id && folders.some(folder => folder.id === id && folder.locked);
const plan = (update = {}, result = null) => ({ update, result });

/** Validate expensive imports before entering the owner's queue; merge only against its fresh read. */
export async function prepareAtlasCollectionCommand(request) {
  if (!request || typeof request.action !== 'string') throw new Error('This Atlas action is unavailable. Reload Tab Atlas and retry.');
  const command = structuredClone(request);
  if (command.action === 'import-backup') command.validated = normalizeBackupDocument(command.document);
  if (command.action === 'import-share') command.validated = await decodeTa1Fragment(command.fragment);
  return command;
}

/** Intent commands never accept a stale replacement array from a dashboard. */
export function atlasCollectionChange(collections, stored, request) {
  const { folders, deferred, workspaceSnapshots } = collections;
  if (Object.hasOwn(request, 'expectedGeneration') && request.expectedGeneration !== (stored[ATLAS_GENERATION_KEY] || null)) {
    const error = new Error('Atlas was restored after this action began. Review the current collection and try again.');
    error.code = 'GENERATION_CHANGED'; throw error;
  }
  if (request.action === 'save-many') {
    if (!Array.isArray(request.pages)) throw new Error('Choose tabs to save.');
    let current = collections, folder = null;
    if (request.createFolder) {
      const created = atlasCollectionChange(current, stored, { action: 'folder-create', name: request.createFolder.name });
      if (!created.result) throw new Error('Choose a folder name before saving tabs.');
      folder = { ...created.result, color: typeof request.createFolder.color === 'string' ? request.createFolder.color.slice(0, 32) : null };
      current = { ...current, folders: [...folders, folder] };
    }
    const savedIds = [], savedIndexes = [], failedIndexes = [];
    for (const [index, item] of request.pages.entries()) {
      try {
        const saved = atlasCollectionChange(current, stored, { action: 'save', page: item.page || item,
          folderId: folder?.id || (Object.hasOwn(item, 'folderId') ? item.folderId : request.folderId) || null });
        current = { ...current, ...saved.update }; savedIds.push(saved.result); savedIndexes.push(index);
      } catch { failedIndexes.push(index); }
    }
    return plan(savedIndexes.length ? { deferred: current.deferred, ...(folder ? { folders: current.folders } : {}) } : {},
      { savedIds, savedIndexes, failedIndexes, folder: savedIndexes.length ? folder : null });
  }
  if (request.action === 'save') {
    const page = request.page || {}, folderId = request.folderId || null;
    let url;
    try { url = new URL(page.url); } catch { throw new Error('Choose a valid website or file link to save.'); }
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('This page cannot be saved. Choose a website or file link.');
    if (folderId && !folders.some(folder => folder.id === folderId)) throw new Error('Folder was removed. Choose another folder.');
    if (deferred.some(link => !link.dismissed && !link.completed && link.url === page.url && (link.folderId || null) === folderId)) return plan();
    const id = makeStorageId(new Set(deferred.map(link => link.id)));
    const record = { id, url: page.url, title: String(page.title || page.url), savedAt: new Date().toISOString(), completed: false, dismissed: false, folderId };
    return plan({ deferred: [...deferred, record] }, id);
  }
  if (request.action === 'remove-links' || request.action === 'cleanup-archive') {
    const requested = request.action === 'cleanup-archive'
      ? expiredArchiveRecordIds(deferred, request.days, Date.now(), stored[ATLAS_ARCHIVE_PROTECTION_KEY]) : idList(request.ids);
    const removable = requested.filter(id => { const record = deferred.find(link => link.id === id); return record && !locked(folders, record.folderId); });
    const result = removeSavedRecords(deferred, removable);
    return plan(result.removed.length ? { deferred: result.records } : {}, request.action === 'cleanup-archive' ? { days: request.days, removed: result.removed } : result.removed);
  }
  if (request.action === 'restore-links') return plan({ deferred: restoreSavedRecords(deferred, request.snapshots) });
  if (request.action === 'completion') {
    const result = setSavedRecordCompletion(deferred, folders, request.id, !!request.completed, { allowLocked: !!request.internalUndo });
    return plan(result.updated ? { deferred: result.records } : {}, result.updated);
  }
  if (request.action === 'purge-legacy') {
    const result = purgeDismissedRecords(deferred); return plan(result.removedCount ? { deferred: result.records } : {}, result.removedCount);
  }
  if (request.action === 'folder-create') {
    const name = cleanName(request.name); if (!name) return plan();
    const folder = { id: makeStorageId(new Set(folders.map(item => item.id))), name, collapsed: false, locked: false, color: null, createdAt: new Date().toISOString() };
    return plan({ folders: [...folders, folder] }, folder);
  }
  if (request.action === 'folder-edit') {
    const index = folders.findIndex(folder => folder.id === request.id); if (index < 0) return plan({}, false);
    const folder = { ...folders[index] };
    for (const [field, value] of Object.entries(request.fields || {})) {
      if (field === 'name') { const name = cleanName(value); if (name) folder.name = name; }
      else if (['collapsed', 'locked'].includes(field)) folder[field] = !!value;
      else if (field === 'color') folder.color = typeof value === 'string' ? value.slice(0, 32) : null;
      else throw new Error('This folder setting cannot be changed.');
    }
    return plan({ folders: folders.map((item, i) => i === index ? folder : item) }, true);
  }
  if (request.action === 'folder-reorder') {
    const from = folders.findIndex(folder => folder.id === request.draggedId), to = folders.findIndex(folder => folder.id === request.targetId);
    if (from < 0 || to < 0 || from === to) return plan();
    const next = [...folders], [moved] = next.splice(from, 1); next.splice(to, 0, moved); return plan({ folders: next });
  }
  if (request.action === 'folders-collapse') return plan({ folders: folders.map(folder => ({ ...folder, collapsed: !!request.collapsed })) });
  if (request.action === 'folder-delete') {
    const result = deleteFolderRecords(folders, deferred, request.id, request.mode);
    return plan(result.snapshot ? { folders: result.folders, deferred: result.records } : {}, result.snapshot);
  }
  if (request.action === 'folder-undo-delete') {
    const result = restoreFolderRecords(folders, deferred, request.snapshot); return plan({ folders: result.folders, deferred: result.records });
  }
  if (request.action === 'move-links') {
    if (request.folderId && !folders.some(folder => folder.id === request.folderId)) throw new Error('Folder was removed. Choose another folder.');
    const result = moveSavedRecords(deferred, folders, request.ids, request.folderId);
    return plan(result.changed ? { deferred: result.records } : {}, result);
  }
  if (request.action === 'import-backup') {
    const result = mergeBackupCollections(collections, request.validated); return plan(result.collections, result.imported);
  }
  if (request.action === 'import-share') {
    const result = mergeSharedPackage(collections, request.validated);
    return plan(result.code === 'OK' ? { folders: result.folders, deferred: result.deferred } : {}, result);
  }
  if (request.action === 'workspace-normalize') {
    const { snapshots } = normalizeWorkspaceSnapshots(workspaceSnapshots, { preserveIds: true, preserveGroupKeys: true, strict: false });
    return plan(JSON.stringify(snapshots) === JSON.stringify(workspaceSnapshots) ? {} : { workspaceSnapshots: snapshots }, snapshots);
  }
  if (request.action === 'workspace-add') {
    const { snapshots } = normalizeWorkspaceSnapshots([request.snapshot], { preserveIds: true, preserveGroupKeys: true, strict: true });
    if (!snapshots.length) throw new Error('This workspace snapshot is unavailable. Retry capturing it.');
    if (workspaceSnapshots.some(item => item.id === snapshots[0].id)) return plan();
    return plan({ workspaceSnapshots: [snapshots[0], ...workspaceSnapshots].slice(0, 20) });
  }
  if (request.action === 'workspace-delete') {
    const index = workspaceSnapshots.findIndex(item => item.id === request.id); if (index < 0) return plan();
    return plan({ workspaceSnapshots: workspaceSnapshots.filter(item => item.id !== request.id) }, { index, snapshot: workspaceSnapshots[index] });
  }
  if (request.action === 'workspace-undo-delete') {
    const { snapshots } = normalizeWorkspaceSnapshots([request.snapshot], { preserveIds: true, preserveGroupKeys: true, strict: true });
    if (!snapshots.length || workspaceSnapshots.some(item => item.id === snapshots[0].id)) return plan();
    const next = [...workspaceSnapshots]; next.splice(Math.min(Math.max(0, request.index || 0), next.length), 0, snapshots[0]); return plan({ workspaceSnapshots: next });
  }
  if (request.action === 'workspace-rename') {
    const name = cleanName(request.name); return plan(name ? { workspaceSnapshots: workspaceSnapshots.map(item => item.id === request.id ? { ...item, name } : item) } : {});
  }
  throw new Error('This Atlas action is unavailable. Reload Tab Atlas and retry.');
}

export function createAtlasCollectionCommands(writer) {
  return async request => {
    const prepared = await prepareAtlasCollectionCommand(request);
    const result = await writer.mutate((collections, stored) => atlasCollectionChange(collections, stored, prepared), { kind: prepared.action });
    return { ...result, generation: request.expectedGeneration ?? null };
  };
}
