/* Applies the saved theme before first paint (no flash).
   Must be an EXTERNAL script: Manifest V3's CSP blocks inline <script>. */
try {
  document.documentElement.dataset.theme = localStorage.getItem('tabout-theme') || 'default';
} catch (e) {
  document.documentElement.dataset.theme = 'default';
}
