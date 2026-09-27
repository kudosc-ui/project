/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * accounts.js
 * Renders the "Connected Accounts" list and add-account form. This same
 * markup/IDs are reused on both pages: inline inside Home's Settings view,
 * and inside a modal on the Custom page — whichever is present in the DOM.
 */

const AccountsUI = (() => {

  function avatarHtml(account) {
    if (account.avatarUrl) {
      return `<img class="account-avatar" src="${account.avatarUrl}" alt="${account.login}">`;
    }
    const initial = account.login.charAt(0).toUpperCase();
    return `<span class="account-avatar account-avatar-fallback">${initial}</span>`;
  }

  function render() {
    const container = document.getElementById('accounts-list');
    if (!container) return;

    const accounts = Auth.getAccounts();
    const activeLogin = Auth.getActiveLogin();
    container.innerHTML = '';

    if (!accounts.length) {
      container.innerHTML = '<div class="hint" style="padding:6px 0 12px">No accounts connected yet.</div>';
      return;
    }

    for (const account of accounts) {
      const isActive = account.login === activeLogin;
      const row = document.createElement('div');
      row.className = `account-row${isActive ? ' account-row-active' : ''}`;
      row.innerHTML = `
        ${avatarHtml(account)}
        <span class="account-login">@${account.login}</span>
        ${isActive ? '<span class="account-badge">ACTIVE</span>' : '<button class="btn-link small" data-action="switch">Switch</button>'}
        <button class="btn-link small account-remove-btn" data-action="remove">Remove</button>
      `;
      const switchBtn = row.querySelector('[data-action="switch"]');
      if (switchBtn) switchBtn.addEventListener('click', () => handleSwitch(account.login));
      row.querySelector('[data-action="remove"]').addEventListener('click', () => handleRemove(account.login));
      container.appendChild(row);
    }
  }

  function handleSwitch(login) {
    Auth.setActiveAccount(login);
    window.location.reload();
  }

  async function handleRemove(login) {
    const ok = await UI.confirm(
      `Remove the saved token for @${login} from this browser? You can always add it again later.`,
      'Remove account'
    );
    if (!ok) return;
    Auth.removeAccount(login);
    window.location.reload();
  }

  async function handleAddAccount() {
    const input = document.getElementById('add-account-token');
    const errEl = document.getElementById('add-account-error');
    const btn = document.getElementById('add-account-btn');
    if (!input || !btn) return;

    const token = input.value.trim();
    errEl.classList.add('hidden');
    if (!token) {
      errEl.textContent = 'Paste a token first.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const user = await Auth.validateToken(token);
      Auth.upsertAccount(user.login, token, user.avatar_url);
      input.value = '';
      window.location.reload();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Account';
    }
  }

  function init() {
    render();
    const addBtn = document.getElementById('add-account-btn');
    if (addBtn) addBtn.addEventListener('click', handleAddAccount);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { render };
})();
