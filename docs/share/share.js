import { decodeTa1Fragment, ShareCodecError } from './ta1-codec.js';
import { createExtensionBridge } from './extension-bridge.js';
import { SHARE_PUBLIC_CONFIG } from './share-config.js';

const status = document.getElementById('shareStatus');
const preview = document.getElementById('sharePreview');
const actions = document.getElementById('shareActions');
const add = document.getElementById('shareAdd');
const retry = document.getElementById('shareRetry');
const store = document.getElementById('shareStore');
const extensionIds = [...new Set([SHARE_PUBLIC_CONFIG.extensionId, SHARE_PUBLIC_CONFIG.developmentExtensionId].filter(Boolean))];
const extensionBridge = createExtensionBridge({ extensionIds });
let fragment = '';
let previewReady = false;

function setStatus(text, alert = false) { status.textContent = text; status.setAttribute('role', alert ? 'alert' : 'status'); }
function clear(element) { while (element.firstChild) element.firstChild.remove(); }
function renderPreview(pkg) {
  clear(preview);
  const domains = new Set(pkg.items.map(item => item.hostname));
  const count = document.createElement('p'); count.className = 'share-count'; count.textContent = `${pkg.name} · ${pkg.items.length} link${pkg.items.length === 1 ? '' : 's'} · ${domains.size} domain${domains.size === 1 ? '' : 's'}`; preview.append(count);
  const list = document.createElement('ol'); list.className = 'share-list';
  const visible = pkg.items.slice(0, 8);
  const append = item => { const row = document.createElement('li'); const title = document.createElement('span'); title.className = 'share-link-title'; title.textContent = item.title || item.url; const url = document.createElement('span'); url.className = 'share-link-url'; url.textContent = item.url; row.append(title, url); list.append(row); };
  visible.forEach(append); preview.append(list);
  if (pkg.items.length > visible.length) { const more = document.createElement('button'); more.type = 'button'; more.className = 'share-more secondary'; more.textContent = `Show all ${pkg.items.length}`; more.addEventListener('click', () => { pkg.items.slice(visible.length).forEach(append); more.remove(); }); preview.append(more); }
  const risky = pkg.items.some(item => item.sensitive || item.local);
  if (risky) { const warning = document.createElement('p'); warning.className = 'share-note'; warning.textContent = 'This folder includes a sensitive or local-address link. Review it carefully before importing.'; preview.append(warning); }
  preview.hidden = false;
}
function showStoreLink(visible) {
  if (SHARE_PUBLIC_CONFIG.chromeWebStoreUrl) store.href = SHARE_PUBLIC_CONFIG.chromeWebStoreUrl;
  else store.removeAttribute('href');
  store.hidden = !visible || !SHARE_PUBLIC_CONFIG.chromeWebStoreUrl;
}
async function checkExtension() {
  if (!previewReady) return;
  retry.disabled = true;
  setStatus('Checking for Tab Atlas…');
  const result = await extensionBridge.send({ type: 'tab-atlas/share/ping', protocol: 'ta1' });
  retry.disabled = false;
  add.disabled = !result?.ok; retry.hidden = Boolean(result?.ok); showStoreLink(!result?.ok);
  if (!result?.ok) setStatus('Tab Atlas is not available yet. Install it, then check again.');
  else setStatus('Preview decrypted locally. Nothing has been imported yet.');
}
async function boot() {
  fragment = location.hash;
  if (!fragment) { setStatus('This share link is missing its encrypted folder.', true); return; }
  if (fragment.length > 8192) { setStatus('This share link is too large to open safely.', true); return; }
  try { const pkg = await decodeTa1Fragment(fragment); renderPreview(pkg); previewReady = true; setStatus('Preview decrypted locally. Nothing has been imported yet.'); actions.hidden = false; await checkExtension(); }
  catch (error) { const code = error instanceof ShareCodecError ? error.code : 'INVALID_URI'; setStatus(code === 'UNKNOWN_VERSION' ? 'This share link needs a newer version of Tab Atlas.' : 'This share link is damaged, changed, or cannot be opened safely.', true); }
}
add.addEventListener('click', async () => { if (!previewReady) return; add.disabled = true; setStatus('Sending this folder to Tab Atlas for final confirmation…'); const result = await extensionBridge.send({ type: 'tab-atlas/share/import-request', protocol: 'ta1', fragment }); if (result?.ok) setStatus('Tab Atlas is ready for you to confirm the import.'); else { setStatus('Tab Atlas could not receive the folder. Check that it is installed, then try again.', true); add.disabled = false; } });
retry.addEventListener('click', checkExtension);
void boot();
