export const SAVE_SOUND_MESSAGE = 'tab-atlas/save-sound/play';
export const UNDO_SOUND_MESSAGE = 'tab-atlas/undo-sound/play';
const AUDIO_DOCUMENT = 'save-sound.html';

// Offscreen playback avoids website autoplay policies and continues without a popup.
export function createSaveSoundPlayer(chromeApi, listClients = () => globalThis.clients.matchAll()) {
  let preparing;
  async function ensureDocument() {
    if (preparing) return preparing;
    preparing = (async () => {
      const url = chromeApi.runtime.getURL(AUDIO_DOCUMENT);
      const contexts = chromeApi.runtime.getContexts
        ? await chromeApi.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })
        : (await listClients()).filter(client => client.url === url);
      if (contexts.length) return;
      await chromeApi.offscreen.createDocument({ url: AUDIO_DOCUMENT, reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play brief confirmation sounds when the user saves or undoes a change.' });
    })();
    try { await preparing; } finally { preparing = null; }
  }
  return async function playSound(kind = 'save') {
    await ensureDocument();
    const result = await chromeApi.runtime.sendMessage({ type: kind === 'undo' ? UNDO_SOUND_MESSAGE : SAVE_SOUND_MESSAGE });
    if (!result?.ok) throw new Error('Save sound unavailable');
  };
}
