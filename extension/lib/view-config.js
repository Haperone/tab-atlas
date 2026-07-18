export const FOLDER_COLORS = ['#78a8c8', '#73937a', '#c8916e', '#9a8ac0', '#c96e72', '#6fae9e', '#c7a85a'];

export const CHROME_GROUP_COLORS = {
  grey: [95, 99, 104], blue: [26, 115, 232], red: [217, 48, 37],
  yellow: [249, 171, 0], green: [30, 142, 62], pink: [208, 24, 132],
  purple: [147, 52, 230], cyan: [0, 123, 131], orange: [250, 144, 62],
};

export const GROUP_COLOR_TO_HEX = {
  grey: null, blue: '#78a8c8', red: '#c96e72', yellow: '#c7a85a',
  green: '#73937a', pink: '#c98ab0', purple: '#9a8ac0', cyan: '#6fae9e', orange: '#c8916e',
};

export const FOLDER_HEX_TO_GROUP = {
  '#78a8c8': 'blue', '#73937a': 'green', '#c8916e': 'orange', '#9a8ac0': 'purple',
  '#c96e72': 'red', '#6fae9e': 'cyan', '#c7a85a': 'yellow',
};

export const THEME_OPTIONS = [
  { id: 'default', label: 'Default', color: '#78a8c8', group: 'dark' },
  { id: 'graphite', label: 'Graphite', color: '#d4af37', group: 'dark' },
  { id: 'solarized', label: 'Solarized', color: '#2f9bd8', group: 'dark' },
  { id: 'tokyonight', label: 'Tokyo Night', color: '#7aa2f7', group: 'dark' },
  { id: 'mocha', label: 'Catppuccin Mocha', color: '#cba6f7', group: 'dark' },
  { id: 'monokai', label: 'Monokai', color: '#a6e22e', group: 'dark' },
  { id: 'obsidian', label: 'Obsidian', color: '#818cf8', group: 'dark' },
  { id: 'auroraglass', label: 'Aurora Glass', color: '#86dfff', group: 'dark' },
  { id: 'smokeglass', label: 'Smoke Glass', color: '#d3c7b8', group: 'dark' },
  { id: 'papersoft', label: 'Paper Soft', color: '#93401f', group: 'light' },
  { id: 'lattesoft', label: 'Latte Soft', color: '#7326cf', group: 'light' },
  { id: 'pearlglass', label: 'Pearl Glass', color: '#6f5ab0', group: 'light' },
  { id: 'paperglass', label: 'Paper Glass', color: '#b98a3a', group: 'light' },
];

export const ONBOARDING_STEPS = [
  { title: 'Open tabs', copy: 'Domain cards show what is open right now. Click a title to jump, bookmark to save, or close tabs when you are done.', targets: ['#openTabsSection'], fallback: '#dashboardColumns' },
  { title: 'Select multiple tabs', copy: 'Hold Ctrl (⌘ on Mac) and click individual tabs to add or remove them from the selection.', demo: 'multiSelect', targets: ['#openTabsSection'], fallback: '#dashboardColumns' },
  { title: 'Move selected tabs', copy: 'Drag any selected saved tab from Saved for later into a folder. The rest of the selection travels with it as one group.', demo: 'dragSelection', targets: ['#deferredColumn'], fallback: '#dashboardColumns' },
  { title: 'Saved for later', copy: 'Saved for later is your inbox for tabs you want to keep without leaving them open.', targets: ['#deferredColumn'], fallback: '#dashboardColumns' },
  { title: 'Folders', copy: 'Folders organize saved tabs into compact groups for projects, research, videos, and tasks.', targets: ['#foldersColumn'], fallback: '#dashboardColumns' },
  { title: 'Search', copy: 'Search open and saved tabs with free text. Press / to focus search, or narrow with domain:github and url:docs.', targets: ['.global-search-row'], fallback: '#dashboardColumns' },
  { title: 'Sweep', copy: 'Sweep turns open tabs into a focused card deck. Swipe left to close, up to save, or right to keep, then review the batch before applying it.', targets: ['[data-action="start-focus-sweep-all"]'], fallback: '#openTabsSection' },
  { title: 'Save workspace', copy: 'Use Save workspace when the whole browser setup is worth keeping as one restorable state.', targets: ['.workspace-edge-save', '[data-action="toggle-workspace-drawer"]'], fallback: '#workspacePanel', spotlightPadding: { top: 18, right: 8, bottom: 8, left: 8 } },
  { title: 'Workspaces', copy: 'Saved states let you restore windows and tabs later, then rename or remove old snapshots as needed.', targets: ['#workspacePanel'], fallback: '#dashboardColumns' },
  { title: 'Top-right controls', copy: 'Bloom switches between your saved light and dark themes. Open Customize to choose both sides of that pair, manage shortcuts and backup, or restart this tour. Privacy stays separate for screen sharing.', virtualTarget: 'cornerControls', spotlightPadding: { top: 8, right: 8, bottom: 8, left: 8 } },
  { title: 'Ready to go', copy: 'Tab Atlas is ready. Start with search, sweep, or a card action whenever the tab count gets heavy.', centered: true },
];
