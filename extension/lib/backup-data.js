import { makeStorageId } from './ids.js';
import { cloneStorageArray } from './storage-repository.js';

export const BACKUP_APP_NAME = 'Tab Atlas';
export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_LIMITS = Object.freeze({
  fileBytes: 5 * 1024 * 1024,
  folders: 500,
  savedTabs: 10_000,
  workspaces: 50,
  windowsPerWorkspace: 50,
  tabsPerWorkspace: 5_000,
  totalWorkspaceTabs: 20_000,
  groupsPerWorkspace: 1_000,
  urlLength: 8_192,
  titleLength: 512,
  nameLength: 120,
  idLength: 128,
  colorLength: 32,
});

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const WINDOW_STATES = new Set(['normal', 'minimized', 'maximized', 'fullscreen']);
const GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export async function parseBackupFile(file) {
  if (!file) throw new Error('No backup file selected');
  if (Number.isFinite(file.size) && file.size > BACKUP_LIMITS.fileBytes) {
    throw new Error('Backup file exceeds the 5 MiB limit');
  }
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
}

function requireArray(value, label, max) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > max) throw new Error(`${label} exceeds the limit of ${max}`);
  return value;
}

function boundedString(value, label, max, fallback = '') {
  const result = typeof value === 'string' ? value : fallback;
  if (result.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return result;
}

function normalizedDate(value, fallback) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function normalizedUrl(value, label) {
  const url = boundedString(value, label, BACKUP_LIMITS.urlLength).trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizedNumber(value, { min = -100_000, max = 100_000 } = {}) {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validStoredId(value, usedIds) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= BACKUP_LIMITS.idLength &&
    SAFE_ID.test(value) &&
    !usedIds.has(value)
  );
}

function createFreshId(usedIds, makeId) {
  return makeId(usedIds);
}

function normalizeGroupMap(sourceGroups, sourceTabs, options) {
  const entries = sourceGroups && typeof sourceGroups === 'object' && !Array.isArray(sourceGroups)
    ? Object.entries(sourceGroups)
    : [];
  if (entries.length > BACKUP_LIMITS.groupsPerWorkspace) {
    throw new Error(`Workspace groups exceed the limit of ${BACKUP_LIMITS.groupsPerWorkspace}`);
  }
  const referenced = new Set(sourceTabs.map(tab => String(tab?.groupKey ?? '')).filter(Boolean));
  const keyMap = new Map();
  const groups = {};
  const usedKeys = new Set();
  for (const [sourceKey, sourceGroup] of entries) {
    if (BLOCKED_KEYS.has(sourceKey) || !referenced.has(sourceKey) || !sourceGroup || typeof sourceGroup !== 'object') continue;
    const preserved = options.preserveGroupKeys && validStoredId(sourceKey, usedKeys);
    const key = preserved ? sourceKey : createFreshId(usedKeys, options.makeId);
    if (preserved) usedKeys.add(key);
    keyMap.set(sourceKey, key);
    const color = GROUP_COLORS.has(sourceGroup.color) ? sourceGroup.color : 'grey';
    groups[key] = {
      title: boundedString(sourceGroup.title, 'Workspace group title', BACKUP_LIMITS.titleLength),
      color,
      collapsed: !!sourceGroup.collapsed,
    };
  }
  return { groups, keyMap };
}

function normalizeWorkspaceSnapshot(source, options, totalTabs) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const sourceWindows = requireArray(source.windows, 'Workspace windows', BACKUP_LIMITS.windowsPerWorkspace);
  const sourceTabs = sourceWindows.flatMap(win => Array.isArray(win?.tabs) ? win.tabs : []);
  if (sourceTabs.length > BACKUP_LIMITS.tabsPerWorkspace) {
    throw new Error(`Workspace tabs exceed the limit of ${BACKUP_LIMITS.tabsPerWorkspace}`);
  }
  totalTabs.count += sourceTabs.length;
  if (totalTabs.count > BACKUP_LIMITS.totalWorkspaceTabs) {
    throw new Error(`Backup workspace tabs exceed the total limit of ${BACKUP_LIMITS.totalWorkspaceTabs}`);
  }

  const { groups, keyMap } = normalizeGroupMap(source.groups, sourceTabs, options);
  const windows = [];
  for (const sourceWindow of sourceWindows) {
    if (!sourceWindow || typeof sourceWindow !== 'object' || Array.isArray(sourceWindow)) continue;
    const tabs = [];
    for (const sourceTab of requireArray(sourceWindow.tabs, 'Workspace window tabs', BACKUP_LIMITS.tabsPerWorkspace)) {
      if (!sourceTab || typeof sourceTab !== 'object' || Array.isArray(sourceTab)) continue;
      const url = normalizedUrl(sourceTab.url, 'Workspace tab URL');
      if (!url) {
        options.skipped.count += 1;
        continue;
      }
      const sourceGroupKey = String(sourceTab.groupKey ?? '');
      tabs.push({
        url,
        title: boundedString(sourceTab.title, 'Workspace tab title', BACKUP_LIMITS.titleLength, url) || url,
        pinned: !!sourceTab.pinned,
        active: !!sourceTab.active,
        index: normalizedNumber(sourceTab.index, { min: 0, max: BACKUP_LIMITS.tabsPerWorkspace }) || 0,
        groupKey: keyMap.get(sourceGroupKey) || null,
      });
    }
    if (!tabs.length) continue;
    const window = {
      state: WINDOW_STATES.has(sourceWindow.state) ? sourceWindow.state : 'normal',
      focused: !!sourceWindow.focused,
      tabs,
    };
    for (const key of ['left', 'top', 'width', 'height']) {
      const value = normalizedNumber(sourceWindow[key], {
        min: key === 'width' || key === 'height' ? 1 : -100_000,
        max: 100_000,
      });
      if (value !== undefined) window[key] = value;
    }
    windows.push(window);
  }
  if (!windows.length) return null;

  const usedIds = options.workspaceIds;
  const preserveId = options.preserveIds && validStoredId(source.id, usedIds);
  const id = preserveId ? source.id : createFreshId(usedIds, options.makeId);
  if (preserveId) usedIds.add(id);
  const tabCount = windows.reduce((sum, window) => sum + window.tabs.length, 0);
  return {
    id,
    name: boundedString(source.name, 'Workspace name', BACKUP_LIMITS.nameLength, 'Workspace').trim() || 'Workspace',
    createdAt: normalizedDate(source.createdAt, options.now()),
    windowCount: windows.length,
    tabCount,
    windows,
    groups,
  };
}

export function normalizeWorkspaceSnapshots(value, options = {}) {
  const source = requireArray(value, 'Workspace snapshots', BACKUP_LIMITS.workspaces);
  const workspaceIds = new Set();
  const skipped = { count: 0 };
  const settings = {
    now: options.now || (() => new Date().toISOString()),
    makeId: options.makeId || makeStorageId,
    preserveIds: options.preserveIds !== false,
    preserveGroupKeys: options.preserveGroupKeys !== false,
    workspaceIds,
    skipped,
  };
  const totalTabs = { count: 0 };
  const snapshots = [];
  for (const item of source) {
    try {
      const snapshot = normalizeWorkspaceSnapshot(item, settings, totalTabs);
      if (snapshot) snapshots.push(snapshot);
      else skipped.count += 1;
    } catch (error) {
      if (options.strict !== false) throw error;
      skipped.count += 1;
    }
  }
  return { snapshots, skipped: skipped.count };
}

export function normalizeBackupDocument(parsed, options = {}) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Backup root must be an object');
  }
  if (parsed.app !== BACKUP_APP_NAME || parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('This is not a Tab Atlas schema-v1 backup file');
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('Backup data must be an object');
  }

  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || makeStorageId;
  const sourceFolders = requireArray(parsed.data.folders, 'Backup folders', BACKUP_LIMITS.folders);
  const sourceDeferred = requireArray(parsed.data.deferred, 'Backup saved tabs', BACKUP_LIMITS.savedTabs);
  const sourceWorkspaces = requireArray(parsed.data.workspaceSnapshots, 'Backup workspaces', BACKUP_LIMITS.workspaces);
  const folderIds = new Set();
  const sourceFolderMap = new Map();
  const folders = [];
  let skipped = 0;

  for (const source of sourceFolders) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      skipped += 1;
      continue;
    }
    const name = boundedString(source.name, 'Folder name', BACKUP_LIMITS.nameLength).trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const id = createFreshId(folderIds, makeId);
    if (typeof source.id === 'string' && source.id.length <= BACKUP_LIMITS.idLength && !BLOCKED_KEYS.has(source.id)) {
      sourceFolderMap.set(source.id, id);
    }
    folders.push({
      id,
      name,
      collapsed: !!source.collapsed,
      color: boundedString(source.color, 'Folder color', BACKUP_LIMITS.colorLength) || null,
      createdAt: normalizedDate(source.createdAt, now()),
    });
  }

  const deferredIds = new Set();
  const deferred = [];
  for (const source of sourceDeferred) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      skipped += 1;
      continue;
    }
    if (source.dismissed) {
      skipped += 1;
      continue;
    }
    const url = normalizedUrl(source.url, 'Saved tab URL');
    if (!url) {
      skipped += 1;
      continue;
    }
    const item = {
      id: createFreshId(deferredIds, makeId),
      url,
      title: boundedString(source.title, 'Saved tab title', BACKUP_LIMITS.titleLength, url) || url,
      savedAt: normalizedDate(source.savedAt, now()),
      completed: !!source.completed,
      dismissed: false,
      folderId: sourceFolderMap.get(String(source.folderId ?? '')) || null,
    };
    if (source.completedAt) item.completedAt = normalizedDate(source.completedAt, now());
    deferred.push(item);
  }

  const normalizedWorkspaces = normalizeWorkspaceSnapshots(sourceWorkspaces, {
    now,
    makeId,
    preserveIds: false,
    preserveGroupKeys: false,
  });
  skipped += normalizedWorkspaces.skipped;

  return {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: normalizedDate(parsed.exportedAt, now()),
    importSkipped: skipped,
    data: {
      deferred,
      folders,
      workspaceSnapshots: normalizedWorkspaces.snapshots,
    },
  };
}

export function createBackupEnvelope(collections, exportedAt = new Date().toISOString()) {
  const deferred = cloneStorageArray(collections?.deferred).filter(item => !item?.dismissed);
  return {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    data: {
      deferred,
      folders: cloneStorageArray(collections?.folders),
      workspaceSnapshots: cloneStorageArray(collections?.workspaceSnapshots),
    },
  };
}

export function normalizeBackupFolderName(name) {
  return String(name || '').trim().toLowerCase();
}

export function backupItemSignature(item, folderId = item?.folderId || null) {
  return JSON.stringify([
    String(item?.url || ''),
    String(item?.title || item?.url || ''),
    !!item?.completed,
    !!item?.dismissed,
    folderId || null,
  ]);
}

export function workspaceSnapshotSignature(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot || {}));
  delete copy.id;
  return JSON.stringify(copy);
}

export function mergeBackupCollections(current, backup, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const makeId = options.makeId || makeStorageId;
  const deferred = cloneStorageArray(current?.deferred);
  const folders = cloneStorageArray(current?.folders);
  const workspaceSnapshots = cloneStorageArray(current?.workspaceSnapshots);
  const imported = { savedTabs: 0, folders: 0, workspaces: 0, skipped: backup.importSkipped || 0 };

  const folderIds = new Set(folders.map(folder => String(folder.id || '')).filter(Boolean));
  const folderNameToId = new Map();
  for (const folder of folders) {
    const key = normalizeBackupFolderName(folder.name);
    if (key && !folderNameToId.has(key)) folderNameToId.set(key, folder.id);
  }
  const folderIdMap = new Map();
  for (const folder of backup.data.folders) {
    const nameKey = normalizeBackupFolderName(folder.name);
    const existingId = folderNameToId.get(nameKey);
    if (existingId) {
      folderIdMap.set(folder.id, existingId);
      imported.skipped += 1;
      continue;
    }
    const id = makeId(folderIds);
    const nextFolder = { ...folder, id };
    folders.push(nextFolder);
    folderNameToId.set(nameKey, id);
    folderIdMap.set(folder.id, id);
    imported.folders += 1;
  }

  const deferredIds = new Set(deferred.map(item => String(item.id || '')).filter(Boolean));
  const savedSignatures = new Set(deferred.map(item => backupItemSignature(item)));
  for (const item of backup.data.deferred) {
    const targetFolderId = item.folderId ? (folderIdMap.get(item.folderId) || null) : null;
    const candidate = { ...item, id: makeId(deferredIds), folderId: targetFolderId };
    const signature = backupItemSignature(candidate, targetFolderId);
    if (savedSignatures.has(signature)) {
      imported.skipped += 1;
      deferredIds.delete(candidate.id);
      continue;
    }
    savedSignatures.add(signature);
    deferred.push(candidate);
    imported.savedTabs += 1;
  }

  const workspaceIds = new Set(workspaceSnapshots.map(snapshot => String(snapshot.id || '')).filter(Boolean));
  const workspaceSignatures = new Set(workspaceSnapshots.map(workspaceSnapshotSignature));
  for (const snapshot of backup.data.workspaceSnapshots) {
    const signature = workspaceSnapshotSignature(snapshot);
    if (workspaceSignatures.has(signature)) {
      imported.skipped += 1;
      continue;
    }
    const nextSnapshot = { ...cloneStorageArray([snapshot])[0], id: makeId(workspaceIds) };
    workspaceSnapshots.unshift(nextSnapshot);
    workspaceSignatures.add(signature);
    imported.workspaces += 1;
  }

  return {
    collections: { deferred, folders, workspaceSnapshots },
    imported,
  };
}

/** Normalize completely before the first storage read/write, then merge once. */
export async function importBackupDocument(repository, parsed, options = {}) {
  const normalized = normalizeBackupDocument(parsed, options);
  const result = mergeBackupCollections(await repository.getCollections(), normalized, options);
  await repository.setCollections(result.collections);
  return result.imported;
}
