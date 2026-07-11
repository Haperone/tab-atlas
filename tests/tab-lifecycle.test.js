import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  badgePresentation,
  createBackgroundHandlers,
  findTabAtlasTab,
  isBadgeRelevantUpdate,
} from '../extension/lib/background-core.js';

test('badge text and documented color thresholds include the 999+ cap', () => {
  assert.deepEqual(badgePresentation(0), { text: '', color: null });
  assert.deepEqual(badgePresentation(10), { text: '10', color: '#3d7a4a' });
  assert.deepEqual(badgePresentation(11), { text: '11', color: '#b8892e' });
  assert.deepEqual(badgePresentation(20), { text: '20', color: '#b8892e' });
  assert.deepEqual(badgePresentation(21), { text: '21', color: '#b35a5a' });
  assert.deepEqual(badgePresentation(999), { text: '999', color: '#b35a5a' });
  assert.deepEqual(badgePresentation(1000), { text: '999+', color: '#b35a5a' });
});

test('irrelevant tab updates never invoke a full badge tab query', async () => {
  let queries = 0;
  const chromeApi = {
    tabs: { query: async () => { queries += 1; return []; } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const handlers = createBackgroundHandlers(chromeApi);
  handlers.handleUpdated(1, { title: 'Loading' });
  await Promise.resolve();
  assert.equal(queries, 0);
  assert.equal(isBadgeRelevantUpdate({ url: 'https://example.com' }), true);
  handlers.handleUpdated(1, { url: 'https://example.com' });
  await Promise.resolve();
  assert.equal(queries, 1);
});

test('action click focuses an existing Tab Atlas tab and its window', async () => {
  const calls = [];
  const dashboardUrl = 'chrome-extension://test/index.html';
  const chromeApi = {
    runtime: { getURL: () => dashboardUrl },
    tabs: {
      query: async () => [{ id: 8, windowId: 3, url: `${dashboardUrl}#saved` }],
      update: async (...args) => calls.push(['tabs.update', ...args]),
      create: async (...args) => calls.push(['tabs.create', ...args]),
    },
    windows: { update: async (...args) => calls.push(['windows.update', ...args]) },
  };
  await createBackgroundHandlers(chromeApi).handleActionClicked();
  assert.deepEqual(calls, [
    ['windows.update', 3, { focused: true }],
    ['tabs.update', 8, { active: true }],
  ]);
  assert.equal(findTabAtlasTab([{ url: 'https://example.com' }], dashboardUrl), null);
});

test('action click creates Tab Atlas only when no existing page exists', async () => {
  const calls = [];
  const dashboardUrl = 'chrome-extension://test/index.html';
  const chromeApi = {
    runtime: { getURL: () => dashboardUrl },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com' }],
      update: async (...args) => calls.push(['tabs.update', ...args]),
      create: async (...args) => calls.push(['tabs.create', ...args]),
    },
    windows: { update: async (...args) => calls.push(['windows.update', ...args]) },
  };
  await createBackgroundHandlers(chromeApi).handleActionClicked();
  assert.deepEqual(calls, [['tabs.create', { url: dashboardUrl }]]);
});

test('service worker and dashboard register lifecycle listeners at top level', async () => {
  const background = await fs.readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../extension/app.js', import.meta.url), 'utf8');
  for (const event of ['onCreated', 'onRemoved', 'onReplaced', 'onUpdated']) {
    assert.match(background, new RegExp(`tabs\\.${event}\\.addListener`));
  }
  assert.match(background, /action\.onClicked\.addListener/);
  assert.doesNotMatch(background, /setTimeout|setInterval/);
  for (const event of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved', 'onAttached', 'onActivated', 'onReplaced']) {
    assert.match(app, new RegExp(`tabs\\.${event}`));
  }
});
