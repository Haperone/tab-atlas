/**
 * Event-driven MV3 service worker for toolbar badge and action handling.
 * Badge colors: green 1–10, amber 11–20, red 21+.
 */
import { createBackgroundHandlers } from './lib/background-core.js';

const { handleActionClicked, handleUpdated, updateBadge } = createBackgroundHandlers(chrome);

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onReplaced.addListener(updateBadge);
chrome.tabs.onUpdated.addListener(handleUpdated);
chrome.action.onClicked.addListener(handleActionClicked);

void updateBadge();
