import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { favIcon } from '../extension/lib/tab-model.js';
import { extensionRoot, projectRoot } from './helpers.js';

test('packaged HTML has no automatic external resource links', async () => {
  const html = await fs.readFile(path.join(extensionRoot, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<link\b[^>]*\brel=["'](?:stylesheet|preconnect|dns-prefetch|modulepreload|preload)["'][^>]*https?:/i);
  assert.doesNotMatch(html, /<(?:script|img|audio|video|source|iframe)\b[^>]*\bsrc=["']https?:/i);
  assert.doesNotMatch(html, /@import\s+(?:url\()?['"]?https?:/i);
  assert.match(html, /href="https:\/\/github\.com\/Haperone\/tab-atlas"/);
  assert.match(html, /href="https:\/\/github\.com\/zarazhangrui\/tab-out"/);
});

test('runtime CSS and JavaScript contain no remote font or favicon fallback', async () => {
  const runtimeFiles = (await fs.readdir(extensionRoot, { recursive: true }))
    .filter(file => /\.(?:css|js)$/i.test(file));
  const runtime = (await Promise.all(runtimeFiles.map(async file =>
    fs.readFile(path.join(extensionRoot, file), 'utf8')))).join('\n');
  assert.doesNotMatch(runtime, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.doesNotMatch(runtime, /google\.com\/s2\/favicons/i);
  assert.doesNotMatch(runtime, /url\(\s*['"]?https?:/i);
});

test('favicon helper uses packaged Chrome cache and has no-image fallback', () => {
  const runtime = { getURL: pathValue => `chrome-extension://test${pathValue}` };
  assert.match(favIcon('https://example.com', 16, runtime), /^chrome-extension:\/\/test\/_favicon\//);
  assert.equal(favIcon('https://example.com', 16, null), '');
});

test('all CSS font-family declarations use centralized system-stack variables', async () => {
  const css = await fs.readFile(path.join(extensionRoot, 'style.css'), 'utf8');
  assert.match(css, /--font-sans:\s*system-ui,[^;]+sans-serif;/);
  assert.match(css, /--font-serif:\s*ui-serif,[^;]+serif;/);
  const declarations = css.match(/^\s*font-family:[^;]+;/gm) || [];
  assert.ok(declarations.length > 20);
  for (const declaration of declarations) {
    assert.match(declaration, /font-family:\s*(?:var\(--font-(?:sans|serif)\)|inherit);/);
  }
});

test('README separates zero-dependency runtime from contributor Node tests', async () => {
  const readme = await fs.readFile(path.join(projectRoot, 'README.md'), 'utf8');
  assert.match(readme, /no Node\.js or npm runtime requirement/i);
  assert.match(readme, /node --test/);
  assert.match(readme, /no server, npm install, build step or external API calls at runtime/i);
});
