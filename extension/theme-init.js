/* Applies the saved theme + privacy state before first paint (no flash).
   Must be an EXTERNAL script: Manifest V3's CSP blocks inline <script>. */
try {
  document.documentElement.dataset.theme = localStorage.getItem('tabout-theme') || 'default';
  // Restore privacy mode pre-paint so a new tab never flashes the dashboard
  if (localStorage.getItem('tabout-privacy') === '1') {
    document.documentElement.dataset.privacy = 'on';
  }
} catch (e) {
  document.documentElement.dataset.theme = 'default';
}
