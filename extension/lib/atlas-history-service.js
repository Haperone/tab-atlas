import { createAtlasHistoryDatabase } from './atlas-history-db.js';
import { createAtlasCollectionWriter, ATLAS_REVISION_KEY } from './atlas-collection-writer.js';
import { captureAtlasHistoryState, diffAtlasStates, serializeAtlasComparison } from './atlas-history-model.js';
import { createAtlasRestorer, ATLAS_RESTORE_KEYS, ATLAS_GENERATION_KEY } from './atlas-history-restore.js';
import { createAtlasCollectionCommands, ATLAS_COLLECTION_PREFIX } from './atlas-collection-commands.js';

export const ATLAS_HISTORY_PREFIX = 'tab-atlas/time-machine/';

/** One worker owns every collection mutation. Browser tab events never enter this journal. */
export function createAtlasHistoryService(chromeApi, { database = createAtlasHistoryDatabase(), notify = () => {}, clock = Date.now,
  allowSender = sender => {
    const url = chromeApi.runtime.getURL('index.html');
    return sender?.id === chromeApi.runtime.id && !sender?.tab?.incognito &&
      (sender?.url === url || sender?.url?.startsWith(`${url}?`) || sender?.url?.startsWith(`${url}#`));
  } } = {}) {
  const area = chromeApi.storage.local;
  let ready = null, enabled = false, paused = false, stopped = null, restorer;
  const announce = () => { try { notify(); } catch {} };
  async function stop(error) {
    stopped = error.message || 'History could not be saved. Retry recording from its options.';
    try { await database.configure({ stopped }); } catch {}
    announce();
  }
  async function initialize() {
    await database.status();
    await restorer.recoverPending();
    // Recovery may have recorded the first durable point. Do not add another baseline.
    const status = await database.status(); enabled = status.enabled; paused = status.paused; stopped = status.stopped;
    if (!enabled || paused || stopped) return;
    const state = captureAtlasHistoryState(await area.get(['folders', 'deferred'])), previous = await database.current();
    if (!status.oldest || Object.keys(diffAtlasStates(previous, state)).length) {
      await database.append(state, { boundary: true, kind: status.oldest ? 'reconciled' : 'baseline', wallTime: clock() });
    }
  }
  async function ensureReady() {
    if (!ready) ready = initialize();
    try { await ready; } catch (error) { ready = null; throw error; }
  }
  async function prepareHistory() {
    // Ordinary saves stay usable when history is unavailable. Restore's source
    // and protection reads still fail before its local commit.
    try { await ensureReady(); await restorer.recoverPending(); } catch (error) { await stop(error); }
  }
  const writer = createAtlasCollectionWriter(area, { extraKeys: ATLAS_RESTORE_KEYS,
    beforeChange: prepareHistory,
    onCommitted: async event => {
      if (await restorer.committed(event)) { announce(); return; }
      if (enabled && !paused && !stopped) {
        await database.append(captureAtlasHistoryState(event.after), { kind: event.kind, wallTime: event.at });
      }
      announce();
    },
    onHistoryError: stop, clock,
  });
  restorer = createAtlasRestorer({ database, writer, storage: area, clock });
  const collectionCommand = createAtlasCollectionCommands(writer);
  // History navigation needs the same queue/recovery, without reading and copying
  // every current collection for a date or storage-status request.
  const inspectHistory = action => writer.exclusive(async () => { await prepareHistory(); return await action(); });
  const comparisonPayload = (state, collections, request) => request.comparisonFormat === 'compact-v1'
    ? { comparison: serializeAtlasComparison(state, collections) }
    : { current: captureAtlasHistoryState(collections) }; // Keep already-open older dashboards usable.
  async function changeRecording(action) {
    return await writer.exclusive(async () => {
      await ensureReady(); await restorer.recoverPending();
      if (action === 'enable' && enabled && !paused && !stopped) return await database.status();
      if (action === 'pause' || action === 'disable') {
        if (action === 'disable') enabled = false; else paused = true;
        await database.configure({ enabled, paused });
      } else {
        enabled = true; paused = false; stopped = null;
        await database.configure({ enabled, paused, stopped });
        try {
          const current = captureAtlasHistoryState(await area.get(['folders', 'deferred']));
          await database.append(current, { boundary: true, kind: action === 'enable' ? 'baseline' : 'resume', wallTime: clock() });
        } catch (error) { await stop(error); throw error; }
      }
      announce(); return await database.status();
    });
  }
  async function status() {
    return await inspectHistory(async () => {
      const stored = await area.get([ATLAS_REVISION_KEY, ATLAS_GENERATION_KEY]);
      return { ...await database.status(), revision: stored[ATLAS_REVISION_KEY]?.id || null, generation: stored[ATLAS_GENERATION_KEY] || null };
    });
  }
  async function openLink(request, sender) {
    return await writer.inspect(async () => {
      let state;
      if (request.pointOperation) {
        const status = await database.status();
        if (status.lastRestore?.id !== request.pointOperation) throw new Error('This return point was replaced. Choose the current return point.');
        state = (await database.operation(request.pointOperation)).before;
      } else {
        const moment = await database.seek(request.time);
        if (!moment.time || moment.gap) throw new Error('Choose a recorded moment before opening a link.');
        state = moment.state;
      }
      const record = state.deferred.find(link => link.id === request.linkId);
      let url; try { url = new URL(record?.url); } catch { throw new Error('This saved address cannot be opened. It remains in the snapshot.'); }
      if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('This address cannot be opened. It remains in the snapshot.');
      const windowId = sender.tab?.windowId;
      if (!Number.isInteger(windowId)) throw new Error('Open Tab Atlas in a normal browser window and try again.');
      const window = await chromeApi.windows.get(windowId);
      if (window.type !== 'normal' || window.incognito) throw new Error('Open Tab Atlas in a normal browser window and try again.');
      const tabs = await chromeApi.tabs.query({ windowId }), existing = tabs.find(tab => tab.url === record.url);
      const tab = existing ? await chromeApi.tabs.update(existing.id, { active: true }) : await chromeApi.tabs.create({ windowId, url: record.url, active: true });
      return { tabId: tab.id, windowId, existing: !!existing };
    });
  }
  async function handleMessage(request, sender) {
    if (!allowSender(sender)) return { ok: false, code: 'NOT_ALLOWED', error: 'Open Time machine from Tab Atlas.' };
    try {
      let data;
      if (request.type.startsWith(ATLAS_COLLECTION_PREFIX)) {
        const action = request.type.slice(ATLAS_COLLECTION_PREFIX.length);
        data = action === 'read' ? await writer.inspect(({ collections, revision, stored }) => ({ collections, revision, generation: stored[ATLAS_GENERATION_KEY] || null }))
          : await collectionCommand({ ...request, action });
      } else {
        const action = request.type.slice(ATLAS_HISTORY_PREFIX.length);
        if (action === 'status') data = await status();
        else if (action === 'storage-status') data = await writer.exclusive(() => database.storageStatus());
        else if (['enable', 'resume', 'pause', 'disable'].includes(action)) data = await changeRecording(action);
        else if (action === 'seek') data = await writer.inspect(async ({ collections }) => {
          const moment = await database.seek(request.time);
          return { ...moment, ...comparisonPayload(moment.state, collections, request) };
        });
        else if (action === 'compare') data = await writer.inspect(async ({ collections, revision }) => {
          if (request.comparisonFormat !== 'compact-v1') return { current: captureAtlasHistoryState(collections), revision };
          let state;
          if (request.pointOperation) {
            const status = await database.status();
            if (status.lastRestore?.id !== request.pointOperation) throw new Error('This return point was replaced. Choose the current return point.');
            state = (await database.operation(request.pointOperation)).before;
          } else state = (await database.seek(request.time)).state;
          return { comparison: serializeAtlasComparison(state, collections), revision };
        });
        else if (action === 'step') data = await inspectHistory(() => database.step(request.time, request.direction));
        else if (action === 'timeline') data = await inspectHistory(() => database.timeline(request));
        else if (action === 'nearest') data = await inspectHistory(() => database.nearest(request.time));
        else if (action === 'preview-restore') data = await restorer.preview(request);
        else if (action === 'restore') data = await restorer.restore(request);
        else if (action === 'preview-undo') data = await restorer.undoPreview(request.operationId);
        else if (action === 'undo') data = await restorer.undo(request);
        else if (action === 'open-link') data = await openLink(request, sender);
        else if (action === 'before-restore') data = await writer.inspect(async ({ collections }) => {
          const status = await database.status();
          if (!status.lastRestore) throw new Error('There is no protected return point yet.');
          const operation = await database.operation(status.lastRestore.id);
          const state = captureAtlasHistoryState(operation.before);
          return { state, ...comparisonPayload(state, collections, request), time: operation.createdAt, wallTime: operation.createdAt,
            pointOperation: operation.id, seq: `protected:${operation.id}`, gap: false };
        });
        else if (action === 'clear') data = await writer.exclusive(async () => {
          // Explicit Clear must remain available when a damaged record prevents initialization.
          await database.clear(); ready = null;
          const preferences = await database.status();
          enabled = preferences.enabled; paused = preferences.paused; stopped = null;
          if (enabled && !paused) await database.append(captureAtlasHistoryState(await area.get(['folders', 'deferred'])), { boundary: true, kind: 'baseline', wallTime: clock() });
          announce(); return await database.status();
        });
        else throw new Error('This history action is unavailable. Reload Tab Atlas and retry.');
      }
      return { ok: true, data };
    } catch (error) { return { ok: false, code: error.code || 'HISTORY_ERROR', error: error.message || 'Unable to save the change. Retry.' }; }
  }
  function register() {
    chromeApi.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(changes.folders || changes.deferred) || changes[ATLAS_REVISION_KEY]) return;
      // Compatibility/foreign writes are reconciliation boundaries, not invented intermediate actions.
      void writer.exclusive(async () => {
        await ensureReady(); await restorer.recoverPending();
        if (enabled && !paused && !stopped) {
          const current = captureAtlasHistoryState(await area.get(['folders', 'deferred'])), previous = await database.current();
          if (Object.keys(diffAtlasStates(previous, current)).length) {
            await database.append(current, { boundary: true, kind: 'external-change', wallTime: clock() });
          }
        }
        announce();
      }).catch(stop);
    });
  }
  return { writer, restorer, database, handleMessage, register, start: () => writer.exclusive(ensureReady), collectionCommand };
}
