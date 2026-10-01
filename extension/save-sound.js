import { SAVE_SOUND_MESSAGE, UNDO_SOUND_MESSAGE } from './lib/save-sound.js';
import { playUiSound } from './lib/ui-sound.js';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (![SAVE_SOUND_MESSAGE, UNDO_SOUND_MESSAGE].includes(message?.type) || sender.id !== chrome.runtime.id) return false;
  void (async () => {
    try {
      await playUiSound(message.type === UNDO_SOUND_MESSAGE ? 'undo' : 'save');
      respond({ ok: true });
    } catch { respond({ ok: false }); }
  })();
  return true;
});
