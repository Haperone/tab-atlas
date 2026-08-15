import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjectJson, readProjectText } from './helpers.js';
import { SHARE_PUBLIC_CONFIG as extensionConfigValues } from '../extension/lib/share-config.js';
import { SHARE_PUBLIC_CONFIG as publicConfigValues } from '../docs/share/share-config.js';

test('share deployment keeps the external boundary narrowly scoped', async () => {
  const manifest = await readProjectJson('extension/manifest.json');
  assert.equal(manifest.minimum_chrome_version, '102');
  assert.deepEqual(manifest.externally_connectable, { matches: ['https://tab-atlas.pages.dev/*'] });
  assert.equal('host_permissions' in manifest, false);
});

test('share page has local-only assets, no index metadata and defense-in-depth CSP', async () => {
  const [page, script, bridge, css, headers] = await Promise.all([
    readProjectText('docs/share/index.html'), readProjectText('docs/share/share.js'), readProjectText('docs/share/extension-bridge.js'), readProjectText('docs/share/share.css'), readProjectText('docs/_headers'),
  ]);
  assert.match(page, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(page, /connect-src 'none'/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(page, /https?:\/\/(?!tab-atlas\.pages\.dev\/share)/i);
  assert.doesNotMatch(script, /\b(fetch|XMLHttpRequest|sendBeacon|innerHTML)\b/);
  assert.doesNotMatch(bridge, /\b(fetch|XMLHttpRequest|sendBeacon|innerHTML)\b/);
  assert.match(script, /textContent/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(headers, /\/share/);
  assert.match(headers, /Content-Security-Policy: default-src 'none'/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
});

test('share UI is isolated and both public configuration values agree', async () => {
  const [html, css, extensionConfig, publicConfig, harness, app] = await Promise.all([
    readProjectText('extension/index.html'), readProjectText('extension/folder-share.css'), readProjectText('extension/lib/share-config.js'), readProjectText('docs/share/share-config.js'), readProjectText('tools/screenshot-harness.html'), readProjectText('extension/app.js'),
  ]);
  assert.match(html, /<dialog id="folderShareDialog"/);
  assert.match(html, /<dialog id="folderShareImportDialog"/);
  assert.match(css, /\.folder-share-dialog/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(extensionConfig, /shareOrigin: 'https:\/\/tab-atlas\.pages\.dev'/);
  assert.match(publicConfig, /shareOrigin: 'https:\/\/tab-atlas\.pages\.dev'/);
  assert.match(extensionConfig, /bnclgfhbebombghodiibgmllbaeonadm/);
  assert.match(publicConfig, /bnclgfhbebombghodiibgmllbaeonadm/);
  assert.match(extensionConfig, /developmentExtensionId: 'falgldcenllafhjplogcabochjkokbcf'/);
  assert.match(publicConfig, /developmentExtensionId: 'falgldcenllafhjplogcabochjkokbcf'/);
  assert.match(await readProjectText('docs/share/share.js'), /store\.href = SHARE_PUBLIC_CONFIG\.chromeWebStoreUrl/);
  assert.match(harness, /extension\/folder-share\.css/);
  assert.match(harness, /surface === 'share-sender'/);
  assert.match(harness, /surface === 'share-import'/);
  for (const theme of ['default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai', 'obsidian', 'auroraglass', 'smokeglass', 'spaceblack', 'pacificblue', 'papersoft', 'lattesoft', 'pearlglass', 'paperglass', 'orchidbloom']) assert.match(harness, new RegExp(`'${theme}'`));
  assert.match(app, /revision = \+\+state\.revision/);
  const senderOpen = app.match(/async function openFolderShareDialog[\s\S]*?\n}\nfunction closeFolderShareDialog/)?.[0] || '';
  assert.ok(senderOpen.indexOf('dialog.showModal()') < senderOpen.indexOf('await folderShareUpdatePreview()'));
  assert.match(app, /requestSharedHandoff\(match\[1\]\)/);
  assert.match(app, /tracking parameter\$\{item\.removedTracking === 1 \? '' : 's'\} removed/);
  assert.doesNotMatch(app, /Tracking −\$\{item\.removedTracking\}/);
  assert.doesNotMatch(app, /pending(?:SharedImport)?\.clear\(/, 'dashboard must not expect functions to cross runtime messaging');
  assert.match(await readProjectText('extension/background.js'), /chrome\.runtime\.onMessage\.addListener/);
  assert.match(css, /grid-template-columns:auto auto minmax\(0,1fr\) auto/);
  assert.match(html, /id="folderShareFilter"[^>]*aria-label="Filter links to share"/);
  assert.deepEqual(extensionConfigValues, publicConfigValues);
});
