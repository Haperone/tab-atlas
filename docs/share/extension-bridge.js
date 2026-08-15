const UNAVAILABLE = Object.freeze({ ok: false, error: 'EXTENSION_UNAVAILABLE' });

export function createExtensionBridge({
  chromeApi = globalThis.chrome,
  extensionIds = [],
  timeoutMs = 2200,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const ids = [...new Set(extensionIds.filter(id => typeof id === 'string' && /^[a-p]{32}$/.test(id)))];

  function available() { return Boolean(ids.length && chromeApi?.runtime?.sendMessage); }
  function sendToExtension(extensionId, request) { return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = result => { if (done) return; done = true; cancel(timer); resolve(result); };
    timer = schedule(() => finish(UNAVAILABLE), timeoutMs);
    try {
      chromeApi.runtime.sendMessage(extensionId, request, response => finish(chromeApi.runtime.lastError ? UNAVAILABLE : response || UNAVAILABLE));
    } catch { finish(UNAVAILABLE); }
  }); }
  async function send(request) {
    if (!available()) return UNAVAILABLE;
    for (const extensionId of ids) {
      const result = await sendToExtension(extensionId, request);
      if (result?.ok) return result;
    }
    return UNAVAILABLE;
  }

  return Object.freeze({ available, send });
}
