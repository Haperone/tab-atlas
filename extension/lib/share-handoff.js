import { parseTa1Fragment, SHARE_LIMITS } from './ta1-codec.js';
import { SHARE_PUBLIC_CONFIG } from './share-config.js';

export const SHARE_MESSAGE_TYPE = 'tab-atlas/share/import-request';
export const SHARE_PING_TYPE = 'tab-atlas/share/ping';
export const SHARE_CONSUME_TYPE = 'tab-atlas/share/consume';
export const SHARE_HANDOFF_PREFIX = 'tab-atlas-share-handoff:';
export const SHARE_HANDOFF_TTL_MS = 5 * 60 * 1000;

function senderUrl(sender) {
  try {
    if (typeof sender?.url !== 'string') return null;
    return new URL(sender.url);
  } catch { return null; }
}
function senderAllowed(sender, config) {
  const url = senderUrl(sender);
  if (!url || url.protocol !== 'https:' || url.origin !== config.shareOrigin || (url.pathname !== config.sharePath && url.pathname !== `${config.sharePath}/`) || url.search) return false;
  return typeof sender.origin === 'string' && sender.origin.length > 0 && sender.origin === url.origin;
}
function exactEnvelope(request, type, fields) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  return Object.keys(request).sort().join(',') === [...fields].sort().join(',') && request.type === type;
}
function tokenFromRandom(randomBytes) {
  const bytes = randomBytes ? randomBytes(16) : crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createShareHandoff({ chromeApi = chrome, config = SHARE_PUBLIC_CONFIG, now = Date.now, randomBytes, openDashboard } = {}) {
  const session = chromeApi?.storage?.session;
  const consuming = new Set();
  const originAllowed = sender => senderAllowed(sender, config);
  async function open(token) {
    const target = chromeApi.runtime.getURL(`index.html#share-import=${token}`);
    if (openDashboard) return openDashboard(target);
    const tabs = await chromeApi.tabs.query({ url: chromeApi.runtime.getURL('index.html*') });
    const existing = tabs[0];
    return existing ? chromeApi.tabs.update(existing.id, { url: target, active: true }) : chromeApi.tabs.create({ url: target, active: true });
  }
  async function handleExternalShareMessage(request, sender) {
    if (!originAllowed(sender)) return { ok: false, error: 'EXTERNAL_ORIGIN_DENIED' };
    if (request?.type === SHARE_PING_TYPE) return exactEnvelope(request, SHARE_PING_TYPE, ['type', 'protocol']) && request.protocol === 'ta1' ? { ok: true } : { ok: false, error: 'INVALID_EXTERNAL_MESSAGE' };
    if (!exactEnvelope(request, SHARE_MESSAGE_TYPE, ['type', 'protocol', 'fragment']) || request.protocol !== 'ta1' || typeof request.fragment !== 'string' || request.fragment.length > SHARE_LIMITS.maxUriChars) return { ok: false, error: 'INVALID_EXTERNAL_MESSAGE' };
    try { parseTa1Fragment(request.fragment); } catch (error) { return { ok: false, error: error.code || 'INVALID_EXTERNAL_MESSAGE' }; }
    const token = tokenFromRandom(randomBytes);
    await session.set({ [`${SHARE_HANDOFF_PREFIX}${token}`]: { fragment: request.fragment, createdAt: now() } });
    await open(token);
    return { ok: true };
  }
  async function consume(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/u.test(token)) return { code: 'HANDOFF_EXPIRED' };
    if (consuming.has(token)) return { code: 'HANDOFF_EXPIRED' };
    consuming.add(token);
    const key = `${SHARE_HANDOFF_PREFIX}${token}`;
    try {
      const data = await session.get(key);
      const entry = data?.[key];
      // Remove before exposing any package, so a second dashboard cannot import it.
      await session.remove(key);
      if (!entry || typeof entry.fragment !== 'string' || !Number.isFinite(entry.createdAt) || now() - entry.createdAt > SHARE_HANDOFF_TTL_MS) return { code: 'HANDOFF_EXPIRED' };
      return { code: 'OK', fragment: entry.fragment, clear: async () => {} };
    } finally { consuming.delete(token); }
  }
  async function handleInternalConsumeMessage(request, sender) {
    if (!exactEnvelope(request, SHARE_CONSUME_TYPE, ['type', 'token']) || typeof request.token !== 'string') return { code: 'HANDOFF_EXPIRED' };
    if (typeof sender?.id !== 'string' || sender.id !== chromeApi.runtime.id) return { code: 'HANDOFF_EXPIRED' };
    return consume(request.token);
  }
  return Object.freeze({ handleExternalShareMessage, handleInternalConsumeMessage, consume, originAllowed });
}
