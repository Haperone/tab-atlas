// Exercise production storage warnings against disposable Chrome API mocks.
import { THEME_OPTIONS } from '../extension/lib/view-config.js';
const results = [];
const colorSamples = [];
const canvas = document.createElement('canvas').getContext('2d');
function rgba(color) {
  canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255];
}
const over = (fg, bg) => fg.slice(0, 3).map((value, index) => value * fg[3] + bg[index] * (1 - fg[3]));
const luminance = rgb => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
function measureColor(element, surface, theme, level) {
  const foreground = rgba(getComputedStyle(element).color);
  const background = rgba(getComputedStyle(surface).backgroundColor);
  const minimum = Math.min(...[[0,0,0], [255,255,255]].map(base => {
    const rendered = over(background, base); return contrast(over(foreground, rendered), rendered);
  }));
  colorSamples.push({theme, level, contrast: Number(minimum.toFixed(2))});
  return minimum;
}
const until = async predicate => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Storage UI did not settle');
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const click = selector => document.querySelector(selector).click();
const warning = document.getElementById('storageWarning');
const dialog = document.getElementById('storageUsageDialog');
async function check(name, callback) {
  try { await callback(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.message }); }
}
async function fill(percent) {
  await chrome.storage.local.set({ previewStoragePadding: 'x'.repeat(Math.floor(chrome.storage.local.QUOTA_BYTES * percent / 100)) });
}
await check('Healthy storage leaves the dashboard clear', async () => {
  await fill(0);
  await until(() => warning.hidden);
});
await check('Warning appears after external storage writes', async () => {
  await fill(85);
  await until(() => !warning.hidden && warning.dataset.level === 'warning');
  assert(warning.textContent.includes('85%'), 'Expected actual usage percentage');
});
await check('Storage dialog shows a complete breakdown and restores focus', async () => {
  const trigger = warning.querySelector('button'); trigger.focus(); trigger.click();
  await until(() => dialog.open && document.querySelectorAll('#storageUsageBreakdown dd').length === 4);
  assert(document.getElementById('storageUsageSummary').textContent.includes('10.0 MB'), 'Missing quota');
  assert(dialog.contains(document.activeElement), 'Dialog did not receive focus');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
  assert(!dialog.open && document.activeElement === trigger, 'Escape did not restore focus');
});
await check('Critical state updates in place and disappears after cleanup', async () => {
  await fill(96);
  await until(() => warning.dataset.level === 'critical');
  assert(warning.textContent.includes('almost full'), 'Missing critical wording');
  await fill(60);
  await until(() => warning.hidden);
});
await check('Cleanup actions reach archive and workspaces', async () => {
  await fill(85);
  await until(() => !warning.hidden);
  click('[data-action="manage-storage"]'); click('[data-action="storage-archive"]');
  assert(document.getElementById('archiveDrawerOverlay').open && !dialog.open, 'Archive action failed');
  click('[data-action="close-archive"]');
  click('[data-action="manage-storage"]'); click('[data-action="storage-workspaces"]');
  assert(document.getElementById('workspaceDrawer').style.display !== 'none' && !dialog.open, 'Workspace action failed');
  click('[data-action="toggle-workspace-drawer"]');
});
await check('Failed usage reads show Retry and recover without closing the dialog', async () => {
  const read = chrome.storage.local.getBytesInUse;
  try {
    chrome.storage.local.getBytesInUse = async () => { throw new Error('Unavailable'); };
    click('[data-action="manage-storage"]');
    await until(() => !document.getElementById('storageUsageError').hidden);
    assert(document.getElementById('storageUsageRetry').hidden === false, 'Retry missing');
  } finally { chrome.storage.local.getBytesInUse = read; }
  click('[data-action="retry-storage"]');
  await until(() => document.getElementById('storageUsageError').hidden && document.querySelectorAll('#storageUsageBreakdown dd').length === 4);
  click('[data-action="close-storage"]');
});
await check('Edge signal plays once, escalates and respects reduced motion', async () => {
  await fill(0); await until(() => warning.hidden);
  await fill(85); await until(() => !warning.hidden);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.motion !== 'reduced') {
    assert(getComputedStyle(warning, '::after').animationName === 'storage-warning-signal', 'Warning signal missing');
    assert(warning.getAnimations({subtree:true}).every(animation => animation.effect.getTiming().iterations === 1), 'Signal repeats');
    await until(() => Number(getComputedStyle(warning, '::after').opacity) === 0 && warning.getAnimations({subtree:true}).every(animation => animation.playState === 'finished'));
    await fill(96); await until(() => warning.dataset.level === 'critical');
    assert(getComputedStyle(warning, '::after').animationName === 'storage-critical-signal', 'Critical signal did not restart');
  }
  const motion = document.documentElement.dataset.motion;
  try {
    document.documentElement.dataset.motion = 'reduced';
    assert(getComputedStyle(warning, '::after').animationName === 'none', 'Edge still moves with reduced motion');
    assert(getComputedStyle(warning.querySelector('svg')).animationName === 'none', 'Icon still moves with reduced motion');
    assert(Number(getComputedStyle(warning, '::after').opacity) === 0, 'Static edge overlay remains');
  } finally { document.documentElement.dataset.motion = motion; }
  await fill(85); await until(() => warning.dataset.level === 'warning');
});
await check('All themes keep labelled and reachable controls', async () => {
  for (const theme of THEME_OPTIONS) {
    document.documentElement.dataset.theme = theme.id;
    for (const level of ['warning', 'critical']) {
      warning.dataset.level = level;
      const border = rgba(getComputedStyle(warning).borderLeftColor);
      assert(border[0] > border[1] && border[0] > border[2], `Warning border is not red in ${theme.id}`);
      assert(measureColor(warning.querySelector('p'), warning, theme.id, level) >= 4.5, `Low warning text contrast in ${theme.id}`);
      assert(measureColor(warning.querySelector('button'), warning, theme.id, level) >= 4.5, `Low warning button contrast in ${theme.id}`);
    }
    warning.dataset.level = 'warning';
    click('[data-action="manage-storage"]');
    await until(() => document.querySelectorAll('#storageUsageBreakdown dd').length === 4);
    for (const button of dialog.querySelectorAll('button:not([hidden])')) {
      assert(button.textContent.trim(), `Unnamed button in ${theme.id}`);
      const rect = button.getBoundingClientRect();
      assert(rect.width >= 24 && rect.height >= 24, `Small target in ${theme.id}`);
    }
    click('[data-action="close-storage"]');
  }
});
document.documentElement.dataset.storageChecks = results.every(result => result.passed) ? 'passed' : 'failed';
const output = document.createElement('pre'); output.id = 'storageCheckResults';
output.textContent = JSON.stringify(results, null, 2); document.body.append(output);
const colors = document.createElement('pre'); colors.id = 'storageColorResults';
colors.textContent = JSON.stringify(colorSamples, null, 2); document.body.append(colors);
