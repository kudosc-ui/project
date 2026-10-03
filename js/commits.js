/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. See LICENSE for full terms.
 */
/**
 * commits.js — the Commits page: App Commit, Live GitHub Commit and recent
 * commit history for any repository/branch.
 */
(() => {
  const state = { repos: [], repo: null, branch: null, branches: [], defaultBranch: null };
  const $ = (id) => document.getElementById(id);

  function split(full) { const [owner, repo] = full.split('/'); return { owner, repo }; }

  function friendlyError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.kind === 'auth') return 'GitHub authentication expired. Please reconnect on the Home page.';
    if (err.kind === 'permission') return "Permission denied for this repository. Check your token's scopes.";
    if (err.kind === 'not_found') return 'Repository or branch not found.';
    if (err.kind === 'rate_limit') return 'GitHub API rate limit reached. Please wait a few minutes.';
    if (err.kind === 'network') return 'Network error. Check your connection and try again.';
    return err.message || 'Something went wrong. Please try again.';
  }

  // ---------- Pickers ----------
  function openRepoPicker() {
    if ($('repo-select-trigger').classList.contains('disabled')) return;
    Picker.open('Select repository', state.repos.map(r => ({
      value: r.full_name, label: r.full_name, sub: r.private ? 'Private' : 'Public',
      selected: r.full_name === state.repo
    })), (v) => selectRepo(v), 'Search repositories…');
  }

  function openBranchPicker() {
    if ($('branch-select-trigger').classList.contains('disabled')) return;
    Picker.open('Select branch', state.branches.map(b => ({
      value: b.name, label: b.name,
      sub: b.name === state.defaultBranch ? 'Default' : '', selected: b.name === state.branch
    })), (v) => selectBranch(v), 'Search branches…');
  }

  async function selectRepo(full) {
    state.repo = full;
    $('repo-select-value').textContent = full;
    const r = state.repos.find(x => x.full_name === full);
    state.defaultBranch = r ? r.default_branch : null;
    const trig = $('branch-select-trigger');
    trig.classList.add('disabled');
    $('branch-select-value').textContent = 'Loading branches…';
    $('commit-status-group').style.display = 'none';
    $('commits-inline-history').innerHTML = '';
    const { owner, repo } = split(full);
    try {
      state.branches = await GitHub.listBranches(owner, repo);
      const def = state.branches.find(b => b.name === state.defaultBranch) || state.branches[0];
      trig.classList.toggle('disabled', !state.branches.length);
      if (def) selectBranch(def.name);
      else $('branch-select-value').textContent = 'No branches';
    } catch (e) {
      $('branch-select-value').textContent = 'Could not load';
      UI.toast(friendlyError(e));
    }
  }

  function selectBranch(name) {
    state.branch = name;
    $('branch-select-value').textContent = name;
    refreshAppCommit();
    loadInlineHistory();
  }

  // ---------- App commit (local, instant) ----------
  function refreshAppCommit() {
    const group = $('commit-status-group');
    if (!state.repo || !state.branch) { group.style.display = 'none'; return; }
    group.style.display = '';
    const { owner, repo } = split(state.repo);
    UI.renderAppCommitRow(AppLog.load(owner, repo, state.branch));
  }

  // ---------- Recent commits shown right on the page ----------
  async function fetchCommits(count) {
    const { owner, repo } = split(state.repo);
    const summaries = await GitHub.listCommits(owner, repo, state.branch, count);
    return Promise.all(summaries.map(s => GitHub.getCommitDetail(owner, repo, s.sha).catch(() => s)));
  }

  async function loadInlineHistory() {
    const box = $('commits-inline-history');
    const repoAtStart = state.repo, branchAtStart = state.branch;
    box.innerHTML = '<div class="hint" style="padding:12px 2px">Loading commits…</div>';
    try {
      const commits = await fetchCommits(5);
      if (repoAtStart !== state.repo || branchAtStart !== state.branch) return; // selection changed
      const real = document.getElementById('commit-files-list');
      // Reuse the shared renderer by pointing it at a temporary container id swap.
      real.id = 'commit-files-list-tmp'; box.id = 'commit-files-list';
      UI.renderCommitHistory(commits);
      box.id = 'commits-inline-history'; real.id = 'commit-files-list';
    } catch (e) {
      box.innerHTML = `<div class="hint" style="padding:12px 2px">${UI.escapeHtml(friendlyError(e))}</div>`;
    }
  }

  // ---------- Live GitHub commit (fresh fetch) ----------
  async function showLiveCommit() {
    if (!state.repo || !state.branch) return;
    UI.showView('view-live-commit');
    UI.renderLiveCommitLoading();
    const { owner, repo } = split(state.repo);
    const branch = state.branch;
    const appRecord = AppLog.load(owner, repo, branch);
    try {
      const ref = await GitHub.getRef(owner, repo, branch);
      const headSha = ref.object.sha;
      const commitInfo = await GitHub.getCommitDetail(owner, repo, headSha);
      let reconciliation = null;
      if (appRecord && appRecord.sha) {
        if (headSha === appRecord.sha) {
          reconciliation = { status: 'match' };
          if (appRecord.verifyStatus !== 'confirmed') AppLog.setVerifyStatus(owner, repo, branch, appRecord.sha, 'confirmed');
        } else {
          const live = new Set((commitInfo.files || []).map(f => f.filename));
          reconciliation = {
            status: 'mismatch',
            pending: appRecord.files.filter(f => !live.has(f.path)),
            confirmed: appRecord.files.filter(f => live.has(f.path))
          };
        }
      }
      UI.renderLiveCommit({
        branch, commitInfo, appRecord, reconciliation,
        failedFiles: appRecord && appRecord.lastFailure ? appRecord.lastFailure.files : []
      });
      refreshAppCommit();
    } catch (e) {
      UI.renderLiveCommitError(friendlyError(e));
    }
  }

  async function showHistory() {
    if (!state.repo || !state.branch) return;
    UI.showView('view-commit-files');
    UI.renderCommitHistoryLoading();
    try { UI.renderCommitHistory(await fetchCommits(5)); }
    catch (e) { UI.renderCommitHistory([]); UI.toast(friendlyError(e)); }
  }

  function backToMain() { UI.showView('view-commits-main'); refreshAppCommit(); }

  // ---------- Init ----------
  async function init() {
    const token = Auth.getToken();
    if (!token) { $('commits-not-connected').classList.remove('hidden'); return; }
    $('commits-connected').classList.remove('hidden');
    const acct = Auth.getActiveAccount();
    $('commits-username-label').textContent = acct ? acct.login : '—';

    const rt = $('repo-select-trigger'), bt = $('branch-select-trigger');
    rt.addEventListener('click', openRepoPicker);
    bt.addEventListener('click', openBranchPicker);
    [rt, bt].forEach(el => el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    }));
    bt.classList.add('disabled');

    $('live-commit-card').addEventListener('click', showLiveCommit);
    $('live-commit-refresh-btn').addEventListener('click', showLiveCommit);
    $('live-commit-back-btn').addEventListener('click', backToMain);
    $('commit-files-back-btn').addEventListener('click', backToMain);
    $('live-commit-body').addEventListener('click', (e) => {
      if (e.target.closest('#live-commit-history-link')) showHistory();
    });

    try {
      state.repos = await GitHub.listRepos();
      if (!state.repos.length) { $('repo-select-value').textContent = 'No repositories found'; return; }
      selectRepo(state.repos[0].full_name);
    } catch (e) {
      $('repo-select-value').textContent = 'Could not load repositories';
      if (e && e.kind === 'auth') { $('commits-connected').classList.add('hidden'); $('commits-not-connected').classList.remove('hidden'); }
      UI.toast(friendlyError(e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
