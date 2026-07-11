const BADGE_COLORS = Object.freeze({
  manageable: '#3d7a4a',
  busy: '#b8892e',
  overloaded: '#b35a5a',
});

export function isCountedTabUrl(url) {
  const value = url || '';
  return !['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://']
    .some(prefix => value.startsWith(prefix));
}

export function badgePresentation(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  return {
    text: safeCount === 0 ? '' : safeCount > 999 ? '999+' : String(safeCount),
    color: safeCount === 0
      ? null
      : safeCount <= 10
        ? BADGE_COLORS.manageable
        : safeCount <= 20
          ? BADGE_COLORS.busy
          : BADGE_COLORS.overloaded,
  };
}

export function isBadgeRelevantUpdate(changeInfo) {
  return Object.hasOwn(changeInfo || {}, 'url');
}

export function findTabAtlasTab(tabs, dashboardUrl) {
  return (tabs || []).find(tab => {
    const url = tab?.url || '';
    return url === dashboardUrl || url.startsWith(`${dashboardUrl}?`) || url.startsWith(`${dashboardUrl}#`);
  }) || null;
}

export function createBackgroundHandlers(chromeApi) {
  async function updateBadge() {
    try {
      const tabs = await chromeApi.tabs.query({});
      const presentation = badgePresentation(tabs.filter(tab => isCountedTabUrl(tab.url)).length);
      await chromeApi.action.setBadgeText({ text: presentation.text });
      if (presentation.color) await chromeApi.action.setBadgeBackgroundColor({ color: presentation.color });
    } catch {
      await chromeApi.action.setBadgeText({ text: '' });
    }
  }

  function handleUpdated(_tabId, changeInfo) {
    if (isBadgeRelevantUpdate(changeInfo)) void updateBadge();
  }

  async function handleActionClicked() {
    const dashboardUrl = chromeApi.runtime.getURL('index.html');
    const tabs = await chromeApi.tabs.query({});
    const existing = findTabAtlasTab(tabs, dashboardUrl);
    if (!existing) {
      await chromeApi.tabs.create({ url: dashboardUrl });
      return;
    }
    if (Number.isFinite(existing.windowId)) {
      await chromeApi.windows.update(existing.windowId, { focused: true });
    }
    await chromeApi.tabs.update(existing.id, { active: true });
  }

  return Object.freeze({ handleActionClicked, handleUpdated, updateBadge });
}
