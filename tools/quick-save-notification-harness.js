import { createQuickSaveService, SAVE_MENU_ID } from '../extension/lib/quick-save-service.js';
import { syncQuickSaveAppearance, QUICK_SAVE_APPEARANCE_KEY } from '../extension/lib/quick-save-appearance.js';
import { showQuickSaveNotification } from '../extension/lib/quick-save-notification.js';
import { THEME_OPTIONS } from '../extension/lib/view-config.js';

const options = new URLSearchParams(location.search);
if (options.has('theme')) localStorage.setItem('tabout-theme', options.get('theme'));
await import('../extension/theme-init.js');
const iframe = document.querySelector('iframe');
iframe.src = `quick-save-harness.html?theme=${document.documentElement.dataset.theme}`;
let data = { deferred: [], folders: [{ id: 'reading', name: 'Reading' }] };
const popupUndoHandlers = new Map();
window.registerPreviewUndo = (undoId, handler) => popupUndoHandlers.set(undoId, handler);
let undoRequests = 0;
window.chrome = {
  runtime: { async sendMessage(message) {
    undoRequests++;
    const handler = popupUndoHandlers.get(message.undoId);
    const result = await (handler ? handler(message) : service.handleMessage(message));
    if (result.ok) popupUndoHandlers.delete(message.undoId);
    return result;
  } },
  storage: { local: {
    async get(keys) { return Object.fromEntries(keys.map(key => [key, data[key]])); },
    async set(update) { data = { ...data, ...update }; },
  } },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} },
  scripting: { async executeScript(injection) { return [{ result: injection.func(...injection.args) }]; } },
};
syncQuickSaveAppearance();
let soundCalls = 0;
let undoSoundCalls = 0;
window.previewQuickSaveResult = (message, appearance) => showQuickSaveNotification(message, appearance, location.href);
window.previewQuickSaveSound = async (kind = 'save') => {
  if (kind === 'undo') undoSoundCalls++; else soundCalls++;
  if (options.has('checks')) return;
  const audio = new Audio(`../extension/sounds/${kind}.wav`); audio.volume = .55;
  audio.addEventListener('ended', () => { document.documentElement.dataset.soundPlayback = 'ended'; }, { once:true });
  await audio.play(); document.documentElement.dataset.soundPlayback = 'playing';
};
const service = createQuickSaveService(chrome, { playSaveSound: window.previewQuickSaveSound, playUndoSound: () => window.previewQuickSaveSound('undo') });
iframe.addEventListener('load', () => {
  const resize = new ResizeObserver(() => {
    iframe.style.height = `${Math.min(600, Math.ceil(iframe.contentDocument.body.getBoundingClientRect().height))}px`;
  });
  resize.observe(iframe.contentDocument.body);
  const observer = new MutationObserver(() => {
    if (iframe.contentDocument.documentElement.dataset.popupClosed === 'true') iframe.hidden = true;
  });
  observer.observe(iframe.contentDocument.documentElement, { attributes:true, attributeFilter:['data-popup-closed'] });
});
const page = { id: 7, url: location.href, title: 'Designing calm interfaces' };
document.getElementById('save').addEventListener('click', () => service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page));
document.getElementById('error').addEventListener('click', () => service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:removed` }, page));
document.getElementById('reduced').addEventListener('click', () => {
  document.documentElement.dataset.motion = document.documentElement.dataset.motion === 'reduced' ? 'full' : 'reduced';
});
if (options.has('checks')) {
  const results = [];
  const assert = (value, text) => { if (!value) throw new Error(text); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const notice = () => globalThis.__tabAtlasSaveNotification?.host.shadowRoot.querySelector('.notice');
  const check = async (name, work) => {
    try { await work(); results.push({ name, passed:true }); }
    catch (error) { results.push({ name, passed:false, error:error.message }); }
  };
  await check('Native popup measurement stays 360px in an initially narrow frame', async () => {
    iframe.style.width = '142px';
    for (let i = 0; i < 80 && (!iframe.contentDocument?.querySelector('.quick-save-panel') || getComputedStyle(iframe.contentDocument.body).minWidth !== '360px'); i++) await wait(25);
    const body = iframe.contentDocument.body;
    assert(Math.round(body.getBoundingClientRect().width) === 360, 'Body shrank with viewport');
    assert(getComputedStyle(iframe.contentDocument.documentElement).minWidth === '360px', 'Root did not preserve intrinsic minimum');
    iframe.style.width = '360px';
    assert(body.scrollWidth <= 360, 'Popup content overflows its intended width');
  });
  await check('Success, repeat, failure and interruption leave one readable notification', async () => {
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
    assert(notice().textContent.includes('Saved to Reading'), 'Success receipt missing');
    const oldHost = globalThis.__tabAtlasSaveNotification.host;
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
    assert(!oldHost.isConnected && notice().textContent.includes('Already saved in Reading'), 'Repeat stacked or duplicated feedback');
    assert(!notice().querySelector('.undo-action'), 'Repeat offered Undo for an unrelated action');
    assert(data.deferred.length === 1, 'Repeat duplicated saved record');
    assert(soundCalls === 1, 'Repeat played duplicate success sound');
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:removed` }, page);
    assert(notice().classList.contains('error') && notice().querySelector('[role="alert"]'), 'Failure presented as success');
    notice().querySelector('button').click(); await wait(190);
    assert(!notice(), 'Dismiss did not clean up');
    assert(!showQuickSaveNotification({ ok:true, text:'Wrong page' }, null, 'https://other.example/'), 'Navigation race showed stale feedback');
  });
  await check('All 16 themes keep their materials; reduced motion stays static and names stay text', async () => {
    const original = document.documentElement.dataset.theme;
    for (const theme of THEME_OPTIONS) {
      document.documentElement.dataset.theme = theme.id;
      document.documentElement.dataset.motion = 'reduced';
      await wait(40);
      showQuickSaveNotification({ ok:true, undoId:'theme-preview', text:'Saved to <img src=x onerror=alert(1)>' }, data[QUICK_SAVE_APPEARANCE_KEY], location.href);
      const element = notice(); const style = getComputedStyle(element);
      assert(element.querySelector('img') === null && element.textContent.includes('<img'), 'Folder interpreted as HTML');
      assert(element.getAnimations({ subtree:true }).length === 0, `${theme.id}: reduced-motion animation`);
      element.querySelector('.undo-action').focus();
      assert(getComputedStyle(element.querySelector('.undo-glyph')).opacity === '1' && getComputedStyle(element.querySelector('.status-glyph')).opacity === '0', `${theme.id}: reduced-motion Undo icon did not switch immediately`);
      assert(element.getAnimations({ subtree:true }).length === 0, `${theme.id}: reduced-motion icon animation`);
      const expected = getComputedStyle(document.documentElement).getPropertyValue('--view-panel-radius').trim();
      assert(style.borderRadius === expected, `${theme.id}: theme radius changed`);
      if (theme.id.endsWith('glass')) assert(style.backdropFilter.includes('blur'), `${theme.id}: glass lost blur`);
      if (theme.id.endsWith('soft')) assert(style.boxShadow.split('rgb').length >= 3, `${theme.id}: soft lost dual shadow`);
      assert(element.getBoundingClientRect().right <= innerWidth, `${theme.id}: notification clipped`);
      const bounds = element.getBoundingClientRect();
      const viewport = document.documentElement.getBoundingClientRect();
      assert(Math.abs((bounds.left + bounds.right) / 2 - (viewport.left + viewport.right) / 2) < 1, `${theme.id}: not centered`);
      assert(Math.abs(bounds.bottom - (innerHeight - 24)) < 1 && bounds.height <= 42, `${theme.id}: not compact at bottom`);
      globalThis.__tabAtlasSaveNotification.dispose();
    }
    document.documentElement.dataset.theme = original;
    document.documentElement.dataset.motion = 'full';
  });
  await check('Notification dismisses itself after the readable interval', async () => {
    await wait(40);
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
    await wait(4750);
    assert(!notice(), 'Notification leaked after timeout');
  });
  await check('Countdown pauses on hover and resumes the remaining time without resetting', async () => {
    showQuickSaveNotification({ ok:true, undoId:'timer-preview', text:'Saved to Reading' }, data[QUICK_SAVE_APPEARANCE_KEY], location.href);
    await wait(3300);
    const element = notice();
    const initialWidth = element.getBoundingClientRect().width;
    assert(getComputedStyle(element.querySelector('.status-glyph')).opacity === '1' && getComputedStyle(element.querySelector('.undo-glyph')).opacity === '0', 'Success did not start with a check');
    const progress = element.querySelector('.countdown').getAnimations()[0];
    assert(progress.currentTime > 3000, 'Countdown did not advance');
    element.dispatchEvent(new MouseEvent('mouseenter'));
    const elapsed = progress.currentTime;
    await wait(1400);
    assert(notice() === element && Math.abs(progress.currentTime - elapsed) < 30, 'Hover failed to pause expiration');
    assert(element.classList.contains('undo-ready') && getComputedStyle(element.querySelector('.undo-label')).opacity === '1', 'Hover did not replace the message with Undo');
    assert(getComputedStyle(element.querySelector('.undo-glyph')).opacity === '1' && getComputedStyle(element.querySelector('.status-glyph')).opacity === '0', 'Hover did not replace the check with the Undo arrow');
    assert(element.getBoundingClientRect().width === initialWidth, 'Icon swap changed receipt width');
    element.dispatchEvent(new MouseEvent('mouseleave'));
    await wait(120);
    assert(getComputedStyle(element.querySelector('.status-glyph')).opacity === '1' && getComputedStyle(element.querySelector('.undo-glyph')).opacity === '0', 'Leaving hover did not restore the check');
    await wait(1500);
    assert(!notice(), 'Leaving hover restarted the full timer');
  });
  await check('Focus reveals Undo; clicking twice commits one cancellation and one Undo sound', async () => {
    data = { ...data, deferred:[], quickSaveUndo:null };
    const requestsBefore = undoRequests;
    const soundsBefore = undoSoundCalls;
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
    const element = notice();
    const action = element.querySelector('.undo-action');
    action.focus(); await wait(120);
    assert(element.classList.contains('undo-ready') && getComputedStyle(element.querySelector('.undo-label')).opacity === '1', 'Keyboard focus did not reveal Undo');
    assert(getComputedStyle(element.querySelector('.undo-glyph')).opacity === '1' && getComputedStyle(element.querySelector('.status-glyph')).opacity === '0', 'Keyboard focus did not reveal the Undo arrow');
    assert(element.querySelector('.countdown').getAnimations()[0].playState === 'paused', 'Focus did not pause countdown');
    action.click(); action.click(); await wait(220);
    assert(data.deferred.length === 0 && data.quickSaveUndo === null, 'Toast Undo did not cancel the saved record');
    assert(!notice() && undoRequests === requestsBefore + 1 && undoSoundCalls === soundsBefore + 1, 'Double click repeated Undo or left feedback behind');
  });
  await check('A stale toast cannot Undo a newer save and reports the failure', async () => {
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
    const old = notice();
    await service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, { ...page, url:'https://example.com/newer-save' });
    assert(notice() === old, 'Navigation guard replaced the original receipt');
    old.querySelector('.undo-action').click(); await wait(40);
    assert(data.deferred.length === 2, 'Stale receipt cancelled another save');
    assert(old.classList.contains('error') && !old.classList.contains('undo-ready') && old.querySelector('[role="alert"]'), 'Undo failure was not announced');
    assert(!old.querySelector('.undo-glyph'), 'Failed Undo still displayed its arrow');
    assert(old.textContent.includes('no longer available') && old.querySelector('.undo-action').getAttribute('aria-disabled') === 'true', 'Stale Undo remained actionable');
    globalThis.__tabAtlasSaveNotification.dispose();
  });
  await check('Popup confirmation and page receipt Undo share the same saved action', async () => {
    const popup = iframe.contentDocument;
    popup.querySelector('button[aria-label="Choose Reading"]').click();
    popup.getElementById('confirmSave').click();
    for (let i = 0; i < 40 && !notice()?.querySelector('.undo-action'); i++) await wait(25);
    assert(iframe.hidden && !popup.getElementById('undoSave').hidden, 'Popup did not close with an available saved action');
    notice().querySelector('.undo-action').focus(); await wait(120);
    assert(getComputedStyle(notice().querySelector('.undo-glyph')).opacity === '1', 'Popup receipt did not reveal the Undo arrow');
    notice().querySelector('.undo-action').click();
    await wait(220);
    assert(!notice() && popup.getElementById('undoSave').hidden, 'Page receipt did not cancel the popup save');
  });
  document.getElementById('notificationResults').textContent = JSON.stringify(results);
}
