// Full product audit against production UI, using disposable Chrome mocks only.
import { THEME_OPTIONS } from '../extension/lib/view-config.js';
const root = document.documentElement;
const results = [], samples = [], failures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const until = async (predicate, message = 'UI did not settle') => {
  for (let i = 0; i < 140; i++) { if (predicate()) return; await wait(25); }
  throw new Error(message);
};
window.addEventListener('unhandledrejection', event => failures.push(String(event.reason)));
const click = selector => { const el = document.querySelector(selector); assert(el, `Missing ${selector}`); el.focus(); el.click(); };
const key = (name, options = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:name, bubbles:true, cancelable:true, ...options }));
const item = name => [...document.querySelectorAll('#contextMenu button')].find(el => el.textContent.trim() === name);
async function check(name, fn) {
  try { await fn(); results.push({ name, passed:true }); }
  catch (error) { results.push({ name, passed:false, error:error.message }); }
}
const canvas = document.createElement('canvas').getContext('2d');
function rgb(color) {
  canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
}
const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
const light = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
const ratio = (a, b) => (Math.max(light(a), light(b)) + .05) / (Math.min(light(a), light(b)) + .05);
function measure(selector, surfaceSelector, theme) {
  const el = document.querySelector(selector), surface = document.querySelector(surfaceSelector);
  if (!el || !surface) return;
  const style = getComputedStyle(el), material = getComputedStyle(surface);
  const layers = [];
  for (let node = el; node && node !== surface; node = node.parentElement) layers.unshift(rgb(getComputedStyle(node).backgroundColor));
  const bases = [[0,0,0],[255,255,255]].map(bg => over(rgb(material.backgroundColor), bg));
  const contrasts = bases.map(base => {
    let bg = base; for (const layer of layers) bg = over(layer, bg);
    return ratio(over(rgb(style.color), bg), bg);
  });
  const bounds = el.getBoundingClientRect();
  const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
  const threshold = size >= 24 || (size >= 18.5 && weight >= 700) ? 3 : 4.5;
  samples.push({ theme, selector, contrast:Number(Math.min(...contrasts).toFixed(2)), threshold,
    foreground:style.color, surface:material.backgroundColor, font:style.fontSize, lineHeight:style.lineHeight,
    radius:material.borderRadius, shadow:material.boxShadow, blur:material.backdropFilter,
    fits:bounds.left >= -1 && bounds.right <= innerWidth + 1 });
}
async function themes(surface, selectors) {
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after { transition:none!important; }';
  document.head.append(freeze);
  const original = root.dataset.theme;
  for (const theme of THEME_OPTIONS) {
    root.dataset.theme = theme.id; await wait(20);
    for (const selector of selectors) measure(selector, surface, theme.id);
  }
  root.dataset.theme = original;
  freeze.remove();
}
async function menu(trigger, label) {
  click(trigger); await until(() => item(label)); item(label).click();
}
async function run() {
  if (new URLSearchParams(location.search).has('load-failure')) {
    await until(() => document.getElementById('dashboardLoadState')?.getAttribute('role') === 'alert');
    assert(!document.getElementById('dashboardLoadState').hidden, 'Initial failure was hidden');
    click('[data-action="retry-dashboard"]');
    await until(() => document.querySelector('.chip-focus') && document.getElementById('dashboardLoadState').hidden);
    results.push({ name:'Initial read failure exposes Retry; retry loads the dashboard', passed:true });
  }
  await until(() => document.querySelector('.chip-focus') && document.getElementById('folderShareImportDialog').open);
  root.dataset.motion = 'reduced';
  await check('Incoming folder: every link can be reviewed; read errors preserve retry', async () => {
    const dialog = document.getElementById('folderShareImportDialog');
    assert(dialog.contains(document.activeElement) && document.activeElement.value === 'cancel', 'Import starts on a consequential action');
    const list = document.getElementById('folderShareImportList');
    list.querySelector('button').click();
    assert(list.querySelectorAll('.folder-share-row').length === 20, 'Some incoming links cannot be reviewed');
    const get = chrome.storage.local.get;
    chrome.storage.local.get = async () => { throw new Error('Audit: failed storage read'); };
    click('#folderShareImportConfirm');
    await until(() => !document.getElementById('folderShareImportConfirm').disabled);
    chrome.storage.local.get = get;
    assert(dialog.open && document.getElementById('folderShareImportStatus').getAttribute('role') === 'alert', 'Import failure closed the preview or left Add disabled');
    await themes('#folderShareImportDialog', ['#folderShareImportIntro','#folderShareImportStatus','.folder-share-row-title','.folder-share-row-url','#folderShareImportConfirm']);
    const before = await chrome.storage.local.get(['folders','deferred']);
    const liveCount = (await chrome.tabs.query({})).length;
    click('#folderShareImportConfirm');
    await until(() => !dialog.open && document.getElementById('toastText').textContent.startsWith('Folder added: 20 links'));
    const after = await chrome.storage.local.get(['folders','deferred']);
    assert(after.deferred.length === before.deferred.length + 20 && after.folders.length === before.folders.length + 1, 'Successful retry lost imported links');
    assert((await chrome.tabs.query({})).length === liveCount, 'Import opened web pages without a separate action');
    await chrome.storage.local.set(before);
    await wait(100);
  });
  await check('Sender: empty selection clears stale URL, warnings and actions', async () => {
    await menu('[data-action="folder-menu"][data-folder-id="f-read"]', 'Share folder…');
    const dialog = document.getElementById('folderShareDialog');
    await until(() => dialog.open && !dialog.querySelector('[data-share-action="copy"]').disabled);
    await themes('#folderShareDialog', ['#folderShareIntro','#folderShareStatus','.folder-share-disclosure','.folder-share-row-title','.folder-share-row-host','.folder-share-row-url','.folder-share-eyebrow','.folder-share-primary','#folderShareCount','#folderShareMeter']);
    click('[data-share-action="clear-all"]');
    assert(document.getElementById('folderShareUri').hidden && document.getElementById('folderShareUri').value === '', 'Old share link is still available');
    assert(document.getElementById('folderShareWarning').hidden && dialog.querySelector('[data-share-action="copy"]').disabled, 'Stale warning or copy action remained');
    document.getElementById('folderShareFilter').value = 'no such title'; document.getElementById('folderShareFilter').dispatchEvent(new Event('input', { bubbles:true }));
    assert(!document.getElementById('folderShareEmpty').hidden, 'Filtered empty state missing');
    dialog.close(); await wait(30);
  });
  await check('Privacy: background is inaccessible; Escape restores the trigger', async () => {
    click('#privacyToggle');
    const screen = document.getElementById('privacyScreen');
    const focus = document.activeElement;
    document.getElementById('globalSearch').focus();
    assert(document.activeElement === focus && screen.contains(focus), 'Hidden dashboard took focus');
    assert(document.getElementById('privacyToggle').getAttribute('aria-pressed') === 'true', 'Privacy state is not exposed');
    await themes('#privacyScreen', ['.privacy-hint','.privacy-date']);
    key('Escape');
    assert(document.activeElement.id === 'privacyToggle' && !document.querySelector('.container').inert, 'Privacy left background inert or lost focus');
  });
  await check('Tour: isolated focus, all steps, restored trigger and reduced motion', async () => {
    await menu('#customizeToggle', 'Restart tour');
    await until(() => document.getElementById('onboardingOverlay').contains(document.activeElement));
    const focus = document.activeElement; document.getElementById('globalSearch').focus();
    assert(document.activeElement === focus, 'Tour background took focus');
    await themes('#onboardingCard', ['#onboardingTitle','#onboardingCopy','#onboardingStepLabel','.onboarding-btn.primary']);
    for (let i = 0; i < 10; i++) {
      click('[data-action="onboarding-next"]'); await wait(25);
      const bounds = document.getElementById('onboardingCard').getBoundingClientRect();
      assert(bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1, `Tour step ${i + 2} is clipped (${bounds.left}, ${bounds.top}, ${bounds.right}, ${bounds.bottom})`);
    }
    click('[data-action="onboarding-next"]');
    assert(document.activeElement.id === 'customizeToggle' && !document.querySelector('.container').inert, 'Tour did not restore the opener');
  });
  if (document.getElementById('onboardingOverlay').style.display !== 'none') click('[data-action="onboarding-skip"]');
  await check('Sweep: isolated background, live menu, staged Undo and retryable tab-read failure', async () => {
    localStorage.setItem('focusSweepActionMode', 'review');
    click('.focus-sweep-launch'); await until(() => document.getElementById('focusSweepOverlay').contains(document.activeElement));
    const focus = document.activeElement; document.getElementById('globalSearch').focus();
    assert(document.activeElement === focus, 'Sweep background took focus');
    await themes('.focus-sweep-panel', ['#focusSweepScope','#focusSweepProgress','.focus-sweep-eyebrow','#focusSweepDestinationText']);
    await themes('#focusSweepCardCurrent', ['#focusSweepCardCurrent .focus-sweep-title','#focusSweepCardCurrent .focus-sweep-domain','#focusSweepCardCurrent .focus-sweep-url']);
    click('#focusSweepDestination'); await until(() => item('Save to Reading'), 'Destination menu did not open');
    assert(!document.getElementById('contextMenu').closest('[inert]'), 'Sweep destination menu became inert');
    item('Save to Reading').click();
    click('[data-action="focus-sweep-save"]'); await until(() => !document.getElementById('focusSweepUndo').disabled, 'Save did not stage');
    await until(() => !document.getElementById('focusSweepCardCurrent').classList.contains('is-committed'));
    click('#focusSweepUndo'); await until(() => document.getElementById('focusSweepUndo').disabled && !document.getElementById('focusSweepCardCurrent').classList.contains('is-returning'), 'Undo did not finish');
    click('[data-action="focus-sweep-save"]'); await until(() => !document.getElementById('focusSweepUndo').disabled, 'Second save did not stage');
    click('[data-action="focus-sweep-review"]');
    await themes('.focus-sweep-panel', ['#focusSweepSummaryTitle','#focusSweepSummaryCopy','.focus-sweep-summary-counts span','#focusSweepApply']);
    const query = chrome.tabs.query;
    chrome.tabs.query = async () => { throw new Error('Audit: failed tab query'); };
    click('#focusSweepApply'); await wait(80);
    chrome.tabs.query = query;
    assert(!document.getElementById('focusSweepApply').disabled && document.getElementById('toast').getAttribute('role') === 'alert', 'Read failure froze Apply or reported success');
    const liveBefore = (await chrome.tabs.query({})).length;
    const groupedBefore = (await chrome.tabs.query({groupId:77})).length;
    const savedBefore = (await chrome.storage.local.get('deferred')).deferred.length;
    click('#focusSweepApply');
    await until(() => document.getElementById('toastText').textContent.startsWith('Applied: 1 saved'));
    assert((await chrome.tabs.query({})).length === liveBefore - 1 && (await chrome.storage.local.get('deferred')).deferred.length === savedBefore + 1, 'Retry did not apply its staged save exactly once');
    click('#toast .toast-undo');
    await until(() => document.getElementById('focusSweepOverlay').style.display === 'none');
    assert((await chrome.tabs.query({})).length === liveBefore && (await chrome.storage.local.get('deferred')).deferred.length === savedBefore, 'Sweep Undo lost data or left its applied summary open');
    assert((await chrome.tabs.query({groupId:77})).length === groupedBefore, 'Sweep Undo lost native group membership');
    assert(!document.querySelector('.container').inert && !document.getElementById('toast').closest('[inert]'), 'Sweep cleanup orphaned recovery or background');
  });
  if (document.getElementById('focusSweepOverlay').style.display !== 'none') click('[data-action="focus-sweep-discard"]');
  await check('Search arrows continue through saved results in both directions', async () => {
    const input = document.getElementById('globalSearch'); input.focus(); key('ArrowDown');
    const results = [...document.querySelectorAll('#openTabsMissions .chip-focus, #deferredList .deferred-title, #foldersList .deferred-title')].filter(el => el.getClientRects().length);
    const saved = results.findIndex(el => el.matches('.deferred-title'));
    results[saved].focus(); key('ArrowDown');
    assert(document.activeElement === results[saved + 1], 'Saved search results lost ArrowDown navigation');
    key('ArrowUp'); assert(document.activeElement === results[saved], 'Saved search results lost ArrowUp navigation');
  });
  await check('Keyboard selection, saved-link context menu and folder ordering', async () => {
    const chip = document.querySelector('.chip-focus');
    chip.focus(); key(' ', { ctrlKey:true });
    assert(chip.closest('.page-chip').classList.contains('selected') && chip.getAttribute('aria-label').includes('Selected'), 'Keyboard selection is missing or unannounced');
    key(' ', { ctrlKey:true });
    assert(!chip.closest('.page-chip').classList.contains('selected'), 'Keyboard selection cannot be cleared');
    const link = document.querySelector('.deferred-title');
    link.focus(); key(' ', { metaKey:true });
    assert(link.closest('.deferred-item').classList.contains('selected'), 'Saved links cannot be selected with the keyboard');
    key('F10', { shiftKey:true }); await until(() => item('🗂  Reading'));
    assert(document.activeElement.closest('#contextMenu'), 'Context menu does not receive keyboard focus');
    key('Escape'); assert(document.activeElement === link, 'Saved menu loses its opener');
    key(' ', { metaKey:true });
    await menu('[data-action="folder-menu"][data-folder-id="f-read"]', 'Move down');
    await until(() => document.querySelector('#foldersList .folder')?.dataset.folderId === 'f-work');
    await menu('[data-action="folder-menu"][data-folder-id="f-read"]', 'Move up');
    await until(() => document.querySelector('#foldersList .folder')?.dataset.folderId === 'f-read');
    assert(document.activeElement.dataset.folderId === 'f-read', 'Folder reorder loses focus');
  });
  await check('Bulk save: failed atomic commit closes nothing, retains selection and retries with exact Undo', async () => {
    const chips = [...document.querySelectorAll('.chip-focus')].slice(0, 2);
    chips.forEach(el => el.dispatchEvent(new MouseEvent('click', { bubbles:true, ctrlKey:true })));
    const tabsBefore = await chrome.tabs.query({});
    const dataBefore = await chrome.storage.local.get(['folders','deferred']);
    const set = chrome.storage.local.set;
    let writes = 0;
    chrome.storage.local.set = async update => {
      if (update.deferred && ++writes === 1) throw new Error('Audit: storage quota');
      return set(update);
    };
    click('[data-action="select-save"]');
    await until(() => document.getElementById('toastText').textContent.includes('They remain open; try again'));
    chrome.storage.local.set = set;
    assert((await chrome.tabs.query({})).length === tabsBefore.length, 'A failed batch closed a tab');
    assert(JSON.stringify(await chrome.storage.local.get(['folders','deferred'])) === JSON.stringify(dataBefore), 'A failed batch partially changed collections');
    assert(document.getElementById('selectionCount').textContent.includes('2 selected'), 'Failed pages cannot be retried from selection');
    click('[data-action="select-save"]'); await until(() => document.getElementById('toastText').textContent.startsWith('Saved 2 tabs'));
    click('#toast .toast-undo'); await wait(100);
    assert((await chrome.tabs.query({})).length === tabsBefore.length, 'Undo duplicated a still-open tab or failed to restore the closed one');
    click('[data-action="select-clear"]');
  });
  await check('Partial close reports actual changes, keeps failed selection and restores only closed tabs', async () => {
    const chips = [...document.querySelectorAll('.chip-focus')].slice(0, 2);
    const before = await chrome.tabs.query({});
    const failingId = Number(chips[1].dataset.tabId);
    const remove = chrome.tabs.remove;
    chrome.tabs.remove = async id => { if ([].concat(id).includes(failingId)) throw new Error('Audit: close rejected'); return remove(id); };
    chips.forEach(el => { el.focus(); key(' ', { ctrlKey:true }); });
    click('[data-action="select-close"]');
    await until(() => document.getElementById('toastText').textContent.includes('remain open; try again'));
    chrome.tabs.remove = remove;
    assert((await chrome.tabs.query({})).length === before.length - 1 && document.getElementById('selectionCount').textContent.includes('1 selected'), 'Failed close was counted or deselected');
    click('#toast .toast-undo'); await wait(100);
    assert((await chrome.tabs.query({})).length === before.length, 'Partial-close Undo duplicated a still-open tab');
    click('[data-action="select-clear"]');
  });
  await check('A failed Undo stays retryable and never restores a successful step twice', async () => {
    const before = await chrome.tabs.query({});
    const chips = [...document.querySelectorAll('.chip-focus')].slice(0, 2);
    chips.forEach(el => { el.focus(); key(' ', { ctrlKey:true }); });
    click('[data-action="select-close"]');
    await until(() => document.querySelector('.toast-undo') && document.getElementById('toastText').textContent.startsWith('Closed 2 tabs'));
    const create = chrome.tabs.create; let calls = 0;
    chrome.tabs.create = async options => { if (++calls === 2) throw new Error('Audit: restore rejected'); return create(options); };
    click('#toast .toast-undo');
    await until(() => document.getElementById('toastText').textContent.includes('Try Undo again'));
    chrome.tabs.create = create;
    assert((await chrome.tabs.query({})).length === before.length - 1, 'The failed restore was reported as successful');
    click('#toast .toast-undo'); await wait(100);
    assert((await chrome.tabs.query({})).length === before.length, 'Retry restored a successful step twice');
  });
  await check('Native group conversion commits folder and links together; failure closes nothing and retry has exact Undo', async () => {
    await themes('.group-control', ['.group-chip-name','.group-chip-count','.group-control-btn']);
    const before = await chrome.tabs.query({});
    const members = await chrome.tabs.query({groupId:77});
    const dataBefore = await chrome.storage.local.get(['folders','deferred']);
    const set = chrome.storage.local.set; let writes = 0;
    chrome.storage.local.set = async update => { if (update.deferred && ++writes === 1) throw new Error('Audit: quota'); return set(update); };
    click('[data-action="group-to-folder"]');
    await until(() => document.getElementById('toastText').textContent.includes('Its tabs remain open; try again'));
    chrome.storage.local.set = set;
    assert((await chrome.tabs.query({})).length === before.length, 'Failed conversion closed a member');
    assert(JSON.stringify(await chrome.storage.local.get(['folders','deferred'])) === JSON.stringify(dataBefore), 'Failed conversion left an empty folder or partial links');
    click('[data-action="group-to-folder"]'); await until(() => document.getElementById('toastText').textContent.includes(`Saved ${members.length} of ${members.length} tabs`));
    click('#toast .toast-undo'); await wait(100);
    assert((await chrome.tabs.query({})).length === before.length, 'Group conversion Undo duplicated live members');
  });
  await check('Partial folder-to-group opening retains every saved link', async () => {
    const before = await chrome.storage.local.get(['folders','deferred']);
    const create = chrome.tabs.create; let calls = 0;
    chrome.tabs.create = async options => { if (++calls === 2) throw new Error('Audit: create rejected'); return create(options); };
    await menu('[data-action="folder-menu"][data-folder-id="f-read"]', 'Open as tab group');
    await until(() => document.getElementById('toastText').textContent.includes('The saved folder is kept'));
    chrome.tabs.create = create;
    const after = await chrome.storage.local.get(['folders','deferred']);
    assert(after.folders.some(folder=>folder.id==='f-read') && after.deferred.filter(item=>item.folderId==='f-read').length === before.deferred.filter(item=>item.folderId==='f-read').length, 'Partial opening discarded saved data');
  });
  await check('No unnamed visible controls, invalid tab order or hidden focus after recovery', async () => {
    const unnamed = [...document.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => el.getClientRects().length && !el.closest('[inert]') && !el.disabled)
      .filter(el => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.textContent.trim() && !el.labels?.length && !el.title);
    assert(!unnamed.length, `Unnamed controls: ${unnamed.map(el => el.id || el.className).join(', ')}`);
    assert(!document.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])'), 'Positive tab index');
    assert(root.scrollWidth <= innerWidth + 1, 'Dashboard overflows viewport');
    assert(!failures.length, `Unhandled failure: ${failures.join('; ')}`);
  });
  const failedPairs = samples.filter(sample => sample.contrast < sample.threshold || !sample.fits);
  results.push({ name:'Every sampled theme/text pair passes contrast and width', passed:!failedPairs.length, failures:failedPairs });
  const report = document.createElement('pre'); report.id = 'interfaceAuditResults'; report.hidden = true;
  report.textContent = JSON.stringify({ viewport:{ width:innerWidth, height:innerHeight }, results, samples, failures });
  document.body.append(report);
}
void run().catch(error => {
  const report = document.createElement('pre'); report.id = 'interfaceAuditResults'; report.hidden = true;
  report.textContent = JSON.stringify({ results, fatal:error.message, samples }); document.body.append(report);
});
