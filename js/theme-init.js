/* Applies the saved theme before first paint (external file so the CSP can forbid inline scripts). */
(function () {
  try {
    var t = localStorage.getItem('gitsync-theme');
    if (!t) { t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* ignore */ }
})();
