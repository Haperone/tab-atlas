/**
 * Event-driven MV3 service worker for toolbar badge and action handling.
 * Badge colors: green 1–10, amber 11–20, red 21+.
 */
import { createBackgroundHandlers } from './lib/background-core.js';
import { createShareHandoff } from './lib/share-handoff.js';
import { createQuickSaveService, QUICK_SAVE_PREFIX } from './lib/quick-save-service.js';
import { createSaveSoundPlayer } from './lib/save-sound.js';
import { createAtlasHistoryService, ATLAS_HISTORY_PREFIX as TIME_MACHINE_PREFIX } from './lib/atlas-history-service.js';
import { ATLAS_COLLECTION_PREFIX } from './lib/atlas-collection-commands.js';

const { handleActionClicked, handleUpdated, updateBadge } = createBackgroundHandlers(chrome);
const shareHandoff = createShareHandoff();
const playQuickSaveSound = createSaveSoundPlayer(chrome);
const timeMachine = createAtlasHistoryService(chrome, {
  notify: () => { void chrome.runtime.sendMessage({ type: `${TIME_MACHINE_PREFIX}changed` }).catch(() => {}); },
});
const quickSave = createQuickSaveService(chrome, { openDashboard: handleActionClicked, updateBadge,
  collectionWriter: timeMachine.writer,
  playSaveSound: () => playQuickSaveSound('save'), playUndoSound: () => playQuickSaveSound('undo') });
timeMachine.register();

// Must be registered synchronously so MV3 can wake the worker for web handoff.
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  void (async () => {
    try { sendResponse(await shareHandoff.handleExternalShareMessage(request, sender)); }
    catch { sendResponse({ ok: false, error: 'INTERNAL_ERROR' }); }
  })();
  return true;
});

// A single worker-owned consumer serializes one-time handoff reads for every dashboard.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (typeof request?.type === 'string' && (request.type.startsWith(TIME_MACHINE_PREFIX) || request.type.startsWith(ATLAS_COLLECTION_PREFIX))) {
    // Change broadcasts have no request/response handler.
    if (request.type === `${TIME_MACHINE_PREFIX}changed`) return false;
    void (async () => { sendResponse(await timeMachine.handleMessage(request, sender)); })();
    return true;
  }
  if (typeof request?.type === 'string' && request.type.startsWith(QUICK_SAVE_PREFIX)) {
    void (async () => { sendResponse(await quickSave.handleMessage(request)); })();
    return true;
  }
  if (request?.type !== 'tab-atlas/share/consume') return false;
  void (async () => {
    try { sendResponse(await shareHandoff.handleInternalConsumeMessage(request, sender)); }
    catch { sendResponse({ code: 'HANDOFF_EXPIRED' }); }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onReplaced.addListener(updateBadge);
chrome.tabs.onUpdated.addListener(handleUpdated);
chrome.action.onClicked.addListener(handleActionClicked);
const refreshSaveMenus = () => { void quickSave.syncMenus().catch(error => console.error('[tab-atlas] Save menu unavailable:', error)); };
chrome.runtime.onInstalled.addListener(refreshSaveMenus);
chrome.runtime.onStartup.addListener(refreshSaveMenus);
chrome.contextMenus.onClicked.addListener((info, tab) => { void quickSave.handleContextClick(info, tab); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.folders) refreshSaveMenus();
});

void updateBadge();
void timeMachine.start().catch(() => {});
