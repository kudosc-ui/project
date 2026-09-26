/**
 * app.js
 * Application state + event wiring. Ties auth/github/files/compare/commit
 * together and drives the UI module.
 */

(() => {
  const state = {
    user: null,
    repos: [],
    currentRepoFullName: null,   // "owner/repo"
    currentBranch: null,
    syncMode: 'folder',
    uploadedFileMap: null,       // Map<path, File>
    uploadedRootName: '',
    localHashes: null,           // Map<path, sha1hex>
    baseline: null,              // { baseCommitSha, baseTreeSha, fullTree }
    diff: null,
    filter: 'all',
    searchTerm: ''
  };

  // ---------------- Helpers ----------------

  function splitFullName(fullName) {
    const [owner, repo] = fullName.split('/');
    return { owner, repo };
  }

  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.kind === 'auth') return 'GitHub authentication expired. Please reconnect your GitHub account.';
    if (err.kind === 'permission') return 'Permission denied for this repository. Check your token\'s scopes.';
    if (err.kind === 'not_found') return 'Repository or branch not found. It may have been renamed or deleted.';
    if (err.kind === 'rate_limit') return 'GitHub API rate limit reached. Please wait a few minutes and try again.';
    if (err.kind === 'network') return 'Network error. Check your connection and try again.';
    if (err.kind === 'conflict') return 'Repository changed';
    return err.message || 'Something went wrong. Please try again.';
  }

  // ---------------- Auth flow ----------------

  async function tryAutoLogin() {
    const token = Auth.getToken();
    if (!token) return;
    try {
      const user = await Auth.validateToken(token);
      await enterApp(user);
    } catch (e) {
      Auth.clearToken();
    }
  }

  async function handleConnect() {
    const tokenInput = document.getElementById('pat-input');
    const remember = document.getElementById('remember-token').checked;
    const errEl = document.getElementById('auth-error');
    const btn = document.getElementById('connect-btn');
    const token = tokenInput.value.trim();
    errEl.classList.add('hidden');

    if (!token) {
      errEl.textContent = 'Please paste a personal access token.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const user = await Auth.validateToken(token);
      Auth.saveToken(token, remember);
      await enterApp(user);
    } catch (e) {
      errEl.textContent = friendlyError(e) || e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect to GitHub';
    }
  }

  function handleDisconnect() {
    Auth.clearToken();
    state.user = null;
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('view-auth').classList.add('active');
    document.getElementById('pat-input').value = '';
  }

  async function enterApp(user) {
    state.user = user;
    document.getElementById('view-auth').classList.remove('active');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('username-label').textContent = user.login;
    document.getElementById('settings-username').textContent = `Connected as @${user.login}`;
    UI.showView('view-dashboard');

    const repoSelect = document.getElementById('repo-select');
    repoSelect.innerHTML = '<option>Loading repositories…</option>';
    try {
      state.repos = await GitHub.listRepos();
      UI.renderRepoOptions(repoSelect, state.repos);
      if (state.repos.length) {
        await onRepoChange(); // load branches + last commit for first repo
      }
      document.getElementById('upload-btn').disabled = false;
    } catch (e) {
      UI.toast(friendlyError(e));
    }
  }

  // ---------------- Dashboard: repo/branch selection ----------------

  async function onRepoChange() {
    const repoSelect = document.getElementById('repo-select');
    const branchSelect = document.getElementById('branch-select');
    const fullName = repoSelect.value;
    if (!fullName || !fullName.includes('/')) return;
    state.currentRepoFullName = fullName;

    const selectedOption = repoSelect.options[repoSelect.selectedIndex];
    const defaultBranch = selectedOption?.dataset?.defaultBranch;

    branchSelect.innerHTML = '<option>Loading branches…</option>';
    const { owner, repo } = splitFullName(fullName);
    try {
      const branches = await GitHub.listBranches(owner, repo);
      UI.renderBranchOptions(branchSelect, branches, defaultBranch);
      state.currentBranch = branchSelect.value;
      await refreshLastCommit();
    } catch (e) {
      UI.toast(friendlyError(e));
    }
  }

  function onBranchChange() {
    state.currentBranch = document.getElementById('branch-select').value;
    refreshLastCommit();
  }

  async function refreshLastCommit() {
    const card = document.getElementById('last-commit-card');
    const msgEl = document.getElementById('last-commit-message');
    const metaEl = document.getElementById('last-commit-meta');
    if (!state.currentRepoFullName || !state.currentBranch) { card.style.display = 'none'; return; }
    const { owner, repo } = splitFullName(state.currentRepoFullName);
    try {
      const commitInfo = await GitHub.getLatestCommitForBranch(owner, repo, state.currentBranch);
      UI.renderLastCommit(card, msgEl, metaEl, commitInfo);
    } catch (e) {
      card.style.display = 'none';
    }
  }

  // ---------------- Upload flow ----------------

  function handleUploadClick() {
    document.getElementById('folder-input').click();
  }

  async function handleFolderSelected(fileList) {
    if (!fileList || !fileList.length) return;
    UI.showView('view-progress');
    UI.setProgress(0, 'Reading project…', '');

    try {
      const { rootName, fileMap, skipped, tooLarge } = Files.buildFileMap(fileList);
      state.uploadedFileMap = fileMap;
      state.uploadedRootName = rootName;

      if (skipped.length) {
        UI.toast(`${skipped.length} file(s) skipped (unsafe path or duplicate).`);
      }
      if (tooLarge.length) {
        UI.toast(`${tooLarge.length} file(s) skipped (exceeds size limit).`);
      }

      // Hash local files (git blob sha1) to detect true modifications.
      const localHashes = new Map();
      const entries = Array.from(fileMap.entries());
      for (let i = 0; i < entries.length; i++) {
        const [path, file] = entries[i];
        const buf = await file.arrayBuffer();
        const sha = await Compare.gitBlobSha1(buf);
        localHashes.set(path, sha);
        const pct = Math.round(((i + 1) / entries.length) * 55);
        UI.setProgress(pct, 'Reading project…', `${i + 1} of ${entries.length} files detected`);
      }
      state.localHashes = localHashes;

      // Fetch remote baseline tree.
      UI.setProgress(60, 'Fetching repository state…', '');
      const { owner, repo } = splitFullName(state.currentRepoFullName);
      const baseline = await Commit.captureBaseline(owner, repo, state.currentBranch);
      state.baseline = baseline;

      UI.setProgress(85, 'Comparing files…', '');
      const remoteMap = Compare.buildRemoteFileMap(baseline.fullTree);
      state.diff = Compare.computeDiff(fileMap, localHashes, remoteMap, state.syncMode, rootName);

      UI.setProgress(100, 'Done', '');
      setTimeout(() => showCompareView(), 200);
    } catch (e) {
      UI.toast(friendlyError(e));
      UI.showView('view-dashboard');
    }
  }

  function showCompareView() {
    UI.showView('view-compare');
    UI.renderSummaryCounts(state.diff);
    UI.renderDeletionsWarning(state.diff);
    renderFileListView();

    const continueBtn = document.getElementById('review-continue-btn');
    const needsConfirm = state.diff.deleted.length > 0;
    document.getElementById('confirm-deletions').checked = false;
    continueBtn.disabled = false; // enabled always; we check on click
  }

  function renderFileListView() {
    const container = document.getElementById('file-list');
    UI.renderFileList(container, state.diff, state.filter, state.searchTerm, openFileDiff);
  }

  async function openFileDiff(item) {
    if (item.status === 'added') {
      const content = await Files.readFileContent(item.file, item.path);
      if (content.isBinary) {
        UI.openDiffModal(item.path, '<div class="diff-binary">Binary file added.</div>');
      } else {
        const ops = (content.text || '').split('\n').map(line => ({ type: 'add', line }));
        UI.openDiffModal(item.path, UI.renderDiffOps(ops));
      }
      return;
    }

    if (item.status === 'modified') {
      const { owner, repo } = splitFullName(state.currentRepoFullName);
      const newContent = await Files.readFileContent(item.file, item.path);
      if (newContent.isBinary) {
        UI.openDiffModal(item.path, '<div class="diff-binary">Binary file modified.</div>');
        return;
      }
      try {
        UI.openDiffModal(item.path, '<div class="diff-binary">Loading diff…</div>');
        const blob = await fetchBlobText(owner, repo, item.remoteSha);
        if (blob === null) {
          UI.openDiffModal(item.path, '<div class="diff-binary">Binary file modified.</div>');
          return;
        }
        const ops = Compare.diffText(blob, newContent.text || '');
        if (!ops) {
          UI.openDiffModal(item.path, '<div class="diff-binary">File too large to preview a diff.</div>');
        } else {
          UI.openDiffModal(item.path, UI.renderDiffOps(ops));
        }
      } catch (e) {
        UI.openDiffModal(item.path, `<div class="diff-binary">${UI.escapeHtml(friendlyError(e))}</div>`);
      }
    }
  }

  async function fetchBlobText(owner, repo, sha) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`, {
      headers: { 'Authorization': `Bearer ${Auth.getToken()}`, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error('Could not load the previous version of this file.');
    const data = await res.json();
    if (data.encoding !== 'base64') return data.content;
    try {
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      // Null byte check to avoid rendering binary as garbled text.
      if (bytes.slice(0, 8000).includes(0)) return null;
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      return null;
    }
  }

  function handleReviewContinue() {
    if (state.diff.deleted.length && !document.getElementById('confirm-deletions').checked) {
      UI.toast('Please confirm the file deletions before continuing.');
      return;
    }
    const totalChanges = state.diff.added.length + state.diff.modified.length + state.diff.deleted.length;
    if (totalChanges === 0) {
      UI.toast('No changes to commit.');
      return;
    }
    UI.showView('view-commit');
    document.getElementById('commit-file-count').textContent = `${totalChanges} files changed`;
    document.getElementById('commit-count-added').textContent = `${state.diff.added.length} Added`;
    document.getElementById('commit-count-modified').textContent = `${state.diff.modified.length} Modified`;
    document.getElementById('commit-count-deleted').textContent = `${state.diff.deleted.length} Deleted`;
    document.getElementById('commit-message').value = '';
    document.getElementById('commit-error').classList.add('hidden');
  }

  // ---------------- Commit flow ----------------

  async function handleCommit() {
    const messageInput = document.getElementById('commit-message');
    const message = messageInput.value.trim();
    const errEl = document.getElementById('commit-error');
    errEl.classList.add('hidden');

    if (!message) {
      errEl.textContent = 'Please enter a commit message.';
      errEl.classList.remove('hidden');
      return;
    }

    const commitBtn = document.getElementById('commit-btn');
    commitBtn.disabled = true;
    UI.showView('view-progress');
    UI.setProgress(0, 'Preparing GitHub commit…', '');

    const { owner, repo } = splitFullName(state.currentRepoFullName);
    try {
      const result = await Commit.pushCommit({
        owner, repo, branch: state.currentBranch,
        baseCommitSha: state.baseline.baseCommitSha,
        baseTreeSha: state.baseline.baseTreeSha,
        diff: state.diff,
        message,
        onProgress: (pct, label) => UI.setProgress(pct, 'Uploading changes…', label)
      });
      showSuccess(result, message, owner, repo);
    } catch (e) {
      if (e.kind === 'conflict') {
        UI.showView('view-conflict');
      } else {
        UI.showView('view-commit');
        errEl.textContent = friendlyError(e);
        errEl.classList.remove('hidden');
      }
    } finally {
      commitBtn.disabled = false;
    }
  }

  function showSuccess(commitResult, message, owner, repo) {
    UI.showView('view-success');
    const total = state.diff.added.length + state.diff.modified.length + state.diff.deleted.length;
    document.getElementById('success-message').textContent = message.split('\n')[0];
    document.getElementById('success-file-count').textContent = `${total} files changed`;
    document.getElementById('success-sha').textContent = commitResult.sha.slice(0, 7);
    document.getElementById('view-on-github-btn').href = `https://github.com/${owner}/${repo}/commit/${commitResult.sha}`;

    // Reset upload-related state so the dashboard is clean next time.
    state.uploadedFileMap = null;
    state.diff = null;
    state.baseline = null;
  }

  function resetToDashboard() {
    UI.showView('view-dashboard');
    UI.setNavActive('dashboard');
    refreshLastCommit();
  }

  // ---------------- Filters / search ----------------

  function handleFilterClick(e) {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderFileListView();
  }

  function handleSearchInput(e) {
    state.searchTerm = e.target.value;
    renderFileListView();
  }

  // ---------------- Nav / settings ----------------

  function handleNavClick(e) {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    UI.setNavActive(btn.dataset.nav);
    if (btn.dataset.nav === 'dashboard') UI.showView('view-dashboard');
    if (btn.dataset.nav === 'settings') { populateSettings(); UI.showView('view-settings'); }
    if (btn.dataset.nav === 'history') UI.showView('view-dashboard'); // history surfaces via last-commit card
  }

  function populateSettings() {
    document.getElementById('settings-default-repo').textContent = state.currentRepoFullName || '—';
    document.getElementById('settings-default-branch').textContent = state.currentBranch || '—';
    document.querySelectorAll('input[name="settings-sync-mode"]').forEach(r => {
      r.checked = r.value === state.syncMode;
    });
  }

  function handleSyncModeChange(e) {
    state.syncMode = e.target.value;
    document.querySelectorAll('input[name="sync-mode"]').forEach(r => r.checked = r.value === state.syncMode);
    document.querySelectorAll('input[name="settings-sync-mode"]').forEach(r => r.checked = r.value === state.syncMode);
  }

  // ---------------- Wiring ----------------

  function init() {
    document.getElementById('connect-btn').addEventListener('click', handleConnect);
    document.getElementById('how-to-token').addEventListener('click', () => {
      window.open('https://github.com/settings/tokens/new?scopes=repo&description=GitSync', '_blank', 'noopener');
    });
    document.getElementById('disconnect-btn').addEventListener('click', handleDisconnect);
    document.getElementById('settings-disconnect-btn').addEventListener('click', handleDisconnect);
    document.getElementById('settings-toggle').addEventListener('click', () => {
      populateSettings();
      UI.showView('view-settings');
    });

    document.getElementById('repo-select').addEventListener('change', onRepoChange);
    document.getElementById('branch-select').addEventListener('change', onBranchChange);
    document.querySelectorAll('input[name="sync-mode"]').forEach(r => r.addEventListener('change', handleSyncModeChange));
    document.querySelectorAll('input[name="settings-sync-mode"]').forEach(r => r.addEventListener('change', handleSyncModeChange));

    document.getElementById('upload-btn').addEventListener('click', handleUploadClick);
    document.getElementById('folder-input').addEventListener('change', (e) => handleFolderSelected(e.target.files));
    document.getElementById('files-input').addEventListener('change', (e) => handleFolderSelected(e.target.files));
    document.getElementById('fallback-files-btn').addEventListener('click', () => document.getElementById('files-input').click());

    document.getElementById('filter-chips').addEventListener('click', handleFilterClick);
    document.getElementById('file-search').addEventListener('input', handleSearchInput);
    document.getElementById('review-continue-btn').addEventListener('click', handleReviewContinue);

    document.getElementById('cancel-commit-btn').addEventListener('click', () => UI.showView('view-compare'));
    document.getElementById('commit-btn').addEventListener('click', handleCommit);

    document.getElementById('back-to-dashboard-btn').addEventListener('click', resetToDashboard);
    document.getElementById('conflict-back-btn').addEventListener('click', resetToDashboard);

    document.getElementById('diff-modal-close').addEventListener('click', UI.closeDiffModal);
    document.getElementById('diff-modal').addEventListener('click', (e) => {
      if (e.target.id === 'diff-modal') UI.closeDiffModal();
    });

    document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', handleNavClick));

    // Detect lack of webkitdirectory support (older/some mobile browsers).
    const testInput = document.createElement('input');
    if (!('webkitdirectory' in testInput)) {
      document.getElementById('folder-input').classList.add('hidden');
      document.getElementById('fallback-files-btn').classList.remove('hidden');
    }

    tryAutoLogin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
