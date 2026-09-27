/* GitSync — theme toggle (light / dark)
   The initial theme is applied synchronously by an inline script in <head>
   (before first paint) to avoid a flash of the wrong theme. This file wires
   up the toggle button(s) and keeps everything in sync afterwards. */
(function () {
  var STORAGE_KEY = 'gitsync-theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
    updateLabels(theme);
  }

  function updateLabels(theme) {
    var label = theme === 'light' ? 'Light' : 'Dark';
    document.querySelectorAll('.js-theme-label').forEach(function (el) {
      el.textContent = label;
    });
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
      btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    });
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateLabels(currentTheme());
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', toggleTheme);
    });
  });
})();
