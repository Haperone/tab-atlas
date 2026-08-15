import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSharePackage,
  decodeTa1Fragment,
  encodeTa1Package,
  fromBase64Url,
  sanitizeShareUrl,
  toBase64Url,
} from '../extension/lib/ta1-codec.js';
import { mergeSharedPackage, uniqueSharedFolderName } from '../extension/lib/share-import.js';

const links = [
  { url: 'https://example.com/a?keep=1&utm_source=newsletter#top', title: 'First' },
  { url: 'https://пример.рф/путь?x=%26&gclid=one', title: 'Привет 👋' },
  { url: 'https://example.com/b?keep=2', title: 'Second' },
];

test('ta1 encrypts/decrypts ordered Unicode folders and uses a compact domain dictionary', async () => {
  const pkg = createSharePackage({ name: ' Design references ', items: links });
  assert.equal(pkg.n, 'Design references');
  assert.equal(pkg.d.length, 2);
  assert.equal(pkg.l[0][1], '/a?keep=1#top');
  const encoded = await encodeTa1Package(pkg);
  assert.match(encoded.fragment, /^#ta1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/);
  const decoded = await decodeTa1Fragment(encoded.fragment);
  assert.deepEqual(decoded.items.map(item => item.url), ['https://example.com/a?keep=1#top', 'https://пример.рф/путь?x=%26', 'https://example.com/b?keep=2']);
  assert.deepEqual(decoded.items.map(item => item.title), ['First', 'Привет 👋', 'Second']);
});

test('URL cleaning preserves raw query order and never mutates signed URLs', () => {
  assert.equal(sanitizeShareUrl('https://e.test/p?a=1&utm_source=x&&B=2#route?x').cleanedUrl, 'https://e.test/p?a=1&&B=2#route?x');
  assert.equal(sanitizeShareUrl('https://e.test/p?X-Amz-Signature=a&utm_source=x').cleanedUrl, 'https://e.test/p?X-Amz-Signature=a&utm_source=x');
  assert.equal(sanitizeShareUrl('https://e.test/p?x-amz-date=tomorrow').sensitive, true);
  assert.equal(sanitizeShareUrl('https://e.test/p?X-Goog-Expires=1').sensitive, true);
});

test('ta1 rejects altered ciphertext and strict malformed fragments', async () => {
  const encoded = await encodeTa1Package(createSharePackage({ name: 'x', items: [links[0]] }));
  const [prefix, key, payload] = encoded.fragment.slice(1).split('.');
  const bytes = fromBase64Url(payload); bytes[12] ^= 1;
  const altered = `#${prefix}.${key}.${toBase64Url(bytes)}`;
  await assert.rejects(decodeTa1Fragment(altered), error => error.code === 'AUTH_FAILED');
  await assert.rejects(decodeTa1Fragment('#ta1.bad=.payload'), error => error.code === 'INVALID_BASE64URL');
  await assert.rejects(decodeTa1Fragment('#ta2.not-even-base64.not-even-base64'), error => error.code === 'UNKNOWN_VERSION');
});

test('share import dedupes exact cleaned URLs, names folders and performs no partial merge', () => {
  const pkg = { name: 'Read later', items: [
    { url: 'https://e.test/a?x=1', title: 'one' },
    { url: 'https://e.test/a?x=1', title: 'duplicate' },
    { url: 'https://e.test/b', title: 'two' },
  ] };
  let sequence = 0;
  const result = mergeSharedPackage({ folders: [{ id: 'f', name: 'Read later' }], deferred: [{ id: 'd', url: 'https://e.test/a?x=1', dismissed: false }] }, pkg, {
    now: () => 7,
    idFactory: ids => { const id = `id-${++sequence}`; ids.add(id); return id; },
  });
  assert.equal(result.folder.name, 'Read later (2)');
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.deferred.at(-1).url, 'https://e.test/b');
  assert.equal(uniqueSharedFolderName('A', [{ name: 'a' }, { name: 'A (2)' }]), 'A (3)');
});

test('packaged and public codec copies are byte-identical', async () => {
  const [extensionCopy, publicCopy] = await Promise.all([
    readFile(new URL('../extension/lib/ta1-codec.js', import.meta.url)),
    readFile(new URL('../docs/share/ta1-codec.js', import.meta.url)),
  ]);
  assert.deepEqual(extensionCopy, publicCopy);
});

test('20 and 30 representative links remain below the URI compatibility ceiling', async () => {
  const urls = JSON.parse(await readFile(new URL('./fixtures/share-benchmark-urls.json', import.meta.url), 'utf8'));
  for (const count of [20, 30]) {
    const items = urls.slice(0, count).map((url, index) => ({ url, title: `Reference ${index + 1}` }));
    const pkg = createSharePackage({ name: 'Share benchmark', items });
    const encoded = await encodeTa1Package(pkg);
    const uriLength = 'https://tabatlas.app/share'.length + encoded.fragment.length;
    assert.ok(uriLength <= 8192, `${count} links should be copyable (${uriLength})`);
  }
});
