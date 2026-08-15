import test from 'node:test';
import assert from 'node:assert/strict';

import { createExtensionBridge } from '../docs/share/extension-bridge.js';

test('share receiver falls back from the store ID to the unpacked development ID', async () => {
  const storeId = 'a'.repeat(32);
  const developmentId = 'b'.repeat(32);
  const calls = [];
  const runtime = {
    lastError: null,
    sendMessage(extensionId, _request, callback) {
      calls.push(extensionId);
      if (extensionId === storeId) {
        runtime.lastError = { message: 'Could not establish connection' };
        callback(undefined);
        runtime.lastError = null;
        return;
      }
      callback({ ok: true });
    },
  };
  const bridge = createExtensionBridge({ chromeApi: { runtime }, extensionIds: [storeId, developmentId] });

  assert.deepEqual(await bridge.send({ type: 'tab-atlas/share/ping', protocol: 'ta1' }), { ok: true });
  assert.deepEqual(calls, [storeId, developmentId]);
});

test('share receiver rejects missing, malformed and unreachable extension IDs', async () => {
  const malformed = createExtensionBridge({ chromeApi: { runtime: { sendMessage() {} } }, extensionIds: ['not-an-extension-id'] });
  assert.equal(malformed.available(), false);
  assert.deepEqual(await malformed.send({ type: 'ping' }), { ok: false, error: 'EXTENSION_UNAVAILABLE' });

  const runtime = { lastError: null, sendMessage(_extensionId, _request, callback) { runtime.lastError = { message: 'Missing' }; callback(); runtime.lastError = null; } };
  const unreachable = createExtensionBridge({ chromeApi: { runtime }, extensionIds: ['c'.repeat(32)] });
  assert.equal(unreachable.available(), true);
  assert.deepEqual(await unreachable.send({ type: 'ping' }), { ok: false, error: 'EXTENSION_UNAVAILABLE' });
});
