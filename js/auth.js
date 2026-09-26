/**
 * auth.js
 * Handles the GitHub Personal Access Token lifecycle.
 *
 * GitSync is a purely client-side, personal-use app. There is no backend to
 * broker a real OAuth "Authorization Code" flow (that requires a client
 * secret, which can never live safely in frontend code). Instead we use a
 * user-supplied Personal Access Token (PAT / fine-grained token), which is
 * GitHub's own recommended approach for personal scripts and tools.
 *
 * Storage:
 *  - Default: sessionStorage (cleared when the browser tab/window closes).
 *  - Opt-in: localStorage, only if the user explicitly checks "Remember on
 *    this device". This is clearly a tradeoff and is presented as such.
 *  - The token is never written to disk, logged to the console, or sent to
 *    any endpoint other than https://api.github.com.
 */

const Auth = (() => {
  const SESSION_KEY = 'gitsync_token';
  const LOCAL_KEY = 'gitsync_token_persist';
  const REMEMBER_KEY = 'gitsync_remember';

  function saveToken(token, remember) {
    // Always clear both first so we never keep stale copies in two places.
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);

    if (remember) {
      localStorage.setItem(LOCAL_KEY, token);
      localStorage.setItem(REMEMBER_KEY, '1');
    } else {
      sessionStorage.setItem(SESSION_KEY, token);
      localStorage.removeItem(REMEMBER_KEY);
    }
  }

  function getToken() {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(LOCAL_KEY) || null;
  }

  function clearToken() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
    localStorage.removeItem(REMEMBER_KEY);
  }

  function isRemembered() {
    return localStorage.getItem(REMEMBER_KEY) === '1';
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
      throw new Error('Could not reach GitHub. Check your internet connection.');
    }

    if (response.status === 401) {
      throw new Error('That token was rejected by GitHub. Double-check it and try again.');
    }
    if (!response.ok) {
      throw new Error('GitHub authentication expired. Please reconnect your GitHub account.');
    }
    return response.json();
  }

  return { saveToken, getToken, clearToken, isRemembered, validateToken };
})();
