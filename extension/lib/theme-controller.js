import { THEME_OPTIONS } from './view-config.js';

export const THEME_KEY = 'tabout-theme';
export const DARK_THEME_KEY = 'tabout-theme-dark';
export const LIGHT_THEME_KEY = 'tabout-theme-light';

const DEFAULT_DARK_THEME = 'default';
const DEFAULT_LIGHT_THEME = 'paper';

export function createThemeController({ document, storage, showContextMenu, showToast }) {
  function readStorage(key) {
    try { return storage.getItem(key); } catch { return null; }
  }

  function writeStorage(key, value) {
    try { storage.setItem(key, value); } catch {}
  }

  function themeOption(id) {
    return THEME_OPTIONS.find(option => option.id === id) || null;
  }

  function optionForGroup(id, group, fallbackId) {
    const option = themeOption(id);
    return option?.group === group ? option : themeOption(fallbackId);
  }

  function currentTheme() {
    const stored = readStorage(THEME_KEY) || DEFAULT_DARK_THEME;
    return themeOption(stored)?.id || DEFAULT_DARK_THEME;
  }

  function currentThemeOption() {
    return themeOption(currentTheme()) || THEME_OPTIONS[0];
  }

  function currentThemePairOptions() {
    const current = currentThemeOption();
    const darkFallback = current.group === 'dark' ? current.id : DEFAULT_DARK_THEME;
    const lightFallback = current.group === 'light' ? current.id : DEFAULT_LIGHT_THEME;
    const storedDark = readStorage(DARK_THEME_KEY);
    const storedLight = readStorage(LIGHT_THEME_KEY);
    const dark = optionForGroup(storedDark, 'dark', darkFallback);
    const light = optionForGroup(storedLight, 'light', lightFallback);
    if (storedDark !== dark.id) writeStorage(DARK_THEME_KEY, dark.id);
    if (storedLight !== light.id) writeStorage(LIGHT_THEME_KEY, light.id);
    return { dark, light };
  }

  function syncThemeToggle() {
    const current = currentThemeOption();
    const pair = currentThemePairOptions();
    const target = current.group === 'light' ? pair.dark : pair.light;
    if (document?.documentElement?.dataset) {
      document.documentElement.dataset.themeMode = current.group;
    }
    const toggle = document?.getElementById?.('themeModeToggle');
    if (!toggle) return;
    toggle.dataset.mode = current.group;
    toggle.setAttribute('aria-pressed', String(current.group === 'light'));
    const label = `Switch to ${target.label}`;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }

  function applyTheme(id) {
    const option = themeOption(id) || themeOption(DEFAULT_DARK_THEME);
    document.documentElement.dataset.theme = option.id;
    writeStorage(THEME_KEY, option.id);
    syncThemeToggle();
    return option;
  }

  function setThemeForMode(group, id) {
    const key = group === 'light' ? LIGHT_THEME_KEY : DARK_THEME_KEY;
    const fallback = group === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const option = optionForGroup(id, group, fallback);
    writeStorage(key, option.id);
    if (currentThemeOption().group === group) applyTheme(option.id);
    else syncThemeToggle();
    return option;
  }

  function toggleThemeMode() {
    const current = currentThemeOption();
    const pair = currentThemePairOptions();
    const target = current.group === 'light' ? pair.dark : pair.light;
    applyTheme(target.id);
    showToast(`Theme: ${target.label}`);
    return target;
  }

  function openThemeMenu(x, y) {
    const current = currentThemeOption();
    const pair = currentThemePairOptions();
    const items = [];
    const addGroup = (label, group) => {
      items.push({ heading: true, label });
      for (const theme of THEME_OPTIONS.filter(option => option.group === group)) {
        items.push({
          label: theme.id === current.id ? `${theme.label} · active` : theme.label,
          swatchColor: theme.color,
          checked: theme.id === pair[group].id,
          onClick: () => {
            setThemeForMode(group, theme.id);
            showToast(`${group === 'light' ? 'Light' : 'Dark'} theme: ${theme.label}`);
            openThemeMenu(x, y);
          },
        });
      }
    };
    addGroup('Dark theme · Bloom pair', 'dark');
    items.push({ separator: true });
    addGroup('Light theme · Bloom pair', 'light');
    showContextMenu(x, y, items);
  }

  syncThemeToggle();

  return Object.freeze({
    applyTheme,
    currentTheme,
    currentThemeOption,
    currentThemePairOptions,
    openThemeMenu,
    setThemeForMode,
    syncThemeToggle,
    toggleThemeMode,
  });
}
