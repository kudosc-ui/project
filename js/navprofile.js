/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/* navprofile.js — fills the navbar profile icon with the active account's
   GitHub avatar (falls back to a generic person icon). */
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var acc = null;
    try { acc = window.Auth && Auth.getActiveAccount(); } catch (e) { /* ignore */ }
    document.querySelectorAll('.profile-btn').forEach(function (btn) {
      var img = btn.querySelector('.profile-btn-img');
      var fb = btn.querySelector('.profile-btn-fallback');
      if (acc && acc.login) btn.title = '@' + acc.login;
      if (!acc || !acc.avatarUrl || !img) return;
      img.onload = function () { img.classList.remove('hidden'); if (fb) fb.classList.add('hidden'); };
      img.src = acc.avatarUrl + (acc.avatarUrl.indexOf('?') === -1 ? '?' : '&') + 's=80';
    });
  });
})();
