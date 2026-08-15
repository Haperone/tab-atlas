/**
 * Event-driven MV3 service worker for toolbar badge and action handling.
 * Badge colors: green 1–10, amber 11–20, red 21+.
 */
import { createBackgroundHandlers } from './lib/background-core.js';
import { createShareHandoff } from './lib/share-handoff.js';

const { handleActionClicked, handleUpdated, updateBadge } = createBackgroundHandlers(chrome);
const shareHandoff = createShareHandoff();

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

void updateBadge();
