export const DASHBOARD_PREFERENCES_KEY = 'tabout-dashboard-preferences';

export function normalizeDashboardPreferences(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  return {
    sort: ['count', 'name', 'recent'].includes(value.sort) ? value.sort : 'count',
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    sound: value.sound !== false,
    motion: value.motion !== false,
  };
}

/** Count duplicates inside the chosen window, before applying the status filter. */
export function filterDashboardTabs(tabs, { windowId = null, filter = 'all', parsed = null } = {}, matches = () => true) {
  const scoped = tabs.filter(tab => windowId === null || tab.windowId === windowId);
  const counts = new Map();
  for (const tab of scoped) counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
  return scoped.filter(tab => {
    if (filter === 'duplicates' && (counts.get(tab.url) || 0) < 2) return false;
    if (filter === 'pinned' && !tab.pinned) return false;
    if (filter === 'audio' && !tab.audible) return false;
    return !parsed || matches(tab.url, tab.title, parsed);
  });
}

export function sortDashboardGroups(groups, sort = 'count') {
  const recent = group => Math.max(0, ...group.tabs.map(tab => Number(tab.lastAccessed) || 0));
  const name = group => group.label || group.domain.replace(/^www\./, '');
  return [...groups].sort((a, b) => {
    if (a.domain === '__landing-pages__') return b.domain === a.domain ? 0 : -1;
    if (b.domain === '__landing-pages__') return 1;
    if (sort === 'recent') return recent(b) - recent(a) || name(a).localeCompare(name(b));
    if (sort === 'name') return name(a).localeCompare(name(b));
    return b.tabs.length - a.tabs.length || name(a).localeCompare(name(b));
  });
}
