import { THEME_OPTIONS } from './view-config.js';

export function createThemeController({ document, storage, showContextMenu, showToast }) {
  function currentTheme() {
    let theme = 'default';
    try { theme = storage.getItem('tabout-theme') || 'default'; } catch {}
    return THEME_OPTIONS.some(option => option.id === theme) ? theme : 'default';
  }

  function applyTheme(id) {
    document.documentElement.dataset.theme = id;
    try { storage.setItem('tabout-theme', id); } catch {}
  }

  function openThemeMenu(x, y) {
    const current = currentTheme();
    const items = [];
    const addGroup = (label, group) => {
      items.push({ heading: true, label });
      for (const theme of THEME_OPTIONS.filter(option => option.group === group)) {
        items.push({
          label: theme.label,
          swatchColor: theme.color,
          checked: theme.id === current,
          onClick: () => {
            applyTheme(theme.id);
            showToast(`Theme: ${theme.label}`);
          },
        });
      }
    };
    addGroup('Dark', 'dark');
    addGroup('Light', 'light');
    showContextMenu(x, y, items);
  }

  return Object.freeze({ currentTheme, applyTheme, openThemeMenu });
}
