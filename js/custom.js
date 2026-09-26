/**
 * custom.js
 * Drives the standalone Custom page (custom.html): creating a new
 * repository (optionally seeded from a ZIP), enabling GitHub Pages hosting,
 * and browsing/editing/deleting individual files in any existing
 * repository. Uses the same Auth/GitHub/Files/ZipHandler/Compare/Commit
 * building blocks as the Home page, plus AccountsUI for the account
 * switcher modal.
 */

(() => {
  const state = {
    repos: [],
    browsing: null // { owner, repoName, branch, treeMap: Map<path,{sha,size}> }
  };

  function splitFullName(fullName) {
    const [owner, repo] = fullName.split('/');
    return { owner, repo };
  }

  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.kind === 'auth') return 'GitHub authentication expired. Please reconnect your GitHub account.';
    if (err.kind === 'permission') return 'Permission denied. Check your token\'s scopes.';
    if (err.kind === 'not_found') return 'Not found — it may have been renamed, deleted, or not exist yet.';
    if (err.kind === 'rate_limit') return 'GitHub API rate limit reached. Please wait a few minutes and try again.';
    if (err.kind === 'network') return 'Network error. Check your connection and try again.';
    if (err.kind === 'invalid') return err.message;
    return err.message || 'Something went wrong. Please try again.';
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function base64ToBytes(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesLookBinary(bytes) {
    return bytes.slice(0, 8000).includes(0);
  }

  function extOf(path) {
    const dot = path.lastIndexOf('.');
    return dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  }

  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
  const HTML_EXT = new Set(['html', 'htm']);

  // ---------------- Entry: connected vs not-connected ----------------

  function boot() {
    const token = Auth.getToken();
    if (!token) {
      document.getElementById('custom-not-connected').classList.remove('hidden');
      return;
    }
    document.getElementById('custom-connected').classList.remove('hidden');
    const account = Auth.getActiveAccount();
    document.getElementById('custom-username-label').textContent = account ? account.login : '…';
    loadRepoList();
  }

  // ---------------- Repository list ----------------

  async function loadRepoList() {
    const container = document.getElementById('custom-repo-list');
    container.innerHTML = '<div class="hint" style="padding:10px 0">Loading repositories…</div>';
    try {
      state.repos = await GitHub.listRepos();
      renderRepoList();
    } catch (e) {
      container.innerHTML = '';
      UI.toast(friendlyError(e));
    }
  }

  function renderRepoList() {
    const container = document.getElementById('custom-repo-list');
    const search = (document.getElementById('custom-repo-search').value || '').toLowerCase();
    const repos = state.repos.filter(r => r.full_name.toLowerCase().includes(search));
    container.innerHTML = '';

    if (!repos.length) {
      container.innerHTML = '<div class="hint" style="padding:10px 0">No repositories found.</div>';
      return;
    }

    for (const repo of repos) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="file-row-top">
          <span class="file-path">${UI.escapeHtml(repo.full_name)}</span>
          <span class="visibility-badge ${repo.private ? 'private' : 'public'}">${repo.private ? 'PRIVATE' : 'PUBLIC'}</span>
        </div>
        <div class="repo-row-actions">
          <button class="btn-link small" data-action="browse">Browse Files</button>
          <a class="btn-link small" href="${repo.html_url}" target="_blank" rel="noopener">Open on GitHub ↗</a>
        </div>
      `;
      row.querySelector('[data-action="browse"]').addEventListener('click', () => browseRepo(repo.full_name));
      container.appendChild(row);
    }
  }

  // ---------------- Create repository ----------------

  async function handleCreateRepo() {
    const nameInput = document.getElementById('new-repo-name');
    const name = nameInput.value.trim();
    const isPrivate = document.querySelector('input[name="new-repo-visibility"]:checked').value === 'private';
    const zipInput = document.getElementById('new-repo-zip-input');
    const zipFile = zipInput.files && zipInput.files[0];
    const errEl = document.getElementById('create-repo-error');
    const btn = document.getElementById('create-repo-btn');
    errEl.classList.add('hidden');

    if (!name) {
      errEl.textContent = 'Please enter a repository name.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      errEl.textContent = 'Repository names can only contain letters, numbers, dots, hyphens and underscores.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    document.getElementById('create-repo-success-card').classList.add('hidden');
    const progressCard = document.getElementById('create-repo-progress-card');
    progressCard.classList.remove('hidden');
    setCreateProgress(5, 'Creating repository…', '');

    try {
      const repo = await GitHub.createRepo(name, isPrivate);
      const owner = repo.owner.login;
      const branch = repo.default_branch || 'main';

      if (zipFile) {
        setCreateProgress(15, 'Extracting ZIP file…', '');
        const { fileMap, skipped, tooLarge } = await ZipHandler.extractZip(
          zipFile,
          (pct, detail) => setCreateProgress(15 + Math.round(pct * 0.25), 'Extracting ZIP file…', detail)
        );
        if (skipped.length) UI.toast(`${skipped.length} file(s) skipped (unsafe path or duplicate).`);
        if (tooLarge.length) UI.toast(`${tooLarge.length} file(s) skipped (exceeds size limit).`);

        if (fileMap.size) {
          setCreateProgress(45, 'Hashing files…', '');
          const localHashes = new Map();
          const entries = Array.from(fileMap.entries());
          for (let i = 0; i < entries.length; i++) {
            const [path, file] = entries[i];
            const buf = await file.arrayBuffer();
            localHashes.set(path, await Compare.gitBlobSha1(buf));
            setCreateProgress(45 + Math.round(((i + 1) / entries.length) * 15), 'Hashing files…', `${i + 1} of ${entries.length}`);
          }
          const diff = Compare.computeDiff(fileMap, localHashes, new Map(), 'repo', '');

          await Commit.pushCommit({
            owner, repo: repo.name, branch,
            baseCommitSha: null, baseTreeSha: null,
            diff, message: 'Initial commit via GitSync',
            onProgress: (pct, label) => setCreateProgress(60 + Math.round(pct * 0.4), label, ''),
            onFileResult: () => {}
          });
        }
      }

      setCreateProgress(100, 'Done', '');
      progressCard.classList.add('hidden');
      showCreateSuccess(repo, owner, branch, isPrivate);
      nameInput.value = '';
      zipInput.value = '';
      state.repos = []; // force a refresh next time the list is viewed
      loadRepoList();
    } catch (e) {
      progressCard.classList.add('hidden');
      errEl.textContent = friendlyError(e);
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  }

  function setCreateProgress(pct, label, detail) {
    document.getElementById('create-repo-progress-bar').style.width = `${pct}%`;
    document.getElementById('create-repo-progress-percent').textContent = `${pct}%`;
    if (label != null) document.getElementById('create-repo-progress-label').textContent = label;
    if (detail != null) document.getElementById('create-repo-progress-detail').textContent = detail;
  }

  function showCreateSuccess(repo, owner, branch, isPrivate) {
    const card = document.getElementById('create-repo-success-card');
    card.classList.remove('hidden');
    document.getElementById('create-repo-result-name').textContent = repo.full_name;
    document.getElementById('create-repo-result-link').href = repo.html_url;

    document.getElementById('pages-result-row').classList.add('hidden');
    const pagesBtn = document.getElementById('enable-pages-btn');
    if (isPrivate) {
      pagesBtn.classList.add('hidden');
    } else {
      pagesBtn.classList.remove('hidden');
      pagesBtn.disabled = false;
      pagesBtn.textContent = 'Host with GitHub Pages';
      pagesBtn.onclick = () => handleEnablePages(owner, repo.name, branch);
    }
  }

  async function handleEnablePages(owner, repoName, branch) {
    const btn = document.getElementById('enable-pages-btn');
    btn.disabled = true;
    btn.textContent = 'Enabling…';
    try {
      await GitHub.enablePages(owner, repoName, branch, '/');
      const url = repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`
        ? `https://${owner}.github.io/`
        : `https://${owner}.github.io/${repoName}/`;
      const row = document.getElementById('pages-result-row');
      const link = document.getElementById('pages-result-link');
      link.href = url;
      link.textContent = url;
      row.classList.remove('hidden');
      btn.textContent = 'Hosted ✓';
      UI.toast('GitHub Pages enabled — it may take a minute to go live.');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Host with GitHub Pages';
      UI.toast(friendlyError(e) || 'Could not enable GitHub Pages for this repository.');
    }
  }

  // ---------------- Browse / view / edit / delete files ----------------

  async function browseRepo(fullName) {
    const { owner, repo } = splitFullName(fullName);
    const card = document.getElementById('repo-browser-card');
    const list = document.getElementById('repo-file-list');
    document.getElementById('repo-browser-title').textContent = fullName;
    card.classList.remove('hidden');
    list.innerHTML = '<div class="hint" style="padding:10px 0">Loading files…</div>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const repoInfo = await GitHub.getRepo(owner, repo);
      const branch = repoInfo.default_branch;
      let treeMap = new Map();
      try {
        const ref = await GitHub.getRef(owner, repo, branch);
        const commit = await GitHub.getCommit(owner, repo, ref.object.sha);
        const tree = await GitHub.getTree(owner, repo, commit.tree.sha, true);
        treeMap = Compare.buildRemoteFileMap(tree);
      } catch (e) {
        // Empty repo (no commits yet) — an empty file list is the correct result.
      }
      state.browsing = { owner, repoName: repo, branch, treeMap };
      renderRepoFileList();
    } catch (e) {
      list.innerHTML = '';
      UI.toast(friendlyError(e));
    }

    document.getElementById('delete-repo-btn').onclick = () => openDeleteRepoModal(owner, repo);
  }

  function renderRepoFileList() {
    const list = document.getElementById('repo-file-list');
    list.innerHTML = '';
    const paths = [...state.browsing.treeMap.keys()].sort();

    if (!paths.length) {
      list.innerHTML = '<div class="hint" style="padding:10px 0">This repository has no files yet.</div>';
      return;
    }

    for (const path of paths) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="file-row-top">
          <span class="file-path">${UI.escapeHtml(path)}</span>
        </div>
        <div class="repo-row-actions">
          <button class="btn-link small" data-action="view">View</button>
          <button class="btn-link small" data-action="edit">Edit</button>
          <button class="btn-link small danger-text" data-action="delete">Delete</button>
        </div>
      `;
      row.querySelector('[data-action="view"]').addEventListener('click', () => openFile(path, 'view'));
      row.querySelector('[data-action="edit"]').addEventListener('click', () => openFile(path, 'edit'));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteFile(path));
      list.appendChild(row);
    }
  }

  async function openFile(path, mode) {
    const { owner, repoName, branch } = state.browsing;
    document.getElementById('file-editor-title').textContent = path;
    const body = document.getElementById('file-editor-body');
    const actions = document.getElementById('file-editor-actions');
    body.innerHTML = '<div class="hint" style="padding:16px 0">Loading…</div>';
    actions.classList.add('hidden');
    document.getElementById('file-editor-modal').classList.remove('hidden');

    let fileData;
    try {
      fileData = await GitHub.getContents(owner, repoName, path, branch);
    } catch (e) {
      body.innerHTML = `<div class="diff-binary">${UI.escapeHtml(friendlyError(e))}</div>`;
      return;
    }

    const ext = extOf(path);
    const bytes = fileData.encoding === 'base64' ? base64ToBytes(fileData.content) : new TextEncoder().encode(fileData.content);
    const isImage = IMAGE_EXT.has(ext);
    const isHtml = HTML_EXT.has(ext) && mode === 'view';
    const isBinary = !isImage && bytesLookBinary(bytes);

    if (isImage) {
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      body.innerHTML = `<img src="data:${mime};base64,${fileData.content.replace(/\n/g, '')}" alt="${UI.escapeHtml(path)}">`;
      return; // images are view-only in this tool
    }

    if (isBinary) {
      body.innerHTML = '<div class="diff-binary">Binary file — preview not available.</div>';
      return;
    }

    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    if (isHtml) {
      body.innerHTML = `<iframe sandbox="" srcdoc="${UI.escapeHtml(text)}"></iframe>
        <p class="hint" style="margin-top:8px">Rendered preview — scripts and external resources are sandboxed.</p>`;
      return;
    }

    if (mode === 'view') {
      body.innerHTML = `<pre class="diff-line diff-context" style="white-space:pre-wrap">${UI.escapeHtml(text)}</pre>`;
      return;
    }

    // Edit mode
    body.innerHTML = `<textarea id="file-editor-textarea" spellcheck="false">${UI.escapeHtml(text)}</textarea>`;
    actions.classList.remove('hidden');
    document.getElementById('file-editor-save').onclick = () => saveFile(path, fileData.sha);
  }

  async function saveFile(path, sha) {
    const { owner, repoName, branch } = state.browsing;
    const textarea = document.getElementById('file-editor-textarea');
    const saveBtn = document.getElementById('file-editor-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const base64 = utf8ToBase64(textarea.value);
      const result = await GitHub.putContents(owner, repoName, path, `Update ${path} via GitSync`, base64, sha, branch);
      UI.toast('File updated.');
      document.getElementById('file-editor-modal').classList.add('hidden');
      if (state.browsing.treeMap.has(path)) {
        state.browsing.treeMap.get(path).sha = result.content.sha;
      }
    } catch (e) {
      UI.toast(friendlyError(e));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }

  async function handleDeleteFile(path) {
    const ok = await UI.confirm(`Delete "${path}" from this repository? This cannot be undone.`, 'Delete file');
    if (!ok) return;
    const { owner, repoName, branch } = state.browsing;
    try {
      const fileData = await GitHub.getContents(owner, repoName, path, branch);
      await GitHub.deleteFileContents(owner, repoName, path, `Delete ${path} via GitSync`, fileData.sha, branch);
      state.browsing.treeMap.delete(path);
      renderRepoFileList();
      UI.toast('File deleted.');
    } catch (e) {
      UI.toast(friendlyError(e));
    }
  }

  // ---------------- Delete repository (type-to-confirm modal) ----------------

  function openDeleteRepoModal(owner, repoName) {
    const modal = document.getElementById('delete-repo-modal');
    const fullName = `${owner}/${repoName}`;
    document.getElementById('delete-repo-modal-name').textContent = fullName;
    const input = document.getElementById('delete-repo-confirm-input');
    const confirmBtn = document.getElementById('delete-repo-confirm-btn');
    input.value = '';
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Delete Repository';
    modal.classList.remove('hidden');
    input.focus();

    input.oninput = () => { confirmBtn.disabled = input.value.trim() !== repoName; };

    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      try {
        await GitHub.deleteRepo(owner, repoName);
        modal.classList.add('hidden');
        document.getElementById('repo-browser-card').classList.add('hidden');
        state.browsing = null;
        state.repos = [];
        loadRepoList();
        UI.toast('Repository deleted.');
      } catch (e) {
        UI.toast(friendlyError(e));
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete Repository';
      }
    };

    const close = () => modal.classList.add('hidden');
    document.getElementById('delete-repo-cancel-btn').onclick = close;
    document.getElementById('delete-repo-modal-close').onclick = close;
  }

  // ---------------- Wiring ----------------

  function init() {
    boot();

    document.getElementById('create-repo-btn').addEventListener('click', handleCreateRepo);
    document.getElementById('custom-repo-search').addEventListener('input', renderRepoList);
    document.getElementById('repo-browser-close').addEventListener('click', () => {
      document.getElementById('repo-browser-card').classList.add('hidden');
      state.browsing = null;
    });

    document.getElementById('file-editor-close').addEventListener('click', () => {
      document.getElementById('file-editor-modal').classList.add('hidden');
    });
    document.getElementById('file-editor-cancel').addEventListener('click', () => {
      document.getElementById('file-editor-modal').classList.add('hidden');
    });
    document.getElementById('file-editor-modal').addEventListener('click', (e) => {
      if (e.target.id === 'file-editor-modal') document.getElementById('file-editor-modal').classList.add('hidden');
    });

    const accountsToggle = document.getElementById('accounts-toggle');
    const accountsModal = document.getElementById('accounts-modal');
    accountsToggle.addEventListener('click', () => {
      AccountsUI.render();
      accountsModal.classList.remove('hidden');
    });
    document.getElementById('accounts-modal-close').addEventListener('click', () => accountsModal.classList.add('hidden'));
    accountsModal.addEventListener('click', (e) => {
      if (e.target.id === 'accounts-modal') accountsModal.classList.add('hidden');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
