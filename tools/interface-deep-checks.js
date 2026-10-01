// Local harness only: interaction regressions and auxiliary surfaces in every theme.
import { THEME_OPTIONS } from '../extension/lib/view-config.js';
const results = [];
window.addEventListener('unhandledrejection', event => results.push({ rejected: String(event.reason) }));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async predicate => {
  for (let n = 0; n < 100; n++) { if (predicate()) return; await wait(20); }
  throw new Error('Timed out waiting for interface');
};
const click = selector => { const el = document.querySelector(selector); el.focus(); el.click(); };
const key = value => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
const menuItem = label => [...document.querySelectorAll('#contextMenu button')].find(el => el.textContent.trim() === label);
const check = async (name, fn) => {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { throw new Error(`${name}: ${error.message}`); }
};
const root = document.documentElement;
const samples = [];
const canvas = document.createElement('canvas').getContext('2d');
const rgb = value => {
  canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = value; canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
};
const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
const lum = color => {
  const l = color.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return l[0] * .2126 + l[1] * .7152 + l[2] * .0722;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
function sample(theme, selector, surfaceSelector) {
  const el = document.querySelector(selector), surface = document.querySelector(surfaceSelector);
  const style = getComputedStyle(el), material = getComputedStyle(surface), rect = surface.getBoundingClientRect();
  const ink = rgb(style.color), fill = rgb(style.backgroundColor), base = rgb(material.backgroundColor);
  let backgrounds = base[3] === 1 ? [base] : [over(base, [0, 0, 0]), over(base, [255, 255, 255])];
  if (theme === 'orchidbloom' && surfaceSelector === '#archiveDrawer') {
    // Bound both opaque linear-gradient endpoints and the radial tint over each.
    const colors = material.backgroundImage.match(/rgba?\([^)]+\)/g).map(rgb);
    backgrounds = colors.slice(-2).flatMap(color => [color, over(colors[0], color)]);
  }
  samples.push({ theme, selector, contrast: Number(Math.min(...backgrounds.map(bg => {
    const painted = over(fill, bg); return ratio(over(ink, painted), painted);
  })).toFixed(2)), fontSize: style.fontSize, material: material.backgroundColor,
    blur: material.backdropFilter, shadow: material.boxShadow, radius: material.borderRadius,
    fitsViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && surface.scrollWidth <= surface.clientWidth + 1 });
}
async function run() {
  await waitFor(() => document.querySelector('.folder-toggle'));
  if (!new URLSearchParams(location.search).has('surfaces')) {
  await check('Folder disclosures expose state and retain names for saved checkboxes', async () => {
    assert([...document.querySelectorAll('.deferred-checkbox')].every(el => el.getAttribute('aria-label')?.startsWith('Archive ')), 'Unnamed saved checkbox');
    click('[data-folder-id="f-read"] .folder-toggle');
    assert(document.querySelector('[data-folder-id="f-read"] .folder-toggle').getAttribute('aria-expanded') === 'false', 'Collapse state not exposed');
    await wait(30); click('[data-folder-id="f-read"] .folder-toggle'); await wait(30);
  });
  await check('Menu arrow navigation, endpoints, typeahead and Escape return focus', async () => {
    const trigger = document.querySelector('[data-action="folder-menu"][data-folder-id="f-read"]');
    trigger.focus(); trigger.click(); await waitFor(() => menuItem('Rename'));
    assert(document.activeElement.textContent === 'Collapse', 'Menu did not focus first item');
    key('ArrowDown'); assert(document.activeElement.textContent === 'Rename', 'ArrowDown failed');
    key('End'); assert(document.activeElement.textContent === 'Delete folder', 'End failed');
    key('Home'); key('r'); assert(document.activeElement.textContent === 'Rename', 'Typeahead failed');
    assert([...document.querySelectorAll('.swatch')].every(el => el.getAttribute('aria-label') && el.getBoundingClientRect().width >= 23.9), 'Colour names or targets missing');
    key('Escape'); assert(document.activeElement === trigger, 'Menu did not return focus');
  });
  await check('Inline rename remains separate from disclosure and restores focus', async () => {
    click('[data-action="folder-menu"][data-folder-id="f-read"]'); await waitFor(() => menuItem('Rename'));
    menuItem('Rename').click(); await waitFor(() => document.activeElement.classList.contains('folder-rename-input'));
    assert(!document.activeElement.closest('button'), 'Editable field nested in a button');
    key('Escape'); await waitFor(() => document.activeElement.classList.contains('folder-toggle'));
    assert(!document.querySelector('.folder-rename-input'), 'Cancelled rename editor remained in the reused DOM');
    assert(document.activeElement.getAttribute('aria-expanded') === 'true', 'Rename Escape collapsed folder');
  });
  await check('Folder editor blur respects the next control and creation Escape restores focus', async () => {
    click('[data-action="folder-menu"][data-folder-id="f-read"]'); await waitFor(() => menuItem('Rename'));
    menuItem('Rename').click();
    document.getElementById('globalSearch').focus();
    await waitFor(() => !document.querySelector('.folder-rename-input'));
    assert(document.activeElement.id === 'globalSearch', 'Rename blur stole focus');
    click('[data-action="new-folder"]'); key('Escape');
    assert(document.activeElement.dataset.action === 'new-folder', 'Creation Escape left focus on hidden input');
    assert(root.dataset.privacy !== 'on', 'Handled Escape also activated privacy');
  });
  await check('Shortcut modal isolates background and keeps invalid input editable', async () => {
    click('[data-action="speeddial-add"]');
    const dialog = document.getElementById('speedDialDialog');
    assert(dialog.matches(':modal'), 'Shortcut editor is not modal');
    document.getElementById('globalSearch').focus(); assert(dialog.contains(document.activeElement), 'Background took focus');
    document.getElementById('speedDialLabelInput').value = 'Regression shortcut';
    for (const value of ['', 'https://', 'mailto:test@example.com', 'javascript:alert(1)']) {
      document.getElementById('speedDialUrlInput').value = value;
      click('[data-action="speeddial-save"]');
      assert(dialog.open && !document.getElementById('speedDialUrlError').hidden, 'Invalid URL dismissed or saved');
      assert(document.getElementById('speedDialLabelInput').value === 'Regression shortcut', 'Label lost');
    }
    key('Escape'); assert(!dialog.open && document.activeElement.matches('[data-action="speeddial-add"]'), 'Modal Escape lost focus');
    await wait(30); // allow Chromium to update the background's native inert state
  });
  await check('Folder confirmation starts on Cancel and Escape stays in the dashboard', async () => {
    click('[data-action="folder-menu"][data-folder-id="f-read"]'); await waitFor(() => menuItem('Delete folder'));
    const remove = menuItem('Delete folder');
    remove.focus();
    await wait(20);
    remove.click(); await waitFor(() => document.getElementById('folderDeleteDialog').open);
    assert(document.activeElement.dataset.action === 'folder-delete-cancel', 'Unsafe initial focus');
    key('Escape'); assert(!document.getElementById('folderDeleteDialog').open, 'Confirmation stayed open');
  });
  await check('Pinned-tab confirmation is modal and returns focus to Close all', async () => {
    click('[data-action="close-all-open-tabs"]');
    assert(document.getElementById('closeAllDialog').matches(':modal'), 'Pinned confirmation is not modal');
    assert(document.activeElement.dataset.action === 'close-all-cancel', 'Confirmation did not start on Cancel');
    key('Escape'); assert(document.activeElement.dataset.action === 'close-all-open-tabs', 'Close-all focus lost');
  });
  await check('Archive restore keeps keyboard focus and Undo survives the old timeout', async () => {
    click('#archiveLaunch'); await waitFor(() => document.activeElement.id === 'archiveSearch');
    const before = document.querySelectorAll('.archive-item').length;
    click('.archive-restore'); await waitFor(() => document.querySelectorAll('.archive-item').length === before - 1);
    assert(document.activeElement.id === 'archiveSearch', 'Removed archive action lost focus');
    assert(document.getElementById('archiveDrawerOverlay').contains(document.querySelector('.toast-undo')), 'Undo outside modal focus scope');
    await wait(5700);
    assert(document.getElementById('toast').classList.contains('visible'), 'Undo timed out');
    click('.toast-undo'); await waitFor(() => document.querySelectorAll('.archive-item').length === before);
    click('[data-action="close-archive"]');
    assert(document.activeElement.id === 'archiveLaunch', 'Archive did not return focus');
  });
  await check('Workspace disclosure moves focus in and back on Escape', async () => {
    click('[data-action="toggle-workspace-drawer"]');
    assert(document.getElementById('workspaceDrawer').contains(document.activeElement), 'Workspace open did not move focus');
    key('Escape'); assert(document.activeElement.dataset.action === 'toggle-workspace-drawer', 'Workspace Escape lost focus');
  });
  await check('Workspace deletion Undo restores the saved workspace', async () => {
    click('[data-action="toggle-workspace-drawer"]');
    click('[data-action="delete-workspace-snapshot"]');
    await waitFor(() => !document.querySelector('.workspace-item'));
    assert(document.activeElement.closest('#workspaceDrawer'), 'Delete lost workspace focus');
    click('.toast-undo'); await waitFor(() => document.querySelector('.workspace-item'));
    click('[data-action="toggle-workspace-drawer"]');
  });
  }
  const original = root.dataset.theme;
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.append(freeze);
  for (const { id: theme } of THEME_OPTIONS) {
    root.dataset.theme = theme;
    click('[data-action="speeddial-add"]');
    sample(theme, '.dialog-field label', '#speedDialDialog .dialog');
    sample(theme, '#speedDialUrlInput', '#speedDialDialog .dialog');
    click('[data-action="speeddial-save"]'); sample(theme, '#speedDialUrlError', '#speedDialDialog .dialog');
    key('Escape');
    await wait(20);
    click('[data-action="folder-menu"][data-folder-id="f-read"]'); await waitFor(() => menuItem('Rename'));
    sample(theme, '.context-menu-heading', '#contextMenu'); sample(theme, '.context-menu-item.danger', '#contextMenu');
    key('Escape');
    click('[data-action="toggle-workspace-drawer"]');
    sample(theme, '.workspace-item-meta', '#workspaceDrawer'); key('Escape');
    click('#archiveLaunch'); sample(theme, '.archive-item-date', '#archiveDrawer'); click('[data-action="close-archive"]');
  }
  root.dataset.theme = original; freeze.remove();
}
try { await run(); } catch (error) {
  results.push({ passed: false, error: error.message,
    dialogs: [...document.querySelectorAll('dialog')].map(el => ({ id: el.id, open: el.open, display: el.style.display })),
    active: document.activeElement.outerHTML.slice(0, 250),
    menuHTML: document.getElementById('contextMenu').outerHTML.slice(0, 400),
    folderTitle: document.getElementById('folderDeleteTitle').textContent });
}
const report = document.createElement('pre'); report.id = 'interfaceDeepResults'; report.hidden = true;
report.textContent = JSON.stringify({ results, samples, viewport: innerWidth, contentWidth: root.scrollWidth }, null, 2);
document.body.append(report);
