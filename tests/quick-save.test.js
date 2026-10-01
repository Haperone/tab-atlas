import test from 'node:test';
import assert from 'node:assert/strict';
import { findSavedPage, savePage, undoSave, websiteUrl, QUICK_SAVE_UNDO_KEY, QUICK_SAVE_FEEDBACK_KEY } from '../extension/lib/quick-save-core.js';
import { createQuickSaveService, QUICK_SAVE_PREFIX, SAVE_MENU_ID } from '../extension/lib/quick-save-service.js';
import { QUICK_SAVE_APPEARANCE_KEY } from '../extension/lib/quick-save-appearance.js';

const page = { id: 7, url: 'https://example.com/article', title: 'An article' };
const folders = [{ id: 'reading', name: 'Reading' }, { id: 'work', name: 'Work', locked: true }];
const saved = { id: 's1', url: page.url, title: 'My edited title', folderId: 'reading', completed: false, dismissed: false, savedAt: '2026-09-01T00:00:00Z' };

function fixture(seed = {}) {
  let data = structuredClone({ folders, deferred: [], ...seed });
  let active = { ...page };
  const menuItems = new Map();
  const calls = [];
  const chromeApi = {
    runtime: { lastError: undefined },
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
      async set(update) { await Promise.resolve(); data = { ...data, ...structuredClone(update) }; },
    } },
    tabs: {
      async query() { return [structuredClone(active)]; },
      async get(id) { assert.equal(id, page.id); return structuredClone(active); },
    },
    action: {
      async setBadgeText(value) { calls.push(['badge', value]); },
      async setBadgeBackgroundColor(value) { calls.push(['color', value]); },
      async setTitle(value) { calls.push(['title', value]); },
    },
    scripting: { async executeScript(value) { calls.push(['notification', value, structuredClone(data.deferred)]); } },
    contextMenus: {
      removeAll(done) { menuItems.clear(); done(); },
      create(item, done) { assert.equal(menuItems.has(item.id), false); menuItems.set(item.id, item); done(); return item.id; },
    },
  };
  const createService = () => createQuickSaveService(chromeApi, {
    async openDashboard() { calls.push(['dashboard']); },
    async updateBadge() { calls.push(['acknowledge']); },
    async playSaveSound() { calls.push(['sound']); },
    async playUndoSound() { calls.push(['undoSound']); },
  });
  const service = createService();
  return { service, createService, chromeApi, calls, menuItems,
    read: () => structuredClone(data), change: update => { data = { ...data, ...structuredClone(update) }; },
    navigate: url => { active.url = url; },
    message: (action, values = {}) => service.handleMessage({ type: `${QUICK_SAVE_PREFIX}${action}`, ...values }) };
}

test('quick save supports websites and preserves URL query/fragment identity', () => {
  for (const url of ['chrome://newtab/', 'chrome-extension://abc/index.html', 'file:///tmp/x', 'javascript:alert(1)', 'not a url']) {
    assert.equal(websiteUrl(url), null);
    assert.equal(savePage([], folders, { url }).error, 'UNSUPPORTED_PAGE');
  }
  assert.equal(websiteUrl('https://example.com'), 'https://example.com/');
  assert.equal(websiteUrl('https://example.com/?x=1#section'), 'https://example.com/?x=1#section');
  assert.equal(findSavedPage([{ url: 'invalid' }], 'invalid'), null);
});

test('save creates a dashboard-compatible record and does not duplicate the same page', () => {
  const result = savePage([], folders, page, 'reading');
  assert.equal(result.ok, true);
  assert.equal(result.record.folderId, 'reading');
  assert.equal(result.record.completed, false);
  assert.equal(result.record.title, page.title);
  const again = savePage(result.records, folders, page, 'reading');
  assert.equal(again.changed, false);
  assert.equal(again.kind, 'existing');
  assert.equal(again.record.id, result.record.id);
});

test('moving a saved page retains its ID, user title and save date', () => {
  const result = savePage([saved], folders, page, 'work');
  assert.equal(result.kind, 'moved');
  assert.equal(result.records.length, 1);
  assert.equal(result.record.id, saved.id);
  assert.equal(result.record.title, saved.title);
  assert.equal(result.record.savedAt, saved.savedAt);
  assert.equal(result.record.folderId, 'work');
});

test('restore reuses archived record and favors an active duplicate when one exists', () => {
  const archived = { ...saved, id: 'old', completed: true, completedAt: '2026-09-29T00:00:00Z' };
  const restored = savePage([archived], folders, page, null);
  assert.equal(restored.kind, 'restored');
  assert.equal(restored.record.id, 'old');
  assert.equal('completedAt' in restored.record, false);
  assert.equal(findSavedPage([archived, saved], page.url).id, saved.id);
  assert.equal(findSavedPage([{ ...saved, dismissed: true }], page.url), null);
});

test('locked folders accept additions but prevent moving their existing pages out', () => {
  assert.equal(savePage([], folders, page, 'work').ok, true);
  const locked = { ...saved, folderId: 'work' };
  assert.equal(savePage([locked], folders, page, 'reading').error, 'SOURCE_LOCKED');
  assert.equal(savePage([locked], folders, page, 'work').changed, false);
  assert.equal(savePage([saved], folders, page, 'missing').error, 'FOLDER_GONE');
});

test('Undo removes only its addition and does not erase subsequent saves', () => {
  const result = savePage([], folders, page, 'reading');
  const another = { ...saved, id: 'unrelated', url: 'https://other.example/' };
  assert.deepEqual(undoSave([...result.records, another], folders, result.undo).records, [another]);
});

test('Undo restores membership/archive state while preserving later title edits', () => {
  const archived = { ...saved, completed: true, completedAt: '2026-09-29T00:00:00Z' };
  const result = savePage([archived], folders, page, null);
  const edited = { ...result.record, title: 'New title' };
  const undone = undoSave([edited], folders, result.undo);
  assert.equal(undone.records[0].title, 'New title');
  assert.equal(undone.records[0].completedAt, archived.completedAt);
  assert.equal(undone.records[0].folderId, 'reading');
});

test('Undo declines changed additions, later moves and locked removals', () => {
  const result = savePage([], folders, page, 'reading');
  assert.equal(undoSave([{ ...result.record, title: 'Edited' }], folders, result.undo).error, 'UNDO_CHANGED');
  assert.equal(undoSave([{ ...result.record, folderId: null }], folders, result.undo).error, 'UNDO_CHANGED');
  assert.equal(undoSave(result.records, [{ ...folders[0], locked: true }], result.undo).error, 'SOURCE_LOCKED');
});

test('Undo returns to the inbox if the original folder was removed', () => {
  const result = savePage([saved], folders, page, null);
  const undone = undoSave(result.records, [], result.undo);
  assert.equal(undone.ok, true);
  assert.equal(undone.records[0].folderId, null);
});

test('worker serializes simultaneous popup/menu saves without creating duplicates', async () => {
  const f = fixture();
  const [popup, menu] = await Promise.all([
    f.message('save', { tabId: page.id, folderId: 'reading', expectedUrl: page.url }),
    f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page),
  ]);
  assert.equal(popup.ok, true);
  assert.equal(menu.ok, true);
  assert.equal(f.read().deferred.length, 1);
  assert.equal(f.read().deferred[0].folderId, 'reading');
  assert.ok(f.calls.some(([kind, value]) => kind === 'badge' && value.text === '✓'));
});

test('save and Undo survive reopening the popup and restarting the worker', async () => {
  const f = fixture();
  await f.message('save', { tabId: page.id, folderId: 'reading' });
  const restarted = f.createService();
  const state = await restarted.handleMessage({ type: `${QUICK_SAVE_PREFIX}state` });
  assert.equal(state.saved.folderId, 'reading');
  assert.ok(state.undo.id);
  const result = await restarted.handleMessage({ type: `${QUICK_SAVE_PREFIX}undo`, undoId: state.undo.id });
  assert.equal(result.ok, true);
  assert.deepEqual(f.read().deferred, []);
  assert.equal(f.read()[QUICK_SAVE_UNDO_KEY], null);
  assert.equal((await f.message('undo', { undoId: state.undo.id })).error, 'UNDO_GONE');
});

test('stale popup URL, missing folder and stale Undo ID cannot alter saved data', async () => {
  const f = fixture();
  f.navigate('https://example.com/changed');
  assert.equal((await f.message('save', { tabId: page.id, expectedUrl: page.url })).error, 'PAGE_CHANGED');
  assert.equal((await f.message('save', { tabId: page.id, folderId: 'deleted' })).error, 'FOLDER_GONE');
  assert.equal((await f.message('undo', { undoId: 'old' })).error, 'UNDO_GONE');
  assert.deepEqual(f.read().deferred, []);
});

test('create and save writes folder/page together and validates before creating', async () => {
  const f = fixture();
  assert.equal((await f.message('create-folder', { name: '  ' })).error, 'EMPTY_NAME');
  assert.equal(f.read().folders.length, 2);
  f.navigate('chrome://settings/');
  assert.equal((await f.message('create-folder', { name: 'Research' })).error, 'UNSUPPORTED_PAGE');
  assert.equal(f.read().folders.length, 2);
  f.navigate(page.url);
  assert.equal((await f.message('create-folder', { name: ' Research ', tabId: page.id })).ok, true);
  const added = f.read().folders.at(-1);
  assert.equal(added.name, 'Research');
  assert.equal(f.read().deferred[0].folderId, added.id);
});

test('context menu rebuild reflects folder changes, escapes selection substitution, and allows locked destinations', async () => {
  const f = fixture({ folders: [...folders, { id: 'percent', name: '100% success %s' }] });
  await f.service.syncMenus();
  assert.equal(f.menuItems.get(`${SAVE_MENU_ID}:folder:percent`).title, '100％ success ％s');
  assert.equal(f.menuItems.get(`${SAVE_MENU_ID}:folder:work`).enabled, undefined);
  assert.deepEqual(f.menuItems.get(SAVE_MENU_ID).documentUrlPatterns, ['http://*/*', 'https://*/*']);
  f.change({ folders: [{ id: 'new', name: 'New folder' }] });
  await Promise.all([f.service.syncMenus(), f.service.syncMenus()]);
  assert.equal(f.menuItems.has(`${SAVE_MENU_ID}:folder:reading`), false);
  assert.equal(f.menuItems.get(`${SAVE_MENU_ID}:folder:new`).title, 'New folder');
});

test('right-click on a link/frame saves the current top-level page and leaves tabs open', async () => {
  const f = fixture();
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox`, linkUrl: 'https://other.example/', frameUrl: 'https://frame.example/' }, page);
  assert.equal(f.read().deferred[0].url, page.url);
  assert.equal(f.read().deferred[0].title, page.title);
  assert.equal(f.read().deferred[0].folderId, null);
});

test('storage and menu API failures are reported, not claimed as success', async () => {
  const f = fixture();
  f.chromeApi.storage.local.set = async () => { throw new Error('quota'); };
  assert.equal((await f.message('save', { tabId: page.id })).error, 'STORAGE_ERROR');
  assert.equal((await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox` }, page)).error, 'STORAGE_ERROR');
  assert.equal(f.calls.some(([kind, value]) => kind === 'badge' && value.text === '✓'), false);
  f.chromeApi.contextMenus.create = (_item, done) => {
    f.chromeApi.runtime.lastError = { message: 'Menu rejected' }; done(); f.chromeApi.runtime.lastError = undefined;
  };
  await assert.rejects(f.service.syncMenus(), /Menu rejected/);
});

test('dashboard remains reachable and context failure feedback persists until read', async () => {
  const f = fixture({ deferred: [{ ...saved, folderId: 'work' }] });
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  assert.equal(f.read()[QUICK_SAVE_FEEDBACK_KEY].error, 'SOURCE_LOCKED');
  assert.ok(f.calls.some(([kind, value]) => kind === 'badge' && value.text === '!'));
  assert.equal((await f.message('dashboard')).ok, true);
  assert.equal((await f.message('acknowledge')).ok, true);
  assert.ok(f.calls.some(([kind]) => kind === 'dashboard'));
});

test('a toolbar badge failure does not report an already committed save as failed', async () => {
  const f = fixture();
  f.chromeApi.action.setBadgeText = async () => { throw new Error('Toolbar unavailable'); };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox` }, page)).ok, true);
    assert.equal(f.read().deferred.length, 1);
    assert.equal(f.read()[QUICK_SAVE_FEEDBACK_KEY].ok, true);
  } finally { console.warn = originalWarn; }
});

test('page notification runs after persistence and carries theme, folder and original URL', async () => {
  const appearance = { theme: 'papersoft', reducedMotion: true, tokens: { '--text': '#222' } };
  const f = fixture({ [QUICK_SAVE_APPEARANCE_KEY]: appearance });
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  const [, injection, persisted] = f.calls.find(([kind]) => kind === 'notification');
  assert.deepEqual(injection.target, { tabId: page.id });
  assert.deepEqual(injection.args, [{ ok: true, text: 'Saved to Reading', undoId:f.read()[QUICK_SAVE_UNDO_KEY].id }, appearance, page.url]);
  assert.equal(persisted[0].folderId, 'reading');
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  assert.equal(f.calls.filter(([kind]) => kind === 'notification').at(-1)[1].args[0].text, 'Already saved in Reading');
  assert.equal(f.calls.filter(([kind]) => kind === 'notification').at(-1)[1].args[0].undoId, undefined);
});

test('receipt Undo cancels its own save and cannot cancel a newer page', async () => {
  const f = fixture();
  const first = await f.message('save', { tabId:page.id, folderId:'reading', notify:true });
  assert.equal(first.undoId, f.calls.find(([kind]) => kind === 'notification')[1].args[0].undoId);
  f.navigate('https://example.com/newer');
  const newer = await f.message('save', { tabId:page.id, folderId:'reading', notify:true });
  assert.notEqual(first.undoId, newer.undoId);
  assert.equal((await f.message('undo', { undoId:first.undoId })).error, 'UNDO_GONE');
  assert.equal(f.read().deferred.length, 2);
  assert.equal((await f.message('undo', { undoId:newer.undoId })).ok, true);
  assert.deepEqual(f.read().deferred.map(record => record.url), [page.url]);
});

test('restricted-page injection failures preserve the successful save and Undo', async () => {
  const f = fixture();
  f.chromeApi.scripting.executeScript = async () => { throw new Error('Cannot access this page'); };
  assert.equal((await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox` }, page)).ok, true);
  assert.equal(f.read().deferred.length, 1);
  assert.ok(f.read()[QUICK_SAVE_UNDO_KEY].id);
});

test('page feedback reports locked-folder and storage failures without success animation', async () => {
  const locked = fixture({ deferred: [{ ...saved, folderId: 'work' }] });
  await locked.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  const failure = locked.calls.find(([kind]) => kind === 'notification')[1].args[0];
  assert.equal(failure.ok, false);
  assert.match(failure.text, /locked folder/);
  assert.equal(locked.read().deferred[0].folderId, 'work');
  const quota = fixture();
  quota.chromeApi.storage.local.set = async () => { throw new Error('quota'); };
  await quota.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox` }, page);
  assert.deepEqual(quota.calls.find(([kind]) => kind === 'notification')[1].args[0], { ok: false, text: 'Could not save the change. Try again.' });
  assert.deepEqual(quota.read().deferred, []);
});

test('popup saves do not inject a second confirmation into the page', async () => {
  const f = fixture();
  await f.message('save', { tabId: page.id, folderId: 'reading' });
  assert.equal(f.calls.some(([kind]) => kind === 'notification'), false);
});

test('explicit popup confirmation shares page feedback and sound without duplicating failed saves', async () => {
  const f = fixture();
  const result = await f.message('save', { tabId: page.id, expectedUrl: page.url, folderId: 'reading', notify:true });
  assert.equal(result.ok, true);
  assert.equal(f.calls.find(([kind]) => kind === 'notification')[1].args[0].text, 'Saved to Reading');
  assert.equal(f.calls.filter(([kind]) => kind === 'sound').length, 1);
  const notifications = f.calls.filter(([kind]) => kind === 'notification').length;
  assert.equal((await f.message('save', { tabId: page.id, folderId: 'missing', notify:true })).ok, false);
  assert.equal(f.calls.filter(([kind]) => kind === 'notification').length, notifications);
  assert.equal(f.calls.filter(([kind]) => kind === 'sound').length, 1);
});

test('Undo sound plays after a successful commit, respecting mute and rejecting stale actions', async () => {
  for (const sound of [true, false]) {
    const f = fixture({ [QUICK_SAVE_APPEARANCE_KEY]: { sound } });
    await f.message('save', { tabId: page.id, folderId: 'reading' });
    const undoId = f.read()[QUICK_SAVE_UNDO_KEY].id;
    assert.equal((await f.message('undo', { undoId })).ok, true);
    assert.deepEqual(f.read().deferred, []);
    assert.equal(f.calls.filter(([kind]) => kind === 'undoSound').length, sound ? 1 : 0);
    await f.message('undo', { undoId });
    assert.equal(f.calls.filter(([kind]) => kind === 'undoSound').length, sound ? 1 : 0);
  }
});

test('save sound accompanies a committed change, respects mute, and stays silent for errors/repeats', async () => {
  const f = fixture();
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  await f.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:missing` }, page);
  assert.equal(f.calls.filter(([kind]) => kind === 'sound').length, 1);
  const mute = fixture({ [QUICK_SAVE_APPEARANCE_KEY]: { sound: false } });
  await mute.service.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:folder:reading` }, page);
  assert.equal(mute.calls.some(([kind]) => kind === 'sound'), false);
  assert.equal(mute.read().deferred.length, 1);
  const failedAudio = createQuickSaveService(f.chromeApi, { async playSaveSound() { throw new Error('Audio unavailable'); } });
  assert.equal((await failedAudio.handleContextClick({ menuItemId: `${SAVE_MENU_ID}:inbox` }, page)).ok, true);
  assert.equal(f.read().deferred[0].folderId, null);
});
