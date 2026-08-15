export const UNDO_TTL_MS = 5_500;
export const MAX_UNDO_SNAPSHOTS = 20;

export function removeSavedRecords(records, ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
  const removed = [];
  const kept = [];
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    if (wanted.has(record?.id)) removed.push({ index, record: structuredClone(record) });
    else kept.push(record);
  }
  return { records: kept, removed };
}

export function restoreSavedRecords(records, snapshots) {
  const restored = [...(Array.isArray(records) ? records : [])];
  const existingIds = new Set(restored.map(record => record?.id));
  const ordered = [...(Array.isArray(snapshots) ? snapshots : [])]
    .filter(snapshot => snapshot?.record?.id && !existingIds.has(snapshot.record.id))
    .sort((a, b) => a.index - b.index);
  for (const snapshot of ordered) {
    const index = Math.max(0, Math.min(Number(snapshot.index) || 0, restored.length));
    restored.splice(index, 0, structuredClone(snapshot.record));
    existingIds.add(snapshot.record.id);
  }
  return restored;
}

export function purgeDismissedRecords(records) {
  const source = Array.isArray(records) ? records : [];
  const recordsWithoutTombstones = source.filter(record => !record?.dismissed);
  return {
    records: recordsWithoutTombstones,
    removedCount: source.length - recordsWithoutTombstones.length,
  };
}

export function moveSavedRecords(records, folders, ids, targetFolderId) {
  const source = Array.isArray(records) ? records : [];
  const folderList = Array.isArray(folders) ? folders : [];
  const targetId = targetFolderId || null;
  const requestedIds = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
  const requestedRecords = requestedIds
    .map(id => source.find(record => record?.id === id))
    .filter(Boolean);
  const blockedIds = requestedRecords
    .filter(record => {
      const sourceFolderId = record.folderId || null;
      return sourceFolderId !== targetId
        && folderList.some(folder => folder?.id === sourceFolderId && folder.locked === true);
    })
    .map(record => record.id);

  if (blockedIds.length) {
    return {
      records: source,
      movedIds: [],
      blockedIds,
      unchangedIds: requestedIds,
      changed: false,
    };
  }

  const movedIds = requestedRecords
    .filter(record => (record.folderId || null) !== targetId)
    .map(record => record.id);
  const moved = new Set(movedIds);
  return {
    records: moved.size
      ? source.map(record => moved.has(record?.id) ? { ...record, folderId: targetId } : record)
      : source,
    movedIds,
    blockedIds: [],
    unchangedIds: requestedIds.filter(id => !moved.has(id)),
    changed: moved.size > 0,
  };
}

export function setSavedRecordCompletion(records, folders, id, completed, {
  allowLocked = false,
  completedAt = new Date().toISOString(),
} = {}) {
  const source = Array.isArray(records) ? records : [];
  const index = source.findIndex(record => record?.id === id);
  if (index < 0) return { records: source, updated: false };

  const record = source[index];
  const locked = (folders || []).some(folder => folder?.id === record.folderId && folder.locked === true);
  if (completed && locked && !allowLocked) return { records: source, updated: false };

  const nextRecords = [...source];
  if (completed) {
    nextRecords[index] = { ...record, completed: true, completedAt };
  } else {
    const { completedAt: _completedAt, ...activeRecord } = record;
    nextRecords[index] = { ...activeRecord, completed: false };
  }
  return { records: nextRecords, updated: true };
}

export function deleteFolderRecords(folders, records, folderId, mode = 'inbox') {
  const folderIndex = folders.findIndex(folder => folder?.id === folderId);
  if (folderIndex < 0) return { folders, records, snapshot: null };
  if (folders[folderIndex]?.locked) return { folders, records, snapshot: null };
  const folder = structuredClone(folders[folderIndex]);
  const nextFolders = folders.filter(folderRecord => folderRecord?.id !== folderId);
  const members = [];
  const nextRecords = [];

  for (const [index, record] of records.entries()) {
    if (record?.folderId !== folderId) {
      nextRecords.push(record);
      continue;
    }
    members.push({ index, record: structuredClone(record) });
    if (mode !== 'delete') nextRecords.push({ ...record, folderId: null });
  }

  return {
    folders: nextFolders,
    records: nextRecords,
    snapshot: { folder, folderIndex, members, mode },
  };
}

export function restoreFolderRecords(folders, records, snapshot) {
  if (!snapshot?.folder) return { folders, records };
  const nextFolders = [...folders];
  if (!nextFolders.some(folder => folder?.id === snapshot.folder.id)) {
    const index = Math.max(0, Math.min(Number(snapshot.folderIndex) || 0, nextFolders.length));
    nextFolders.splice(index, 0, structuredClone(snapshot.folder));
  }

  if (snapshot.mode === 'delete') {
    return { folders: nextFolders, records: restoreSavedRecords(records, snapshot.members) };
  }

  const byId = new Map(snapshot.members.map(member => [member.record.id, member.record]));
  const nextRecords = records.map(record => byId.has(record?.id) ? structuredClone(byId.get(record.id)) : record);
  return { folders: nextFolders, records: nextRecords };
}

export function createUndoStore({
  now = () => Date.now(),
  ttlMs = UNDO_TTL_MS,
  maxEntries = MAX_UNDO_SNAPSHOTS,
} = {}) {
  const entries = new Map();
  let sequence = 0;

  function prune() {
    const timestamp = now();
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(token);
    }
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }

  return Object.freeze({
    add(callback) {
      prune();
      const token = `undo-${++sequence}`;
      entries.set(token, { callback, expiresAt: now() + ttlMs });
      prune();
      return token;
    },
    discard(token) {
      entries.delete(token);
    },
    take(token) {
      prune();
      const entry = entries.get(token);
      entries.delete(token);
      return entry?.callback || null;
    },
    prune,
    size() {
      prune();
      return entries.size;
    },
  });
}
