import test from 'node:test';
import assert from 'node:assert/strict';

import { createSharePackage, encodeTa1Package } from '../extension/lib/ta1-codec.js';
import { createShareHandoff } from '../extension/lib/share-handoff.js';

function mockChrome() {
  const session = {};
  return {
    storage: { session: {
      async set(value) { Object.assign(session, value); },
      async get(key) { return { [key]: session[key] }; },
      async remove(key) { delete session[key]; },
    } },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}` },
    tabs: { async query() { return []; }, async create(value) { return value; }, async update(_id, value) { return value; } },
    session,
  };
}

test('external handoff accepts only configured origin and stages a raw fragment under a nonce', async () => {
  const chromeApi = mockChrome();
  const handoff = createShareHandoff({ chromeApi, randomBytes: () => new Uint8Array(16).fill(3) });
  const encoded = await encodeTa1Package(createSharePackage({ name: 'Shared', items: [{ url: 'https://example.com', title: 'Example' }] }));
  const denied = await handoff.handleExternalShareMessage({ type: 'tab-atlas/share/import-request', protocol: 'ta1', fragment: encoded.fragment }, { origin: 'https://evil.example', url: 'https://evil.example/share' });
  assert.deepEqual(denied, { ok: false, error: 'EXTERNAL_ORIGIN_DENIED' });
  const accepted = await handoff.handleExternalShareMessage({ type: 'tab-atlas/share/import-request', protocol: 'ta1', fragment: encoded.fragment }, { origin: 'https://tab-atlas.pages.dev', url: 'https://tab-atlas.pages.dev/share' });
  assert.deepEqual(accepted, { ok: true });
  const key = Object.keys(chromeApi.session)[0];
  assert.match(key, /03030303030303030303030303030303$/);
  assert.deepEqual(Object.keys(chromeApi.session[key]).sort(), ['createdAt', 'fragment']);
  const consumed = await handoff.consume('03030303030303030303030303030303');
  assert.equal(consumed.code, 'OK');
  await consumed.clear();
  assert.equal(Object.keys(chromeApi.session).length, 0);
  assert.equal((await handoff.consume('03030303030303030303030303030303')).code, 'HANDOFF_EXPIRED');
});

test('external handoff requires a complete exact public share URL and exact envelopes', async () => {
  const handoff = createShareHandoff({ chromeApi: mockChrome() });
  const ping = { type: 'tab-atlas/share/ping', protocol: 'ta1' };
  for (const sender of [
    { origin: 'https://tab-atlas.pages.dev' },
    { url: 'https://tab-atlas.pages.dev/share' },
    { origin: 'https://tab-atlas.pages.dev', url: 'http://tab-atlas.pages.dev/share' },
    { origin: 'https://tab-atlas.pages.dev', url: 'https://tab-atlas.pages.dev/share?x=1' },
    { origin: 'https://wrong.example', url: 'https://tab-atlas.pages.dev/share' },
    { origin: 'https://tab-atlas.pages.dev', url: 'https://tab-atlas.pages.dev/other' },
  ]) assert.equal((await handoff.handleExternalShareMessage(ping, sender)).error, 'EXTERNAL_ORIGIN_DENIED');
  const sender = { origin: 'https://tab-atlas.pages.dev', url: 'https://tab-atlas.pages.dev/share/' };
  assert.deepEqual(await handoff.handleExternalShareMessage({ ...ping, extra: true }, sender), { ok: false, error: 'INVALID_EXTERNAL_MESSAGE' });
  assert.deepEqual(await handoff.handleExternalShareMessage(ping, sender), { ok: true });
});

test('a single worker handoff permits only one concurrent consume', async () => {
  const chromeApi = mockChrome();
  chromeApi.session['tab-atlas-share-handoff:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'] = { fragment: '#ta1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAt: Date.now() };
  const handoff = createShareHandoff({ chromeApi });
  const outcomes = await Promise.all([handoff.consume('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), handoff.consume('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')]);
  assert.deepEqual(outcomes.map(result => result.code).sort(), ['HANDOFF_EXPIRED', 'OK']);
});

test('internal consume requires the exact extension sender and envelope', async () => {
  const handoff = createShareHandoff({ chromeApi: mockChrome() });
  const request = { type: 'tab-atlas/share/consume', token: 'b'.repeat(32) };
  assert.equal((await handoff.handleInternalConsumeMessage(request, {})).code, 'HANDOFF_EXPIRED');
  assert.equal((await handoff.handleInternalConsumeMessage({ ...request, extra: true }, { id: 'test' })).code, 'HANDOFF_EXPIRED');
  assert.equal((await handoff.handleInternalConsumeMessage(request, { id: 'other' })).code, 'HANDOFF_EXPIRED');
});

test('expired handoffs are removed before they can be consumed', async () => {
  const chromeApi = mockChrome();
  const handoff = createShareHandoff({ chromeApi, now: () => 10_000 });
  chromeApi.session['tab-atlas-share-handoff:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] = { fragment: '#ta1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAt: -400_001 };
  assert.equal((await handoff.consume('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).code, 'HANDOFF_EXPIRED');
  assert.equal(Object.keys(chromeApi.session).length, 0);
});
