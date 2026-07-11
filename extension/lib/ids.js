/** Create a storage-safe identifier while avoiding IDs already in use. */
export function makeStorageId(existingIds = new Set(), options = {}) {
  const now = options.now || Date.now;
  const random = options.random || Math.random;
  let id = '';
  do {
    id = now().toString() + random().toString(36).slice(2, 8);
  } while (existingIds.has(id));
  existingIds.add(id);
  return id;
}
