import { STORAGE_KEYS } from './storage-repository.js';
import { captureAtlasState, diffAtlasStates } from './atlas-history-model.js';
import { checkStorageCapacity } from './storage-usage.js';

export const ATLAS_REVISION_KEY = 'atlasCollectionsRevision';

/** Worker-owned read/modify/commit boundary. Other writers must route through this owner. */
export function createAtlasCollectionWriter(storage, { extraKeys = [], beforeChange, onCommitted, onHistoryError,
  key = () => crypto.randomUUID(), clock = Date.now } = {}) {
  const allowed = new Set([...Object.values(STORAGE_KEYS), ...extraKeys]);
  const readKeys = [...allowed, ATLAS_REVISION_KEY];
  let tail = Promise.resolve();
  const serialize = action => {
    const previous = tail;
    const result = (async () => { await previous; return await action(); })();
    tail = result.catch(() => {}); return result;
  };
  async function readCurrent() {
    const stored = await storage.get(readKeys);
    const collections = Object.fromEntries(Object.values(STORAGE_KEYS).map(name => [name, Array.isArray(stored[name]) ? structuredClone(stored[name]) : []]));
    return { stored, collections, revision: stored[ATLAS_REVISION_KEY]?.id || null };
  }
  function conflict() {
    const error = new Error('Atlas changed while this action was being prepared. Review the current data and retry.');
    error.code = 'REVISION_CONFLICT'; return error;
  }
  async function commit(change, options) {
    await beforeChange?.();
    const current = await readCurrent();
    if (Object.hasOwn(options, 'expectedRevision') && options.expectedRevision !== current.revision) throw conflict();
    const before = captureAtlasState(current.collections);
    const plan = await change(structuredClone(current.collections), structuredClone(current.stored));
    if (!plan || !plan.update || typeof plan.update !== 'object' || Array.isArray(plan.update)) throw new Error('This Atlas action has no valid update.');
    const update = structuredClone(plan.update);
    for (const name of Object.keys(update)) {
      if (!allowed.has(name)) throw new Error('This action cannot change that storage setting.');
      if (Object.values(STORAGE_KEYS).includes(name) && !Array.isArray(update[name])) throw new Error('Atlas collections must be arrays.');
    }
    const after = captureAtlasState({ ...current.collections, ...update });
    const changed = Object.keys(diffAtlasStates(before, after)).length > 0;
    const stamp = changed ? { id: key(), at: clock(), kind: options.kind || 'change', operationId: options.operationId || null } : null;
    if (stamp) update[ATLAS_REVISION_KEY] = stamp;
    if (stamp && options.receiptKey) {
      if (!allowed.has(options.receiptKey) || !update[options.receiptKey]) throw new Error('This restore has no valid commit receipt.');
      update[options.receiptKey].revision = stamp.id;
    }
    await checkStorageCapacity(storage, update, { action: 'update Atlas' });
    if (changed) await options.prepare?.({ before, after, stamp, revision: current.revision });
    if (Object.keys(update).length) await storage.set(update);
    let historyError = false;
    if (changed && onCommitted) {
      try { await onCommitted({ before, after, revision: stamp.id, ...stamp }); }
      catch (error) {
        // A history failure must never report the already committed save as failed.
        historyError = true; try { await onHistoryError?.(error); } catch {}
      }
    }
    return { result: plan.result, changed, revision: stamp?.id || current.revision, historyError };
  }
  return {
    read: () => serialize(async () => {
      await beforeChange?.();
      const { collections, revision } = await readCurrent(); return { collections, revision };
    }),
    inspect: action => serialize(async () => {
      await beforeChange?.();
      const { collections, revision, stored } = await readCurrent(); return await action({ collections, revision, stored });
    }),
    exclusive: action => serialize(action),
    mutate: (change, options = {}) => serialize(() => commit(change, options)),
  };
}
