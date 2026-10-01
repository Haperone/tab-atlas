// Browser smoke checks against the real dashboard and the local harness's mocks.
// Run at /tools/screenshot-harness.html?checks=1 with a desktop viewport >= 1240px.
const results = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const click = selector => document.querySelector(selector).click();
const setViewPanel = open => {
  if ((document.getElementById('tabViewToggle').getAttribute('aria-expanded') === 'true') !== open) click('#tabViewToggle');
};
const select = (selector, value) => {
  if (selector === '#tabWindowScope' || selector === '#tabSort') setViewPanel(true);
  const el = document.querySelector(selector); el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const search = value => {
  const el = document.getElementById('globalSearch'); el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const waitFor = async condition => {
  for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await sleep(20); }
  throw new Error('Timed out waiting for dashboard');
};
const check = async (name, fn) => { await fn(); results.push(`PASS ${name}`); };

async function run() {
  await waitFor(() => document.querySelectorAll('#foldersList .folder').length === 22);
  await check('view drawer is hidden by default, opens from the edge and dismisses with Escape', async () => {
    const drawer = document.getElementById('tabViewDrawer');
    const toggle = document.getElementById('tabViewToggle');
    assert(drawer.inert && drawer.getAttribute('aria-hidden') === 'true', 'Secondary controls must start hidden');
    assert(!document.querySelector('#openTabsSection .dashboard-toolbar'), 'Toolbar still occupies the column');
    setViewPanel(true);
    await waitFor(() => document.activeElement.matches('[data-tab-filter]'));
    assert(!drawer.inert && drawer.getAttribute('aria-hidden') === 'false', 'Drawer did not open');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(drawer.inert && document.activeElement === toggle, 'Escape did not dismiss and restore focus');
    assert(document.documentElement.dataset.privacy !== 'on', 'Escape unexpectedly enabled privacy');
    setViewPanel(true);
    document.getElementById('globalSearch').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    assert(drawer.inert, 'Outside pointer did not dismiss drawer');
  });
  await check('window and status filters', async () => {
    setViewPanel(true);
    click('[data-tab-filter="duplicates"]');
    assert(document.querySelector('[data-domain-id="domain-github-com"] .mission-page-count').textContent === '3', 'All windows must include all three copies');
    select('#tabWindowScope', 'current');
    assert(document.querySelector('[data-domain-id="domain-github-com"] .mission-page-count').textContent === '2', 'Current window must include only its two copies');
    click('[data-tab-filter="pinned"]');
    assert(document.querySelectorAll('.chip-focus').length === 1, 'Pinned filter');
    click('[data-tab-filter="audio"]');
    assert(document.querySelectorAll('.chip-focus').length === 1, 'Audio filter');
    click('[data-tab-filter="all"]'); select('#tabWindowScope', 'all');
    setViewPanel(false);
  });
  await check('sorting retains nodes and drawer dismissal restores keyboard focus', async () => {
    const button = document.querySelector('[data-domain-id="domain-github-com"] .chip-focus');
    select('#tabSort', 'name');
    assert(button.isConnected, 'Sorting detached an unchanged tab');
    select('#tabSort', 'count');
    setViewPanel(false);
    assert(document.activeElement.id === 'tabViewToggle', 'Closing the drawer lost keyboard focus');
  });
  await check('search phrases, exclusions and keyboard navigation', async () => {
    search('"building a chrome" -domain:github');
    assert(document.querySelectorAll('.chip-focus').length === 1, 'Phrase and exclusion search');
    const input = document.getElementById('globalSearch');
    input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert(document.activeElement.matches('.chip-focus'), 'ArrowDown did not enter results');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    assert(document.activeElement === input, 'Ctrl K did not focus search');
    search(''); await waitFor(() => document.querySelectorAll('#deferredList .deferred-item').length === 62);
  });
  await check('compact preference persists', async () => {
    setViewPanel(true);
    const before = document.documentElement.dataset.density;
    click('#densityToggle');
    assert(document.documentElement.dataset.density !== before, 'Density did not change');
    const saved = JSON.parse(localStorage.getItem('tabout-dashboard-preferences'));
    assert(saved.density === document.documentElement.dataset.density, 'Density was not saved');
    click('#densityToggle');
    setViewPanel(false);
  });
  await check('empty search offers recovery and restores keyboard focus', async () => {
    search('url:there-are-no-matching-tabs');
    await waitFor(() => !document.getElementById('tabViewEmpty').hidden);
    click('#resetTabView');
    await waitFor(() => document.getElementById('tabViewEmpty').hidden);
    assert(document.activeElement.id === 'globalSearch', 'Reset left focus on the removed empty-state action');
    assert(document.getElementById('globalSearch').value === '', 'Reset did not clear the unmatched query');
  });
  await check('Sweep respects the shown view', async () => {
    search('"building a chrome"');
    click('[data-action="start-focus-sweep-all"]');
    await waitFor(() => document.getElementById('focusSweepOverlay').style.display !== 'none');
    assert(document.getElementById('focusSweepScope').textContent === 'Shown tabs sweep', 'Sweep ignored the filtered view');
    assert(document.getElementById('focusSweepProgress').textContent.includes('/ 1'), 'Sweep included hidden tabs');
    click('[data-action="focus-sweep-exit"]');
    search(''); await waitFor(() => document.querySelectorAll('#deferredList .deferred-item').length === 62);
  });
  await check('sound and motion can be changed and restored', async () => {
    for (const [label, key] of [['Sound', 'sound'], ['Animations', 'motion']]) {
      const before = JSON.parse(localStorage.getItem('tabout-dashboard-preferences') || '{}')[key] !== false;
      click('[data-action="customize-menu"]');
      [...document.querySelectorAll('.context-menu-item')].find(el => el.textContent.startsWith(label)).click();
      assert(JSON.parse(localStorage.getItem('tabout-dashboard-preferences'))[key] === !before, `${label} preference did not change`);
      click('[data-action="customize-menu"]');
      [...document.querySelectorAll('.context-menu-item')].find(el => el.textContent.startsWith(label)).click();
    }
  });
  await check('rapid theme changes commit materials together and restore transitions', async () => {
    const original = document.documentElement.dataset.theme;
    click('#themeModeToggle');
    assert(document.documentElement.classList.contains('theme-switching'), 'Theme colors can transition independently');
    click('#themeModeToggle');
    assert(document.documentElement.dataset.theme === original, 'Rapid theme reversal lost the original theme');
    await waitFor(() => !document.documentElement.classList.contains('theme-switching'));
    assert(getComputedStyle(document.getElementById('globalSearch')).transitionDuration !== '0s', 'Hover transitions stayed disabled');
  });
  await check('stationary drag scrolls columns, wheel works, drop moves link to top folder', async () => {
    const inbox = document.getElementById('deferredScroll');
    const folders = document.getElementById('foldersScroll');
    document.getElementById('dashboardColumns').scrollIntoView({ block: 'start' });
    assert(inbox.scrollHeight > inbox.clientHeight && folders.scrollHeight > folders.clientHeight, 'Use a desktop viewport >=1240px');
    inbox.scrollTop = inbox.scrollHeight;
    folders.scrollTop = Math.min(350, folders.scrollHeight - folders.clientHeight);
    const source = document.querySelector('[data-deferred-id="stress-inbox-59"]');
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const rect = folders.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = Math.max(1, rect.top) + 2;
    const target = document.elementFromPoint(x, y);
    const initial = folders.scrollTop;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }));
    await sleep(160);
    assert(folders.scrollTop < initial, 'Holding still at the edge did not scroll');
    const beforeWheel = folders.scrollTop;
    folders.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
    assert(folders.scrollTop < beforeWheel, 'Wheel did not scroll during drag');
    await waitFor(() => folders.scrollTop <= 1);
    const firstFolder = document.querySelector('[data-folder-id="f-read"]');
    firstFolder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await waitFor(() => document.querySelector('[data-folder-id="f-read"] [data-deferred-id="stress-inbox-59"]'));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
    const stopped = folders.scrollTop; await sleep(80);
    assert(folders.scrollTop === stopped, 'Scroll continued after drop');
    const stored = await chrome.storage.local.get('deferred');
    assert(stored.deferred.find(item => item.id === 'stress-inbox-59').folderId === 'f-read', 'Drop did not persist the destination');
  });
  await check('closing a searched group leaves hidden same-domain tabs open; Undo restores it', async () => {
    search('url:issues');
    click('[data-action="close-domain-tabs"]');
    await waitFor(() => document.querySelector('.toast-undo'));
    const tabs = await chrome.tabs.query({});
    assert(!tabs.some(tab => tab.id === 2), 'Shown tab remained open');
    assert(tabs.some(tab => tab.id === 1) && tabs.some(tab => tab.id === 16), 'Hidden same-domain tabs were closed');
    click('.toast-undo');
    await waitFor(() => document.querySelector('[data-domain-id="domain-github-com"] .chip-focus'));
    search('');
  });
  await check('duplicate cleanup has Undo and preserves the copy in a different window', async () => {
    select('#tabWindowScope', 'current');
    setViewPanel(false);
    const before = await chrome.tabs.query({});
    click('[data-action="dedup-keep-one"]');
    await waitFor(() => document.getElementById('toastText').textContent.startsWith('Closed 1 duplicate'));
    const after = await chrome.tabs.query({});
    assert(after.length === before.length - 1 && after.some(tab => tab.id === 16), 'Duplicate cleanup crossed the selected window');
    click('.toast-undo');
    await waitFor(() => document.querySelector('[data-action="dedup-keep-one"]'));
    assert((await chrome.tabs.query({})).length === before.length, 'Undo did not restore the duplicate');
    select('#tabWindowScope', 'all');
    setViewPanel(false);
  });
}

try { await run(); }
catch (error) { results.push(`FAIL ${error.message}`); console.error('[dashboard smoke]', error); }
const report = document.createElement('pre');
report.id = 'dashboardSmokeResults';
report.textContent = results.join('\n');
report.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:20000;max-height:40vh;overflow:auto;background:#14251c;color:#c2f6d1;padding:16px;border:1px solid #6bb88e;border-radius:12px;font:12px/1.6 monospace;white-space:pre-wrap;';
document.body.appendChild(report);
