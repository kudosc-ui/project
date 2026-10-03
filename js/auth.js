/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * auth.js
 * Handles GitHub Personal Access Tokens for one or more saved accounts, so
 * the person can switch between them without re-pasting a token each time.
 *
 * Storage: accounts (login, token, avatarUrl) are kept in localStorage as a
 * small JSON array, plus a pointer to which one is "active". This is a
 * deliberate tradeoff for the multi-account switcher to be genuinely
 * useful across browser sessions — each account can be removed individually
 * at any time from the Accounts UI, and nothing is ever sent anywhere
 * except https://api.github.com.
 */

const Auth = (() => {
  const ACCOUNTS_KEY = 'gitsync_accounts';
  const ACTIVE_KEY = 'gitsync_active_login';

  // Superseded single-token keys from earlier versions of GitSync, migrated
  // automatically into the accounts list on first load.
  const LEGACY_SESSION_KEY = 'gitsync_token';
  const LEGACY_LOCAL_KEY = 'gitsync_token_persist';

  function loadAccounts() {
    try {
      const raw = localStorage.getItem(ACCOUNTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveAccounts(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function getAccounts() {
    return loadAccounts();
  }

  function getActiveLogin() {
    return localStorage.getItem(ACTIVE_KEY);
  }

  function getActiveAccount() {
    const login = getActiveLogin();
    if (!login) return null;
    return loadAccounts().find(a => a.login === login) || null;
  }

  /** Returns a legacy pre-multi-account token if one exists and hasn't been migrated yet. */
  function legacyToken() {
    return sessionStorage.getItem(LEGACY_SESSION_KEY) || localStorage.getItem(LEGACY_LOCAL_KEY) || null;
  }

  function getToken() {
    const active = getActiveAccount();
    if (active) return active.token;
    return legacyToken();
  }

  /** Adds a new account or updates an existing one (matched by login), and makes it active. */
  function upsertAccount(login, token, avatarUrl) {
    const accounts = loadAccounts();
    const idx = accounts.findIndex(a => a.login === login);
    const entry = { login, token, avatarUrl: avatarUrl || null };
    if (idx >= 0) accounts[idx] = entry; else accounts.push(entry);
    saveAccounts(accounts);
    localStorage.setItem(ACTIVE_KEY, login);
    // The account list is now the single source of truth for this login.
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(LEGACY_LOCAL_KEY);
  }

  function setActiveAccount(login) {
    localStorage.setItem(ACTIVE_KEY, login);
  }

  function removeAccount(login) {
    const accounts = loadAccounts().filter(a => a.login !== login);
    saveAccounts(accounts);
    if (getActiveLogin() === login) {
      if (accounts.length) {
        localStorage.setItem(ACTIVE_KEY, accounts[0].login);
      } else {
        localStorage.removeItem(ACTIVE_KEY);
      }
    }
  }

  /** "Disconnect" — removes whichever account is currently active. */
  function clearToken() {
    const login = getActiveLogin();
    if (login) {
      removeAccount(login);
    } else {
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      localStorage.removeItem(LEGACY_LOCAL_KEY);
    }
  }

  /**
   * Validates a token by asking GitHub who it belongs to.
   * Returns the user object on success, throws a friendly Error on failure.
   */
  async function validateToken(token) {
    let response;
    try {
      response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
    } catch (networkErr) {
      const err = new Error('Could not reach GitHub. Check your internet connection.');
      err.kind = 'network';
      try { window.dispatchEvent(new Event('gitsync:network-error')); } catch (_) { /* ignore */ }
      throw err;
    }

    if (response.status === 401) {
      const err = new Error('That token was rejected by GitHub. Double-check it and try again.');
      err.kind = 'auth';
      throw err;
    }
    if (!response.ok) {
      // A non-401 failure here (5xx, a flaky proxy, a momentary GitHub
      // outage) says nothing about whether the token itself is still good —
      // it must NOT be treated the same as a rejected token by callers.
      const err = new Error('GitHub could not be reached right now. Please try again.');
      err.kind = 'transient';
      throw err;
    }
    return response.json();
  }

  return {
    getAccounts, getActiveLogin, getActiveAccount, getToken,
    upsertAccount, setActiveAccount, removeAccount, clearToken,
    validateToken
  };
})();
