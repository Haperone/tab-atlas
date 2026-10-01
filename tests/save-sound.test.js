import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSaveSoundPlayer, SAVE_SOUND_MESSAGE, UNDO_SOUND_MESSAGE } from '../extension/lib/save-sound.js';

function fixture(legacy = false) {
  let exists = false;
  const calls = [];
  const url = 'chrome-extension://atlas/save-sound.html';
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://atlas/${path}`,
      ...(legacy ? {} : { async getContexts(query) { assert.deepEqual(query.documentUrls, [url]); return exists ? [{}] : []; } }),
      async sendMessage(message) { calls.push(message); return { ok: true }; },
    },
    offscreen: { async createDocument(options) { calls.push(options); await Promise.resolve(); exists = true; } },
  };
  return { chrome, calls, play: createSaveSoundPlayer(chrome, async () => exists ? [{ url }] : [{ url: 'chrome-extension://atlas/index.html' }]), close: () => { exists = false; } };
}

test('audio document creation is serialized, reused and recreated after Chrome closes it', async () => {
  const f = fixture();
  await Promise.all([f.play(), f.play()]);
  assert.equal(f.calls.filter(call => call.url).length, 1);
  assert.deepEqual(f.calls[0].reasons, ['AUDIO_PLAYBACK']);
  assert.equal(f.calls.filter(call => call.type === SAVE_SOUND_MESSAGE).length, 2);
  await f.play();
  assert.equal(f.calls.filter(call => call.url).length, 1);
  await f.play('undo');
  assert.equal(f.calls.at(-1).type, UNDO_SOUND_MESSAGE);
  f.close(); await f.play();
  assert.equal(f.calls.filter(call => call.url).length, 2);
});

test('Chrome 109–115 uses an exact document URL without mistaking dashboards for audio', async () => {
  const f = fixture(true);
  await f.play(); await f.play();
  assert.equal(f.calls.filter(call => call.url).length, 1);
});

test('audio startup failures do not poison the next playback attempt', async () => {
  const f = fixture();
  const create = f.chrome.offscreen.createDocument;
  f.chrome.offscreen.createDocument = async () => { throw new Error('Unavailable'); };
  await assert.rejects(f.play(), /Unavailable/);
  f.chrome.offscreen.createDocument = create;
  await f.play();
  f.chrome.runtime.sendMessage = async () => ({ ok: false });
  await assert.rejects(f.play(), /Save sound unavailable/);
});

test('confirmation is a packaged short PCM WAV with valid header and payload', async () => {
  const wave = await readFile(new URL('../extension/sounds/save.wav', import.meta.url));
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wave.readUInt32LE(4), wave.length - 8);
  assert.equal(wave.readUInt16LE(20), 1);
  assert.equal(wave.readUInt16LE(22), 1);
  assert.equal(wave.readUInt32LE(40), wave.length - 44);
  const duration = (wave.length - 44) / wave.readUInt32LE(28);
  assert.ok(duration >= 0.2 && duration <= 0.4);
  const undo = await readFile(new URL('../extension/sounds/undo.wav', import.meta.url));
  assert.equal(undo.length, wave.length);
  assert.notDeepEqual(undo.subarray(44), wave.subarray(44), 'Undo must have its own audible cue');
});
