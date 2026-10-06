import { THEME_OPTIONS } from '../extension/lib/view-config.js';
import { atlasRecordJSON, captureAtlasHistoryState, planAtlasRestore } from '../extension/lib/atlas-history-model.js';

// Real Atlas controller/service/IndexedDB with disposable Chrome/local-storage fixtures.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
const equal = (a, b, message) => assert(atlasRecordJSON(a) === atlasRecordJSON(b), message);
const find = selector => document.querySelector(selector);
const click = selector => { const element = find(selector); assert(element && !element.disabled, `Unavailable ${selector}`); element.focus(); element.click(); };
async function until(predicate) { for (let i = 0; i < 500; i++) { if (predicate()) return; await wait(20); } throw new Error('UI condition timed out'); }
const idle = () => until(() => !find('.tm-confirm') && find('.tm-loading').hidden && !find('[data-tm][data-busy]') && find('#timeMachineDialog').getAttribute('aria-busy') !== 'true' && find('.tm-columns').getAttribute('aria-busy') !== 'true' && find('.tm-navigator').getAttribute('aria-busy') !== 'true' && !find('.tm-navigator').dataset.choosing);
const local = () => chrome.storage.local.get(['folders', 'deferred', 'workspaceSnapshots']);
const history = async (action, extra = {}) => {
  const response = await chrome.runtime.sendMessage({ type: `tab-atlas/time-machine/${action}`, ...extra });
  assert(response.ok, response.error); return response.data;
};
const results = [], samples = [], output = document.createElement('pre'); output.id = 'atlasHistoryUIResults'; output.hidden = true; document.body.append(output);
const write = running => { output.textContent = JSON.stringify({ running, passed: results.every(row => row.passed), results, samples,
  environment: { width: innerWidth, height: innerHeight, userAgent: navigator.userAgent },
  note: 'Native IndexedDB with synthetic Chrome/local storage in IAB; not installed-extension lifecycle or production-worker performance evidence.' }, null, 2); };
async function check(name, run) { try { await run(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } write(true); }
const confirmation = () => find('.tm-confirm');
async function menuAction(action) { if (find(`[data-tm="${action}"]`).closest('.tm-menu')) click('.tm-menu summary'); click(`[data-tm="${action}"]`); }
async function reloadLatestHistory() {
  // Seed writes are fixture setup. Reopen through the UI to await fresh status,
  // rather than racing its debounced external-change notification with a sleep.
  await idle(); click('[data-tm="close"]');
  await until(() => !find('#timeMachineDialog').open && !find('[data-tm][data-busy]'));
  click('#customizeToggle');
  await until(() => [...document.querySelectorAll('#contextMenu button')].some(button => button.textContent === 'Time machine…'));
  [...document.querySelectorAll('#contextMenu button')].find(button => button.textContent === 'Time machine…').click();
  await idle();
}
async function pastDesign() {
  const range = find('#tmRange');
  if (range.disabled) { click('[data-tm="latest"]'); await idle(); }
  range.value = 0; range.dispatchEvent(new Event('input')); range.dispatchEvent(new Event('change')); await idle();
  click('[data-tm="later"]'); await idle();
  assert([...document.querySelectorAll('.tm-card h3')].some(heading => heading.textContent === 'Past design'), 'Wrong source snapshot');
}
const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
// Read computed CSS channels directly: canvas readback can be altered by browser
// privacy settings and accumulate spurious opacity when compositing ancestors.
const color = value => {
  const rgb = /^rgba?\((.*)\)$/i.exec(value), srgb = /^color\(srgb\s+(.*)\)$/i.exec(value);
  assert(rgb || srgb, `Unsupported computed color: ${value}`);
  const parts = (rgb || srgb)[1].trim().split(/[\s,/]+/);
  assert(parts.length === 3 || parts.length === 4, `Invalid computed color: ${value}`);
  const channels = parts.map((part, index) => {
    const percent = part.endsWith('%'), number = Number(percent ? part.slice(0, -1) : part);
    assert(Number.isFinite(number), `Invalid color channel: ${value}`);
    const scale = index === 3 ? (percent ? .01 : 1) : percent ? 2.55 : srgb ? 255 : 1;
    return Math.max(0, Math.min(index === 3 ? 1 : 255, number * scale));
  });
  if (channels.length === 3) channels.push(1);
  return channels;
};
const over = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
const luminance = c => c.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
async function inspectStateThemes(state) {
  const root = document.documentElement, theme = root.dataset.theme, switching = root.classList.contains('theme-switching');
  // The production theme controller suppresses transitions during a material swap.
  // Direct fixture palette changes must also measure settled colors, not interpolation.
  root.classList.add('theme-switching');
  try {
    for (const option of THEME_OPTIONS) {
      root.dataset.theme = option.id; await wait(20);
      const surface = confirmation() || find('#timeMachineDialog');
      for (const element of surface.querySelectorAll('h3,h4,p,legend,strong,small,time,button,a,summary,select,dt,dd,.tm-review-links li')) {
        if (!visible(element) || element.disabled || !element.textContent.trim()) continue;
        let background = [255, 255, 255], ancestors = [];
        for (let parent = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
        for (const parent of ancestors) background = over(color(getComputedStyle(parent).backgroundColor), background);
        const foreground = getComputedStyle(element).color, ratio = contrast(over(color(foreground), background), background);
        samples.push({ state, theme: option.id, selector: element.className || element.tagName.toLowerCase(), contrast: +ratio.toFixed(2), foreground, background,
          ...(ratio < 4.5 ? { actualTheme: root.dataset.theme, switching: root.classList.contains('theme-switching'), ancestors: ancestors.map(parent => ({ tag: parent.tagName, className: parent.className, background: getComputedStyle(parent).backgroundColor })) } : {}) });
        assert(ratio >= 4.5, `${state} ${option.id} ${element.tagName} contrast ${ratio.toFixed(2)}`);
      }
      for (const marker of surface.querySelectorAll('.tm-moment')) {
        if (!visible(marker) || marker.disabled) continue;
        let background = [255, 255, 255], ancestors = [];
        for (let parent = marker; parent; parent = parent.parentElement) ancestors.unshift(parent);
        for (const parent of ancestors) background = over(color(getComputedStyle(parent).backgroundColor), background);
        const foreground = getComputedStyle(marker, '::before').backgroundColor, ratio = contrast(over(color(foreground), background), background);
        samples.push({ state, theme: option.id, selector: 'tm-moment::before', contrast: +ratio.toFixed(2), foreground, background });
        assert(ratio >= 3, `${state} ${option.id} timeline marker contrast ${ratio.toFixed(2)}`);
        assert(!marker.textContent && getComputedStyle(marker).backgroundColor === 'rgba(0, 0, 0, 0)', 'Timeline markers regained numeric tiles');
      }
      if (['papersoft', 'lattesoft'].includes(option.id)) {
        for (const axis of surface.querySelectorAll('.tm-ruler,.tm-axis-label')) {
          if (!visible(axis)) continue;
          let background = [255, 255, 255], ancestors = [];
          for (let parent = axis; parent; parent = parent.parentElement) ancestors.unshift(parent);
          for (const parent of ancestors) background = over(color(getComputedStyle(parent).backgroundColor), background);
          const css = getComputedStyle(axis, '::after'), ratio = contrast(over(color(css.backgroundColor), background), background);
          samples.push({ state, theme: option.id, selector: `${axis.className}::after`, contrast: +ratio.toFixed(2), foreground: css.backgroundColor, background, shadow: css.boxShadow });
          // The rail is a decorative guide; labeled calendar ticks and actual
          // snapshot targets retain their separate readable/3:1 contrast checks.
          assert(axis.classList.contains('tm-ruler') ? ratio > 1 : ratio >= 3, `${state} ${option.id} timeline guide/tick contrast ${ratio.toFixed(2)}`);
          assert(parseFloat(css.height) > 0 && parseFloat(css.width) > 0, 'Timeline axis or calendar tick has no visible area');
        }
      }
      assert(surface.scrollWidth <= surface.clientWidth + 1, `${state} ${option.id} horizontal overflow`);
      for (const control of surface.querySelectorAll('button,a[href],input,select,summary')) {
        if (!visible(control)) continue;
        const rect = control.getBoundingClientRect(); assert(rect.left >= -1 && rect.right <= innerWidth + 1, `${state} ${option.id} clips ${control.tagName}`);
      }
    }
  } finally { root.dataset.theme = theme; void root.offsetHeight; if (!switching) root.classList.remove('theme-switching'); }
}
let original, moment, tabsBefore;
async function run() {
  await until(() => find('.folder-toggle')); original = await local(); tabsBefore = await chrome.tabs.query({});
  click('#customizeToggle'); await until(() => [...document.querySelectorAll('#contextMenu button')].some(button => button.textContent === 'Time machine…'));
  [...document.querySelectorAll('#contextMenu button')].find(button => button.textContent === 'Time machine…').click(); await idle();
  const fault = new URLSearchParams(location.search).get('history-fault');
  if (fault) {
    await check(`${fault}: history explains recovery, disables unsafe restoration and leaves collections unchanged`, async () => {
      assert(!find('.tm-error').hidden && find('.tm-error').getAttribute('role') === 'alert', 'Fault is not announced');
      const message = find('.tm-error').textContent;
      assert(fault === 'quota' ? message.includes('Resume recording') : fault === 'corrupt' ? message.includes('clear history') : fault === 'blocked' ? message.includes('Close other Atlas pages') : message.includes('Update Tab Atlas'), 'Fault has no specific recovery');
      if (fault !== 'quota') assert(find('[data-tm="restore-all"]').disabled, 'Broken history permits restoration');
      equal(await local(), original, 'Fault changed current collections'); await inspectStateThemes(fault);
    });
    if (fault === 'corrupt') await check('Corrupt history can be cleared only after explicit confirmation; Cancel preserves corruption and current collections', async () => {
      await menuAction('storage'); await until(() => confirmation()?.open);
      assert(document.activeElement.textContent === 'Cancel' && confirmation().textContent.includes('including Undo'), 'Clear is not safely confirmed');
      [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle();
      assert(!find('.tm-error').hidden, 'Cancellation silently repaired the history'); equal(await local(), original, 'Cancel changed current collections');
      await menuAction('storage'); await until(() => confirmation()?.open); click('.tm-confirm .tm-danger'); await idle();
      assert(find('.tm-error').hidden && !find('.tm-preview').hidden && (await history('status')).enabled, 'Explicit Clear did not recover automatic history');
      equal(await local(), original, 'History repair changed saved links');
    });
    if (fault === 'quota') await check('Stopped recording resumes only on request and preserves current links and historical preview', async () => {
      const date = find('.tm-date').dateTime; await menuAction('record'); await idle();
      assert(find('.tm-error').hidden && find('.tm-recording-inline').textContent === 'Recording', 'Resume did not recover recording');
      assert(find('.tm-date').dateTime === date, 'Resume reset the inspected moment'); equal(await local(), original, 'Resume changed collections');
    });
    if (fault === 'newer-schema') await check('Retry leaves future history data intact instead of wiping or downgrading it', async () => {
      click('[data-tm="retry"]'); await idle(); assert(!find('.tm-error').hidden, 'Newer schema was silently accepted');
      const sentinel = await new Promise((resolve, reject) => {
        const request = indexedDB.open(document.body.dataset.atlasHistoryFixtureDatabase);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { const connection = request.result, tx = connection.transaction('future-fixture'), read = tx.objectStore('future-fixture').get('sentinel');
          read.onsuccess = () => resolve({ version: connection.version, data: read.result }); tx.oncomplete = () => connection.close(); tx.onabort = () => { connection.close(); reject(tx.error); }; };
      });
      equal(sentinel, { version: 3, data: 'Preserve future data' }, 'Retry destroyed future history'); equal(await local(), original, 'Retry changed saved links');
    });
    if (fault === 'blocked') await check('Retry after the controlled storage block is released recovers history without deleting data', async () => {
      document.dispatchEvent(new Event('atlas-fixture-unblock')); click('[data-tm="retry"]'); await idle();
      assert(find('.tm-error').hidden && !find('.tm-preview').hidden, 'Retry did not recover released storage');
      equal(await local(), original, 'Blocked recovery changed collections'); const status = await history('status');
      assert(status.oldest < status.latest && status.latestSeq >= 3, 'Blocked recovery silently replaced the historical journal');
    });
    write(false); return;
  }
  if (new URLSearchParams(location.search).has('history-first-run')) {
    await check('First run automatically records exactly the current baseline without an activation screen', async () => {
      const status = await history('status'), latest = await history('seek', { time: status.latest });
      assert(status.enabled && status.oldest === status.latest && status.latestSeq === 1, 'Startup did not create one automatic baseline');
      equal(latest.state.folders, original.folders, 'Baseline changed current folder order');
      equal(latest.state.deferred, captureAtlasHistoryState(original).deferred, 'Baseline lost active links or retained archive');
      assert(!find('[data-tm="enable"]') && !find('.tm-preview').hidden && find('.tm-recording-inline').textContent === 'Recording', 'First run requires activation');
      assert(find('.tm-restore-dock').hidden, 'Current baseline offers a redundant restore');
      equal(await local(), original, 'Startup changed collections'); await inspectStateThemes('automatic-first-baseline');
    });
    await check('Explicit off survives reopening; new edits remain saved without creating history', async () => {
      await menuAction('disable'); await idle(); await reloadLatestHistory();
      assert(!(await history('status')).enabled && find('.tm-recording-inline').textContent === 'Recording off', 'Reopening ignored explicit off');
      await chrome.storage.local.set({ folders: original.folders.map((folder, index) => index ? folder : { ...folder, name: 'Edited while off' }) });
      await history('status'); await reloadLatestHistory();
      assert((await history('status')).latestSeq === 1 && (await local()).folders[0].name === 'Edited while off', 'Off recorded an edit or blocked saving');
      assert(!find('[data-tm="restore-all"]').hidden && find('.tm-restore-dock').hidden, 'Latest recorded moment cannot quietly restore edits made while recording is off');
      await inspectStateThemes('explicit-off');
    });
    await check('Recording can be resumed from options without adding duplicate startup points', async () => {
      await menuAction('record'); await idle(); await reloadLatestHistory();
      const status = await history('status');
      assert(status.enabled && status.latestSeq === 2 && find('.tm-recording-inline').textContent === 'Recording', 'Resume did not preserve the pause boundary');
      assert((await history('seek', { time: status.latest })).state.folders[0].name === 'Edited while off', 'Resume did not capture current collections');
      await history('enable'); assert((await history('status')).latestSeq === 2, 'Repeated enable duplicated a baseline');
    });
    await check('An explicitly cleared and disabled history has a readable off state without an activation screen', async () => {
      await menuAction('disable'); await idle(); await history('clear'); await reloadLatestHistory();
      assert(!find('.tm-empty-history').hidden && find('.tm-empty-history').textContent.includes('options menu')
        && find('.tm-preview').hidden && !find('[data-tm="enable"]'), 'Empty disabled history is blank or requires first-run activation');
      await inspectStateThemes('explicit-off-empty');
      await menuAction('record'); await idle(); await reloadLatestHistory();
      assert(find('.tm-empty-history').hidden && !find('.tm-preview').hidden && (await history('status')).latestSeq === 1, 'Resume did not leave the off state');
    });
    write(false); return;
  }
  await check('Current snapshot has no restore dock; a different older snapshot exposes restoration', async () => {
    assert(find('.tm-restore-dock').hidden, 'Current snapshot offers a redundant restore');
    click('[data-tm="earlier"]'); await idle();
    assert(!find('[data-tm="restore-all"]').hidden && find('.tm-restore-dock').hidden, 'Older changed snapshot has no header action or shows an unsolicited dock');
    click('[data-tm="latest"]'); await idle();
    assert(find('.tm-restore-dock').hidden && find('[data-tm="restore-all"]').hidden, 'Returning to current snapshot leaves restoration visible');
    equal(await local(), original, 'Timeline navigation changed Atlas');
  });
  await check('Historical preview is read-only and modal; timeline has normalized bounds and dated accessible value', async () => {
    click('[data-tm="earlier"]'); await idle();
    moment = find('.tm-date').dateTime;
    assert([...document.querySelectorAll('.tm-card h3')].some(heading => heading.textContent === 'Past design'), 'Preview contains browser-tab groups');
    assert(find('#tmRange').min === '0' && find('#tmRange').max === '1000' && find('#tmRange').getAttribute('aria-valuetext'), 'Range lacks usable bounds/date');
    assert(find('#timeMachineDialog').matches(':modal'), 'History is not modal');
    equal(await local(), original, 'Preview changed Atlas'); equal(await chrome.tabs.query({}), tabsBefore, 'Preview changed browser tabs');
  });
  await check('Restore remains visible at the bottom during scrolling; selection states, exact scope and keyboard reset stay clear across themes', async () => {
    const before = await local(), scroll = find('.tm-scroll'), dock = find('.tm-restore-dock');
    const full = find('[data-tm="restore-all"]');
    assert(dock.hidden && !full.hidden && full.closest('.tm-header') && !full.classList.contains('tm-primary'), 'Full restoration is not a quiet header action');
    assert(!find('.tm-search-row button'), 'Restore still shares the search row');
    const folderCheck = find('.tm-folder-choice input'), card = folderCheck.closest('.tm-card'), links = card.querySelectorAll('.tm-link-check').length;
    click('.tm-folder-choice input');
    assert(find('.tm-restore-scope').textContent === `1 folder · ${links} links`, 'Selected folder scope double-counts links');
    assert(!dock.hidden && !find('[data-tm="restore-selected"]').hidden, 'Selection has no dedicated restore action');
    assert(getComputedStyle(dock).animationName === 'none' && getComputedStyle(dock).opacity === '1', 'Selection dock inherits the delayed dashboard footer entrance');
    assert(find('.tm-restore-date').dateTime === find('.tm-date').dateTime, 'Restore belongs to a different moment');
    const rect = dock.getBoundingClientRect(); scroll.scrollTop = scroll.scrollHeight; await wait(20);
    assert(dock.getBoundingClientRect().top === rect.top && rect.bottom <= innerHeight && rect.top >= 0, 'Restore moved out of view during scrolling');
    assert(scroll.getBoundingClientRect().bottom <= rect.top, 'Restore hides the last links underneath');
    const primary = find('[data-tm="restore-selected"]'); primary.focus({ preventScroll: true });
    assert(document.activeElement === primary && primary.getBoundingClientRect().height >= 40, 'Primary action has no keyboard/touch access');
    for (const action of [primary, full]) {
      const label = action.querySelector('span'), style = getComputedStyle(label);
      assert(!label.textContent.includes('…') && style.whiteSpace !== 'nowrap' && label.scrollWidth <= label.clientWidth + 1, 'Restore label is abbreviated or clipped');
    }
    await inspectStateThemes('restore-dock-selected');
    click('[data-tm="restore-selected"]'); await until(() => confirmation()?.open);
    [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle();
    assert(!find('[data-tm="restore-selected"]').hidden, 'Cancelling restoration loses selection');
    assert(document.activeElement === primary, 'Cancel strands keyboard focus away from the restore action');
    click('[data-tm="clear-selection"]'); await idle();
    assert(dock.hidden && document.activeElement.matches('.tm-check'), 'Clear leaves an unsolicited dock or strands focus away from the selected content');
    assert(![...document.querySelectorAll('.tm-check')].some(input => input.checked || input.disabled), 'Clear left a selected or disabled item');
    await inspectStateThemes('restore-dock-entire'); equal(await local(), before, 'Review/Cancel/Clear changed Atlas');
    scroll.scrollTop = 0;
  });
  await check('Folder conflict offers Replace / Add missing / Copy with no default; Cancel commits nothing', async () => {
    click('.tm-domain-restore'); await until(() => confirmation()?.open);
    assert(document.activeElement.textContent === 'Cancel', 'Initial focus is destructive');
    equal([...confirmation().querySelectorAll('input[type="radio"]')].map(input => input.value), ['replace', 'merge', 'copy'], 'Wrong folder choices');
    assert(!confirmation().querySelector('input:checked'), 'Conflict has an implicit choice');
    click('.tm-confirm .tm-primary'); assert(confirmation().querySelector('[role="alert"]').textContent.includes('Choose'), 'Missing choice not explained');
    [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle();
    equal(await local(), original, 'Cancelled folder conflict changed data');
  });
  for (const mode of ['merge', 'replace']) await check(`${mode === 'merge' ? 'Add missing' : 'Replace'} affects only the chosen folder and durable Undo returns all current links`, async () => {
    await pastDesign(); click('.tm-domain-restore'); await until(() => confirmation()?.open);
    click(`.tm-confirm input[value="${mode}"]`); click('.tm-confirm .tm-primary');
    await until(() => confirmation()?.textContent.includes('Only selected items change.'));
    const commit = [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Restore selected');
    commit.click(); await idle(); const current = await local(), id = original.folders[0].id;
    equal(current.folders.filter(folder => folder.id !== id), original.folders.filter(folder => folder.id !== id), 'Unrelated folder changed');
    equal(current.deferred.filter(link => link.folderId !== id), original.deferred.filter(link => link.folderId !== id), 'Unselected links changed');
    if (mode === 'merge') {
      equal(current.folders[0], original.folders[0], 'Merge overwrote current folder fields');
      for (const link of original.deferred.filter(link => link.folderId === id)) equal(current.deferred.find(item => item.id === link.id), link, 'Merge overwrote current link edits');
      assert(current.deferred.some(link => link.id === 'history-only-link'), 'Merge did not add a missing link');
    } else {
      assert(current.folders[0].name === 'Past design', `Replacement did not restore folder fields: ${JSON.stringify(current.folders)}; ${find('.tm-error').hidden ? '' : find('.tm-error').textContent}`);
      assert(!current.deferred.some(link => link.id === 'd3'), 'Replacement restored a historical archived link');
    }
    assert(find('.tm-restore-dock').hidden, 'Restored current moment still offers restoration');
    await menuAction('undo'); await idle(); equal(await local(), original, 'Undo lost newer current links');
    assert(find('.tm-restore-dock').hidden, 'Current moment after Undo still offers restoration');
  });
  await check('Prefixed copy previews its exact name, excludes archive, keeps original folder and opens no tabs', async () => {
    await pastDesign(); click('.tm-domain-restore'); await until(() => confirmation()?.open); click('.tm-confirm input[value="copy"]'); click('.tm-confirm .tm-primary');
    await until(() => confirmation()?.textContent.includes('Added folders:'));
    assert(confirmation().textContent.includes('Restored · Past design'), 'Exact prefixed name is missing');
    click('.tm-confirm .tm-primary'); await idle();
    const current = await local(), copy = current.folders.find(folder => folder.name === 'Restored · Past design');
    assert(copy && copy.id !== original.folders[0].id, 'Copy reused an id');
    equal(current.folders.slice(0, original.folders.length), original.folders, 'Copy edited the originals');
    equal(current.deferred.slice(0, original.deferred.length), original.deferred, 'Copy edited current links');
    assert(current.deferred.filter(link => link.folderId === copy.id).every(link => !link.completed), 'Copy restored historical archive');
    equal(await chrome.tabs.query({}), tabsBefore, 'Folder restore opened browser tabs');
  });
  await check('Success notice keeps countdown/Undo icon; durable Undo restores before and protects the restored copy', async () => {
    const host = window.__tabAtlasSaveNotification?.host, shadow = host?.shadowRoot;
    assert(find('#timeMachineDialog').contains(host), 'Notice is outside modal');
    assert(shadow.querySelector('.countdown') && shadow.querySelector('.undo-glyph'), 'Notice lacks countdown/Undo glyph');
    shadow.querySelector('.notice').dispatchEvent(new MouseEvent('mouseenter'));
    assert(shadow.querySelector('.notice').classList.contains('undo-ready'), 'Hover does not switch Undo');
    const restored = await local(); shadow.querySelector('[aria-label="Dismiss Tab Atlas notification"]').click();
    await menuAction('undo'); await idle(); equal(await local(), original, 'Undo did not return before the restore');
    assert(find('[data-tm="undo"]').textContent === 'Return to previous Atlas', 'Return after Undo is unavailable');
    await menuAction('before'); await idle(); assert(find('.tm-date').textContent.startsWith('Before Undo'), 'Protected point lacks its identity');
    assert(find('.tm-count').textContent.startsWith(`${restored.folders.length} folders`), 'Before Undo does not contain the restored copy');
    equal(await local(), original, 'Inspecting Before Undo mutated current Atlas');
  });
  await check('Opening a historical saved link uses current normal window and changes no Atlas state', async () => {
    const before = await local(); const button = find('.tm-tab'); const url = button.querySelector('.tm-tab-meta').textContent;
    assert(button.matches('a[href]') && button.getAttribute('href') === url && button.target === '_blank', 'Historical address has no native link or modifier/middle-click path');
    assert(find('.tm-ruler-hover').getAttribute('role') === 'tooltip' && find('.tm-ruler-hover').tagName !== 'OUTPUT', 'Pointer preview is a live status instead of a tooltip');
    click('.tm-tab'); await idle(); const tabs = await chrome.tabs.query({});
    assert(tabs.some(tab => tab.windowId === 1 && tab.url === url), 'Historical URL opened outside current window');
    equal(await local(), before, 'Opening a saved link changed Atlas');
  });
  await check('Active-only history, search and selection preserve the historical moment and focus', async () => {
    const date = find('.tm-date').dateTime;
    assert(!find('[data-tm="archive"]') && !find('[data-tm="saved"]'), 'History still exposes an archive switch');
    assert([...document.querySelectorAll('.tm-tab')].length >= 1, 'Historical active links are empty');
    const check = find('.tm-link-check'); check.focus(); check.click();
    assert(document.activeElement === check && !find('[data-tm="restore-selected"]').hidden, 'Selection rerender lost focus');
    const search = find('#tmSearch'); search.value = 'definitely-no-atlas-match'; search.dispatchEvent(new Event('input'));
    await until(() => find('.tm-state-message').textContent.includes('No matches'));
    assert(!find('[data-tm="clear-search"]').hidden, 'No-results state offers no exit');
    click('[data-tm="clear-search"]'); await idle();
    assert(find('.tm-date').dateTime === date, 'Filtering changed historical moment');
  });
  await check('Undo after newer edits requires confirmation; Cancel keeps edits and confirmed Undo protects them', async () => {
    await pastDesign(); click('.tm-domain-restore'); await until(() => confirmation()?.open);
    click('.tm-confirm input[value="copy"]'); click('.tm-confirm .tm-primary');
    await until(() => confirmation()?.textContent.includes('Added folders:')); click('.tm-confirm .tm-primary'); await idle();
    const response = await chrome.runtime.sendMessage({ type: 'tab-atlas/collections/folder-edit', id: original.folders[1].id, fields: { name: 'New edits after restore' } });
    assert(response.ok, response.error); const edited = await local();
    await menuAction('undo'); await until(() => confirmation()?.textContent.includes('Atlas changed after the restore'));
    [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle(); equal(await local(), edited, 'Cancelled Undo discarded edits');
    await menuAction('undo'); await until(() => confirmation()?.open); click('.tm-confirm .tm-danger'); await idle();
    equal(await local(), original, 'Confirmed Undo did not return before restore');
    await menuAction('before'); await idle();
    const protectedState = await history('before-restore');
    assert(protectedState.state.folders.some(folder => folder.name === 'New edits after restore'), 'Undo failed to protect the newer edits');
    equal(await local(), original, 'Protected-point preview altered the current Atlas');
  });
  await check('All themes preserve readable text, family materials, named controls and horizontal viewport fit', async () => {
    await menuAction('storage'); await until(() => confirmation()?.open);
    const root = document.documentElement, originalTheme = root.dataset.theme, switching = root.classList.contains('theme-switching');
    root.classList.add('theme-switching');
    try {
      for (const option of THEME_OPTIONS) {
        root.dataset.theme = option.id; await wait(40);
        const base = color(getComputedStyle(find('.tm-dialog')).backgroundColor);
        for (const [selector, surface] of [['.tm-tab-title', '.tm-card'], ['.tm-tab-meta', '.tm-card'], ['.tm-eyebrow', '.tm-dialog'], ['.tm-count', '.tm-dialog'], ['#tmSearch', '#tmSearch'], ['.tm-confirm p', '.tm-confirm'], ['.tm-confirm .tm-danger', '.tm-confirm']]) {
          const element = find(selector), css = getComputedStyle(element), material = getComputedStyle(find(surface));
          const backdrop = over(color(material.backgroundColor), base), bg = selector === surface ? backdrop : over(color(css.backgroundColor), backdrop);
          const ratio = contrast(over(color(css.color), bg), bg);
          samples.push({ theme: option.id, selector, contrast: +ratio.toFixed(2), background: material.backgroundColor, blur: material.backdropFilter, shadow: material.boxShadow });
          assert(ratio >= 4.5, `${option.id} ${selector} contrast ${ratio.toFixed(2)}`);
        }
        for (const element of document.querySelectorAll('.tm-dialog button,.tm-dialog a[href],.tm-dialog input,.tm-dialog select,.tm-dialog summary')) {
          if (!visible(element)) continue;
          assert(element.textContent.trim() || element.getAttribute('aria-label') || element.labels?.length, `Unnamed ${element.tagName}`);
          const rect = element.getBoundingClientRect(); assert(rect.left >= -1 && rect.right <= innerWidth + 1, `${option.id} clipped ${element.className}`);
        }
        assert(find('.tm-shell').scrollWidth <= find('.tm-shell').clientWidth + 1, `${option.id} horizontal overflow`);
      }
    } finally { root.dataset.theme = originalTheme; void root.offsetHeight; if (!switching) root.classList.remove('theme-switching'); [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle(); }
  });
  await check('Scrubbing previews dates without seeking; release commits once and a stale released choice cannot overwrite the latest choice', async () => {
    await menuAction('before'); await idle(); click('[data-tm="latest"]'); await idle();
    document.documentElement.dataset.motion = 'reduced'; const range = find('#tmRange'), send = chrome.runtime.sendMessage;
    let seeks = 0, neighbours = 0, release;
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.type === 'tab-atlas/time-machine/seek') seeks++;
      if (args[0]?.type === 'tab-atlas/time-machine/nearest' && ++neighbours === 1) return new Promise(resolve => { release = resolve; });
      return send(...args);
    };
    try {
      const date = find('.tm-date').dateTime;
      for (let i = 0; i < 100; i++) { range.value = i % 2 ? 1000 : 0; range.dispatchEvent(new Event('input')); }
      assert(seeks === 0 && find('.tm-date').dateTime === date, 'Pointer scrubbing loads snapshots before release');
      range.value = 0; range.dispatchEvent(new Event('change'));
      range.value = 1000; range.dispatchEvent(new Event('change'));
      await idle(); assert(seeks === 1 && Number(range.value) === 1000, 'Final release does not commit exactly once');
      release({ ok: false, error: 'Stale failed selection must stay silent.' }); await wait(20);
      assert(seeks === 1 && find('.tm-date').dateTime === date, 'Stale nearest reply overwrites the final release');
      assert(find('.tm-error').hidden, 'A stale failed selection creates an unrelated error');
    } finally { chrome.runtime.sendMessage = send; }
    assert([...document.querySelectorAll('.tm-card')].every(card => !card.getAnimations().length), 'Preview moves with reduced motion');
    assert(!performance.getEntriesByType('resource').some(entry => !entry.name.startsWith(location.origin) && !entry.name.startsWith('data:') && !entry.name.startsWith('blob:')), 'History requested an external resource');
  });
  await check('Clear requires safe initial focus and Cancel preserves data and protected Undo', async () => {
    const before = await local(), status = await history('status');
    await menuAction('storage'); await until(() => confirmation()?.open);
    assert(document.activeElement.textContent === 'Cancel', 'Clear initially focuses destruction');
    assert(confirmation().textContent.includes('including Undo'), 'Clear does not disclose loss of rollback');
    [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle();
    equal(await local(), before, 'Clear cancellation changed collections'); assert((await history('status')).lastRestore.id === status.lastRestore.id, 'Cancel deleted protected Undo');
  });
  await check('Imported prototype-like folder IDs preserve the explicit copy choice through the dialog', async () => {
    const before = await local(), name = 'Imported history';
    try {
      const past = { ...before, folders: [...before.folders, { id: '__proto__', name, color: null, collapsed: false }],
        deferred: [...before.deferred, { id: 'constructor', folderId: '__proto__', url: 'https://example.com/imported-id', title: 'Historical imported link', completed: false },
          { id: 'imported-missing-peer', folderId: '__proto__', url: 'https://example.com/imported-missing', title: 'Missing imported link', completed: false }] };
      await chrome.storage.local.set(past); await history('status');
      const current = { ...past, deferred: past.deferred.filter(link => link.id !== 'imported-missing-peer').map(link => link.id === 'constructor' ? { ...link, title: 'Current imported title' } : link) };
      await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory(); click('[data-tm="earlier"]'); await idle();
      const card = [...document.querySelectorAll('.tm-card')].find(card => card.querySelector('.tm-folder-choice input')?.dataset.folderId === '__proto__');
      assert(card && card.textContent.includes('Historical imported link'), 'Imported historical folder was not rendered');
      card.querySelector('.tm-domain-restore').click(); await until(() => confirmation()?.open);
      click('.tm-confirm input[value="copy"]'); click('.tm-confirm .tm-primary');
      await until(() => confirmation()?.textContent.includes('Added folders:'));
      assert(confirmation().textContent.includes('Restored · Imported history'), 'Explicit copy choice was lost');
      click('.tm-confirm .tm-primary'); await idle(); const restored = await local();
      const copy = restored.folders.find(folder => folder.name === 'Restored · Imported history');
      assert(copy && restored.deferred.some(link => link.folderId === copy.id && link.title === 'Historical imported link'), 'Imported folder copy failed');
      assert(restored.deferred.find(link => link.id === 'constructor').title === 'Current imported title', 'Copy replaced current imported link');
      await until(() => [...document.querySelectorAll('#foldersColumn .folder')].some(folder => folder.dataset.folderId === '__proto__'));
      assert([...document.querySelectorAll('#foldersColumn .folder')].find(folder => folder.dataset.folderId === '__proto__').textContent.includes('Current imported title'), 'Dashboard cannot render the imported folder');
      await menuAction('undo'); await idle(); equal(await local(), current, 'Imported copy Undo lost current data');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Full Atlas restore requires confirmation, restores active order and preserves unselected archive, workspace and browser tabs', async () => {
    await pastDesign(); const source = await history('seek', { time: new Date(find('.tm-date').dateTime).getTime() });
    const before = await local(), tabs = await chrome.tabs.query({});
    find('.tm-scroll').scrollTop = find('.tm-scroll').scrollHeight;
    await menuAction('restore-all'); await until(() => confirmation()?.open);
    assert(document.activeElement.textContent === 'Cancel', 'Full restore initially focuses replacement');
    assert(confirmation().textContent.includes('will be replaced') && confirmation().textContent.includes('Other archived links stay unchanged'), 'Full restore omits replacement/archive consequences');
    [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel').click(); await idle();
    equal(await local(), before, 'Cancelled full restore changed data');
    await menuAction('restore-all'); await until(() => confirmation()?.open);
    const send = chrome.runtime.sendMessage; let release;
    const gate = new Promise(resolve => { release = resolve; });
    chrome.runtime.sendMessage = async request => {
      if (request.type === 'tab-atlas/time-machine/restore') {
        await gate;
        return { ok: false, error: 'Unable to restore. Free storage space and retry.' };
      }
      return await send(request);
    };
    try {
      click('.tm-confirm .tm-danger');
      await until(() => find('[data-tm="restore-all"] span').textContent === 'Restoring…');
      const action = find('[data-tm="restore-all"]'), rect = action.getBoundingClientRect();
      assert(action.disabled && visible(action) && rect.bottom <= innerHeight && rect.top >= 0, 'Long restoration has no visible busy action');
      equal(await local(), before, 'Unconfirmed/in-flight restoration changed collections');
    } finally { release(); chrome.runtime.sendMessage = send; }
    await idle();
    equal(await local(), before, 'Failed restoration changed collections');
    const errorRect = find('.tm-error').getBoundingClientRect(), scrollRect = find('.tm-scroll').getBoundingClientRect();
    assert(!find('.tm-error').hidden && errorRect.top >= scrollRect.top - 1 && errorRect.bottom <= scrollRect.bottom + 1, 'Restore error remains hidden above the scroll position');
    click('[data-tm="retry"]'); await idle();
    await menuAction('restore-all'); await until(() => confirmation()?.open); click('.tm-confirm .tm-danger'); await idle();
    const restored = await local(); equal(restored.folders, source.state.folders, 'Full restore lost folder order/fields');
    equal(restored.deferred, planAtlasRestore(before, source.state).target.deferred, 'Full restore lost active order or current archive');
    equal(restored.workspaceSnapshots, before.workspaceSnapshots, 'Full restore changed workspace');
    equal(await chrome.tabs.query({}), tabs, 'Full restore changed browser tabs');
    await menuAction('undo'); await idle(); equal(await local(), before, 'Full restore Undo lost current Atlas');
  });
  await check('Restoring one missing historical link leaves its neighbours and current folder fields unchanged', async () => {
    await pastDesign(); const before = await local();
    click('.tm-link-check[data-link-id="history-only-link"]'); click('[data-tm="restore-selected"]');
    await until(() => confirmation()?.textContent.includes('Only selected items change.'));
    click('.tm-confirm .tm-primary'); await idle(); const restored = await local();
    equal(restored.folders, before.folders, 'Individual link replaced its folder');
    equal(restored.deferred.filter(link => link.id !== 'history-only-link'), before.deferred, 'Individual link changed neighbours');
    assert(restored.deferred.filter(link => link.id === 'history-only-link').length === 1, 'Missing link was not restored once');
    await menuAction('undo'); await idle(); equal(await local(), before, 'Individual link Undo lost data');
  });
  await check('Multiple folder conflicts require individual choices and commit together with a single Undo', async () => {
    const before = await local();
    try {
      const past = { ...before, folders: before.folders.map((folder, index) => index < 2 ? { ...folder, name: `Historical folder ${index + 1}` } : folder),
        deferred: [...before.deferred, ...before.folders.slice(0, 2).map((folder, index) => ({ id: `tm-multiple-missing-${index}`, folderId: folder.id, title: `Missing folder link ${index}`, url: `https://example.com/multiple-missing/${index}`, completed: false }))] };
      await chrome.storage.local.set(past); await history('status');
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory(); click('[data-tm="earlier"]'); await idle();
      for (const folder of before.folders.slice(0, 2)) click(`.tm-folder-choice input[data-folder-id="${folder.id}"]`);
      click('[data-tm="restore-selected"]'); await until(() => confirmation()?.open);
      const fields = [...confirmation().querySelectorAll('fieldset')]; assert(fields.length === 2, 'Not all folder conflicts were shown');
      assert(!confirmation().querySelector('input:checked'), 'Multiple conflicts have default choices');
      fields[0].querySelector('input[value="copy"]').click();
      assert(fields[0].querySelector('.tm-destination').hidden, 'Copy asks for an unrelated existing destination');
      click('.tm-confirm .tm-primary');
      assert(fields[1].contains(document.activeElement) && document.activeElement.getAttribute('aria-invalid') === 'true'
        && document.activeElement.getAttribute('aria-describedby') === 'tmConfirmError', 'Validation does not focus/describe the unresolved conflict');
      equal(await local(), before, 'Invalid choices changed current data');
      fields[1].querySelector('input[value="merge"]').click();
      assert(!fields[1].querySelector('.tm-destination').hidden && !confirmation().querySelector('[aria-invalid="true"]'), 'Correcting the choice leaves stale validation or hides its destination');
      click('.tm-confirm .tm-primary'); await until(() => confirmation()?.textContent.includes('Added folders:'));
      assert(confirmation().textContent.includes('Restored · Historical folder 1') && confirmation().textContent.includes('Add missing links'), 'Combined plan omits chosen results');
      click('.tm-confirm .tm-primary'); await idle(); const restored = await local();
      equal(restored.folders.slice(0, before.folders.length), before.folders, 'Combined restore changed current folders');
      assert(restored.folders.length === before.folders.length + 1, 'Combined restore did not create exactly one copy');
      await menuAction('undo'); await idle(); equal(await local(), before, 'Single Undo failed to return the entire selection');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  for (const mode of ['parent', 'existing-collision', 'copy-parent-collision']) await check(`Missing parent: ${mode} restores only the selected link and Undo preserves the current Atlas`, async () => {
    const before = await local(), parentId = 'tm-removed-parent', linkId = 'tm-parent-wanted';
    const collision = mode.endsWith('-collision'), choice = mode === 'existing-collision' ? 'existing' : collision ? 'copy-parent' : mode;
    const current = collision ? { ...before, folders: [...before.folders, { id: 'tm-existing-parent', name: 'Removed parent', collapsed: false }] } : before;
    try {
      const past = { ...before, folders: [...before.folders, { id: parentId, name: 'Removed parent', collapsed: false }],
        deferred: [...before.deferred,
          { id: linkId, folderId: parentId, url: 'https://example.com/selected-parent-link', title: 'Selected parent link', completed: false },
          { id: 'tm-parent-neighbour', folderId: parentId, url: 'https://example.com/unselected-neighbour', title: 'Unselected neighbour', completed: false }] };
      await chrome.storage.local.set(past); await history('status'); await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory(); click('[data-tm="earlier"]'); await idle();
      click(`.tm-link-check[data-link-id="${linkId}"]`); click('[data-tm="restore-selected"]'); await until(() => confirmation()?.open);
      if (collision) {
        assert(confirmation().textContent.includes('original folder is unavailable') && !confirmation().querySelector('input:checked'), 'Name collision has an implicit destination or no explanation');
        assert(confirmation().querySelector('input[value="parent"]').disabled && confirmation().textContent.includes('A folder with this name already exists'), 'Name collision is not explained at the first destination choice');
        await inspectStateThemes('missing-parent-name-collision');
      }
      if (collision) {
        click(`.tm-confirm input[value="${choice}"]`);
        if (choice === 'existing') { const select = confirmation().querySelector('select'); select.value = 'tm-existing-parent'; select.dispatchEvent(new Event('change')); }
        click('.tm-confirm .tm-primary');
      }
      await until(() => confirmation()?.textContent.includes('Only selected items change.'));
      if (mode === 'parent') { assert(confirmation().textContent.includes('Removed parent'), 'Original folder is not included in confirmation'); await inspectStateThemes('missing-parent'); }
      if (choice === 'copy-parent') assert(confirmation().textContent.includes('Restored · Removed parent'), 'Prefixed parent name is not reviewed');
      click('.tm-confirm .tm-primary'); await idle(); const restored = await local(), link = restored.deferred.find(link => link.id === linkId);
      assert(link && restored.deferred.length === before.deferred.length + 1 && !restored.deferred.some(link => link.id === 'tm-parent-neighbour'), 'Restoring one link brought its neighbours');
      equal(restored.deferred.filter(link => link.id !== linkId), before.deferred, 'Missing-parent restore changed current links');
      if (choice === 'existing') {
        equal(restored.folders, current.folders, 'Destination restore changed folder fields');
        assert(link.folderId === 'tm-existing-parent', 'Wrong selected destination');
      } else {
        const parent = restored.folders.find(folder => folder.id === link.folderId);
        assert(parent?.name === (mode === 'parent' ? 'Removed parent' : 'Restored · Removed parent'), 'Wrong restored parent');
        equal(restored.folders.slice(0, current.folders.length), current.folders, 'Creating parent edited current folders');
      }
      await menuAction('undo'); await idle(); equal(await local(), current, 'Missing-parent Undo lost data');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Multiple matching names require a destination and replacement changes only the chosen folder', async () => {
    const before = await local(), sourceId = 'tm-match-source', linkId = 'tm-match-past';
    const current = { ...before, folders: [...before.folders, { id: 'tm-match-a', name: ' Matches ', collapsed: false }, { id: 'tm-match-b', name: 'MATCHES', collapsed: false }],
      deferred: [...before.deferred, { id: 'tm-match-new-a', folderId: 'tm-match-a', title: 'New A', url: 'https://example.com/a', completed: false },
        { id: 'tm-match-new-b', folderId: 'tm-match-b', title: 'New B', url: 'https://example.com/b', completed: false }] };
    try {
      const past = { ...before, folders: [...before.folders, { id: sourceId, name: 'Matches', collapsed: false }],
        deferred: [...before.deferred, { id: linkId, folderId: sourceId, title: 'Historical match link', url: 'https://example.com/match-history', completed: false }] };
      await chrome.storage.local.set(past); await history('status'); await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory(); click('[data-tm="earlier"]'); await idle();
      click(`.tm-domain-restore[data-folder-id="${sourceId}"]`); await until(() => confirmation()?.open);
      const select = confirmation().querySelector('select'); assert(select.value === '' && select.options.length === 3, 'Multiple matches silently choose a destination');
      await inspectStateThemes('multiple-matching-folders');
      click('.tm-confirm input[value="replace"]'); click('.tm-confirm .tm-primary');
      assert(confirmation().querySelector('[role="alert"]').textContent.includes('destination'), 'Missing destination is not explained');
      equal(await local(), current, 'Invalid destination selection committed data');
      select.value = 'tm-match-b'; select.dispatchEvent(new Event('change')); click('.tm-confirm .tm-primary');
      await until(() => confirmation()?.textContent.includes('Only selected items change.')); click('.tm-confirm .tm-danger'); await idle();
      const restored = await local(); equal(restored.folders.filter(folder => folder.id !== 'tm-match-b'), current.folders.filter(folder => folder.id !== 'tm-match-b'), 'Replacement edited another matching folder');
      equal(restored.deferred.filter(link => link.folderId !== 'tm-match-b'), current.deferred.filter(link => link.folderId !== 'tm-match-b'), 'Replacement changed unselected links');
      assert(restored.folders.at(-1).id === 'tm-match-b' && restored.deferred.some(link => link.id === linkId && link.folderId === 'tm-match-b'), 'Replacement changed destination order or lost its source link');
      await menuAction('undo'); await idle(); equal(await local(), current, 'Matching-name Undo lost current data');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Locked folder explains unavailable replacement while allowing a copy without removing its lock', async () => {
    const before = await local(), id = before.folders[0].id;
    const current = { ...before, folders: before.folders.map(folder => folder.id === id ? { ...folder, locked: true } : folder) };
    try {
      await chrome.storage.local.set({ ...before, deferred: [...before.deferred, { id: 'tm-locked-missing', folderId: id, title: 'Missing locked-folder link', url: 'https://example.com/locked-missing', completed: false }] }); await history('status');
      await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory(); click('[data-tm="earlier"]'); await idle();
      click(`.tm-domain-restore[data-folder-id="${id}"]`); await until(() => confirmation()?.open);
      assert(confirmation().querySelector('input[value="replace"]').disabled && confirmation().textContent.includes('This folder is locked'), 'Locked replacement is available or unexplained');
      await inspectStateThemes('locked-folder');
      assert(!confirmation().querySelector('input[value="merge"]').disabled && !confirmation().querySelector('input[value="copy"]').disabled, 'Lock blocks safe restoration choices');
      click('.tm-confirm input[value="copy"]'); click('.tm-confirm .tm-primary'); await until(() => confirmation()?.textContent.includes('Added folders:'));
      click('.tm-confirm .tm-primary'); await idle(); const restored = await local();
      equal(restored.folders.find(folder => folder.id === id), current.folders.find(folder => folder.id === id), 'Copy silently removed the current lock');
      await menuAction('undo'); await idle(); equal(await local(), current, 'Locked-copy Undo lost data');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Pause, resume and recording off preserve existing history and current collections', async () => {
    const before = await local(), oldest = (await history('status')).oldest;
    await menuAction('record'); await idle(); assert(find('.tm-recording-inline').textContent === 'Recording paused', 'Pause has no visible state');
    await inspectStateThemes('paused');
    assert(find('[data-tm="record"]').textContent === 'Resume recording', 'Pause has no recovery action');
    await menuAction('record'); await idle(); assert(find('.tm-recording-inline').textContent === 'Recording', 'Resume did not update its state');
    await menuAction('disable'); await idle(); assert(find('.tm-recording-inline').textContent === 'Recording off', 'Off state is missing');
    await inspectStateThemes('off-with-history');
    assert(!find('.tm-preview').hidden && (await history('status')).oldest === oldest, 'Turning recording off erased past moments');
    await menuAction('record'); await idle(); equal(await local(), before, 'Recording settings changed collections');
  });
  await check('An empty historical Atlas explains its state and can return to populated history', async () => {
    const before = await local();
    try {
      await chrome.storage.local.set({ folders: [], deferred: [] }); await history('status'); await reloadLatestHistory();
      assert(find('.tm-count').textContent === '0 folders · 0 links', 'Empty snapshot count is wrong');
      assert(find('.tm-state-message').textContent.includes('Atlas was empty'), 'Empty snapshot has no explanation');
      await inspectStateThemes('empty');
      click('[data-tm="earlier"]'); await idle(); assert(find('.tm-card'), 'Earlier populated snapshot cannot be reached');
    } finally {
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Loading disables restore; a failed status announces recovery and Retry loads the same current Atlas', async () => {
    const before = await local(), send = chrome.runtime.sendMessage;
    const openHistory = async () => {
      click('#customizeToggle'); await until(() => [...document.querySelectorAll('#contextMenu button')].some(button => button.textContent === 'Time machine…'));
      [...document.querySelectorAll('#contextMenu button')].find(button => button.textContent === 'Time machine…').click();
    };
    let release;
    try {
      click('[data-tm="close"]'); await until(() => !find('[data-tm][data-busy]'));
      const gate = new Promise(resolve => { release = resolve; });
      chrome.runtime.sendMessage = async request => { if (request.type === 'tab-atlas/time-machine/status') await gate; return send(request); };
      await openHistory(); await until(() => find('#timeMachineDialog').open && !find('.tm-loading').hidden);
      assert(find('[data-tm="restore-all"]').disabled && find('.tm-loading').getAttribute('role') === 'status', 'Loading permits restore or has no status');
      await inspectStateThemes('loading');
      release(); await idle(); click('[data-tm="close"]'); await until(() => !find('[data-tm][data-busy]'));
      let fail = true;
      chrome.runtime.sendMessage = request => request.type === 'tab-atlas/time-machine/status' && fail
        ? (fail = false, Promise.resolve({ ok: false, error: 'Test history read failure. Retry to load history.' })) : send(request);
      await openHistory(); await until(() => !find('.tm-error').hidden);
      assert(find('.tm-error').getAttribute('role') === 'alert' && !find('[data-tm="retry"]').disabled, 'Error has no announced recovery');
      await inspectStateThemes('error');
      click('[data-tm="retry"]'); await idle(); assert(find('.tm-error').hidden && !find('.tm-preview').hidden, 'Retry did not recover the preview');
      equal(await local(), before, 'Loading/retry changed collections');
    } finally { release?.(); chrome.runtime.sendMessage = send; }
  });
  await check('Saved for later remains visible before paginated folders; standalone links restore independently with Undo', async () => {
    const before = await local(), selectedId = 'tm-standalone-null';
    const standalone = [
      { id: selectedId, folderId: null, title: 'Standalone null folder', url: 'https://example.com/standalone-null', completed: false },
      { id: 'tm-standalone-omitted', title: 'Standalone omitted folder', url: 'https://example.com/standalone-omitted', completed: false },
      { id: 'tm-standalone-orphan', folderId: 'missing-folder', title: 'Standalone missing folder', url: 'https://example.com/standalone-orphan', completed: false },
      { id: 'tm-standalone-archive', folderId: null, title: 'Standalone archive', url: 'https://example.com/standalone-archive', completed: true, completedAt: '2025-01-01T00:00:00Z' },
    ];
    const inbox = () => find('.tm-inbox-list');
    try {
      const past = { ...before,
        folders: [...before.folders, ...Array.from({ length: 18 }, (_, index) => ({ id: 'tm-extra-folder-' + index, name: 'Extra folder ' + index }))],
        deferred: [...before.deferred, ...standalone] };
      await chrome.storage.local.set(past); await history('status');
      const current = { ...past, folders: before.folders, deferred: past.deferred.filter(link => link.id !== selectedId) };
      await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory();
      click('[data-tm="earlier"]'); await idle();
      assert(inbox() && inbox().closest('.tm-inbox-pane') && !inbox().classList.contains('tm-card'), 'Standalone links are hidden behind folder pagination or wrapped in a card');
      assert(inbox().querySelector('ul > li.tm-row'), 'Standalone links have no native list semantics');
      const inboxStyle = getComputedStyle(inbox());
      assert(inboxStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(inboxStyle.borderTopWidth) === 0 && inboxStyle.boxShadow === 'none', 'Standalone list has a card surface');
      assert(!find('[data-tm="more-folders"]').hidden, 'Fixture did not exercise folder pagination');
      for (const link of standalone.filter(link => !link.completed)) assert(inbox().querySelector(`[data-link-id="${link.id}"]`), 'Standalone link omitted from Saved for later');
      assert(!inbox()?.querySelector('[data-link-id="tm-standalone-archive"]') && !find('[data-tm="archive"]'), 'Standalone archive is still exposed');
      click(`.tm-link-check[data-link-id="${selectedId}"]`); click('[data-tm="restore-selected"]');
      await until(() => confirmation()?.textContent.includes('Only selected items change.'));
      click('.tm-confirm .tm-primary'); await idle();
      const restored = await local();
      equal(restored.folders, current.folders, 'Standalone restore created or changed a folder');
      equal(restored.deferred.filter(link => link.id !== selectedId), current.deferred, 'Standalone restore changed other links');
      equal(restored.deferred.find(link => link.id === selectedId), standalone[0], 'Standalone restore changed link fields/destination');
      await menuAction('undo'); await idle(); equal(await local(), current, 'Standalone Undo changed unrelated collections');
      await chrome.storage.local.set({ folders: [], deferred: standalone }); await history('status'); await reloadLatestHistory();
      assert(!inbox() && find('.tm-state-message').textContent.includes('Choose an earlier moment'), 'Fully present standalone group is not hidden or has no next step');
      await chrome.storage.local.set({ deferred: standalone.filter(link => link.id !== selectedId) }); await history('status'); await reloadLatestHistory();
      click('[data-tm="earlier"]'); await idle();
      assert(inbox() && !find('.tm-state-message').textContent.includes('Atlas was empty'), 'An Atlas without folders hides standalone links');
      await inspectStateThemes('standalone-inbox');
    } finally {
      if (confirmation()) [...confirmation().querySelectorAll('button')].find(button => button.textContent === 'Cancel')?.click();
      await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
    }
  });
  await check('Saved for later and folders have independent desktop scroll areas, with a plain list and narrow-screen reflow', async () => {
    const before = await local();
    try {
      const past = { ...before, folders: [...before.folders, ...Array.from({ length: 18 }, (_, index) => ({ id: `tm-pane-folder-${index}`, name: `Pane folder ${index}` }))],
        deferred: [...before.deferred, ...Array.from({ length: 36 }, (_, index) => ({ id: `tm-pane-link-${index}`, title: `Saved list link ${index}`, url: `https://example.com/panes/${index}`, folderId: null, completed: false }))] };
      await chrome.storage.local.set(past); await history('status'); await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory();
      click('[data-tm="earlier"]'); await idle();
      const left = find('.tm-inbox-pane'), right = find('.tm-folders-pane');
      assert(!left.hidden && !right.hidden && !left.querySelector('.tm-card'), 'The list and folders are not separate, or Saved for later has a card');
      const standaloneCount = past.deferred.filter(link => !link.completed && !past.folders.some(folder => folder.id === link.folderId)).length;
      assert(left.querySelectorAll('.tm-row').length === standaloneCount && !left.querySelector('[data-tm="more-links"]'), 'Saved for later is not fully expanded');
      if (innerWidth > 760) {
        const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
        assert(a.right < b.left && Math.abs(a.width - b.width) < 2, 'Desktop panes are not two equal side-by-side areas');
        assert(left.scrollHeight > left.clientHeight && right.scrollHeight > right.clientHeight, 'Fixture does not overflow both panes');
        const date = find('.tm-date').getBoundingClientRect().top;
        left.scrollTop = 60; assert(left.scrollTop === 60 && right.scrollTop === 0, 'Left scroll moves the folders');
        right.scrollTop = 80; assert(right.scrollTop === 80 && left.scrollTop === 60, 'Folder scroll moves the list');
        assert(find('.tm-date').getBoundingClientRect().top === date, 'Pane scrolling moves the timeline');
        left.scrollTop = left.scrollHeight;
        assert(left.scrollTop > 60 && right.scrollTop === 80, 'Scrolling the full list moves the folders');
      } else {
        assert(getComputedStyle(find('.tm-columns')).display === 'block' && getComputedStyle(left).overflowY === 'visible', 'Narrow view has cramped nested scrollers');
      }
      click('.tm-inbox .tm-link-check'); click('.tm-folder-choice input');
      assert(!find('.tm-restore-dock').hidden && find('.tm-restore-scope').textContent.includes('1 folder'), 'Selection cannot combine the two areas');
      const leftBefore = left.getBoundingClientRect(), rightBefore = right.getBoundingClientRect();
      find('#tmSearch').value = 'Pane folder'; find('#tmSearch').dispatchEvent(new Event('input')); await idle();
      assert(left.hidden && !right.hidden, 'Folder-only search did not hide the plain list');
      if (innerWidth > 760) {
        const after = right.getBoundingClientRect();
        assert(Math.abs(after.left - rightBefore.left) < 1 && Math.abs(after.width - rightBefore.width) < 1, 'Folders move left or change width when Saved for later disappears');
      }
      find('#tmSearch').value = 'Saved list'; find('#tmSearch').dispatchEvent(new Event('input')); await idle();
      assert(!left.hidden && right.hidden, 'List-only search did not hide folders');
      if (innerWidth > 760) {
        const after = left.getBoundingClientRect();
        assert(Math.abs(after.left - leftBefore.left) < 1 && Math.abs(after.width - leftBefore.width) < 1, 'Saved for later moves or changes width when folders disappear');
      }
      equal(await local(), before, 'Pane scrolling/expansion/selection changes collections');
    } finally { await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory(); }
  });
  await check('Fully present folders/inbox are hidden; missing folders are red and mixed groups show missing links first before pagination/search, across all themes', async () => {
    const before = await local(), folderId = 'tm-deleted-folder';
    try {
      const extraFolders = [
        { id: 'tm-all-present', name: 'All present' }, { id: 'tm-all-missing', name: 'All missing' },
        { id: 'tm-paginated-mixed', name: 'Paginated mixed' },
        { id: 'tm-empty-present', name: 'Empty present' }, { id: 'tm-empty-missing', name: 'Empty missing' },
      ];
      const extraLinks = [
        ...Array.from({ length: 4 }, (_, index) => ({ id: `tm-inbox-priority-${index}`, folderId: null, title: `Inbox priority ${index}`, url: `https://example.com/inbox-priority/${index}`, completed: false })),
        ...['tm-all-present', 'tm-all-missing'].flatMap(id => [0, 1].map(index => ({ id: `${id}-${index}`, folderId: id, title: `${id} ${index}`, url: `https://example.com/${id}/${index}`, completed: false }))),
        ...Array.from({ length: 11 }, (_, index) => ({ id: `tm-paginated-${index}`, folderId: 'tm-paginated-mixed', title: index < 10 ? `Paginated shared ${index}` : 'Hidden missing item', url: `https://example.com/paginated/${index}`, completed: false })),
      ];
      const past = { ...before, folders: [...before.folders, { id: folderId, name: 'Deleted folder' }, ...extraFolders], deferred: [...before.deferred, ...extraLinks,
        { id: 'tm-missing-link', title: 'Missing link', url: 'https://example.com/missing', folderId, completed: false },
        { id: 'tm-moved-link', title: 'Historical moved link', url: 'https://example.com/moved', folderId, completed: false }] };
      const current = { ...before, folders: [...before.folders, ...extraFolders.filter(folder => !['tm-all-missing', 'tm-empty-missing'].includes(folder.id))],
        deferred: [...before.deferred, ...extraLinks.filter(link => link.folderId !== 'tm-all-missing' && !['tm-paginated-10', 'tm-inbox-priority-1', 'tm-inbox-priority-3'].includes(link.id)), { ...past.deferred.at(-1), title: 'Current moved link', folderId: before.folders[0].id }] };
      await chrome.storage.local.set(past); await history('status'); await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory();
      click('[data-tm="earlier"]'); await idle();
      const card = [...document.querySelectorAll('.tm-card')].find(card => card.querySelector('input[data-folder-id]')?.dataset.folderId === folderId);
      assert(card?.dataset.presence === 'missing', 'Deleted folder is not marked missing');
      assert(card.dataset.match === 'mixed', 'A missing folder with surviving links is not mixed');
      const byFolder = id => [...document.querySelectorAll('.tm-card')].find(card => card.querySelector('input[data-folder-id]')?.dataset.folderId === id);
      const presentCard = byFolder('tm-all-present'), missingCard = byFolder('tm-all-missing'), paginatedCard = byFolder('tm-paginated-mixed');
      assert(!presentCard && missingCard?.dataset.match === 'missing', 'Fully present folder is visible or missing folder has no aggregate state');
      for (const uniform of [missingCard]) for (const row of uniform.querySelectorAll('.tm-row')) {
        assert(getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)', 'Uniform folder repeats its fill on individual rows');
      }
      assert(!byFolder('tm-empty-present') && byFolder('tm-empty-missing')?.dataset.match === 'missing', 'Present empty folder is visible or missing empty folder is hidden');
      const displayedIds = card => [...card.querySelectorAll('.tm-tab')].map(link => link.dataset.linkId);
      assert(paginatedCard?.dataset.match === 'mixed' && displayedIds(paginatedCard)[0] === 'tm-paginated-10' && !paginatedCard.querySelector('[data-link-id="tm-paginated-9"]'), 'Missing row was not prioritized before pagination');
      const inbox = find('.tm-inbox-list');
      const historicalInbox = past.deferred.filter(link => !link.completed && !link.folderId).map(link => link.id);
      equal(displayedIds(inbox), [historicalInbox.filter(id => !current.deferred.some(link => link.id === id)), historicalInbox.filter(id => current.deferred.some(link => link.id === id))].flat(), 'Inbox does not preserve order within missing and present links');
      equal(displayedIds(missingCard), ['tm-all-missing-0', 'tm-all-missing-1'], 'All-missing folder changed historical order');
      const missing = card.querySelector('[data-link-id="tm-missing-link"].tm-tab'), moved = card.querySelector('[data-link-id="tm-moved-link"].tm-tab');
      assert(missing.closest('.tm-row').dataset.presence === 'missing' && moved.closest('.tm-row').dataset.presence === 'present', 'Moved and missing links have the same presence');
      assert(moved.title.includes('Current title:') && moved.title.includes('Currently in '), 'Changes are absent from hover details');
      assert(missing.getAttribute('aria-label').includes('missing') && moved.getAttribute('aria-label').includes('current Atlas'), 'Status has no accessible alternative');
      assert(!card.textContent.includes('missing from') && !card.textContent.includes('current Atlas') && !card.textContent.includes('Currently in'), 'Permanent status labels were added');
      assert(getComputedStyle(missing.closest('.tm-row')).backgroundColor !== getComputedStyle(moved.closest('.tm-row')).backgroundColor, 'Status fills are identical');
      await inspectStateThemes('presence-comparison'); equal(await local(), current, 'Comparison changed collections');
      find('#tmSearch').value = 'All present'; find('#tmSearch').dispatchEvent(new Event('input'));
      await until(() => !find('.tm-card') && find('.tm-state-message').textContent.includes('No matches'));
      find('#tmSearch').value = ''; find('#tmSearch').dispatchEvent(new Event('input'));
      await until(() => byFolder('tm-paginated-mixed'));
      click('.tm-card [data-tm="more-links"][data-folder-id="tm-paginated-mixed"]');
      await until(() => byFolder('tm-paginated-mixed')?.querySelector('[data-link-id="tm-paginated-9"]'));
      equal(displayedIds(byFolder('tm-paginated-mixed')), ['tm-paginated-10', ...Array.from({ length: 10 }, (_, index) => `tm-paginated-${index}`)], 'Folder expansion changed order within missing and present links');
      assert(byFolder('tm-paginated-mixed').dataset.match === 'mixed', 'Expanding rows changes the folder state');
      find('#tmSearch').value = 'Inbox priority'; find('#tmSearch').dispatchEvent(new Event('input'));
      await until(() => document.querySelectorAll('.tm-card').length === 0 && find('[data-link-id="tm-inbox-priority-3"]'));
      equal(displayedIds(find('.tm-inbox-list')), ['tm-inbox-priority-1', 'tm-inbox-priority-3', 'tm-inbox-priority-0', 'tm-inbox-priority-2'], 'Inbox search lost missing-first stable order');
      find('#tmSearch').value = 'Paginated'; find('#tmSearch').dispatchEvent(new Event('input'));
      await until(() => byFolder('tm-paginated-mixed') && document.querySelectorAll('.tm-card').length === 1);
      assert(displayedIds(byFolder('tm-paginated-mixed'))[0] === 'tm-paginated-10', 'Folder search lost missing-first order');
      find('#tmSearch').value = 'Paginated shared'; find('#tmSearch').dispatchEvent(new Event('input'));
      await until(() => document.querySelectorAll('.tm-card').length === 1 && !find('[data-link-id="tm-paginated-10"]'));
      assert(byFolder('tm-paginated-mixed')?.dataset.match === 'mixed', 'Search hides the missing member and incorrectly turns the folder green');
    } finally { await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory(); }
  });
  await check('Saved for later is fully expanded, every missing folder link is exposed, and expansion starts after the exposed rows', async () => {
    const before = await local();
    try {
      const extraFolders = [{ id: 'tm-disclosure-mixed', name: 'Disclosure mixed' }, { id: 'tm-disclosure-missing', name: 'Disclosure missing' }];
      const extraLinks = [
        ...Array.from({ length: 70 }, (_, index) => ({ id: `tm-disclosure-mixed-${index}`, folderId: extraFolders[0].id, title: `Disclosure mixed ${index < 40 ? 'shared' : 'lost'} ${index}`, url: `https://example.com/disclosure/mixed/${index}`, completed: false })),
        ...Array.from({ length: 15 }, (_, index) => ({ id: `tm-disclosure-missing-${index}`, folderId: extraFolders[1].id, title: `Disclosure missing ${index}`, url: `https://example.com/disclosure/missing/${index}`, completed: false })),
        ...Array.from({ length: 28 }, (_, index) => ({ id: `tm-disclosure-inbox-${index}`, folderId: null, title: `Disclosure inbox ${index < 14 ? 'shared' : 'lost'} ${index}`, url: `https://example.com/disclosure/inbox/${index}`, completed: false })),
      ];
      const presentLinks = extraLinks.filter(link => link.folderId === extraFolders[0].id ? Number(link.id.split('-').at(-1)) < 40 : !link.folderId && Number(link.id.split('-').at(-1)) < 14);
      const past = { ...before, folders: [...extraFolders, ...before.folders], deferred: [...before.deferred, ...extraLinks] };
      const current = { ...before, folders: [extraFolders[0], ...before.folders], deferred: [...before.deferred, ...presentLinks] };
      await chrome.storage.local.set(past); await history('status'); await chrome.storage.local.set(current); await history('status'); await reloadLatestHistory();
      click('[data-tm="earlier"]'); await idle();
      const search = async value => { find('#tmSearch').value = value; find('#tmSearch').dispatchEvent(new Event('input')); await idle(); };
      const card = id => [...document.querySelectorAll('.tm-card')].find(element => element.querySelector('.tm-folder-choice input')?.dataset.folderId === id);
      const rows = element => [...element.querySelectorAll('.tm-tab')].map(link => link.dataset.linkId);
      await search('Disclosure');
      equal(rows(find('.tm-inbox-list')), [...Array.from({ length: 14 }, (_, i) => `tm-disclosure-inbox-${i + 14}`), ...Array.from({ length: 14 }, (_, i) => `tm-disclosure-inbox-${i}`)], 'The full inbox is paginated or its missing-first order changed');
      assert(!find('.tm-inbox [data-tm="more-links"]'), 'The full inbox still has an expansion button');
      equal(rows(card(extraFolders[0].id)), Array.from({ length: 30 }, (_, i) => `tm-disclosure-mixed-${i + 40}`), 'A mixed folder hides missing links or changes their historical order');
      assert(card(extraFolders[1].id).querySelectorAll('.tm-row').length === 15 && !card(extraFolders[1].id).querySelector('[data-tm="more-links"]'), 'An entirely missing folder is not fully expanded');
      await search('Disclosure mixed shared');
      assert(card(extraFolders[0].id).querySelectorAll('.tm-row').length === 10 && card(extraFolders[0].id).dataset.match === 'mixed', 'Searching present links loses progressive disclosure or aggregate status');
      await search('Disclosure');
      const left = find('.tm-inbox-pane'), right = find('.tm-folders-pane');
      if (innerWidth > 760) { left.scrollTop = 60; right.scrollTop = 80; }
      const offsets = [left.scrollTop, right.scrollTop];
      card(extraFolders[0].id).querySelector('[data-tm="more-links"]').click(); await idle();
      equal(rows(card(extraFolders[0].id)), [...Array.from({ length: 30 }, (_, i) => `tm-disclosure-mixed-${i + 40}`), ...Array.from({ length: 25 }, (_, i) => `tm-disclosure-mixed-${i}`)], 'Show 25 more does not extend the actual exposed rows by 25');
      equal([left.scrollTop, right.scrollTop], offsets, 'Folder expansion resets a pane scroll position');
      card(extraFolders[0].id).querySelector('[data-tm="more-links"]').click(); await idle();
      assert(card(extraFolders[0].id).querySelectorAll('.tm-row').length === 70 && !card(extraFolders[0].id).querySelector('[data-tm="more-links"]'), 'Final expansion fails to expose the remaining present links');
      click('.tm-link-check[data-link-id="tm-disclosure-mixed-69"]');
      assert(!find('.tm-restore-dock').hidden && find('.tm-restore-scope').textContent.includes('1 link'), 'A missing link after the old ten-row boundary cannot be selected');
      equal(await local(), current, 'Disclosure or selection changed current collections');
    } finally { await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory(); }
  });
  await check('Comparison refreshes after an active change without switching the inspected historical moment', async () => {
    const before = await local();
    try {
      await pastDesign(); const date = find('.tm-date').dateTime;
      const missing = find('.tm-tab[data-link-id="history-only-link"]'); assert(missing.closest('.tm-row').dataset.presence === 'missing', 'Fixture has no missing link');
      const past = await history('seek', { time: new Date(date).getTime() });
      await chrome.storage.local.set({ deferred: [...before.deferred, past.state.deferred.find(link => link.id === 'history-only-link')] }); await history('status');
      await until(() => !find('.tm-tab[data-link-id="history-only-link"]'));
      assert(find('.tm-date').dateTime === date, 'Comparison switched historical moment');
    } finally { await chrome.storage.local.set(before); await history('status'); await reloadLatestHistory(); }
  });
  await check('Escape closes options before history, preserves the preview and reopens with secondary controls collapsed', async () => {
    const before = await local(), date = find('.tm-date').dateTime;
    const reopen = async () => {
      click('#customizeToggle');
      await until(() => [...document.querySelectorAll('#contextMenu button')].some(button => button.textContent === 'Time machine…'));
      [...document.querySelectorAll('#contextMenu button')].find(button => button.textContent === 'Time machine…').click();
      await idle();
    };
    click('.tm-menu summary'); find('#tmSearch').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(find('#timeMachineDialog').open && !find('.tm-menu').open, 'Escape closed history instead of options');
    assert(document.activeElement === find('.tm-menu summary') && find('.tm-date').dateTime === date, 'Options Escape lost focus or the inspected moment');
    click('.tm-menu summary');
    find('#tmSearch').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); find('#tmSearch').focus();
    assert(!find('.tm-menu').open && find('#timeMachineDialog').open && document.activeElement === find('#tmSearch'), 'Outside pointer activation fails to dismiss only options');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!find('#timeMachineDialog').open && document.activeElement.id === 'customizeToggle', 'Second Escape failed to close history or restore its trigger');
    await reopen(); assert(!find('.tm-menu').open, 'Reopened history retained expanded options');
    click('.tm-menu summary'); click('[data-tm="close"]');
    await until(() => !find('#timeMachineDialog').open && !find('[data-tm][data-busy]'));
    await reopen(); assert(!find('.tm-menu').open, 'Close button left options expanded at the next entry');
    equal(await local(), before, 'Closing options/history changed collections');
  });
  write(false);
  if (new URLSearchParams(location.search).has('history-conflict')) {
    await pastDesign(); click('.tm-domain-restore'); await until(() => confirmation()?.open);
    output.dataset.poseReady = 'true';
  }
}
void run().catch(error => { results.push({ name: 'Fixture setup', passed: false, error: error.message }); write(false); });
