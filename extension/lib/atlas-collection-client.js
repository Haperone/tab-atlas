import { ATLAS_COLLECTION_PREFIX } from './atlas-collection-commands.js';
import { ATLAS_GENERATION_KEY } from './atlas-history-restore.js';

export function createAtlasCollectionClient(chromeApi) {
  let generation = null, loaded = false, undoContext = null, changeVersion = 0;
  const load = async () => {
    if (loaded) return generation;
    const version = changeVersion, captured = (await chromeApi.storage.local.get(ATLAS_GENERATION_KEY))[ATLAS_GENERATION_KEY] || null;
    if (version === changeVersion) { generation = captured; loaded = true; }
    return captured;
  };
  chromeApi.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[ATLAS_GENERATION_KEY]) { changeVersion++; generation = changes[ATLAS_GENERATION_KEY].newValue || null; loaded = true; }
  });
  async function command(action, data = {}) {
    const atStart = loaded ? { generation } : null;
    const initial = await load();
    const expectedGeneration = undoContext ? undoContext.generation : atStart ? atStart.generation : initial;
    const response = await chromeApi.runtime.sendMessage({ ...data, type: ATLAS_COLLECTION_PREFIX + action,
      ...(!action.startsWith('workspace-') && action !== 'read' ? { expectedGeneration } : {}) });
    if (!response?.ok) {
      const error = new Error(response?.error || 'Atlas could not save this change. Reload the extension at chrome://extensions and retry.');
      error.code = response?.code || 'SERVICE_UNAVAILABLE'; throw error;
    }
    return action === 'read' ? response.data : response.data?.result;
  }
  function guardUndo(callback, captured = Promise.resolve(generation)) {
    return async () => {
      const value = await captured;
      const previous = undoContext; undoContext = { generation: value };
      try { return await callback(); } finally { undoContext = previous; }
    };
  }
  function captureUndoGuard() {
    const captured = loaded ? Promise.resolve(generation) : load();
    void captured.catch(() => {});
    return callback => guardUndo(callback, captured);
  }
  return { command, guardUndo, captureUndoGuard };
}
