import { QUICK_SAVE_ERRORS } from './lib/quick-save-core.js';
import { QUICK_SAVE_PREFIX } from './lib/quick-save-service.js';
import { FOLDER_COLORS } from './lib/view-config.js';
import { syncQuickSaveAppearance } from './lib/quick-save-appearance.js';
import { readStorageUsage, storageWarningText } from './lib/storage-usage.js';

syncQuickSaveAppearance();

const byId = id => document.getElementById(id);
let current = null;
let busy = false;
let refreshPending = false;
let refreshRevision = 0;
let selectedFolder;
let storageRevision = 0;
let storageTimer;

async function refreshStorageNotice() {
  const revision = ++storageRevision;
  try {
    const usage = await readStorageUsage(chrome.storage.local);
    if (!usage || revision !== storageRevision) return;
    byId('popupStorageText').textContent = storageWarningText(usage);
    byId('popupStorageWarning').hidden = usage.level === 'normal';
  } catch { /* Keep the previous warning if a measurement fails. */ }
}
const CHECK = '<svg class="destination-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
const LOCK = '<svg class="destination-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function request(action, values = {}) {
  const result = await chrome.runtime.sendMessage({ type: `${QUICK_SAVE_PREFIX}${action}`, ...values });
  if (!result?.ok) throw new Error(result?.error || 'STORAGE_ERROR');
  return result;
}

function showError(error) {
  byId('saveError').textContent = QUICK_SAVE_ERRORS[error.message] || QUICK_SAVE_ERRORS.STORAGE_ERROR;
  byId('saveError').hidden = false;
}

function renderFolders() {
  const list = byId('folderList');
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.folderId : undefined;
  const query = byId('folderSearch').value.trim().toLocaleLowerCase();
  const destinations = [{ id: '', name: 'Saved for later' }, ...current.folders];
  const visible = destinations.filter(folder => folder.name.toLocaleLowerCase().includes(query));
  list.innerHTML = visible.map(folder => {
    const selected = selectedFolder === folder.id;
    const color = FOLDER_COLORS.includes(folder.color) ? folder.color : '';
    return `<button type="button" class="quick-save-destination" data-folder-id="${escape(folder.id)}" title="${escape(folder.name)}" aria-pressed="${selected}" ${busy ? 'aria-disabled="true"' : ''} aria-label="${escape(selected ? `Selected: ${folder.name}` : `Choose ${folder.name}`)}"><span class="quick-save-dot" aria-hidden="true"${color ? ` style="--folder-color:${color}"` : ''}></span><span class="destination-name">${escape(folder.name)}</span>${folder.locked ? LOCK : ''}${selected ? CHECK : ''}</button>`;
  }).join('');
  byId('folderEmpty').hidden = visible.length > 0;
  syncConfirmation();
  if (focusedId !== undefined) {
    const next = [...list.querySelectorAll('button')].find(button => button.dataset.folderId === focusedId);
    (next || byId('folderSearch')).focus({ preventScroll: true });
  }
}

function renderFeedback() {
  const canUndo = current.undo?.after?.url === current.page.url && current.supported;
  byId('saveFeedback').hidden = !canUndo;
  byId('undoSave').hidden = !canUndo;
}

function syncConfirmation() {
  const confirm = byId('confirmSave');
  confirm.hidden = selectedFolder === undefined || !current?.supported || !byId('folderForm').hidden;
  confirm.disabled = busy || selectedFolder === undefined || !current?.supported;
  const folder = selectedFolder === '' ? 'Saved for later' : current?.folders.find(item => item.id === selectedFolder)?.name;
  const label = folder ? `Save to ${folder}` : 'Save page';
  confirm.querySelector('span').textContent = label;
  confirm.title = label;
}

function render() {
  byId('saveControls').setAttribute('aria-busy', String(busy));
  byId('pageTitle').textContent = current.page.title || 'This page';
  byId('pageTitle').title = current.page.title || '';
  try { byId('pageHost').textContent = new URL(current.page.url).hostname; } catch { byId('pageHost').textContent = ''; }
  byId('saveControls').hidden = !current.supported;
  byId('saveHint').hidden = !current.supported;
  if (!current.supported) showError(new Error('UNSUPPORTED_PAGE'));
  const editingFolder = !byId('folderForm').hidden;
  byId('folderSearchWrap').hidden = editingFolder || !current.folders.length;
  byId('folderList').hidden = editingFolder;
  byId('newFolder').hidden = editingFolder;
  byId('savedLocation').hidden = !current.saved;
  if (current.saved) {
    const folder = current.folders.find(item => item.id === current.saved.folderId)?.name || 'Saved for later';
    byId('savedLocation').textContent = `${current.saved.completed ? 'Archived in' : 'Saved in'} ${folder}`;
  }
  renderFolders();
  renderFeedback();
}

async function refresh() {
  const revision = ++refreshRevision;
  const next = await request('state', current?.page.id === undefined ? {} : { tabId: current.page.id });
  if (revision !== refreshRevision) return;
  if (current?.page.url !== next.page.url) selectedFolder = undefined;
  current = next;
  if (selectedFolder && !current.folders.some(folder => folder.id === selectedFolder)) selectedFolder = undefined;
  render();
}

async function run(action, values = {}) {
  if (busy) return;
  busy = true;
  byId('saveError').hidden = true;
  byId('saveControls').setAttribute('aria-busy', 'true');
  const focused = document.activeElement;
  // Keep focus stable while preventing repeated pointer/keyboard submissions.
  document.querySelectorAll('button').forEach(button => button.setAttribute('aria-disabled', 'true'));
  try {
    await request(action, values);
    if (action === 'save' || action === 'create-folder') { window.close(); return; }
    if (action === 'create-folder') { byId('folderSearch').value = ''; cancelFolder(); }
    await refresh();
    if (!byId('saveFeedback').hidden) byId('saveFeedback').scrollIntoView({ block: 'nearest' });
    if (action === 'undo') byId('folderSearchWrap').hidden
      ? byId('folderList').querySelector('button')?.focus() : byId('folderSearch').focus();
  } catch (error) {
    if (error.message === 'PAGE_CHANGED' || error.message === 'FOLDER_GONE') await refresh().catch(() => {});
    showError(error);
    if (action === 'create-folder' && error.message === 'EMPTY_NAME') { byId('folderName').setAttribute('aria-invalid', 'true'); byId('folderName').focus(); }
    else if (focused?.isConnected) focused.focus();
  } finally {
    busy = false;
    byId('saveControls').setAttribute('aria-busy', 'false');
    document.querySelectorAll('button').forEach(button => button.removeAttribute('aria-disabled'));
    syncConfirmation();
    if (refreshPending) { refreshPending = false; await refresh().catch(showError); }
  }
}

function cancelFolder() {
  byId('folderForm').hidden = true;
  byId('newFolder').hidden = false;
  byId('folderName').value = '';
  byId('folderName').removeAttribute('aria-invalid');
  byId('saveError').hidden = true;
  if (current) render();
  byId('newFolder').focus();
}

byId('folderSearch').addEventListener('input', () => { if (current && !busy) renderFolders(); });
byId('folderSearch').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); byId('folderList').querySelector('button')?.focus(); }
  if (event.key === 'Escape' && event.currentTarget.value) { event.preventDefault(); event.stopPropagation(); event.currentTarget.value = ''; renderFolders(); }
});
byId('folderList').addEventListener('click', event => {
  const button = event.target.closest('[data-folder-id]');
  if (button && current && !busy) {
    selectedFolder = button.dataset.folderId;
    byId('saveError').hidden = true;
    renderFolders();
  }
});
byId('confirmSave').addEventListener('click', () => {
  if (current && selectedFolder !== undefined) void run('save', { tabId: current.page.id, expectedUrl: current.page.url, folderId: selectedFolder || null, notify:true });
});
byId('folderList').addEventListener('keydown', event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0 || busy) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
});
byId('newFolder').addEventListener('click', () => {
  if (busy) return;
  byId('folderForm').hidden = false; byId('newFolder').hidden = true;
  byId('folderList').hidden = true; byId('folderSearchWrap').hidden = true; byId('folderEmpty').hidden = true;
  byId('folderName').focus();
  syncConfirmation();
});
byId('cancelFolder').addEventListener('click', () => { if (!busy) cancelFolder(); });
byId('folderName').setAttribute('aria-describedby', 'saveError');
byId('folderName').addEventListener('input', () => byId('folderName').removeAttribute('aria-invalid'));
byId('folderForm').addEventListener('submit', event => {
  event.preventDefault();
  if (current) void run('create-folder', { name: byId('folderName').value, tabId: current.page.id, expectedUrl: current.page.url, notify:true });
});
byId('folderForm').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); cancelFolder(); }
});
byId('undoSave').addEventListener('click', () => { if (current?.undo) void run('undo', { undoId: current.undo.id }); });
byId('openDashboard').addEventListener('click', async () => {
  if (busy) return;
  try { await request('dashboard'); window.close(); } catch (error) { showError(error); }
});
byId('popupManageStorage').addEventListener('click', () => byId('openDashboard').click());
byId('retrySave').addEventListener('click', () => { void initialize(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') { clearTimeout(storageTimer); storageTimer = setTimeout(refreshStorageNotice, 200); }
  if (area !== 'local' || !current || !['deferred', 'folders', 'quickSaveUndo', 'quickSaveFeedback'].some(key => changes[key])) return;
  if (busy) refreshPending = true; else void refresh().catch(showError);
});

async function initialize() {
  void refreshStorageNotice();
  byId('retrySave').hidden = true;
  byId('saveError').hidden = true;
  try {
    await refresh();
    await request('acknowledge');
    (byId('folderSearchWrap').hidden ? byId('folderList').querySelector('button') : byId('folderSearch'))?.focus();
  } catch (error) {
    if (!current) { byId('pageTitle').textContent = 'Page unavailable'; byId('saveControls').hidden = true; }
    showError(error); byId('retrySave').hidden = false;
  }
  finally { byId('saveControls').setAttribute('aria-busy', 'false'); }
}
void initialize();
