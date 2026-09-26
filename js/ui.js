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

  function renderLastCommit(card, msgEl, metaEl, commitInfo) {
    if (!commitInfo) { card.style.display = 'none'; return; }
    card.style.display = '';
    const firstLine = (commitInfo.commit.message || '').split('\n')[0];
    msgEl.textContent = firstLine || '(no message)';
    metaEl.textContent = `${relativeTime(commitInfo.commit.author.date)} · ${commitInfo.sha.slice(0, 7)}`;
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
    document.getElementById('count-added').textContent = `+${diff.added.length} Added`;
    document.getElementById('count-modified').textContent = `~${diff.modified.length} Modified`;
    document.getElementById('count-deleted').textContent = `-${diff.deleted.length} Deleted`;
    document.getElementById('count-unchanged').textContent = `=${diff.unchanged.length} Unchanged`;
  }

  function renderDeletionsWarning(diff) {
    const box = document.getElementById('deletions-warning');
    const list = document.getElementById('deletions-list');
    if (!diff.deleted.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    list.innerHTML = diff.deleted.map(d => `<div class="del-item">- ${escapeHtml(d.path)}</div>`).join('');
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
      container.innerHTML = '<div class="hint" style="padding:16px 0">No files match this filter.</div>';
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = `
        <div class="file-row-top">
          <span class="status-badge ${item.status}">${badgeLabel(item.status)}</span>
          <span class="file-path">${escapeHtml(item.path)}</span>
        </div>
        ${item.status !== 'deleted' ? '<div class="file-row-action">View Diff ▾</div>' : ''}
      `;
      if (item.status !== 'deleted') {
        row.addEventListener('click', () => onOpenDiff(item));
      }
      container.appendChild(row);
    }
  }

  function badgeLabel(status) {
    return { added: 'ADDED', modified: 'MODIFIED', deleted: 'DELETED', unchanged: 'UNCHANGED' }[status] || status.toUpperCase();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Sync results (per-file live status) ----------------

  function initSyncResultsList(container, items) {
    container.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-row result-row';
      row.dataset.path = item.path;
      row.innerHTML = `
        <div class="file-row-top">
          <span class="status-badge pending" data-role="badge">${badgeLabel(item.status)}</span>
          <span class="file-path">${escapeHtml(item.path)}</span>
        </div>
        <div class="file-row-action hidden" data-role="error"></div>
      `;
      container.appendChild(row);
    }
  }

  function setSyncResultStatus(container, path, status, errorMessage) {
    const row = container.querySelector(`.result-row[data-path="${cssEscape(path)}"]`);
    if (!row) return;
    const badge = row.querySelector('[data-role="badge"]');
    badge.className = `status-badge ${status}`;
    badge.textContent = status === 'success' ? '✓ DONE' : status === 'failed' ? '✕ FAILED' : status.toUpperCase();
    if (errorMessage) {
      const errEl = row.querySelector('[data-role="error"]');
      errEl.textContent = errorMessage;
      errEl.classList.remove('hidden');
      errEl.style.color = 'var(--red)';
    }
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  function renderSyncSummary(successCount, failedCount) {    document.getElementById('results-count-success').textContent = `${successCount} Succeeded`;
    document.getElementById('results-count-failed').textContent = `${failedCount} Failed`;
    const banner = document.getElementById('sync-results-banner');
    const retryBtn = document.getElementById('results-retry-btn');
    banner.classList.remove('hidden');
    if (failedCount === 0) {
      banner.innerHTML = `<div class="success-check">✓</div><div class="success-title">All files have been changed successfully</div>`;
      retryBtn.classList.add('hidden');
    } else {
      banner.innerHTML = `<div class="conflict-icon">⚠</div><div class="success-title">${failedCount} file(s) failed — no commit was created</div><p class="hint">Fix the issue below and try again. Nothing was changed on GitHub.</p>`;
      retryBtn.classList.remove('hidden');
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

  return {
    showView, setNavActive, toast, confirm, setProgress,
    renderRepoOptions, renderBranchOptions, renderLastCommit,
    renderSummaryCounts, renderDeletionsWarning, renderFileList,
    openDiffModal, closeDiffModal, renderDiffOps, escapeHtml,
    initSyncResultsList, setSyncResultStatus, renderSyncSummary
  };
})();
