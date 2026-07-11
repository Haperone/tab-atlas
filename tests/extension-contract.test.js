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

test('archive access sits beside global search and stays raised in soft themes', async () => {
  const html = await readProjectText('extension/index.html');
  const css = await readProjectText('extension/style.css');
  const searchRowStart = html.indexOf('<div class="global-search-row">');
  const searchRowEnd = html.indexOf('</div>', searchRowStart);
  const archiveLaunch = html.indexOf('id="archiveLaunch"');
  const archiveRule = [...css.matchAll(/\.archive-launch\s*\{([^}]*)\}/g)]
    .map(match => match[1])
    .find(rule => rule.includes('--archive-label:')) || '';
  assert.ok(searchRowStart >= 0 && archiveLaunch > searchRowStart && archiveLaunch < searchRowEnd);
  assert.match(archiveRule, /color:\s*var\(--archive-label\)/);
  assert.match(archiveRule, /background:\s*rgba\(var\(--neutral-rgb\), 0\.07\)/);
  assert.doesNotMatch(archiveRule, /accent-rgb/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.archive-launch[\s\S]*?box-shadow:\s*-3px -3px 6px var\(--neu-light\), 3px 3px 6px var\(--neu-dark\)/);
  assert.match(css, /\.archive-launch[\s\S]*?:active\s*\{[\s\S]*?box-shadow:\s*inset 2px 2px 5px var\(--neu-dark\), inset -2px -2px 5px var\(--neu-light\)/);
  assert.match(css, /\.archive-count\s*\{[\s\S]*?box-shadow:\s*inset 1px 1px 2px var\(--neu-dark\), inset -1px -1px 2px var\(--neu-light\)/);
});

test('every theme defines a distinct checkbox hover and soft themes expose it', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  const colors = themeIds.map(id => {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    const color = block.match(/--checkbox-hover:\s*(#[0-9a-f]{6})/i)?.[1];
    assert.ok(color, `${id} must define --checkbox-hover`);
    return color.toLowerCase();
  });
  assert.equal(new Set(colors).size, themeIds.length);
  assert.match(css, /\.deferred-checkbox:hover:not\(:checked\)\s*\{[\s\S]*?var\(--checkbox-hover\)/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.deferred-checkbox:hover:not\(:checked\)[\s\S]*?0 0 0 2px color-mix\(in srgb, var\(--checkbox-hover\) 34%, transparent\)/);
});

test('soft themes own save and close hover treatments for tab actions', async () => {
  const css = await readProjectText('extension/style.css');
  const softTokens = ['papersoft', 'lattesoft'].map(id => {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    return {
      save: block.match(/--soft-save-hover:\s*(#[0-9a-f]{6})/i)?.[1],
      close: block.match(/--soft-close-hover:\s*(#[0-9a-f]{6})/i)?.[1],
    };
  });
  assert.ok(softTokens.every(tokens => tokens.save && tokens.close));
  assert.notDeepEqual(softTokens[0], softTokens[1]);
  const saveHover = css.match(/\.chip-save:hover\s*\{([^}]*)\}/)?.[1] || '';
  const closeHover = css.match(/\.chip-close:hover, \.deferred-dismiss:hover\s*\)\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(saveHover, /color:\s*var\(--soft-save-hover\)/);
  assert.match(saveHover, /background:\s*transparent/);
  assert.match(saveHover, /box-shadow:\s*none/);
  assert.doesNotMatch(saveHover, /inset/);
  assert.match(closeHover, /color:\s*var\(--soft-close-hover\)/);
  assert.match(closeHover, /background:\s*transparent/);
  assert.match(closeHover, /box-shadow:\s*none/);
  assert.doesNotMatch(closeHover, /inset/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.page-chip\.clickable:hover\s*\{[\s\S]*?linear-gradient\([\s\S]*?var\(--accent-primary\)/);
  assert.match(css, /\.page-chip\.clickable:has\(\.chip-action:hover\)\s*\{\s*background:\s*transparent/);
});

test('saved-link close buttons match the first-column close control', async () => {
  const css = await readProjectText('extension/style.css');
  const firstColumnIcon = css.match(/\.chip-action svg\s*\{([^}]*)\}/)?.[1] || '';
  const savedLinkIcon = css.match(/\.deferred-dismiss svg\s*\{([^}]*)\}/)?.[1] || '';
  const savedLinkButton = css.match(/\.deferred-dismiss\s*\{([^}]*)\}/)?.[1] || '';

  for (const iconRule of [firstColumnIcon, savedLinkIcon]) {
    assert.match(iconRule, /width:\s*15px/);
    assert.match(iconRule, /height:\s*15px/);
  }
  assert.match(savedLinkButton, /display:\s*inline-flex/);
  assert.match(savedLinkButton, /padding:\s*4px/);
  assert.match(savedLinkButton, /opacity:\s*0\.62/);
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
