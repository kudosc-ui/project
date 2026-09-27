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
    lastCommitInfo: null,        // full commit payload (incl. files[]) for the last-commit row
    diff: null,
    filter: 'all',
    searchTerm: '',
    branches: [],                 // branches of the currently selected repo, for the branch picker
    defaultBranchName: null
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
    const cachedAccount = Auth.getActiveAccount();
    try {
      const user = await Auth.validateToken(token);
      // Keeps the saved account's login/avatar fresh, and migrates a
      // legacy single-token session into the new account list.
      Auth.upsertAccount(user.login, token, user.avatar_url);
      await enterApp(user);
    } catch (e) {
      // Only a genuinely rejected token (401) should sign the person out.
      // A network hiccup or a momentary GitHub outage on cold launch used
      // to wipe the saved token here, which is why the app kept asking to
      // paste it again — a flaky connection at startup is common on mobile
      // and must never delete a saved account.
      if (e && e.kind === 'auth') {
        Auth.clearToken();
        return;
      }
      if (cachedAccount) {
        await enterApp({ login: cachedAccount.login, avatar_url: cachedAccount.avatarUrl });
        UI.toast("Couldn't verify your GitHub connection — check your internet if something fails.");
      }
      // No cached account to fall back on and no confirmed rejection:
      // leave the token in storage and just show the login screen this
      // time rather than deleting it.
    }
  }

  async function handleConnect() {
    const tokenInput = document.getElementById('pat-input');
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
      Auth.upsertAccount(user.login, token, user.avatar_url);
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
    // If another saved account became active, just carry on as that account
    // instead of forcing a re-login.
    if (Auth.getToken()) {
      window.location.reload();
      return;
    }
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
    UI.showView('view-dashboard');

    const repoSelect = document.getElementById('repo-select');
    const repoTrigger = document.getElementById('repo-select-trigger');
    repoSelect.innerHTML = '<option>Loading repositories…</option>';
    document.getElementById('repo-select-value').textContent = 'Loading repositories…';
    repoTrigger.classList.add('disabled');
    try {
      state.repos = await GitHub.listRepos();
      UI.renderRepoOptions(repoSelect, state.repos);
      syncRepoTriggerLabel();
      repoTrigger.classList.toggle('disabled', !state.repos.length);
      if (state.repos.length) {
        await onRepoChange(); // load branches + last commit for first repo
      }
      document.getElementById('upload-btn').disabled = false;
      document.getElementById('upload-zip-btn').disabled = false;
      document.getElementById('upload-single-btn').disabled = false;
    } catch (e) {
      UI.toast(friendlyError(e));
    }
  }

  // ---------------- Dashboard: repo/branch selection (custom picker) ----------------

  function syncRepoTriggerLabel() {
    const repoSelect = document.getElementById('repo-select');
    document.getElementById('repo-select-value').textContent =
      state.repos.length ? (repoSelect.value || 'Select a repository') : 'No repositories found';
  }

  function syncBranchTriggerLabel(loadingText) {
    const branchSelect = document.getElementById('branch-select');
    const valueEl = document.getElementById('branch-select-value');
    if (loadingText) { valueEl.textContent = loadingText; return; }
    valueEl.textContent = state.currentRepoFullName
      ? (branchSelect.value || 'Select a branch')
      : 'Select a repository first';
  }

  function openRepoPicker() {
    if (document.getElementById('repo-select-trigger').classList.contains('disabled')) return;
    const repoSelect = document.getElementById('repo-select');
    const items = state.repos.map(r => ({
      value: r.full_name,
      label: r.full_name,
      sub: r.private ? 'Private' : 'Public',
      selected: r.full_name === repoSelect.value
    }));
    Picker.open('Select Repository', items, (value) => {
      if (value === repoSelect.value) return;
      repoSelect.value = value;
      repoSelect.dispatchEvent(new Event('change'));
    }, 'Search repositories…');
  }

  function openBranchPicker() {
    if (document.getElementById('branch-select-trigger').classList.contains('disabled')) return;
    if (!state.currentRepoFullName || !state.branches.length) return;
    const branchSelect = document.getElementById('branch-select');
    const items = state.branches.map(b => ({
      value: b.name,
      label: b.name,
      sub: b.name === state.defaultBranchName ? 'Default branch' : undefined,
      selected: b.name === branchSelect.value
    }));
    Picker.open('Select Branch', items, (value) => {
      if (value === branchSelect.value) return;
      branchSelect.value = value;
      branchSelect.dispatchEvent(new Event('change'));
    }, 'Search branches…');
  }

  async function onRepoChange() {
    const repoSelect = document.getElementById('repo-select');
    const branchSelect = document.getElementById('branch-select');
    const branchTrigger = document.getElementById('branch-select-trigger');
    const fullName = repoSelect.value;
    if (!fullName || !fullName.includes('/')) return;
    state.currentRepoFullName = fullName;
    syncRepoTriggerLabel();

    const selectedOption = repoSelect.options[repoSelect.selectedIndex];
    const defaultBranch = selectedOption?.dataset?.defaultBranch;
    state.defaultBranchName = defaultBranch || null;

    branchSelect.innerHTML = '<option>Loading branches…</option>';
    syncBranchTriggerLabel('Loading branches…');
    branchTrigger.classList.add('disabled');
    document.getElementById('new-branch-btn').disabled = true;
    const { owner, repo } = splitFullName(fullName);
    try {
      const branches = await GitHub.listBranches(owner, repo);
      state.branches = branches;
      UI.renderBranchOptions(branchSelect, branches, defaultBranch);
      state.currentBranch = branchSelect.value;
      syncBranchTriggerLabel();
      branchTrigger.classList.toggle('disabled', !branches.length);
      document.getElementById('new-branch-btn').disabled = !branches.length;
      await refreshLastCommit();
    } catch (e) {
      UI.toast(friendlyError(e));
    }
  }

  function onBranchChange() {
    state.currentBranch = document.getElementById('branch-select').value;
    syncBranchTriggerLabel();
    refreshLastCommit();
  }

  // ---------------- New branch creation ----------------

  function isValidBranchName(name) {
    if (!name || name.length > 250) return false;
    // A pragmatic subset of git's ref-name rules — enough to catch the
    // mistakes people actually make, without re-implementing git's full spec.
    if (/^[\/.]|[\/.]$/.test(name)) return false;
    if (/\.\.|\/\/|[ ~^:?*\[\\]|@\{/.test(name)) return false;
    if (name === '@') return false;
    return true;
  }

  function openNewBranchModal() {
    if (!state.currentRepoFullName || !state.currentBranch) return;
    const modal = document.getElementById('new-branch-modal');
    const input = document.getElementById('new-branch-name-input');
    const err = document.getElementById('new-branch-error');
    document.getElementById('new-branch-base-hint').textContent = `Branching off "${state.currentBranch}"`;
    input.value = '';
    err.classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('new-branch-create-btn').disabled = false;
    document.getElementById('new-branch-create-btn').textContent = 'Create Branch';
    setTimeout(() => input.focus(), 50);
  }

  function closeNewBranchModal() {
    document.getElementById('new-branch-modal').classList.add('hidden');
  }

  async function handleCreateBranch() {
    const input = document.getElementById('new-branch-name-input');
    const err = document.getElementById('new-branch-error');
    const createBtn = document.getElementById('new-branch-create-btn');
    const name = input.value.trim();
    err.classList.add('hidden');

    if (!isValidBranchName(name)) {
      err.textContent = 'Enter a valid branch name (no spaces, ~^:?*[\\, or leading/trailing slashes).';
      err.classList.remove('hidden');
      return;
    }
    if (state.branches.some(b => b.name === name)) {
      err.textContent = 'A branch with that name already exists.';
      err.classList.remove('hidden');
      return;
    }

    const baseBranch = state.branches.find(b => b.name === state.currentBranch);
    if (!baseBranch) {
      err.textContent = "Couldn't find the current branch's latest commit. Try reopening the repository.";
      err.classList.remove('hidden');
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    const { owner, repo } = splitFullName(state.currentRepoFullName);
    try {
      await GitHub.createRef(owner, repo, name, baseBranch.commit.sha);
      closeNewBranchModal();
      UI.toast(`Branch "${name}" created.`);

      // Refresh the branch list and switch straight to the new branch so
      // uploads land there immediately.
      const branchSelect = document.getElementById('branch-select');
      const branches = await GitHub.listBranches(owner, repo);
      state.branches = branches;
      UI.renderBranchOptions(branchSelect, branches, state.defaultBranchName);
      branchSelect.value = name;
      state.currentBranch = name;
      syncBranchTriggerLabel();
      document.getElementById('branch-select-trigger').classList.remove('disabled');
      document.getElementById('new-branch-btn').disabled = false;
      await refreshLastCommit();
    } catch (e) {
      err.textContent = friendlyError(e);
      err.classList.remove('hidden');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create Branch';
    }
  }

  async function refreshLastCommit() {
    const card = document.getElementById('last-commit-card');
    const msgEl = document.getElementById('last-commit-message');
    const metaEl = document.getElementById('last-commit-meta');
    if (!state.currentRepoFullName || !state.currentBranch) { card.style.display = 'none'; return; }
    const { owner, repo } = splitFullName(state.currentRepoFullName);
    try {
      const commitInfo = await GitHub.getLatestCommitForBranch(owner, repo, state.currentBranch);
      state.lastCommitInfo = commitInfo;
      UI.renderLastCommit(card, msgEl, metaEl, commitInfo);
    } catch (e) {
      state.lastCommitInfo = null;
      card.style.display = 'none';
    }
  }

  // ---------------- Last commit → file list ----------------

  async function handleLastCommitClick() {
    if (!state.lastCommitInfo || !state.currentRepoFullName || !state.currentBranch) return;
    UI.showView('view-commit-files');
    UI.renderCommitHistoryLoading();
    const { owner, repo } = splitFullName(state.currentRepoFullName);
    try {
      const summaries = await GitHub.listCommits(owner, repo, state.currentBranch, 5);
      // Full file-level detail (added/modified/deleted, +/- counts) needs a
      // separate request per commit — fetch them in parallel.
      const commits = await Promise.all(
        summaries.map(s => GitHub.getCommitDetail(owner, repo, s.sha).catch(() => s))
      );
      UI.renderCommitHistory(commits);
    } catch (e) {
      UI.renderCommitHistory([state.lastCommitInfo]);
      UI.toast(friendlyError(e));
    }
  }

  // ---------------- Upload flow ----------------

  function handleUploadClick() {
    document.getElementById('folder-input').click();
  }

  async function handleFolderSelected(fileList) {
    if (!fileList || !fileList.length) return;
    try {
      const { rootName, fileMap, skipped, tooLarge } = Files.buildFileMap(fileList);
      await proceedWithFileMap(rootName, fileMap, skipped, tooLarge);
    } catch (e) {
      UI.toast(friendlyError(e));
      UI.showView('view-dashboard');
    }
  }

  function handleZipUploadClick() {
    document.getElementById('zip-input').click();
  }

  async function handleZipSelected(file) {
    if (!file) return;
    UI.showView('view-zip-progress');
    setZipProgress(0, 'Extracting ZIP file…', '');
    try {
      const { rootName, fileMap, skipped, tooLarge } = await ZipHandler.extractZip(
        file,
        (pct, detail) => setZipProgress(pct, 'Extracting ZIP file…', detail)
      );
      await proceedWithFileMap(rootName, fileMap, skipped, tooLarge);
    } catch (e) {
      UI.toast(friendlyError(e));
      UI.showView('view-dashboard');
    }
  }

  function handleSingleFileClick() {
    document.getElementById('single-file-input').click();
  }

  async function handleSingleFileSelected(fileList) {
    if (!fileList || !fileList.length) return;
    try {
      const { rootName, fileMap, skipped, tooLarge } = Files.buildFileMap(fileList);
      // A single-file change must never be scoped as "entire repository" —
      // that mode treats everything else in the repo as missing and marks
      // it for deletion, which would be destructive here. Always diff it
      // like a scoped folder upload, regardless of the dashboard's Sync
      // Mode setting.
      await proceedWithFileMap(rootName, fileMap, skipped, tooLarge, 'folder');
    } catch (e) {
      UI.toast(friendlyError(e));
      UI.showView('view-dashboard');
    }
  }

  function setZipProgress(pct, label, detail) {
    document.getElementById('zip-progress-bar').style.width = `${pct}%`;
    document.getElementById('zip-progress-percent').textContent = `${pct}%`;
    if (label != null) document.getElementById('zip-progress-label').textContent = label;
    if (detail != null) document.getElementById('zip-progress-detail').textContent = detail;
  }

  /**
   * Shared tail for folder upload, ZIP upload, and single-file upload: hash
   * local files, fetch the remote baseline, compute the diff, and land on
   * the compare screen. `fileMap` values may be File objects (folder/single
   * file) or Blobs (ZIP upload) — both support .arrayBuffer() and .size,
   * which is all this pipeline needs. `forceSyncMode`, when given, overrides
   * state.syncMode for just this one diff without changing the user's saved
   * preference.
   */
  async function proceedWithFileMap(rootName, fileMap, skipped, tooLarge, forceSyncMode) {
    UI.showView('view-progress');
    UI.setProgress(0, 'Reading project…', '');
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
    state.diff = Compare.computeDiff(fileMap, localHashes, remoteMap, forceSyncMode || state.syncMode, rootName);

    UI.setProgress(100, 'Done', '');
    setTimeout(() => showCompareView(), 200);
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

    const { owner, repo } = splitFullName(state.currentRepoFullName);
    const changedItems = [...state.diff.added, ...state.diff.modified, ...state.diff.deleted];

    // Show the sync-results page immediately with every file pending, then
    // fill in success/failed as each one is processed.
    UI.showView('view-sync-results');
    const resultsContainer = document.getElementById('sync-results-list');
    UI.initSyncResultsList(resultsContainer, changedItems.map(i => ({ path: i.path, status: 'pending' })));
    document.getElementById('sync-results-banner').classList.add('hidden');
    document.getElementById('results-retry-btn').classList.add('hidden');

    let successCount = 0;
    let failedCount = 0;

    try {
      const result = await Commit.pushCommit({
        owner, repo, branch: state.currentBranch,
        baseCommitSha: state.baseline.baseCommitSha,
        baseTreeSha: state.baseline.baseTreeSha,
        diff: state.diff,
        message,
        onProgress: () => { /* per-file rows carry the progress signal here */ },
        onFileResult: ({ path, status, error }) => {
          UI.setSyncResultStatus(resultsContainer, path, status, error);
          if (status === 'success') successCount++; else failedCount++;
        }
      });

      // Every file succeeded and the commit landed.
      UI.renderSyncSummary(successCount, 0);
      setTimeout(() => showSuccess(result, message, owner, repo), 1000);
    } catch (e) {
      if (e.kind === 'conflict') {
        UI.showView('view-conflict');
      } else if (e.kind === 'partial_failure') {
        UI.renderSyncSummary(successCount, failedCount);
      } else {
        // Something failed outside the per-file loop (tree/commit/ref step).
        UI.renderSyncSummary(successCount, changedItems.length - successCount);
        UI.toast(friendlyError(e));
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
    if (btn.dataset.nav === 'howto') UI.showView('view-howto');
  }

  function populateSettings() {
    if (window.AccountsUI) AccountsUI.render();
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
    document.getElementById('settings-toggle').addEventListener('click', () => {
      populateSettings();
      UI.showView('view-settings');
    });

    document.getElementById('repo-select').addEventListener('change', onRepoChange);
    document.getElementById('branch-select').addEventListener('change', onBranchChange);

    // Custom picker sheet for Repository/Branch, instead of the native
    // browser <select> dropdown.
    const repoTrigger = document.getElementById('repo-select-trigger');
    const branchTrigger = document.getElementById('branch-select-trigger');
    repoTrigger.addEventListener('click', openRepoPicker);
    branchTrigger.addEventListener('click', openBranchPicker);
    [repoTrigger, branchTrigger].forEach(el => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
    });
    document.querySelectorAll('input[name="sync-mode"]').forEach(r => r.addEventListener('change', handleSyncModeChange));
    document.querySelectorAll('input[name="settings-sync-mode"]').forEach(r => r.addEventListener('change', handleSyncModeChange));

    document.getElementById('upload-btn').addEventListener('click', handleUploadClick);
    document.getElementById('folder-input').addEventListener('change', (e) => handleFolderSelected(e.target.files));
    document.getElementById('files-input').addEventListener('change', (e) => handleFolderSelected(e.target.files));
    document.getElementById('fallback-files-btn').addEventListener('click', () => document.getElementById('files-input').click());

    document.getElementById('upload-zip-btn').addEventListener('click', handleZipUploadClick);
    document.getElementById('zip-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      handleZipSelected(file);
      e.target.value = ''; // allow re-selecting the same zip later
    });

    document.getElementById('upload-single-btn').addEventListener('click', handleSingleFileClick);
    document.getElementById('single-file-input').addEventListener('change', (e) => {
      handleSingleFileSelected(e.target.files);
      e.target.value = ''; // allow re-selecting the same file later
    });

    document.getElementById('new-branch-btn').addEventListener('click', openNewBranchModal);
    document.getElementById('new-branch-modal-close').addEventListener('click', closeNewBranchModal);
    document.getElementById('new-branch-cancel-btn').addEventListener('click', closeNewBranchModal);
    document.getElementById('new-branch-create-btn').addEventListener('click', handleCreateBranch);
    document.getElementById('new-branch-modal').addEventListener('click', (e) => {
      if (e.target.id === 'new-branch-modal') closeNewBranchModal();
    });
    document.getElementById('new-branch-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleCreateBranch(); }
    });

    document.getElementById('results-back-btn').addEventListener('click', resetToDashboard);
    document.getElementById('results-retry-btn').addEventListener('click', () => UI.showView('view-commit'));

    document.getElementById('filter-chips').addEventListener('click', handleFilterClick);
    document.getElementById('file-search').addEventListener('input', handleSearchInput);
    document.getElementById('review-continue-btn').addEventListener('click', handleReviewContinue);

    document.getElementById('cancel-commit-btn').addEventListener('click', () => UI.showView('view-compare'));
    document.getElementById('commit-btn').addEventListener('click', handleCommit);

    document.getElementById('back-to-dashboard-btn').addEventListener('click', resetToDashboard);
    document.getElementById('conflict-back-btn').addEventListener('click', resetToDashboard);

    document.getElementById('last-commit-card').addEventListener('click', handleLastCommitClick);
    document.getElementById('commit-files-back-btn').addEventListener('click', resetToDashboard);
    document.getElementById('settings-back-btn').addEventListener('click', resetToDashboard);

    document.getElementById('settings-howto-link').addEventListener('click', () => {
      UI.setNavActive('howto');
      UI.showView('view-howto');
    });
    document.getElementById('howto-back-btn').addEventListener('click', resetToDashboard);
    document.getElementById('howto-open-token-page').addEventListener('click', () => {
      window.open('https://github.com/settings/tokens/new?scopes=repo&description=GitSync', '_blank', 'noopener');
    });

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
