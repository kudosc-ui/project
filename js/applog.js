/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * applog.js
 * Tracks what THIS app last pushed to each repo/branch (the "App Commit"),
 * separately from what GitHub is actually serving right now (the "Live
 * GitHub Commit"). The two are usually the same within a second or two of a
 * push, but GitHub's read side can briefly lag behind — this module records
 * the app's own side instantly (no network needed) and can poll GitHub to
 * confirm when the two have converged.
 *
 * Persisted to localStorage so the App Commit panel survives a reload.
 */
const AppLog = (() => {
  const PREFIX = 'gitsync-applog:';

  function keyFor(owner, repo, branch) {
    return `${PREFIX}${owner}/${repo}#${branch}`;
  }

  function load(owner, repo, branch) {
    try {
      const raw = localStorage.getItem(keyFor(owner, repo, branch));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persist(owner, repo, branch, record) {
    try {
      localStorage.setItem(keyFor(owner, repo, branch), JSON.stringify(record));
    } catch (e) {
      // Storage unavailable/full — the App Commit panel just won't persist
      // across reloads this session; nothing else depends on it succeeding.
    }
  }

  /** Records a brand-new successful push. Clears any previous failure note. */
  function recordPush(owner, repo, branch, { sha, message, files }) {
    const record = {
      sha,
      message: message || '',
      files: files || [],           // [{ path, status: 'added'|'modified'|'deleted' }]
      pushedAt: Date.now(),
      verifyStatus: 'pending',       // 'pending' | 'confirmed' | 'unconfirmed'
      lastFailure: null
    };
    persist(owner, repo, branch, record);
    return record;
  }

  /**
   * Records that the most recent upload attempt had per-file failures (the
   * atomic commit never happened, so there's no new sha) without disturbing
   * whatever the last *successful* push was.
   */
  function recordFailure(owner, repo, branch, { message, files }) {
    const existing = load(owner, repo, branch) || {
      sha: null, message: '', files: [], pushedAt: null, verifyStatus: 'unconfirmed'
    };
    existing.lastFailure = { at: Date.now(), message: message || 'Upload failed', files: files || [] };
    persist(owner, repo, branch, existing);
    return existing;
  }

  /** Updates verifyStatus only if the record still refers to the same push. */
  function setVerifyStatus(owner, repo, branch, sha, status) {
    const record = load(owner, repo, branch);
    if (!record || record.sha !== sha) return;
    record.verifyStatus = status;
    persist(owner, repo, branch, record);
  }

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  /**
   * Polls GitHub's branch ref (the strongly-consistent Git Data API, not the
   * higher-level REST commits list) until it reports `expectedSha`, calling
   * onUpdate('confirmed' | 'unconfirmed') once with the outcome. Gives up
   * after ~24s of backoff so a genuinely stuck state doesn't poll forever.
   */
  async function verify(owner, repo, branch, expectedSha, onUpdate) {
    const delays = [1200, 2000, 3000, 4000, 6000, 8000];
    for (const d of delays) {
      await sleep(d);
      try {
        const ref = await GitHub.getRef(owner, repo, branch);
        if (ref && ref.object && ref.object.sha === expectedSha) {
          onUpdate('confirmed');
          return;
        }
      } catch (e) {
        // Transient — just try again on the next tick.
      }
    }
    onUpdate('unconfirmed');
  }

  return { load, recordPush, recordFailure, setVerifyStatus, verify };
})();
