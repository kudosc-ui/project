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
      throw err;
    }

    if (res.status === 401) {
      const err = new Error('GitHub authentication expired. Please reconnect your GitHub account.');
      err.kind = 'auth';
      throw err;
    }
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const err = new Error(remaining === '0'
        ? 'GitHub API rate limit reached. Please wait a few minutes and try again.'
        : 'Permission denied for this action on GitHub.');
      err.kind = remaining === '0' ? 'rate_limit' : 'permission';
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

  // ---- Repository creation & metadata ----

  function createRepo(name, isPrivate, description) {
    return request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        private: !!isPrivate,
        description: description || '',
        auto_init: false
      })
    });
  }

  function getRepo(owner, repo) {
    return request(`/repos/${owner}/${repo}`);
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

  return {
    listRepos, listBranches, getBranch, getRef, getCommit, getTree,
    createBlob, createTree, createCommit, updateRef, getLatestCommitForBranch,
    createRepo, getRepo, deleteRepo, createRef,
    getContents, putContents, deleteFileContents,
    enablePages, getPages
  };
})();
