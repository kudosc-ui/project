/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * github.js
 * Thin wrapper around the GitHub REST + Git Data API.
 * Every request goes straight from the browser to https://api.github.com —
 * nothing is proxied through a third-party server.
 */

const GitHub = (() => {
  const BASE = 'https://api.github.com';

  function headers() {
    const token = Auth.getToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async function request(path, options = {}) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { ...headers(), ...(options.headers || {}) }
      });
    } catch (e) {
      const err = new Error('Network error while contacting GitHub.');
      err.kind = 'network';
      try { window.dispatchEvent(new Event('gitsync:network-error')); } catch (_) { /* ignore */ }
      throw err;
    }

    if (res.status === 401) {
      const err = new Error('GitHub authentication expired. Please reconnect your GitHub account.');
      err.kind = 'auth';
      throw err;
    }
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const retryAfterHeader = res.headers.get('retry-after');
      const body = await res.json().catch(() => ({}));
      // GitHub returns 403 both for "out of quota" (x-ratelimit-remaining:0)
      // AND for its separate, unlabeled "secondary rate limit" (too many
      // requests too quickly — e.g. many files uploaded back-to-back from a
      // large multi-folder project). Both are transient and worth retrying;
      // a real permission problem is neither.
      const isSecondary = /secondary rate limit|abuse detection|too many requests/i.test(body.message || '');
      const isRateLimit = remaining === '0' || isSecondary || !!retryAfterHeader;
      const err = new Error(isRateLimit
        ? (body.message || 'GitHub API rate limit reached. Please wait a few minutes and try again.')
        : 'Permission denied for this action on GitHub.');
      err.kind = isRateLimit ? 'rate_limit' : 'permission';
      if (retryAfterHeader) err.retryAfter = parseInt(retryAfterHeader, 10);
      throw err;
    }
    if (res.status === 404) {
      const err = new Error('That repository, branch, or resource could not be found.');
      err.kind = 'not_found';
      throw err;
    }
    if (res.status === 409) {
      const err = new Error('Repository is empty or the reference could not be resolved.');
      err.kind = 'conflict';
      throw err;
    }
    if (res.status === 422) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.message || 'GitHub rejected this request as invalid.');
      err.kind = 'invalid';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`GitHub request failed (status ${res.status}).`);
      err.kind = 'unknown';
      throw err;
    }

    if (res.status === 204) return null;
    return res.json();
  }

  // ---- Repositories ----

  async function listRepos() {
    // Paginate through the user's repos (affiliated: owner/collab/org member).
    let page = 1;
    let all = [];
    while (true) {
      const batch = await request(`/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`);
      all = all.concat(batch);
      if (batch.length < 100) break;
      page++;
      if (page > 10) break; // safety cap
    }
    return all;
  }

  function listBranches(owner, repo) {
    return request(`/repos/${owner}/${repo}/branches?per_page=100`);
  }

  function getBranch(owner, repo, branch) {
    return request(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  }

  function getRef(owner, repo, branch) {
    return request(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  }

  function getCommit(owner, repo, sha) {
    return request(`/repos/${owner}/${repo}/git/commits/${sha}`);
  }

  function getTree(owner, repo, treeSha, recursive) {
    return request(`/repos/${owner}/${repo}/git/trees/${treeSha}${recursive ? '?recursive=1' : ''}`);
  }

  function createBlob(owner, repo, base64Content) {
    return request(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: base64Content, encoding: 'base64' })
    });
  }

  function createTree(owner, repo, baseTreeSha, treeEntries) {
    const payload = { tree: treeEntries };
    if (baseTreeSha) payload.base_tree = baseTreeSha;
    return request(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  function createCommit(owner, repo, message, treeSha, parentSha) {
    return request(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: treeSha, parents: parentSha ? [parentSha] : [] })
    });
  }

  function updateRef(owner, repo, branch, commitSha, force = false) {
    return request(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha, force })
    });
  }

  function getLatestCommitForBranch(owner, repo, branch) {
    // Returns { sha, commit: { message, author: { date } } }
    return request(`/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}?per_page=1`);
  }

  /** Returns up to `count` recent commit summaries (sha + message + date, no file list) for a branch. */
  function listCommits(owner, repo, branch, count = 5) {
    return request(`/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`);
  }

  /** Returns full detail for one commit, including its files[] (added/modified/removed, +/- counts). */
  function getCommitDetail(owner, repo, sha) {
    return request(`/repos/${owner}/${repo}/commits/${sha}`);
  }

  // ---- Repository creation & metadata ----

  /**
   * opts: { autoInit, gitignore, license }
   *  - gitignore: a template name from listGitignoreTemplates() (e.g. "Node")
   *  - license:   a license key from listLicenses() (e.g. "mit")
   * GitHub only applies gitignore/license templates when auto_init is true.
   */
  function createRepo(name, isPrivate, description, opts = {}) {
    // auto_init: true makes GitHub create the initial commit + branch ref
    // as part of repo creation itself, atomically. That removes the race
    // window where the repo record exists but its Git internals (blobs,
    // trees, refs) aren't ready yet — the source of the old "repository is
    // empty / reference could not be resolved" failures on a fresh repo.
    const autoInit = opts.autoInit !== false;
    const payload = {
      name,
      private: !!isPrivate,
      description: description || '',
      auto_init: autoInit
    };
    if (autoInit && opts.gitignore) payload.gitignore_template = opts.gitignore;
    if (autoInit && opts.license) payload.license_template = opts.license;
    return request('/user/repos', { method: 'POST', body: JSON.stringify(payload) });
  }

  /** Every license GitHub offers (name + key), for the "Add license" dropdown. */
  function listLicenses() {
    return request('/licenses?per_page=100');
  }

  /** Every .gitignore template GitHub offers (array of names). */
  function listGitignoreTemplates() {
    return request('/gitignore/templates');
  }

  function getRepo(owner, repo) {
    return request(`/repos/${owner}/${repo}`);
  }

  /** Renames a repository (PATCH name). GitHub keeps redirecting the old URL. */
  function renameRepo(owner, repo, newName) {
    return request(`/repos/${owner}/${repo}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
  }

  function deleteRepo(owner, repo) {
    return request(`/repos/${owner}/${repo}`, { method: 'DELETE' });
  }

  /** Creates a brand-new branch ref (used for a repo's very first commit, where no ref exists yet). */
  function createRef(owner, repo, branch, commitSha) {
    return request(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha })
    });
  }

  // ---- Single-file contents (view / edit / delete individual files) ----

  function getContents(owner, repo, path, ref) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return request(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${q}`);
  }

  function putContents(owner, repo, path, message, base64Content, sha, branch) {
    const payload = { message, content: base64Content, branch };
    if (sha) payload.sha = sha; // required when overwriting an existing file
    return request(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  function deleteFileContents(owner, repo, path, message, sha, branch) {
    return request(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch })
    });
  }

  // ---- GitHub Pages ----

  function enablePages(owner, repo, branch, path = '/') {
    return request(`/repos/${owner}/${repo}/pages`, {
      method: 'POST',
      body: JSON.stringify({ source: { branch, path } })
    });
  }

  function getPages(owner, repo) {
    return request(`/repos/${owner}/${repo}/pages`);
  }

  // ---- Profile ----

  function getUser() { return request('/user'); }
  /** Updates the signed-in user's profile. Only the fields passed are changed. */
  function updateUser(fields) { return request('/user', { method: 'PATCH', body: JSON.stringify(fields) }); }
  function listOrgs() { return request('/user/orgs?per_page=50'); }
  function listFollowers(page = 1) { return request(`/user/followers?per_page=30&page=${page}`); }
  function listFollowing(page = 1) { return request(`/user/following?per_page=30&page=${page}`); }
  function listStarred(page = 1) { return request(`/user/starred?per_page=30&page=${page}`); }

  /** Total starred repos: ask for 1 per page and read the last page number from the Link header. */
  async function starredCount() {
    const res = await fetch(`${BASE}/user/starred?per_page=1`, { headers: headers() });
    if (!res.ok) throw new Error('Could not load stars.');
    const link = res.headers.get('link') || '';
    const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    if (m) return parseInt(m[1], 10);
    const arr = await res.json().catch(() => []);
    return Array.isArray(arr) ? arr.length : 0;
  }

  /** GraphQL: pinned repositories + the contribution calendar (neither exists in the REST API). */
  function graphql(query) {
    return request('/graphql', { method: 'POST', body: JSON.stringify({ query }) });
  }

  /** The profile README (repo named after the user), as GitHub-rendered HTML, or null if there isn't one. */
  async function getProfileReadmeHtml(login) {
    let res;
    try {
      res = await fetch(`${BASE}/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`, {
        headers: { ...headers(), 'Accept': 'application/vnd.github.html+json' }
      });
    } catch (e) { return null; }
    if (!res.ok) return null;
    return res.text();
  }

  return {
    listRepos, listBranches, getBranch, getRef, getCommit, getTree,
    createBlob, createTree, createCommit, updateRef, getLatestCommitForBranch,
    listCommits, getCommitDetail,
    createRepo, listLicenses, listGitignoreTemplates, getRepo, deleteRepo, createRef,
    getUser, updateUser, renameRepo, listOrgs, listFollowers, listFollowing, listStarred, starredCount, graphql, getProfileReadmeHtml,
    getContents, putContents, deleteFileContents,
    enablePages, getPages
  };
})();
