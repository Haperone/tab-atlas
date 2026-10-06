/** Pure history model. Chrome IDs are mappings; historical keys survive moves. */
export const TIME_MACHINE_LIMITS = Object.freeze({
  budget: 20 * 1024 * 1024, trimTo: 16 * 1024 * 1024,
  maxAge: 30 * 24 * 60 * 60 * 1000, checkpointEvents: 200, checkpointMs: 5 * 60 * 1000,
  operationReserve: 256 * 1024,
});
export const emptyHistoryState = () => ({ tabs: {}, windows: {}, groups: {} });
export const cloneHistoryState = state => structuredClone(state);

export function historyUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value : null; }
  catch { return null; }
}

export function diffHistoryStates(before, after) {
  const patch = {};
  for (const collection of ['tabs', 'windows', 'groups']) {
    const put = [], remove = [];
    for (const [key, value] of Object.entries(after[collection])) {
      const old = before[collection][key];
      if (!old || Object.keys(old).length !== Object.keys(value).length ||
        Object.entries(value).some(([field, item]) => old[field] !== item)) put.push(value);
    }
    for (const key of Object.keys(before[collection])) if (!after[collection][key]) remove.push(key);
    if (put.length || remove.length) patch[collection] = { put, remove };
  }
  return patch;
}

export function applyHistoryPatch(state, patch) {
  const next = { ...state };
  for (const collection of ['tabs', 'windows', 'groups']) {
    if (!patch[collection]) continue;
    next[collection] = { ...state[collection] };
    for (const key of patch[collection].remove) delete next[collection][key];
    for (const value of patch[collection].put) next[collection][value.key] = { ...value };
  }
  return next;
}

export function replayHistory(checkpoint, events) {
  return events.reduce((state, event) => applyHistoryPatch(state, event.patch), cloneHistoryState(checkpoint));
}

/** Snapshot capture is used only for boundaries/reconciliation, never polling. */
export function captureHistoryState(windows, groups, previous = emptyHistoryState(), key = () => crypto.randomUUID()) {
  const state = emptyHistoryState();
  const oldWindow = new Map(Object.values(previous.windows).map(w => [w.chromeId, w]));
  const oldTab = new Map(Object.values(previous.tabs).map(t => [t.chromeId, t]));
  const oldGroup = new Map(Object.values(previous.groups).map(g => [g.chromeId, g]));
  const windowKeys = new Map();
  for (const window of windows) {
    if (window.incognito || window.type !== 'normal') continue;
    const windowKey = oldWindow.get(window.id)?.key || key();
    windowKeys.set(window.id, windowKey);
    state.windows[windowKey] = { key: windowKey, chromeId: window.id };
  }
  const groupKeys = new Map();
  for (const group of groups) {
    const windowKey = windowKeys.get(group.windowId);
    if (!windowKey) continue;
    const groupKey = oldGroup.get(group.id)?.key || key();
    groupKeys.set(group.id, groupKey);
    state.groups[groupKey] = { key: groupKey, chromeId: group.id, windowKey,
      title: String(group.title || ''), color: group.color || 'grey', collapsed: !!group.collapsed };
  }
  for (const window of windows) {
    const windowKey = windowKeys.get(window.id);
    if (!windowKey) continue;
    for (const tab of window.tabs || []) {
      const url = historyUrl(tab.url);
      if (tab.incognito || !url) continue;
      const tabKey = oldTab.get(tab.id)?.key || key();
      state.tabs[tabKey] = { key: tabKey, chromeId: tab.id, windowKey, url,
        title: String(tab.title || url), index: tab.index || 0, pinned: !!tab.pinned,
        active: !!tab.active, groupKey: groupKeys.get(tab.groupId) || null };
    }
  }
  return state;
}

/** Mutate a cloned working model using captured event data (closed IDs aren't read). */
export function reduceChromeHistory(state, event, key = () => crypto.randomUUID()) {
  const next = cloneHistoryState(state);
  const find = (collection, id) => Object.values(next[collection]).find(row => row.chromeId === id);
  const reindex = (windowKey, from, delta, except) => {
    for (const tab of Object.values(next.tabs)) {
      if (tab.windowKey === windowKey && tab.key !== except && tab.index >= from) tab.index += delta;
    }
  };
  const attachTab = raw => {
    const existing = find('tabs', raw.id);
    const window = find('windows', raw.windowId);
    const url = historyUrl(raw.url);
    if (raw.incognito || !window || !url) {
      if (existing) delete next.tabs[existing.key];
      // A navigation keeps its physical slot; a newly created internal tab shifts it.
      if(window && !existing && event.type==='created')reindex(window.key,raw.index || 0,1);
      return;
    }
    const tabKey = existing?.key || key();
    const group = find('groups', raw.groupId);
    if (!existing && event.type === 'created') reindex(window.key, raw.index || 0, 1, tabKey);
    next.tabs[tabKey] = { key: tabKey, chromeId: raw.id, windowKey: window.key,
      url, title: String(raw.title || url), index: raw.index || 0, pinned: !!raw.pinned,
      active: !!raw.active, groupKey: group?.key || null };
    if (raw.active) for (const tab of Object.values(next.tabs)) {
      if (tab.windowKey === window.key && tab.key !== tabKey) tab.active = false;
    }
  };
  switch (event.type) {
    case 'window-created': {
      const raw = event.window;
      if (raw.incognito || raw.type !== 'normal') break;
      const windowKey = find('windows', raw.id)?.key || key();
      next.windows[windowKey] = { key: windowKey, chromeId: raw.id };
      for (const tab of raw.tabs || []) attachTab(tab);
      break;
    }
    case 'window-removed': {
      const window = find('windows', event.id);
      if (!window) break;
      delete next.windows[window.key];
      for (const [k, tab] of Object.entries(next.tabs)) if (tab.windowKey === window.key && !tab.detached) delete next.tabs[k];
      for (const [k, group] of Object.entries(next.groups)) if (group.windowKey === window.key) delete next.groups[k];
      break;
    }
    case 'created': case 'updated': attachTab(event.tab); break;
    case 'removed': {
      const tab = find('tabs', event.id);
      if (!tab) break;
      delete next.tabs[tab.key]; if (!tab.detached) reindex(tab.windowKey, tab.index + 1, -1); break;
    }
    case 'activated': {
      const tab = find('tabs', event.id);
      if (tab) for (const candidate of Object.values(next.tabs)) {
        if (candidate.windowKey === tab.windowKey) candidate.active = candidate.key === tab.key;
      }
      break;
    }
    case 'moved': {
      const tab = find('tabs', event.id);
      if (!tab) break;
      const from = tab.index, to = event.index;
      for (const candidate of Object.values(next.tabs)) {
        if (candidate.windowKey !== tab.windowKey || candidate.key === tab.key) continue;
        if (from < to && candidate.index > from && candidate.index <= to) candidate.index--;
        if (from > to && candidate.index >= to && candidate.index < from) candidate.index++;
      }
      tab.index = to; break;
    }
    case 'attached': {
      const tab = find('tabs', event.id), window = find('windows', event.windowId);
      if (!tab || !window) break;
      if (!tab.detached) reindex(tab.windowKey, tab.index + 1, -1, tab.key);
      reindex(window.key, event.index, 1, tab.key);
      tab.windowKey = window.key; tab.index = event.index; tab.groupKey = null; delete tab.detached; break;
    }
    case 'detached': {
      const tab = find('tabs', event.id);
      if (tab) { reindex(tab.windowKey, tab.index + 1, -1, tab.key); tab.detached = true; }
      break;
    }
    case 'replaced': {
      const tab = find('tabs', event.oldId);
      if (tab && !event.tab.incognito && historyUrl(event.tab.url)) {
        tab.chromeId = event.tab.id; attachTab(event.tab);
      } else if (tab) delete next.tabs[tab.key];
      break;
    }
    case 'group-updated': {
      const raw = event.group, window = find('windows', raw.windowId);
      if (!window) break;
      const groupKey = find('groups', raw.id)?.key || key();
      next.groups[groupKey] = { key: groupKey, chromeId: raw.id, windowKey: window.key,
        title: String(raw.title || ''), color: raw.color || 'grey', collapsed: !!raw.collapsed };
      const members=new Set(event.tabIds || []);
      for(const tab of Object.values(next.tabs)){
        if(members.has(tab.chromeId))tab.groupKey=groupKey;
        else if(tab.groupKey===groupKey)tab.groupKey=null;
      }
      break;
    }
    case 'group-removed': {
      const group = find('groups', event.id);
      if (!group) break;
      delete next.groups[group.key];
      for (const tab of Object.values(next.tabs)) if (tab.groupKey === group.key) tab.groupKey = null;
      break;
    }
  }
  return next;
}

export function planHistoryRestore(state, selectedKeys, liveTabs) {
  const requested = new Set(selectedKeys), seen = new Set(liveTabs.filter(t => !t.incognito).map(t => t.url));
  const tabs = [], skipped = [];
  for (const tab of Object.values(state.tabs).sort((a, b) => a.index - b.index)) {
    if (!requested.has(tab.key) || !historyUrl(tab.url)) continue;
    if (seen.has(tab.url)) skipped.push(tab.key);
    else { seen.add(tab.url); tabs.push(tab); }
  }
  return { tabs, skipped, windowCount: new Set(tabs.map(t => t.windowKey)).size };
}

export function canUndoHistoryTab(owned, live) {
  return !!live && !live.incognito && live.id === owned.id && live.url === owned.url &&
    live.windowId === owned.windowId && !!live.pinned === !!owned.pinned && !owned.changed;
}
