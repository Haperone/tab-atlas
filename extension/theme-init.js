/* Applies the saved theme + privacy state before first paint (no flash).
   Must be an EXTERNAL script: Manifest V3's CSP blocks inline <script>. */
try {
  const theme = localStorage.getItem('tabout-theme') || 'default';
  const lightThemes = new Set(['paper', 'latte', 'papersoft', 'lattesoft']);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeMode = lightThemes.has(theme) ? 'light' : 'dark';
  // Restore privacy mode pre-paint so a new tab never flashes the dashboard
  if (localStorage.getItem('tabout-privacy') === '1') {
    document.documentElement.dataset.privacy = 'on';
  }
} catch (e) {
  document.documentElement.dataset.theme = 'default';
  document.documentElement.dataset.themeMode = 'dark';
}
