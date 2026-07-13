import assert from 'node:assert/strict';
import test from 'node:test';

import { readProjectJson, readProjectText } from './helpers.js';

test('Chrome Web Store draft matches manifest identity and every permission', async () => {
  const [manifest, store] = await Promise.all([
    readProjectJson('extension/manifest.json'),
    readProjectText('CHROMEWEBSTORE.md'),
  ]);
  assert.ok(store.includes(`Chrome Web Store Listing — ${manifest.name}`));
  assert.ok(store.includes(`| ${manifest.version} |`));
  for (const permission of manifest.permissions) {
    assert.ok(store.includes(`| \`${permission}\` | permissions |`), permission);
  }
  assert.equal(Object.hasOwn(manifest, 'host_permissions'), false);
  assert.match(store, /\*\*Host permissions:\*\* None\./);
});

test('store privacy draft describes local processing and flags submission inputs', async () => {
  const store = await readProjectText('CHROMEWEBSTORE.md');
  assert.match(store, /does not collect, transmit, sell, or share/i);
  assert.match(store, /chrome\.storage\.local/);
  // Privacy-policy URL is now wired to the published GitHub Pages page, not a placeholder.
  assert.match(store, /\*\*Privacy Policy URL:\*\* https:\/\/haperone\.github\.io\/tab-atlas\/privacy-policy\.html/);
  assert.doesNotMatch(store, /Privacy Policy URL.*REQUIRED BEFORE SUBMISSION/);
  // Publisher identity is filled in (still needs dashboard entry + email verification).
  assert.match(store, /\*\*Publisher Name:\*\* \S+/);
  assert.match(store, /\*\*Contact Email:\*\* \S+@\S+/);
  assert.doesNotMatch(store, /(?:Publisher Name|Contact Email).*REQUIRED BEFORE SUBMISSION/);
  // The one blocker that genuinely cannot be resolved from the repo: real screenshots.
  assert.match(store, /Screenshot 1.*Not created/);
});

test('published privacy policy page exists and makes no external requests', async () => {
  const page = await readProjectText('docs/privacy-policy.html');
  assert.match(page, /<title>Privacy Policy — Tab Atlas<\/title>/);
  assert.match(page, /does not collect, transmit, sell, or share/i);
  // The page must not pull remote fonts, styles, scripts, or images — it promises exactly that.
  assert.doesNotMatch(page, /<link\b[^>]*\bhref=["']https?:/i);
  assert.doesNotMatch(page, /<(?:script|img|source|iframe)\b[^>]*\bsrc=["']https?:/i);
  assert.doesNotMatch(page, /@import\s+(?:url\()?['"]?https?:/i);
  assert.doesNotMatch(page, /fonts\.(?:googleapis|gstatic)\.com/i);
});
