/**
 * Tab Atlas share protocol v1. This module deliberately has no Chrome or DOM
 * dependency so the public receiver can carry an identical audited copy.
 */
export const SHARE_LIMITS = Object.freeze({
  normalUriChars: 4096,
  maxUriChars: 8192,
  encryptedBytes: 6144,
  decompressedBytes: 256 * 1024,
  items: 200,
  domains: 200,
  folderNameLength: 120,
  titleLength: 512,
  urlLength: 8192,
  domainPrefixLength: 512,
});

const AAD_TEXT = 'TabAtlas share\0ta1\0json+gzip\0aes-256-gcm';
const AAD = new TextEncoder().encode(AAD_TEXT);
const FRAGMENT_RE = /^#?ta1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]+)$/;
const URL_PREFIX_RE = /^(https?:\/\/[^/?#]+)([/?#].*)?$/i;
const TRACKERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'yclid', 'mc_cid', 'mc_eid']);
const SIGNED = new Set(['signature', 'sig', 'policy', 'key-pair-id', 'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'x-amz-date', 'x-amz-expires', 'x-goog-signature', 'x-goog-credential', 'x-goog-date', 'x-goog-expires']);
const SENSITIVE = new Set(['token', 'access_token', 'id_token', 'refresh_token', 'key', 'api_key', 'apikey', 'auth', 'authorization', 'code', 'signature', 'sig', 'policy', 'key-pair-id', 'jwt', 'session', 'sessionid', 'password', 'passwd', 'secret', 'client_secret', 'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'x-goog-signature', 'x-goog-credential']);

export class ShareCodecError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = 'ShareCodecError';
    this.code = code;
  }
}

function fail(code, message) { throw new ShareCodecError(code, message); }
function byteLength(text) { return new TextEncoder().encode(text).byteLength; }
function ownKeys(value) { return Object.keys(value).sort(); }
function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(ownKeys(value)) === JSON.stringify([...expected].sort());
}
function base64FromBytes(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
function bytesFromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function toBase64Url(bytes) {
  return base64FromBytes(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
export function fromBase64Url(value, code = 'INVALID_BASE64URL') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) fail(code);
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  let bytes;
  try { bytes = bytesFromBase64(padded); } catch { fail(code); }
  if (toBase64Url(bytes) !== value) fail(code);
  return bytes;
}

function rawQueryNames(url) {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt < 0) return [];
  return beforeHash.slice(queryAt + 1).split('&').map(segment => {
    const rawName = segment.split('=', 1)[0].replaceAll('+', ' ');
    try { return decodeURIComponent(rawName).toLowerCase(); } catch { return ''; }
  });
}
function isPrivateIPv4(host) {
  const bits = host.split('.').map(Number);
  if (bits.length !== 4 || bits.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = bits;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || b === 88))
    || a >= 224 || (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0);
}
function isLocalHost(host) {
  const value = host.toLowerCase().replace(/^\[|\]$/gu, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || !value.includes('.')) return true;
  if (isPrivateIPv4(value)) return true;
  if (value.includes(':')) {
    const compact = value.toLowerCase();
    if (compact === '::' || compact === '::1' || compact.startsWith('fc') || compact.startsWith('fd') || compact.startsWith('fe8') || compact.startsWith('fe9') || compact.startsWith('fea') || compact.startsWith('feb') || compact.startsWith('ff') || compact.startsWith('2001:db8:')) return true;
    const mapped = compact.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/u);
    return Boolean(mapped && isPrivateIPv4(mapped[1]));
  }
  return false;
}

/** Validate spelling without URL serialization; it is only classification evidence. */
export function inspectShareUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > SHARE_LIMITS.urlLength || /[\u0000-\u0020\u007f\\]/u.test(rawUrl)) fail('INVALID_URL');
  const match = rawUrl.match(URL_PREFIX_RE);
  let parsed;
  try { parsed = new URL(rawUrl); } catch { fail('INVALID_URL'); }
  if (!match || !/^https?:$/iu.test(parsed.protocol)) fail('DISALLOWED_SCHEME');
  if (!parsed.hostname || parsed.username || parsed.password) fail('INVALID_URL');
  const names = rawQueryNames(rawUrl);
  return Object.freeze({
    url: rawUrl,
    prefix: match[1],
    suffix: match[2] || '',
    hostname: parsed.hostname.toLowerCase(),
    signed: names.some(name => SIGNED.has(name)),
    sensitive: names.some(name => SENSITIVE.has(name) || name.startsWith('x-amz-') || name.startsWith('x-goog-')),
    local: isLocalHost(parsed.hostname),
  });
}

/** Removes only known tracking query segments, preserving every other byte. */
export function sanitizeShareUrl(rawUrl) {
  const info = inspectShareUrl(rawUrl);
  if (info.signed) return Object.freeze({ ...info, cleanedUrl: rawUrl, removedTracking: 0 });
  const hashAt = rawUrl.indexOf('#');
  const beforeHash = hashAt < 0 ? rawUrl : rawUrl.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : rawUrl.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  if (queryAt < 0) return Object.freeze({ ...info, cleanedUrl: rawUrl, removedTracking: 0 });
  const base = beforeHash.slice(0, queryAt);
  const segments = beforeHash.slice(queryAt + 1).split('&');
  let removedTracking = 0;
  const retained = segments.filter(segment => {
    let name = '';
    try { name = decodeURIComponent(segment.split('=', 1)[0].replaceAll('+', ' ')).toLowerCase(); } catch { return true; }
    if (!TRACKERS.has(name)) return true;
    removedTracking += 1;
    return false;
  });
  const cleanedUrl = base + (retained.length ? `?${retained.join('&')}` : '') + hash;
  return Object.freeze({ ...info, cleanedUrl, removedTracking });
}

function trimWithoutDanglingHighSurrogate(value, limit) {
  let text = value.slice(0, limit);
  if (text && /[\uD800-\uDBFF]/u.test(text.at(-1))) text = text.slice(0, -1);
  return text;
}
function validateName(name) {
  if (typeof name !== 'string') fail('INVALID_NAME');
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > SHARE_LIMITS.folderNameLength) fail('INVALID_NAME');
  return trimWithoutDanglingHighSurrogate(trimmed, SHARE_LIMITS.folderNameLength);
}
function validateTitle(title) {
  if (typeof title !== 'string' || title.length > SHARE_LIMITS.titleLength) fail('INVALID_TITLE');
  return title;
}
function streamFromBytes(bytes) { return new Blob([bytes]).stream(); }
async function readBounded(stream, limit, overflowCode) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); fail(overflowCode); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ShareCodecError) throw error;
    fail('DECOMPRESSION_FAILED');
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
async function gzip(bytes, options = {}) {
  if (options.compress) return options.compress(bytes);
  if (typeof CompressionStream !== 'function') fail('COMPRESSION_UNSUPPORTED');
  return readBounded(streamFromBytes(bytes).pipeThrough(new CompressionStream('gzip')), SHARE_LIMITS.encryptedBytes, 'URI_TOO_LARGE');
}
async function gunzip(bytes, options = {}) {
  if (options.decompress) return options.decompress(bytes, SHARE_LIMITS.decompressedBytes);
  if (typeof DecompressionStream !== 'function') fail('COMPRESSION_UNSUPPORTED');
  return readBounded(streamFromBytes(bytes).pipeThrough(new DecompressionStream('gzip')), SHARE_LIMITS.decompressedBytes, 'DECOMPRESSED_TOO_LARGE');
}
function randomBytes(length, options = {}) {
  if (options.randomBytes) return new Uint8Array(options.randomBytes(length));
  const cryptoApi = options.crypto || globalThis.crypto;
  if (!cryptoApi?.getRandomValues) fail('COMPRESSION_UNSUPPORTED');
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

export function createSharePackage({ name, items }) {
  const folderName = validateName(name);
  if (!Array.isArray(items) || !items.length) fail('EMPTY_SELECTION');
  if (items.length > SHARE_LIMITS.items) fail('TOO_MANY_ITEMS');
  const domains = [];
  const domainIndex = new Map();
  const links = [];
  for (const item of items) {
    const sanitized = sanitizeShareUrl(item?.url || '');
    const title = validateTitle(item?.title || '');
    const url = sanitized.cleanedUrl;
    const valid = inspectShareUrl(url);
    if (valid.prefix.length > SHARE_LIMITS.domainPrefixLength) fail('INVALID_URL');
    let index = domainIndex.get(valid.prefix);
    if (index === undefined) {
      if (domains.length >= SHARE_LIMITS.domains) fail('TOO_MANY_ITEMS');
      index = domains.length; domainIndex.set(valid.prefix, index); domains.push(valid.prefix);
    }
    links.push([index, valid.suffix, title]);
  }
  return Object.freeze({ v: 1, n: folderName, d: domains, l: links });
}

export function validateSharePackage(value) {
  if (!exactKeys(value, ['v', 'n', 'd', 'l']) || value.v !== 1 || !Array.isArray(value.d) || !Array.isArray(value.l)) fail('SCHEMA_MISMATCH');
  const name = validateName(value.n);
  if (value.d.length > SHARE_LIMITS.domains || value.l.length > SHARE_LIMITS.items || !value.l.length) fail('TOO_MANY_ITEMS');
  const domains = value.d.map(prefix => {
    if (typeof prefix !== 'string' || prefix.length > SHARE_LIMITS.domainPrefixLength || !/^https?:\/\/[^/?#]+$/iu.test(prefix)) fail('INVALID_PACKAGE');
    return inspectShareUrl(prefix).prefix;
  });
  const items = value.l.map(tuple => {
    if (!Array.isArray(tuple) || tuple.length !== 3 || !Number.isInteger(tuple[0]) || tuple[0] < 0 || tuple[0] >= domains.length || typeof tuple[1] !== 'string' || !/^(|[/?#])/u.test(tuple[1])) fail('INVALID_PACKAGE');
    const title = validateTitle(tuple[2]);
    const url = domains[tuple[0]] + tuple[1];
    const inspected = inspectShareUrl(url);
    if (url.length > SHARE_LIMITS.urlLength) fail('INVALID_URL');
    return Object.freeze({ url, title, hostname: inspected.hostname, sensitive: inspected.sensitive, local: inspected.local, signed: inspected.signed });
  });
  return Object.freeze({ v: 1, name, domains: [...domains], items });
}

export function parseTa1Fragment(fragment) {
  if (typeof fragment !== 'string' || fragment.length > SHARE_LIMITS.maxUriChars) fail('URI_TOO_LARGE');
  const version = fragment.match(/^#?ta(\d+)\./u)?.[1];
  if (version && version !== '1') fail('UNKNOWN_VERSION');
  const match = fragment.match(FRAGMENT_RE);
  if (!match) fail(fragment.includes('ta') ? 'INVALID_BASE64URL' : 'INVALID_URI');
  const key = fromBase64Url(match[1]);
  if (key.byteLength !== 32) fail('INVALID_KEY_LENGTH');
  const payload = fromBase64Url(match[2]);
  if (payload.byteLength < 29 || payload.byteLength > SHARE_LIMITS.encryptedBytes) fail('INVALID_PAYLOAD_LENGTH');
  return Object.freeze({ version: 'ta1', key, payload, fragment: `#ta1.${match[1]}.${match[2]}` });
}

export async function encodeTa1Package(pkg, options = {}) {
  const normalized = validateSharePackage(pkg);
  const json = JSON.stringify({ v: 1, n: normalized.name, d: normalized.domains, l: normalized.items.map(item => {
    const info = inspectShareUrl(item.url);
    return [normalized.domains.indexOf(info.prefix), info.suffix, item.title];
  }) });
  if (byteLength(json) > SHARE_LIMITS.decompressedBytes) fail('DECOMPRESSED_TOO_LARGE');
  const compressed = await gzip(new TextEncoder().encode(json), options);
  if (compressed.byteLength > SHARE_LIMITS.encryptedBytes - 28) fail('URI_TOO_LARGE');
  const key = randomBytes(32, options);
  const iv = randomBytes(12, options);
  const cryptoApi = options.crypto || globalThis.crypto;
  const cryptoKey = await cryptoApi.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, cryptoKey, compressed));
  const output = new Uint8Array(iv.length + encrypted.length); output.set(iv); output.set(encrypted, iv.length);
  return Object.freeze({ key: toBase64Url(key), payload: toBase64Url(output), fragment: `#ta1.${toBase64Url(key)}.${toBase64Url(output)}`, package: normalized });
}

export async function decodeTa1Fragment(fragment, options = {}) {
  const parsed = parseTa1Fragment(fragment);
  const cryptoApi = options.crypto || globalThis.crypto;
  const iv = parsed.payload.slice(0, 12);
  const ciphertext = parsed.payload.slice(12);
  let compressed;
  try {
    const key = await cryptoApi.subtle.importKey('raw', parsed.key, 'AES-GCM', false, ['decrypt']);
    compressed = new Uint8Array(await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: AAD, tagLength: 128 }, key, ciphertext));
  } catch { fail('AUTH_FAILED'); }
  let bytes;
  try { bytes = await gunzip(compressed, options); } catch (error) { if (error instanceof ShareCodecError) throw error; fail('DECOMPRESSION_FAILED'); }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('INVALID_UTF8'); }
  let value;
  try { value = JSON.parse(text); } catch { fail('INVALID_JSON'); }
  return validateSharePackage(value);
}
