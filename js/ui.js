/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * ui.js
 * Pure DOM rendering / view-switching helpers. No GitHub or file logic lives
 * here — app.js calls into these functions with plain data.
 */

const UI = (() => {

  function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function setNavActive(navKey) {
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.nav === navKey);
    });
  }

  function toast(message, ms = 3200) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  /**
   * Styled replacement for window.confirm(). Returns a Promise<boolean>.
   * Requires #confirm-modal markup to be present in the page.
   */
  function confirm(message, title = 'Are you sure?') {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      if (!modal) { resolve(window.confirm(message)); return; }
      document.getElementById('confirm-modal-title').textContent = title;
      document.getElementById('confirm-modal-message').textContent = message;
      modal.classList.remove('hidden');
      const okBtn = document.getElementById('confirm-modal-ok');
      const cancelBtn = document.getElementById('confirm-modal-cancel');
      const finish = (result) => { modal.classList.add('hidden'); resolve(result); };
      okBtn.onclick = () => finish(true);
      cancelBtn.onclick = () => finish(false);
    });
  }

  function setProgress(percent, label, detail) {
    document.getElementById('progress-bar').style.width = `${percent}%`;
    document.getElementById('progress-percent').textContent = `${percent}%`;
    if (label != null) document.getElementById('progress-label').textContent = label;
    if (detail != null) document.getElementById('progress-detail').textContent = detail;
  }

  function renderRepoOptions(selectEl, repos) {
    selectEl.innerHTML = '';
    if (!repos.length) {
      selectEl.innerHTML = '<option>No repositories found</option>';
      return;
    }
    for (const r of repos) {
      const opt = document.createElement('option');
      opt.value = r.full_name;
      opt.textContent = r.full_name;
      opt.dataset.defaultBranch = r.default_branch;
      selectEl.appendChild(opt);
    }
  }

  function renderBranchOptions(selectEl, branches, defaultBranch) {
    selectEl.innerHTML = '';
    for (const b of branches) {
      const opt = document.createElement('option');
      opt.value = b.name;
      opt.textContent = b.name;
      if (b.name === defaultBranch) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  /**
   * Renders the "App Commit" dashboard row from the app's own local record
   * (js/applog.js) — instant, no network call. This reflects what GitSync
   * itself last pushed, independent of whether GitHub has caught up yet.
   */
  function renderAppCommitRow(record) {
    const msgEl = document.getElementById('app-commit-message');
    const metaEl = document.getElementById('app-commit-meta');
    const badgeEl = document.getElementById('app-commit-verify-badge');

    if (!record || !record.sha) {
      msgEl.textContent = 'No pushes yet on this branch';
      metaEl.textContent = record && record.lastFailure
        ? `Last attempt failed — ${record.lastFailure.files.length} file(s) need reuploading`
        : 'Upload something to get started';
      badgeEl.classList.add('hidden');
      return;
    }

    const firstLine = (record.message || '').split('\n')[0];
    msgEl.textContent = firstLine || '(no message)';
    const fileCount = record.files.length;
    let meta = `${relativeTime(record.pushedAt)} · ${record.sha.slice(0, 7)} · ${fileCount} file${fileCount === 1 ? '' : 's'}`;
    if (record.lastFailure) meta += ` · ⚠ ${record.lastFailure.files.length} failed since`;
    metaEl.textContent = meta;

    badgeEl.classList.remove('hidden');
    if (record.verifyStatus === 'confirmed') {
      badgeEl.className = 'verify-badge confirmed';
      badgeEl.textContent = '✓ Synced';
    } else if (record.verifyStatus === 'unconfirmed') {
      badgeEl.className = 'verify-badge unconfirmed';
      badgeEl.textContent = 'Check GitHub';
    } else {
      badgeEl.className = 'verify-badge pending';
      badgeEl.textContent = 'Verifying…';
    }
  }

  function relativeTime(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  function renderSummaryCounts(diff) {
    const a = diff.added.length, m = diff.modified.length, d = diff.deleted.length;
    const total = a + m + d;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('count-added', a); set('count-modified', m); set('count-deleted', d);
    set('count-unchanged', diff.unchanged.length);
    set('cmp-total', total);
    set('cmp-total-label', total === 1 ? 'file will change' : 'files will change');
    set('chip-all', total); set('chip-added', a); set('chip-modified', m); set('chip-deleted', d);
    const bar = document.getElementById('cmp-bar');
    if (bar) {
      const pct = (n) => total ? (n / total * 100) : 0;
      bar.querySelector('.a').style.width = pct(a) + '%';
      bar.querySelector('.m').style.width = pct(m) + '%';
      bar.querySelector('.d').style.width = pct(d) + '%';
      bar.classList.toggle('empty', !total);
    }
  }

  function renderDeletionsWarning(diff) {
    const box = document.getElementById('deletions-warning');
    const list = document.getElementById('deletions-list');
    if (!diff.deleted.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    list.innerHTML = diff.deleted.slice(0, 200).map(d => `<div class="del-item">${escapeHtml(d.path)}</div>`).join('') +
      (diff.deleted.length > 200 ? `<div class="del-item more">+ ${diff.deleted.length - 200} more files</div>` : '');
  }

  function splitPath(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
  }

  const STATUS_GLYPH = { added: '+', modified: '~', deleted: '\u2212', pending: '\u2022' };

  function fileRowInner(path, status, badgeText) {
    const { dir, name } = splitPath(path);
    return `
      <span class="fr-ico ${status}">${STATUS_GLYPH[status] || '\u2022'}</span>
      <span class="fr-main">
        <span class="fr-name">${escapeHtml(name)}</span>
        ${dir ? `<span class="fr-dir">${escapeHtml(dir)}</span>` : ''}
      </span>
      <span class="status-badge ${status}" data-role="badge">${badgeText}</span>`;
  }

  function renderFileList(container, diff, filter, searchTerm, onOpenDiff) {
    container.innerHTML = '';
    let items = [
      ...diff.added.map(i => ({ ...i, status: 'added' })),
      ...diff.modified.map(i => ({ ...i, status: 'modified' })),
      ...diff.deleted.map(i => ({ ...i, status: 'deleted' })),
    ];
    if (filter !== 'all') items = items.filter(i => i.status === filter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      items = items.filter(i => i.path.toLowerCase().includes(q));
    }
    items.sort((a, b) => a.path.localeCompare(b.path));

    if (!items.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-ico">\u2713</div>
        <div class="empty-title">${diff.added.length + diff.modified.length + diff.deleted.length === 0 ? 'Everything is already up to date' : 'No files match'}</div>
        <div class="empty-sub">${diff.added.length + diff.modified.length + diff.deleted.length === 0 ? 'Your files are identical to what is on GitHub, so there is nothing to commit.' : 'Try a different filter or search term.'}</div>
      </div>`;
      return;
    }

    // Render in chunks so a project with thousands of changed files never freezes the screen.
    const CHUNK = 120;
    let idx = 0;
    const token = (container._renderToken = {});
    function paint() {
      if (container._renderToken !== token) return; // a newer render replaced this one
      const frag = document.createDocumentFragment();
      const end = Math.min(idx + CHUNK, items.length);
      for (; idx < end; idx++) {
        const item = items[idx];
        const row = document.createElement('div');
        const canDiff = item.status !== 'deleted';
        row.className = 'file-row' + (canDiff ? ' clickable' : '');
        row.innerHTML = fileRowInner(item.path, item.status, badgeLabel(item.status)) +
          (canDiff ? '<span class="fr-chev" aria-hidden="true">\u203a</span>' : '');
        if (canDiff) {
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.setAttribute('aria-label', 'View diff for ' + item.path);
          row.addEventListener('click', () => onOpenDiff(item));
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDiff(item); } });
        }
        frag.appendChild(row);
      }
      container.appendChild(frag);
      if (idx < items.length) requestAnimationFrame(paint);
    }
    paint();
  }

  /**
   * Full-screen commit history: up to 5 recent commits, each with its own
   * clearly labeled list of added/modified/deleted files (from GitHub's
   * "get a commit" response, which includes a files[] array). Rendered as a
   * flat, divided list rather than individually boxed cards.
   */
  function renderCommitHistoryLoading() {
    document.getElementById('commit-files-list').innerHTML =
      '<div class="hint" style="padding:16px 2px">Loading commit history…</div>';
  }

  function renderCommitHistory(commits) {
    const container = document.getElementById('commit-files-list');
    container.innerHTML = '';
    if (!commits || !commits.length) {
      container.innerHTML = '<div class="hint" style="padding:16px 2px">No commits found on this branch.</div>';
      return;
    }

    for (const commitInfo of commits) {
      const firstLine = (commitInfo.commit?.message || '').split('\n')[0] || '(no message)';
      const authorDate = commitInfo.commit?.author?.date;
      const files = commitInfo.files || [];
      const added = files.filter(f => f.status === 'added').length;
      const removed = files.filter(f => f.status === 'removed').length;
      const changed = files.length - added - removed;

      const group = document.createElement('div');
      group.className = 'commit-history-group';

      const statParts = [];
      if (added) statParts.push(`<span class="chg-stat added">+${added} added</span>`);
      if (changed) statParts.push(`<span class="chg-stat modified">${changed} changed</span>`);
      if (removed) statParts.push(`<span class="chg-stat deleted">-${removed} deleted</span>`);

      group.innerHTML = `
        <div class="commit-history-head">
          <span class="commit-history-msg">${escapeHtml(firstLine)}</span>
          <span class="commit-history-meta">
            ${authorDate ? relativeTime(authorDate) + ' · ' : ''}<code>${commitInfo.sha.slice(0, 7)}</code>
            ${statParts.length ? ' · ' + statParts.join(' ') : ''}
          </span>
        </div>
        <div class="commit-history-files"></div>
      `;

      const filesEl = group.querySelector('.commit-history-files');
      if (!files.length) {
        filesEl.innerHTML = '<div class="hint" style="padding:8px 0 4px">No file details available for this commit.</div>';
      } else {
        for (const f of files) {
          const status = commitFileStatus(f.status);
          const row = document.createElement('div');
          row.className = 'chf-row';
          row.innerHTML = `
            <span class="status-badge ${status}">${badgeLabel(status)}</span>
            <span class="file-path">${escapeHtml(f.filename)}</span>
            <span class="commit-file-stat"><span class="add-stat">+${f.additions ?? 0}</span> <span class="del-stat">-${f.deletions ?? 0}</span></span>
          `;
          filesEl.appendChild(row);
        }
      }

      container.appendChild(group);
    }
  }

  function commitFileStatus(githubStatus) {
    if (githubStatus === 'added') return 'added';
    if (githubStatus === 'removed') return 'deleted';
    return 'modified'; // modified, renamed, copied, changed
  }

  function badgeLabel(status) {
    return { added: 'ADDED', modified: 'MODIFIED', deleted: 'DELETED', unchanged: 'UNCHANGED' }[status] || status.toUpperCase();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Sync results (per-file live status) ----------------

  let syncTotal = 0, syncDone = 0, syncOk = 0, syncFail = 0;

  function setSyncProgress(pct, title, sub) {
    const ring = document.getElementById('sr-ring');
    if (ring) ring.style.setProperty('--p', pct);
    const p = document.getElementById('sr-pct'); if (p) p.textContent = pct + '%';
    if (title != null) document.getElementById('sr-title').textContent = title;
    if (sub != null) document.getElementById('sr-sub').textContent = sub;
  }

  function initSyncResultsList(container, items) {
    container.innerHTML = '';
    syncTotal = items.length; syncDone = 0; syncOk = 0; syncFail = 0;
    const hero = document.getElementById('sr-hero');
    if (hero) hero.setAttribute('data-state', 'running');
    setSyncProgress(0, 'Uploading to GitHub\u2026', 'Keep this screen open until it finishes.');
    document.getElementById('results-count-success').textContent = '0 Succeeded';
    document.getElementById('results-count-failed').textContent = '0 Failed';
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-row result-row';
      row.dataset.path = item.path;
      row.innerHTML = fileRowInner(item.path, 'pending', 'WAITING') +
        '<div class="fr-error hidden" data-role="error"></div>';
      frag.appendChild(row);
    }
    container.appendChild(frag);
  }

  function setSyncResultStatus(container, path, status, errorMessage) {
    const row = container.querySelector(`.result-row[data-path="${cssEscape(path)}"]`);
    if (!row) return;
    const badge = row.querySelector('[data-role="badge"]');
    badge.className = `status-badge ${status}`;
    badge.textContent = status === 'success' ? '\u2713 DONE' : status === 'failed' ? '\u2715 FAILED' : status.toUpperCase();
    const ico = row.querySelector('.fr-ico');
    if (ico) {
      ico.className = `fr-ico ${status}`;
      ico.textContent = status === 'success' ? '\u2713' : status === 'failed' ? '\u2715' : '\u2022';
    }
    row.classList.add(status);
    if (errorMessage) {
      const errEl = row.querySelector('[data-role="error"]');
      errEl.textContent = errorMessage;
      errEl.classList.remove('hidden');
    }
    // Keep the row being worked on in view without yanking the page around.
    syncDone++;
    if (status === 'success') syncOk++; else if (status === 'failed') syncFail++;
    document.getElementById('results-count-success').textContent = `${syncOk} Succeeded`;
    document.getElementById('results-count-failed').textContent = `${syncFail} Failed`;
    const pct = syncTotal ? Math.min(99, Math.round(syncDone / syncTotal * 100)) : 0;
    setSyncProgress(pct);
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  function renderSyncSummary(successCount, failedCount) {
    document.getElementById('results-count-success').textContent = `${successCount} Succeeded`;
    document.getElementById('results-count-failed').textContent = `${failedCount} Failed`;
    const hero = document.getElementById('sr-hero');
    const banner = document.getElementById('sync-results-banner');
    const retryBtn = document.getElementById('results-retry-btn');
    banner.classList.remove('hidden');
    if (failedCount === 0) {
      if (hero) hero.setAttribute('data-state', 'ok');
      setSyncProgress(100, 'All files uploaded', 'Creating your commit\u2026');
      banner.className = 'sr-banner ok';
      banner.innerHTML = `<span class="sr-banner-ico">\u2713</span><span>All files were sent from GitSync successfully. GitHub may take a few seconds to show the change.</span>`;
      retryBtn.classList.add('hidden');
    } else {
      if (hero) hero.setAttribute('data-state', 'fail');
      setSyncProgress(Math.round(successCount / Math.max(1, successCount + failedCount) * 100), `${failedCount} file${failedCount === 1 ? '' : 's'} failed`, 'No commit was created \u2014 nothing changed on GitHub.');
      banner.className = 'sr-banner fail';
      banner.innerHTML = `<span class="sr-banner-ico">!</span><span>Fix the issue shown on the failed files below, then tap Try Again. Nothing was changed on GitHub.</span>`;
      retryBtn.classList.remove('hidden');
      const firstFail = document.querySelector('#sync-results-list .result-row.failed');
      if (firstFail && firstFail.scrollIntoView) firstFail.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function openDiffModal(title, bodyHtml) {
    document.getElementById('diff-modal-title').textContent = title;
    document.getElementById('diff-modal-body').innerHTML = bodyHtml;
    document.getElementById('diff-modal').classList.remove('hidden');
  }

  function closeDiffModal() {
    document.getElementById('diff-modal').classList.add('hidden');
  }

  function renderDiffOps(ops) {
    return ops.map(op => {
      const cls = op.type === 'add' ? 'diff-add' : op.type === 'remove' ? 'diff-remove' : 'diff-context';
      const prefix = op.type === 'add' ? '+ ' : op.type === 'remove' ? '- ' : '  ';
      return `<div class="diff-line ${cls}">${prefix}${escapeHtml(op.line)}</div>`;
    }).join('');
  }

  // ---------------- Success view (full-screen) ----------------

  function fileRowHtml(path, status) {
    const { dir, name } = splitPath(path);
    return `
      <div class="flat-file-row">
        <span class="fr-ico ${status}">${STATUS_GLYPH[status] || '\u2022'}</span>
        <span class="fr-main"><span class="fr-name">${escapeHtml(name)}</span>${dir ? `<span class="fr-dir">${escapeHtml(dir)}</span>` : ''}</span>
        <span class="status-badge ${status}">${badgeLabel(status)}</span>
      </div>`;
  }

  function burst(container) {
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#5b7cff', '#8b5cf6', '#3ecf8e', '#e2b93b', '#f56565'];
    container.innerHTML = Array.from({ length: 26 }, (_, i) => {
      const x = (Math.random() * 100).toFixed(1);
      const d = (Math.random() * .5).toFixed(2);
      const t = (1.6 + Math.random() * 1.2).toFixed(2);
      const r = Math.round(Math.random() * 360);
      return `<i style="left:${x}%;background:${colors[i % 5]};animation-delay:${d}s;animation-duration:${t}s;--r:${r}deg"></i>`;
    }).join('');
    setTimeout(() => { container.innerHTML = ''; }, 3500);
  }

  function renderSuccessView({ message, sha, files, githubUrl, repoName, branch }) {
    const firstLine = (message || '').split('\n')[0];
    document.getElementById('success-message').textContent = firstLine || '(no message)';
    document.getElementById('success-file-count').textContent = `${files.length} file${files.length === 1 ? '' : 's'} changed`;
    document.getElementById('success-sha').textContent = sha.slice(0, 7);
    document.getElementById('view-on-github-btn').href = githubUrl;
    const repoChip = document.getElementById('success-repo-chip');
    if (repoChip) repoChip.textContent = repoName || '';
    repoChip && repoChip.classList.toggle('hidden', !repoName);
    const br = document.getElementById('success-branch'); if (br) br.textContent = branch || '';
    const shaBtn = document.getElementById('success-sha-btn');
    if (shaBtn) shaBtn.onclick = () => {
      if (navigator.clipboard) navigator.clipboard.writeText(sha).then(() => toast('Commit hash copied')).catch(() => {});
    };

    const count = (st) => files.filter(f => f.status === st).length;
    document.getElementById('success-added').textContent = count('added');
    document.getElementById('success-modified').textContent = count('modified');
    document.getElementById('success-deleted').textContent = count('deleted');

    const list = document.getElementById('success-files-list');
    list.innerHTML = files.length
      ? files.slice(0, 200).map(f => fileRowHtml(f.path, f.status)).join('')
      : '<div class="hint" style="padding:4px 0">No file details available.</div>';
    if (files.length > 200) {
      list.innerHTML += `<div class="hint" style="padding:8px 0 0">+ ${files.length - 200} more files</div>`;
    }

    // Replay the check animation on every push.
    const badge = document.querySelector('.success-hero-badge');
    if (badge) { badge.style.animation = 'none'; void badge.offsetWidth; badge.style.animation = ''; }
    burst(document.getElementById('success-confetti'));
    window.scrollTo({ top: 0 });

    // Reset the verification row back to its "checking" state for this push.
    const icon = document.getElementById('success-verify-icon');
    icon.className = 'sync-status-icon pending';
    icon.innerHTML = '<span class="spinner"></span>';
    document.getElementById('success-verify-title').textContent = 'Confirming on GitHub\u2026';
    document.getElementById('success-verify-sub').textContent =
      'GitHub can take a few seconds to reflect a brand-new push. Open Live GitHub Commit any time to check the exact live state.';
  }

  function updateSuccessVerify(status) {
    const icon = document.getElementById('success-verify-icon');
    const title = document.getElementById('success-verify-title');
    const sub = document.getElementById('success-verify-sub');
    if (status === 'confirmed') {
      icon.className = 'sync-status-icon done';
      icon.innerHTML = '✓';
      title.textContent = 'Confirmed on GitHub';
      sub.textContent = 'GitHub now reflects this exact commit.';
    } else {
      icon.className = 'sync-status-icon warn';
      icon.innerHTML = '⏳';
      title.textContent = "Still syncing with GitHub";
      sub.textContent = "GitHub hasn't reported this commit as live yet. Open Live GitHub Commit to check again.";
    }
  }

  // ---------------- Live GitHub Commit view (full-screen) ----------------

  function renderLiveCommitLoading() {
    document.getElementById('live-commit-subtitle').textContent = 'Fetching the exact live state…';
    document.getElementById('live-commit-body').innerHTML = `
      <div class="hint" style="padding:24px 2px">Contacting GitHub for the current branch state…</div>`;
  }

  function renderLiveCommitError(message) {
    document.getElementById('live-commit-subtitle').textContent = "Couldn't reach GitHub";
    document.getElementById('live-commit-body').innerHTML = `
      <div class="live-banner warn">
        <span class="live-banner-icon">⚠</span>
        <span>${escapeHtml(message)}</span>
      </div>`;
  }

  function renderLiveCommit({ branch, commitInfo, appRecord, reconciliation, failedFiles }) {
    const subtitle = document.getElementById('live-commit-subtitle');
    subtitle.textContent = `Fetched just now · ${branch}`;

    const firstLine = (commitInfo.commit?.message || '').split('\n')[0] || '(no message)';
    const authorDate = commitInfo.commit?.author?.date;
    const files = commitInfo.files || [];
    const added = files.filter(f => f.status === 'added').length;
    const removed = files.filter(f => f.status === 'removed').length;
    const changed = files.length - added - removed;

    let banner = '';
    if (reconciliation && reconciliation.status === 'match') {
      banner = `
        <div class="live-banner match">
          <span class="live-banner-icon">✓</span>
          <span>This matches your last App Commit — GitHub is fully up to date with everything you pushed.</span>
        </div>`;
    } else if (reconciliation && reconciliation.status === 'mismatch') {
      const ageMs = appRecord.pushedAt ? Date.now() - appRecord.pushedAt : Infinity;
      const recent = ageMs < 3 * 60 * 1000;
      banner = `
        <div class="live-banner ${recent ? 'pending' : 'warn'}">
          <span class="live-banner-icon">${recent ? '⏳' : '⚠'}</span>
          <span>
            ${recent
              ? `GitHub hasn't fully caught up with your last App Commit (<code>${appRecord.sha.slice(0, 7)}</code>) yet. This usually finishes within a few seconds up to about a minute — tap Refresh to check again.`
              : `The commit GitHub is currently serving (<code>${commitInfo.sha.slice(0, 7)}</code>) is different from your last App Commit (<code>${appRecord.sha.slice(0, 7)}</code>). Someone — or something else — may have pushed since. Files below are checked against what's live right now.`}
          </span>
        </div>`;
    }

    const statParts = [];
    if (added) statParts.push(`<span class="chg-stat added">+${added} added</span>`);
    if (changed) statParts.push(`<span class="chg-stat modified">${changed} changed</span>`);
    if (removed) statParts.push(`<span class="chg-stat deleted">-${removed} deleted</span>`);

    let filesHtml = '';
    if (!files.length) {
      filesHtml = '<div class="hint" style="padding:8px 2px">No file details available for this commit.</div>';
    } else {
      filesHtml = files.map(f => {
        const status = commitFileStatus(f.status);
        return `
          <div class="chf-row">
            <span class="status-badge ${status}">${badgeLabel(status)}</span>
            <span class="file-path">${escapeHtml(f.filename)}</span>
            <span class="commit-file-stat"><span class="add-stat">+${f.additions ?? 0}</span> <span class="del-stat">-${f.deletions ?? 0}</span></span>
          </div>`;
      }).join('');
    }

    let pendingHtml = '';
    if (reconciliation && reconciliation.status === 'mismatch' && reconciliation.pending.length) {
      pendingHtml = `
        <div class="live-commit-section">
          <div class="live-commit-section-head">Not reflected on GitHub yet (${reconciliation.pending.length})</div>
          <div class="live-commit-section-sub">These were part of your last App Commit but don't appear in what GitHub is currently serving.</div>
          ${reconciliation.pending.map(f => `
            <div class="chf-row">
              <span class="status-badge pending">PENDING</span>
              <span class="file-path">${escapeHtml(f.path)}</span>
            </div>`).join('')}
        </div>`;
    }

    let failedHtml = '';
    if (failedFiles && failedFiles.length) {
      failedHtml = `
        <div class="live-commit-section">
          <div class="live-commit-section-head">Needs re-upload (${failedFiles.length})</div>
          <div class="live-commit-section-sub">These files errored on the last upload attempt and were never sent to GitHub — nothing was committed for them.</div>
          ${failedFiles.map(f => `
            <div class="chf-row">
              <span class="status-badge failed">✕ FAILED</span>
              <span class="file-path">${escapeHtml(f.path)}</span>
            </div>
            ${f.error ? `<div class="chf-error">${escapeHtml(f.error)}</div>` : ''}`).join('')}
        </div>`;
    }

    document.getElementById('live-commit-body').innerHTML = `
      <div class="live-commit-hero">
        <div class="live-commit-hero-title">${escapeHtml(firstLine)}</div>
        <div class="live-commit-hero-meta">
          ${authorDate ? relativeTime(authorDate) + ' · ' : ''}<code>${commitInfo.sha.slice(0, 7)}</code>
          ${statParts.length ? ' · ' + statParts.join(' ') : ''}
        </div>
        <a class="btn-link" href="${commitInfo.html_url || '#'}" target="_blank" rel="noopener">View this commit on GitHub ↗</a>
      </div>
      ${banner}
      <div class="live-commit-section">
        <div class="live-commit-section-head">Changed in this commit (${files.length})</div>
        ${filesHtml}
      </div>
      ${pendingHtml}
      ${failedHtml}
      <button type="button" class="btn-link" id="live-commit-history-link" style="margin:18px 2px 40px">View last 5 commits →</button>
    `;
  }

  return {
    showView, setNavActive, toast, confirm, setProgress,
    renderRepoOptions, renderBranchOptions, renderAppCommitRow,
    renderCommitHistoryLoading, renderCommitHistory,
    renderSummaryCounts, renderDeletionsWarning, renderFileList,
    openDiffModal, closeDiffModal, renderDiffOps, escapeHtml,
    initSyncResultsList, setSyncResultStatus, renderSyncSummary, setSyncProgress,
    renderSuccessView, updateSuccessVerify,
    renderLiveCommitLoading, renderLiveCommitError, renderLiveCommit
  };
})();
