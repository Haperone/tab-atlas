import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  extensionRoot,
  readPngDimensions,
  readProjectJson,
  readProjectText,
} from './helpers.js';

const manifestPath = 'extension/manifest.json';

test('manifest uses MV3 with the expected entry points', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides?.newtab, 'index.html');
  assert.equal(manifest.background?.service_worker, 'background.js');
});

test('manifest keeps the minimal declared Chrome permissions', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['favicon', 'storage', 'tabGroups', 'tabs'].sort(),
  );
  assert.equal('host_permissions' in manifest, false);
});

test('manifest declares a toolbar action without a popup', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.equal(manifest.action?.default_title, 'Tab Atlas');
  assert.equal('default_popup' in manifest.action, false);
});

test('every manifest entry-point file exists', async () => {
  const manifest = await readProjectJson(manifestPath);
  const files = [
    manifest.chrome_url_overrides.newtab,
    manifest.background.service_worker,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  await Promise.all(files.map(file => access(path.join(extensionRoot, file))));
});

test('manifest PNG icons have their declared dimensions', async () => {
  const manifest = await readProjectJson(manifestPath);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const dimensions = await readPngDimensions(`extension/${file}`);
    assert.deepEqual(dimensions, { width: Number(size), height: Number(size) });
  }
  for (const [size, file] of Object.entries(manifest.action.default_icon)) {
    const dimensions = await readPngDimensions(`extension/${file}`);
    assert.deepEqual(dimensions, { width: Number(size), height: Number(size) });
  }
});

test('extension page uses only external local scripts', async () => {
  const html = await readProjectText('extension/index.html');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scriptTags.length, 2);
  for (const [, attributes, body] of scriptTags) {
    const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    assert.ok(source, 'every script tag must use src');
    assert.equal(/^https?:/i.test(source), false, 'script src must be packaged');
    assert.equal(body.trim(), '', 'script tags must not contain inline code');
  }
  assert.equal(/\son\w+\s*=/i.test(html), false, 'inline event handlers are forbidden');
});

test('extension JavaScript avoids dynamic execution and promise chains', async () => {
  const libraryFiles = (await readdir(path.join(extensionRoot, 'lib')))
    .filter(file => file.endsWith('.js'))
    .map(file => `extension/lib/${file}`);
  const sources = await Promise.all([
    'extension/app.js',
    'extension/background.js',
    'extension/theme-init.js',
    ...libraryFiles,
  ].map(readProjectText));
  const source = sources.join('\n');
  assert.equal(/\beval\s*\(/.test(source), false);
  assert.equal(/\bnew\s+Function\s*\(/.test(source), false);
  assert.equal(/\.then\s*\(/.test(source), false);
});

test('storage keys remain stable for saved data', async () => {
  const repositorySource = await readProjectText('extension/lib/storage-repository.js');
  const appSource = await readProjectText('extension/app.js');
  assert.match(repositorySource, /deferred:\s*['"]deferred['"]/);
  assert.match(repositorySource, /folders:\s*['"]folders['"]/);
  assert.match(repositorySource, /workspaceSnapshots:\s*['"]workspaceSnapshots['"]/);
  assert.match(appSource, /createStorageRepository\(chrome\.storage\.local\)/);
});

test('backup contract remains schema version 1', async () => {
  const source = await readProjectText('extension/lib/backup-data.js');
  assert.match(source, /BACKUP_APP_NAME\s*=\s*['"]Tab Atlas['"]/);
  assert.match(source, /BACKUP_SCHEMA_VERSION\s*=\s*1\b/);
  assert.match(source, /workspaceSnapshots:\s*cloneStorageArray/);
});

test('theme initialization remains a packaged pre-paint script', async () => {
  const html = await readProjectText('extension/index.html');
  const themeIndex = html.indexOf('<script src="theme-init.js"></script>');
  const stylesheetIndex = html.indexOf('<link rel="stylesheet" href="style.css">');
  const appIndex = html.search(/<script\b[^>]*\bsrc="app\.js"[^>]*><\/script>/);
  assert.ok(themeIndex >= 0 && themeIndex < stylesheetIndex);
  assert.ok(appIndex > stylesheetIndex);
});
