import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderArchiveItem,
  renderDeferredItem,
  renderDomainCard,
  renderTabChip,
} from '../extension/lib/renderers.js';
import { parseSearch, recordMatches } from '../extension/lib/search.js';
import { renderSpeedDialMarkup } from '../extension/lib/speed-dial.js';
import { createThemeController } from '../extension/lib/theme-controller.js';
import {
  escapeHtml,
  favIcon,
  friendlyDomain,
  isFaviconRequestUrl,
  isLandingPageUrl,
  tabUpdateAffectsDashboard,
  tabsSignature,
} from '../extension/lib/tab-model.js';

test('search parser separates operators and free text', () => {
  assert.deepEqual(parseSearch('domain:github url:issues urgent review'), {
    domain: ['github'],
    url: ['issues'],
    text: ['urgent', 'review'],
  });
});

test('record matching requires every parsed search term', () => {
  const parsed = parseSearch('domain:github url:issues regression');
  assert.equal(recordMatches('https://github.com/org/repo/issues/1', 'Regression report', parsed), true);
  assert.equal(recordMatches('https://github.com/org/repo/pulls/1', 'Regression report', parsed), false);
});

test('HTML escaping covers text and attribute delimiters', () => {
  assert.equal(escapeHtml(`<img title="x" data-y='z'>&`), '&lt;img title=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;');
});

test('favicon construction uses a supplied packaged Chrome runtime', () => {
  const runtime = { getURL: path => `chrome-extension://test-id${path}` };
  assert.equal(
    favIcon('https://example.com/a?b=1', 32, runtime),
    'chrome-extension://test-id/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;size=32',
  );
});

test('favicon error handler recognises the URLs favIcon() actually produces', () => {
  const runtime = { getURL: path => `chrome-extension://test-id${path}` };
  // The real favicon URL (with &amp; from favIcon) and the DOM-resolved form both match.
  assert.equal(isFaviconRequestUrl(favIcon('https://example.com', 16, runtime)), true);
  assert.equal(isFaviconRequestUrl('chrome-extension://test-id/_favicon/?pageUrl=https%3A%2F%2Fx&size=16'), true);
  // Legacy Google source kept for forks that customise favIcon().
  assert.equal(isFaviconRequestUrl('https://www.google.com/s2/favicons?domain=example.com'), true);
  // Non-favicon images must not be hidden.
  assert.equal(isFaviconRequestUrl('https://example.com/logo.png'), false);
  assert.equal(isFaviconRequestUrl(''), false);
});

test('tab signatures change for every rendered or behaviorally relevant field', () => {
  const base = {
    id: 7, title: 'Example', url: 'https://example.com', pinned: false,
    active: false, audible: false, mutedInfo: { muted: false }, discarded: false,
    groupId: -1, windowId: 1, index: 0,
  };
  const changes = {
    title: 'Changed', url: 'https://other.test', pinned: true, active: true,
    audible: true, mutedInfo: { muted: true }, discarded: true,
    groupId: 2, windowId: 3, index: 4,
  };
  for (const [field, value] of Object.entries(changes)) {
    assert.notEqual(tabsSignature([base]), tabsSignature([{ ...base, [field]: value }]), field);
  }
});

test('dashboard update filtering covers displayed update fields only', () => {
  for (const field of ['title', 'url', 'pinned', 'audible', 'mutedInfo', 'discarded', 'groupId']) {
    assert.equal(tabUpdateAffectsDashboard({ [field]: true }), true, field);
  }
  assert.equal(tabUpdateAffectsDashboard({ status: 'complete' }), false);
});

test('domain and landing-page helpers preserve grouping behavior', () => {
  assert.equal(friendlyDomain('docs.google.com'), 'Google Docs');
  assert.equal(friendlyDomain('alice.github.io'), 'Alice (GitHub Pages)');
  const patterns = [{ hostname: 'example.com', pathExact: ['/home'] }];
  assert.equal(isLandingPageUrl('https://example.com/home', patterns), true);
  assert.equal(isLandingPageUrl('https://example.com/article', patterns), false);
});

test('theme controller exposes the current option for the Customize menu', () => {
  const controller = createThemeController({
    document: { documentElement: { dataset: {} } },
    storage: { getItem: () => 'papersoft', setItem: () => {} },
    showContextMenu: () => {},
    showToast: () => {},
  });
  assert.deepEqual(controller.currentThemeOption(), {
    id: 'papersoft',
    label: 'Paper Soft',
    color: '#93401f',
    group: 'light',
  });
});

test('theme controller persists a light/dark pair and Bloom toggles only between it', () => {
  const values = new Map([['tabout-theme', 'tokyonight']]);
  const attributes = new Map();
  const toggle = {
    dataset: {},
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const toasts = [];
  const controller = createThemeController({
    document: {
      documentElement: { dataset: {} },
      getElementById: id => id === 'themeModeToggle' ? toggle : null,
    },
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    showContextMenu: () => {},
    showToast: message => toasts.push(message),
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(controller.currentThemePairOptions()).map(([mode, option]) => [mode, option.id])),
    { dark: 'tokyonight', light: 'paper' },
  );
  controller.setThemeForMode('light', 'lattesoft');
  assert.equal(controller.currentTheme(), 'tokyonight', 'editing the inactive side must not switch immediately');
  assert.equal(values.get('tabout-theme-light'), 'lattesoft');

  controller.toggleThemeMode();
  assert.equal(controller.currentTheme(), 'lattesoft');
  assert.equal(toggle.dataset.mode, 'light');
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.equal(attributes.get('aria-label'), 'Switch to Tokyo Night');

  controller.setThemeForMode('dark', 'graphite');
  assert.equal(controller.currentTheme(), 'lattesoft');
  controller.toggleThemeMode();
  assert.equal(controller.currentTheme(), 'graphite');
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(attributes.get('aria-label'), 'Switch to Latte Soft');
  assert.deepEqual(toasts, ['Theme: Latte Soft', 'Theme: Graphite']);
});

test('theme pair menu keeps both selectors together while either side is edited', () => {
  const values = new Map([['tabout-theme', 'default']]);
  const menus = [];
  const controller = createThemeController({
    document: { documentElement: { dataset: {} } },
    storage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    showContextMenu: (x, y, items) => menus.push({ x, y, items }),
    showToast: () => {},
  });

  controller.openThemeMenu(120, 80);
  assert.deepEqual(
    menus[0].items.filter(item => item.heading).map(item => item.label),
    ['Dark theme · Bloom pair', 'Light theme · Bloom pair'],
  );
  const latte = menus[0].items.find(item => item.label === 'Catppuccin Latte');
  latte.onClick();
  assert.equal(values.get('tabout-theme-light'), 'latte');
  assert.equal(menus.length, 2, 'the pair menu should reopen so the other side can be selected');
  assert.equal(menus[1].items.find(item => item.label === 'Catppuccin Latte').checked, true);
});

test('tab-chip renderer escapes content and retains action names', () => {
  const html = renderTabChip({
    url: 'https://example.com/?q="quoted"',
    title: '<img src=x> Example',
  }, 'example.com', {});
  assert.match(html, /data-action="focus-tab"/);
  assert.match(html, /data-action="defer-single-tab"/);
  assert.match(html, /data-action="close-single-tab"/);
  assert.equal(html.includes('<img src=x> Example'), false);
  assert.match(html, /&lt;img src=x&gt; Example/);
});

test('domain-card renderer retains duplicate and sweep actions', () => {
  const group = {
    domain: 'example.com',
    tabs: [
      { url: 'https://example.com/a', title: 'A' },
      { url: 'https://example.com/a', title: 'A duplicate' },
    ],
  };
  const html = renderDomainCard(group, new Set());
  assert.match(html, /class="action-btn sweep-action" data-action="start-focus-sweep-domain"/);
  assert.match(html, /class="action-btn close-tabs" data-action="close-domain-tabs"/);
  assert.match(html, /class="action-btn dedup-tabs" data-action="dedup-keep-one"/);
  assert.match(html, /2 tabs open/);
});

test('saved-item renderers retain saved and archive markup', () => {
  const item = { id: 'd1', url: 'https://example.com', title: 'Example', savedAt: 'date' };
  const deferred = renderDeferredItem(item, value => `ago:${value}`);
  const archived = renderArchiveItem({ ...item, completedAt: 'done' }, value => `ago:${value}`);
  assert.match(deferred, /data-action="check-deferred"/);
  assert.match(deferred, /data-action="dismiss-deferred"/);
  assert.match(deferred, /ago:date/);
  assert.match(archived, /archive-item/);
  assert.match(archived, /data-action="restore-archive-item"/);
  assert.match(archived, /data-action="remove-archive-item"/);
  assert.match(archived, /aria-label="Restore Example to Saved for later"/);
  assert.match(archived, /ago:done/);
});

test('speed-dial markup retains open and add actions', () => {
  const html = renderSpeedDialMarkup(
    [{ id: 'one', url: 'https://example.com', label: 'Example' }],
    escapeHtml,
    () => '',
  );
  assert.match(html, /data-action="speeddial-open"/);
  assert.match(html, /data-action="speeddial-add"/);
});
