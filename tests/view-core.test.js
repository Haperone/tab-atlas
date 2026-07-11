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
import {
  escapeHtml,
  favIcon,
  friendlyDomain,
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
  assert.match(html, /data-action="start-focus-sweep-domain"/);
  assert.match(html, /data-action="close-domain-tabs"/);
  assert.match(html, /data-action="dedup-keep-one"/);
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
