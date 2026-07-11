export const STORAGE_KEYS = Object.freeze({
  deferred: 'deferred',
  folders: 'folders',
  workspaceSnapshots: 'workspaceSnapshots',
});

export function cloneStorageArray(value) {
  return Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : [];
}

/**
 * Keep chrome.storage access behind one injectable boundary. The returned
 * arrays intentionally remain mutable because callers follow Chrome's
 * read-modify-write pattern and persist them explicitly.
 */
export function createStorageRepository(storageArea) {
  if (!storageArea || typeof storageArea.get !== 'function' || typeof storageArea.set !== 'function') {
    throw new TypeError('A Chrome-compatible storage area is required');
  }

  async function getArray(key) {
    const data = await storageArea.get(key);
    return Array.isArray(data?.[key]) ? data[key] : [];
  }

  async function setArray(key, value) {
    await storageArea.set({ [key]: Array.isArray(value) ? value : [] });
  }

  async function getCollections() {
    const keys = Object.values(STORAGE_KEYS);
    const data = await storageArea.get(keys);
    return {
      deferred: Array.isArray(data?.[STORAGE_KEYS.deferred]) ? data[STORAGE_KEYS.deferred] : [],
      folders: Array.isArray(data?.[STORAGE_KEYS.folders]) ? data[STORAGE_KEYS.folders] : [],
      workspaceSnapshots: Array.isArray(data?.[STORAGE_KEYS.workspaceSnapshots])
        ? data[STORAGE_KEYS.workspaceSnapshots]
        : [],
    };
  }

  async function setCollections(collections) {
    const update = {};
    for (const [property, key] of Object.entries(STORAGE_KEYS)) {
      if (Object.hasOwn(collections, property)) {
        update[key] = Array.isArray(collections[property]) ? collections[property] : [];
      }
    }
    if (Object.keys(update).length) await storageArea.set(update);
  }

  return Object.freeze({
    getDeferred: () => getArray(STORAGE_KEYS.deferred),
    setDeferred: value => setArray(STORAGE_KEYS.deferred, value),
    getFolders: () => getArray(STORAGE_KEYS.folders),
    setFolders: value => setArray(STORAGE_KEYS.folders, value),
    getWorkspaceSnapshots: () => getArray(STORAGE_KEYS.workspaceSnapshots),
    setWorkspaceSnapshots: value => setArray(STORAGE_KEYS.workspaceSnapshots, value),
    getCollections,
    setCollections,
  });
}
