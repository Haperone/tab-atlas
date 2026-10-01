// Preview the real popup and worker logic with local, observable Chrome API mocks.
import { createQuickSaveService } from '../extension/lib/quick-save-service.js';
import { playUiSound } from '../extension/lib/ui-sound.js';

const options = new URLSearchParams(location.search);
const listeners = [];
const menuItems = new Map();
const page = { id: 7, active: true, windowId: 1, title: 'Designing calm interfaces — a practical guide', url: 'https://example.com/design/calm-interfaces' };
if (options.has('unsupported')) page.url = 'chrome://settings/';
let data = { deferred: [], folders: [
  { id: 'reading', name: 'Reading', color: '#78a8c8', locked: false },
  { id: 'work', name: 'Work', color: '#73937a', locked: false },
  { id: 'ideas', name: 'Ideas', color: '#9a8ac0', locked: false },
  { id: 'locked', name: 'Reference', color: '#c8916e', locked: true },
] };
if (options.has('empty')) data.folders = [];
if (options.has('many')) data.folders.push(...Array.from({ length: 25 }, (_, i) => ({ id: `f-${i}`, name: `Research folder ${i + 1} — notes and useful links` })));
if (options.has('existing')) data.deferred.push({ id: 'existing', url: page.url, title: page.title, folderId: 'reading', completed: false, dismissed: false });
if (options.has('undone')) data.quickSaveFeedback = { ok:true, kind:'undone' };
if (options.has('persist')) {
  try { data = JSON.parse(sessionStorage.getItem('quick-save-demo') || 'null') || data; } catch {}
}
if (options.has('theme')) localStorage.setItem('tabout-theme', options.get('theme'));
const chromeApi = {
  runtime: { getURL: value => new URL(`../extension/${value}`, location.href).href, lastError: null,
    async sendMessage(message) { return service.handleMessage(message); } },
  storage: { local: {
    async get(keys) {
      if (options.has('unavailable')) throw new Error('Simulated unreadable storage');
      return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])]));
    },
    async set(update) {
      if (options.has('fail')) throw new Error('Simulated unavailable storage');
      const changes = Object.fromEntries(Object.entries(update).map(([key, value]) => [key, { oldValue: data[key], newValue: structuredClone(value) }]));
      data = { ...data, ...structuredClone(update) };
      if (options.has('persist')) sessionStorage.setItem('quick-save-demo', JSON.stringify(data));
      queueMicrotask(() => listeners.forEach(listener => listener(changes, 'local')));
    },
  }, onChanged: { addListener(listener) { listeners.push(listener); } } },
  tabs: { async query() { return [page]; }, async get() { return page; } },
  action: { async setBadgeText(value) { document.documentElement.dataset.badge = value.text; }, async setBadgeBackgroundColor() {}, async setTitle() {} },
  contextMenus: { removeAll(done) { menuItems.clear(); done(); }, create(item, done) { menuItems.set(item.id, item); done(); return item.id; } },
  scripting: { async executeScript(injection) {
    if (window.parent !== window && window.parent.previewQuickSaveResult) {
      if (injection.args[0].undoId) window.parent.registerPreviewUndo?.(injection.args[0].undoId, message => service.handleMessage(message));
      return [{ result: window.parent.previewQuickSaveResult(injection.args[0], injection.args[1]) }];
    }
    return [{ result:false }];
  } },
};
async function sound(kind) {
  if (options.has('checks')) {
    document.documentElement.dataset[`${kind}SoundCount`] = String(Number(document.documentElement.dataset[`${kind}SoundCount`] || 0) + 1);
  } else if (window.parent !== window && window.parent.previewQuickSaveSound) await window.parent.previewQuickSaveSound(kind);
  else await playUiSound(kind);
}
const service = createQuickSaveService(chromeApi, { async openDashboard() {}, async updateBadge() {},
  playSaveSound: () => sound('save'), playUndoSound: () => sound('undo') });
window.chrome = chromeApi;
window.close = () => { document.documentElement.dataset.popupClosed = 'true'; };
const markup = await (await fetch('../extension/popup.html')).text();
const parsed = new DOMParser().parseFromString(markup, 'text/html');
parsed.querySelectorAll('script').forEach(script => script.remove());
const base = document.createElement('base'); base.href = new URL('../extension/', location.href).href;
document.head.replaceChildren(base, ...parsed.head.childNodes);
document.body.className = parsed.body.className;
document.body.replaceChildren(...parsed.body.childNodes);
await import('../extension/theme-init.js');
await service.syncMenus().catch(() => {});
listeners.push(changes => { if (changes.folders) void service.syncMenus(); });
if (options.has('context')) await service.handleContextClick({ menuItemId: 'tab-atlas-save-page:folder:reading' }, page);
await import('../extension/popup.js');

if (options.has('checks')) await import('./quick-save-checks.js');
