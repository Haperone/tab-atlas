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
  assert.match(store, /Privacy Policy URL.*REQUIRED BEFORE SUBMISSION/);
  assert.match(store, /Publisher Name.*REQUIRED BEFORE SUBMISSION/);
  assert.match(store, /Contact Email.*REQUIRED BEFORE SUBMISSION/);
  assert.match(store, /Screenshot 1.*Not created/);
});
