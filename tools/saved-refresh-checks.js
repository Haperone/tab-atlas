import { savePage } from '../extension/lib/quick-save-core.js';

const results = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  for (let i = 0; i < 120; i++) { if (predicate()) return; await wait(25); }
  throw new Error('Saved-page refresh did not settle');
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
await waitFor(() => document.querySelector('[data-folder-id="f-read"] .deferred-item'));
let addedId;
await check('External quick save appears in the existing folder without a tab event', async () => {
  const { deferred, folders } = await chrome.storage.local.get(['deferred', 'folders']);
  const result = savePage(deferred, folders, { url: 'https://example.com/external', title: 'Saved from the website' }, 'f-read');
  addedId = result.record.id;
  await chrome.storage.local.set({ deferred: result.records });
  await waitFor(() => document.querySelector(`[data-deferred-id="${addedId}"]`));
  assert(document.querySelector(`[data-folder-id="f-read"] [data-deferred-id="${addedId}"]`), 'Save rendered outside the folder');
});
await check('External folder creation and move update both destination and inbox', async () => {
  const { deferred, folders } = await chrome.storage.local.get(['deferred', 'folders']);
  const created = { id: 'external-folder', name: 'Created from popup', collapsed: false };
  await chrome.storage.local.set({ folders: [...folders, created], deferred: deferred.map(item => item.id === addedId ? { ...item, folderId: created.id } : item) });
  await waitFor(() => document.querySelector(`[data-folder-id="external-folder"] [data-deferred-id="${addedId}"]`));
  assert(!document.querySelector(`[data-folder-id="f-read"] [data-deferred-id="${addedId}"]`), 'Old folder retained a duplicate');
});
await check('External changes wait while a field is focused, then refresh safely', async () => {
  const field = document.getElementById('globalSearch'); field.focus();
  const { deferred } = await chrome.storage.local.get('deferred');
  await chrome.storage.local.set({ deferred: deferred.map(item => item.id === addedId ? { ...item, folderId: null } : item) });
  await wait(450);
  assert(document.activeElement === field, 'Refresh stole field focus');
  assert(document.querySelector(`[data-folder-id="external-folder"] [data-deferred-id="${addedId}"]`), 'Refresh interrupted editing');
  field.blur();
  await waitFor(() => document.querySelector(`#deferredList [data-deferred-id="${addedId}"]`));
});
await check('External Undo removal disappears without a tab event', async () => {
  const { deferred } = await chrome.storage.local.get('deferred');
  await chrome.storage.local.set({ deferred: deferred.filter(item => item.id !== addedId) });
  await waitFor(() => !document.querySelector(`[data-deferred-id="${addedId}"]`));
});
const report = document.createElement('pre'); report.id = 'savedRefreshResults'; report.hidden = true;
report.textContent = JSON.stringify(results, null, 2); document.body.append(report);
