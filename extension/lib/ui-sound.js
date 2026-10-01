let current;

// Each UI document owns one short sound; rapid actions replace the previous cue.
export async function playUiSound(kind = 'save') {
  current?.pause();
  const audio = new Audio(chrome.runtime.getURL(`sounds/${kind === 'undo' ? 'undo' : 'save'}.wav`));
  current = audio;
  audio.volume = .55;
  audio.addEventListener('ended', () => { if (current === audio) current = null; }, { once:true });
  try { await audio.play(); }
  catch (error) { if (current === audio) current = null; throw error; }
}
