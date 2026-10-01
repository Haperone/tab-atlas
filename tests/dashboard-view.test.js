import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDashboardTabs, normalizeDashboardPreferences, sortDashboardGroups } from '../extension/lib/dashboard-view.js';
import { parseSearch, recordMatches } from '../extension/lib/search.js';

const tabs = [
  { id: 1, url: 'https://github.com/a', title: 'Code review', windowId: 1, pinned: true },
  { id: 2, url: 'https://github.com/a', title: 'Code review', windowId: 2 },
  { id: 3, url: 'https://example.com/music', title: 'Music', windowId: 1, audible: true },
  { id: 4, url: 'https://example.com/music', title: 'Music', windowId: 1 },
];

test('view filters stay scoped to the chosen window, including duplicates', () => {
  assert.deepEqual(filterDashboardTabs(tabs, { windowId: 1, filter: 'duplicates' }).map(t => t.id), [3, 4]);
  assert.deepEqual(filterDashboardTabs(tabs, { filter: 'duplicates' }).map(t => t.id), [1, 2, 3, 4]);
  assert.deepEqual(filterDashboardTabs(tabs, { filter: 'pinned' }).map(t => t.id), [1]);
  assert.deepEqual(filterDashboardTabs(tabs, { windowId: 2, filter: 'audio' }), []);
  assert.deepEqual(filterDashboardTabs(tabs, { filter: 'audio' }).map(t => t.id), [3]);
});

test('search and view filters intersect without changing the source tabs', () => {
  const filtered = filterDashboardTabs(tabs, { windowId: 1, parsed: parseSearch('DOMAIN:GITHUB "code review"') }, recordMatches);
  assert.deepEqual(filtered.map(t => t.id), [1]);
  assert.equal(tabs.length, 4);
});

test('quoted phrases and negative operators apply consistently', () => {
  const parsed = parseSearch('DOMAIN:"GitHub.com" "code review" -url:pulls -draft');
  assert.equal(recordMatches('https://github.com/a', 'Code review', parsed), true);
  assert.equal(recordMatches('https://github.com/pulls/1', 'Code review', parsed), false);
  assert.equal(recordMatches('https://github.com/a', 'Code review draft', parsed), false);
  assert.equal(recordMatches('https://github.com/a', 'Code and review', parsed), false);
  assert.equal(recordMatches('https://github.com/a', 'Review', parseSearch('"review')), true);
  assert.deepEqual(parseSearch('domain: url: ""'), { domain: [], url: [], text: [] });
});

test('group ordering is stable, non-mutating and supports older Chrome tabs without lastAccessed', () => {
  const groups = [
    { domain: 'z.com', tabs: [{ lastAccessed: 100 }, {}] },
    { domain: 'a.com', tabs: [{ lastAccessed: 200 }] },
    { domain: '__landing-pages__', tabs: [{}] },
  ];
  assert.deepEqual(sortDashboardGroups(groups, 'name').map(g => g.domain), ['__landing-pages__', 'a.com', 'z.com']);
  assert.deepEqual(sortDashboardGroups(groups, 'recent').map(g => g.domain), ['__landing-pages__', 'a.com', 'z.com']);
  assert.deepEqual(sortDashboardGroups(groups).map(g => g.domain), ['__landing-pages__', 'z.com', 'a.com']);
  assert.equal(groups[0].domain, 'z.com');
});

test('malformed and old preferences fall back without losing deliberate opt-outs', () => {
  assert.deepEqual(normalizeDashboardPreferences(null), { sort: 'count', density: 'comfortable', sound: true, motion: true });
  assert.deepEqual(normalizeDashboardPreferences({ sort: 'unexpected', density: 'compact', sound: false, motion: false }), { sort: 'count', density: 'compact', sound: false, motion: false });
});
