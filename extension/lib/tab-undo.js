// Restoration records retain progress across retries, including failures after
// tab creation. The same record must never create another tab on retry.
export function snapshotUndoTab(tab, groupMeta = null) {
  if (!tab) return null;
  if (typeof tab === 'string') return tab ? { url:tab, pinned:false } : null;
  if (!tab.url) return null;
  return {
    url:tab.url, pinned:!!tab.pinned,
    ...(Number.isInteger(tab.windowId) ? { windowId:tab.windowId } : {}),
    ...(Number.isInteger(tab.index) ? { index:tab.index } : {}),
    ...(Number.isInteger(tab.groupId) && tab.groupId >= 0 ? {
      groupId:tab.groupId,
      groupMeta:groupMeta ? { title:groupMeta.title || '', color:groupMeta.color, collapsed:!!groupMeta.collapsed } : null,
    } : {}),
  };
}

const singleRestoreGroups = new WeakMap();
export async function restoreUndoTabRecord(chrome, record, groups) {
  if (!record?.url) return null;
  if (!groups) {
    if (!singleRestoreGroups.has(record)) singleRestoreGroups.set(record, new Map());
    groups = singleRestoreGroups.get(record);
  }
  if (record.restoredTabId == null) {
    const options = { url:record.url, active:false, pinned:!!record.pinned };
    if (record.windowId != null && chrome.windows?.getAll) {
      const windows = await chrome.windows.getAll({});
      if (windows.some(window => window.id === record.windowId)) {
        options.windowId = record.windowId;
        if (record.index != null) options.index = record.index;
      }
    }
    const created = await chrome.tabs.create(options);
    if (created?.id == null) throw new Error('The restored tab is unavailable');
    record.restoredTabId = created.id;
  }

  if (!record.pinned && record.groupId != null && chrome.tabGroups && chrome.tabs.group) {
    let target = groups.get(record.groupId);
    if (!target) {
      let existing;
      try { existing = await chrome.tabGroups.get(record.groupId); } catch { /* The last member may have closed the group. */ }
      target = existing?.id != null
        ? { id:existing.id, created:false }
        : { id:await chrome.tabs.group({ tabIds:[record.restoredTabId] }), created:true };
      groups.set(record.groupId, target);
    }
    await chrome.tabs.group({ groupId:target.id, tabIds:[record.restoredTabId] });
    if (target.created && record.groupMeta) await chrome.tabGroups.update(target.id, record.groupMeta);
  }
  return { id:record.restoredTabId };
}
