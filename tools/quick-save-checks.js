import { QUICK_SAVE_PREFIX } from '../extension/lib/quick-save-service.js';
import { THEME_OPTIONS } from '../extension/lib/view-config.js';

const results = [];
const samples = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  for (let i = 0; i < 80; i++) { if (predicate()) return; await wait(25); }
  throw new Error('Popup state did not settle');
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
const button = name => [...document.querySelectorAll('[data-folder-id]')].find(el => el.textContent.trim() === name);
const click = el => { assert(el, 'Missing control'); el.click(); };
const state = () => chrome.runtime.sendMessage({ type: `${QUICK_SAVE_PREFIX}state` });
const settle = () => waitFor(() => document.getElementById('saveControls').getAttribute('aria-busy') === 'false');
async function confirm(name) {
  click(button(name)); click(document.getElementById('confirmSave')); await settle();
  assert(document.documentElement.dataset.popupClosed === 'true', 'Successful confirmation did not close popup');
}

await waitFor(() => button('Reading') && document.getElementById('saveControls').getAttribute('aria-busy') === 'false');
await check('Save, repeat save, move and Undo keep a single record and stable focus', async () => {
  button('Reading').focus(); click(button('Reading'));
  assert(!(await state()).saved, 'Selection wrote data before confirmation');
  assert(button('Reading').getAttribute('aria-pressed') === 'true', 'Selection mark missing');
  await confirm('Reading');
  assert((await state()).saved.folderId === 'reading', 'Save did not reach folder');
  assert(document.activeElement.dataset.folderId === 'reading', 'Save lost focus');
  const id = (await state()).saved.id;
  await confirm('Reading'); assert((await state()).saved.id === id, 'Repeat duplicated page');
  await confirm('Work'); assert((await state()).saved.folderId === 'work', 'Move failed');
  assert(document.getElementById('undoSave').getBoundingClientRect().bottom <= innerHeight + 1, 'Undo clipped by popup height');
  click(document.getElementById('undoSave')); await settle(); assert((await state()).saved.folderId === 'reading', 'Undo did not restore folder');
  assert(document.getElementById('saveFeedback').hidden, 'Undo result remained visible');
  assert(document.documentElement.dataset.undoSoundCount === '1', 'Successful Undo did not signal');
});
await check('Filtering, empty recovery, arrow keys and folder creation', async () => {
  const input = document.getElementById('folderSearch');
  input.value = 'no such folder'; input.dispatchEvent(new Event('input', { bubbles: true }));
  assert(!document.getElementById('folderEmpty').hidden, 'No-results state missing');
  input.value = 'work'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert(document.activeElement.dataset.folderId === 'work', 'Arrow Down did not enter destinations');
  input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
  click(document.getElementById('newFolder')); assert(document.activeElement.id === 'folderName', 'New folder field not focused');
  document.getElementById('folderForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(); assert(!document.getElementById('saveError').hidden, 'Blank folder error missing');
  document.getElementById('folderName').value = 'Research';
  document.getElementById('folderForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(); assert((await state()).folders.find(f => f.name === 'Research')?.id === (await state()).saved.folderId, 'Create and save failed');
  assert(document.documentElement.dataset.popupClosed === 'true', 'Create-and-save did not close popup');
  click(document.getElementById('cancelFolder'));
});

function rgb(value) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
  return [...ctx.getImageData(0, 0, 1, 1).data];
}
const luminance = color => {
  const channels = color.slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const composite = (front, back) => { const alpha = front[3] / 255; return front.slice(0, 3).map((v, i) => v * alpha + back[i] * (1 - alpha)); };
const contrast = (a, b) => { const l = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l[0] + .05) / (l[1] + .05); };
await check('All themes preserve legible text, materials and popup bounds', async () => {
  const original = document.documentElement.dataset.theme;
  for (const theme of THEME_OPTIONS) {
    document.documentElement.dataset.theme = theme.id;
    const panel = document.body;
    assert(getComputedStyle(document.querySelector('.quick-save-panel')).boxShadow === 'none', `${theme.id}: inner card returned`);
    const surface = rgb(getComputedStyle(panel).backgroundColor);
    const bounds = panel.getBoundingClientRect();
    assert(bounds.right <= innerWidth + 1 && bounds.left >= 0, `${theme.id}: horizontal overflow`);
    for (const selector of ['.quick-save-brand', '#pageTitle', '#pageHost', '#saveHint', '#folderSearch', '#saveError', '.quick-save-destination[aria-pressed="true"]', '#confirmSave']) {
      const el = document.querySelector(selector);
      const text = rgb(getComputedStyle(el).color);
      const layers = [];
      for (let node = el; node && node !== panel; node = node.parentElement) layers.unshift(rgb(getComputedStyle(node).backgroundColor));
      const ratio = Math.min(...[[0, 0, 0], [255, 255, 255]].map(back => {
        let painted = composite(surface, back);
        for (const layer of layers) painted = composite(layer, painted);
        return contrast(text, painted);
      }));
      samples.push({ theme: theme.id, selector, contrast: Number(ratio.toFixed(2)) });
      assert(ratio >= 4.5, `${theme.id} ${selector}: ${ratio.toFixed(2)} contrast`);
    }
    if (['spaceblack', 'pacificblue', 'orchidbloom'].includes(theme.id)) assert(surface[3] === 255, `${theme.id}: solid material became translucent`);
    if (theme.id.endsWith('glass')) assert(surface[3] < 255 && getComputedStyle(panel).backdropFilter.includes('blur'), `${theme.id}: glass lost translucency/blur`);
    if (theme.id.endsWith('soft')) assert([...getComputedStyle(document.getElementById('confirmSave')).boxShadow.matchAll(/(?:rgba?|color)\(/g)].length >= 2, `${theme.id}: tactile shadows missing`);
  }
  document.documentElement.dataset.theme = original;
});
const report = document.createElement('pre'); report.id = 'quickSaveResults'; report.hidden = true;
report.textContent = JSON.stringify({ results, samples, width: innerWidth, contentWidth: document.documentElement.scrollWidth }, null, 2);
document.body.append(report);
