import { DASHBOARD_PREFERENCES_KEY } from './dashboard-view.js';

export const QUICK_SAVE_APPEARANCE_KEY = 'quickSaveAppearance';

// Share resolved theme tokens with the worker, which cannot access localStorage or CSS.
export function syncQuickSaveAppearance() {
  const root = document.documentElement;
  let previous = '';
  let pending = 0;
  const update = async () => {
    pending = 0;
    const style = getComputedStyle(root);
    const tokens = Object.fromEntries([
      '--view-panel-bg', '--view-panel-border', '--view-panel-radius', '--view-panel-shadow',
      '--view-secondary-text', '--view-danger-text', '--text', '--accent-primary', '--accent-success',
      '--font-sans', '--glass-blur', '--glass-saturation',
    ].map(key => [key, style.getPropertyValue(key).trim()]));
    let preferences;
    try { preferences = JSON.parse(localStorage.getItem(DASHBOARD_PREFERENCES_KEY) || '{}'); } catch {}
    const appearance = { theme: root.dataset.theme, reducedMotion: root.dataset.motion === 'reduced', sound: preferences?.sound !== false, tokens };
    const signature = JSON.stringify(appearance);
    if (signature === previous) return;
    try {
      await chrome.storage.local.set({ [QUICK_SAVE_APPEARANCE_KEY]: appearance });
      previous = signature;
    } catch { /* Theme rendering remains usable if extension storage is unavailable. */ }
  };
  const observer = new MutationObserver(() => {
    if (!pending) pending = requestAnimationFrame(update);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] });
  void update();
}

