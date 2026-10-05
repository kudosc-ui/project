/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. See LICENSE for full terms.
 */
/**
 * edit-profile.js — edit your GitHub profile from inside GitSync (PATCH /user).
 * Only changed fields are sent. The username (login) can't be changed via the API.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const TEXT = { name: 'ef-name', bio: 'ef-bio', email: 'ef-email', blog: 'ef-blog', twitter_username: 'ef-twitter', company: 'ef-company', location: 'ef-location' };
  let original = {};

  function read() {
    const o = {};
    Object.keys(TEXT).forEach((k) => { o[k] = $(TEXT[k]).value.trim(); });
    o.twitter_username = o.twitter_username.replace(/^@+/, '');
    o.hireable = $('ef-hireable').checked;
    return o;
  }
  const changed = () => { const c = read(); return Object.keys(c).filter((k) => c[k] !== original[k]); };

  function refresh() {
    $('ef-bio-count').textContent = $('ef-bio').value.length;
    $('ep-save').disabled = changed().length === 0;
  }

  function friendly(e) {
    if (!e) return 'Something went wrong. Please try again.';
    if (e.kind === 'auth') return 'GitHub authentication expired. Please reconnect your GitHub account.';
    if (e.kind === 'permission' || e.kind === 'not_found') return 'GitHub refused the update. Your token needs the "user" scope (classic token) or "Profile: Read and write" (fine-grained token).';
    if (e.kind === 'rate_limit') return 'GitHub API rate limit reached. Please wait a few minutes and try again.';
    if (e.kind === 'network') return 'Network error. Check your connection and try again.';
    return e.message || 'Something went wrong. Please try again.';
  }

  function fill(u) {
    original = {
      name: u.name || '', bio: u.bio || '', email: u.email || '', blog: u.blog || '',
      twitter_username: u.twitter_username || '', company: u.company || '', location: u.location || '',
      hireable: !!u.hireable
    };
    Object.keys(TEXT).forEach((k) => { $(TEXT[k]).value = original[k]; });
    $('ef-hireable').checked = original.hireable;
    $('ef-login').value = '@' + u.login;
    $('ep-title').textContent = u.name || u.login;
    $('ep-handle').textContent = '@' + u.login;
    if (u.avatar_url) $('ep-avatar').src = u.avatar_url + (u.avatar_url.includes('?') ? '&' : '?') + 's=120';
    refresh();
  }

  async function save() {
    const keys = changed();
    if (!keys.length) return;
    const cur = read();
    const payload = {};
    keys.forEach((k) => { payload[k] = cur[k]; });
    const btn = $('ep-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    $('ep-error').classList.add('hidden');
    try {
      const u = await GitHub.updateUser(payload);
      fill(u);
      UI.toast('Profile updated');
      setTimeout(() => { location.href = 'profile.html'; }, 700);
    } catch (e) {
      $('ep-error').textContent = friendly(e);
      $('ep-error').classList.remove('hidden');
      btn.disabled = false;
    } finally {
      btn.textContent = 'Save Changes';
    }
  }

  async function boot() {
    if (!Auth.getToken()) { $('ep-not-connected').classList.remove('hidden'); return; }
    $('ep-connected').classList.remove('hidden');
    const acc = Auth.getActiveAccount();
    if (acc) { $('ep-handle').textContent = '@' + acc.login; $('ef-login').value = '@' + acc.login; }

    Object.values(TEXT).concat(['ef-hireable']).forEach((id) => {
      $(id).addEventListener('input', refresh);
      $(id).addEventListener('change', refresh);
    });
    $('ep-save').addEventListener('click', save);
    $('ep-back').addEventListener('click', async (ev) => {
      if (!changed().length) return;
      ev.preventDefault();
      if (await UI.confirm('You have unsaved changes. Leave without saving?', 'Discard changes')) location.href = 'profile.html';
    });

    try { fill(await GitHub.getUser()); }
    catch (e) { UI.toast(friendly(e)); $('ep-title').textContent = acc ? acc.login : 'Profile'; }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
