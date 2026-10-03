/* UploadUI — full-screen upload progress + success page (shared by pages). */
const UploadUI = (() => {
  let el = null;
  let busy = false;
  window.GitSyncIsBusy = () => busy;
  const STEPS = ['Reading ZIP', 'Creating repository', 'Uploading files', 'Finishing up'];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function root() {
    if (!el) { el = document.createElement('div'); el.className = 'up-overlay hidden'; document.body.appendChild(el); }
    return el;
  }
  function open() {
    busy = true;
    const r = root();
    r.classList.remove('hidden');
    r.innerHTML = `<div class="up-card">
      <div class="up-ring" id="up-ring" style="--p:0"><div class="up-ring-in"><span id="up-pct">0%</span></div></div>
      <div class="up-title" id="up-label">Getting started…</div>
      <div class="up-detail" id="up-detail"></div>
      <ul class="up-steps">${STEPS.map((s, i) => `<li data-i="${i}"><span class="up-dot"></span>${s}</li>`).join('')}</ul>
      <div class="up-note">Please keep this screen open until it finishes.</div></div>`;
  }
  function progress(pct, label, detail) {
    if (!el || el.classList.contains('hidden') || !document.getElementById('up-ring')) open();
    document.getElementById('up-ring').style.setProperty('--p', pct);
    document.getElementById('up-pct').textContent = pct + '%';
    if (label != null) document.getElementById('up-label').textContent = label;
    if (detail != null) document.getElementById('up-detail').textContent = detail;
    const cur = pct < 32 ? 0 : pct < 42 ? 1 : pct < 98 ? 2 : 3;
    el.querySelectorAll('.up-steps li').forEach((li, i) => {
      li.className = i < cur ? 'done' : i === cur ? 'active' : '';
    });
  }
  function close() { busy = false; if (el) el.classList.add('hidden'); }

  function confetti() {
    const colors = ['#5b7cff', '#8b5cf6', '#3ecf8e', '#e2b93b', '#f56565'];
    return Array.from({ length: 28 }, (_, i) =>
      `<i style="left:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${(Math.random() * .6).toFixed(2)}s;animation-duration:${(1.8 + Math.random() * 1.4).toFixed(2)}s"></i>`).join('');
  }

  /** opts: { repo, isPrivate, branch, fileCount, note, onPublish: async () => url, onBrowse } */
  function success(o) {
    busy = false;
    const r = root();
    r.classList.remove('hidden');
    const live = o.isPrivate
      ? `<div class="up-live private">🔒 <b>Private repository</b><br>GitSync can't publish private repos. To host it, open it on GitHub → <b>Settings → Pages</b>.
         <a class="btn btn-secondary btn-block" target="_blank" rel="noopener" href="${esc(o.repo.html_url)}/settings/pages">Open Pages settings on GitHub ↗</a></div>`
      : `<div class="up-live" id="up-live"><button class="btn btn-secondary btn-block" id="up-publish">🌐 Publish with GitHub Pages</button></div>`;
    r.innerHTML = `<div class="up-card up-success"><div class="up-confetti">${confetti()}</div>
      <div class="up-badge"><svg class="success-tick" viewBox="0 0 52 52" aria-hidden="true"><path d="M14 27l8 8 16-17"/></svg></div>
      <div class="up-title big">Upload complete!</div>
      <div class="up-detail">Your project is now live on GitHub.</div>
      <div class="up-repo"><code>${esc(o.repo.full_name)}</code><button class="btn-link small" id="up-copy">Copy</button></div>
      <div class="up-stats">
        <div><b>${o.fileCount || 0}</b><small>Files</small></div>
        <div><b>${o.isPrivate ? 'Private' : 'Public'}</b><small>Visibility</small></div>
        <div><b>${esc(o.branch)}</b><small>Branch</small></div></div>
      ${o.note ? `<div class="up-note warn">${esc(o.note)}</div>` : ''}
      ${live}
      <a class="btn btn-primary btn-block" target="_blank" rel="noopener" href="${esc(o.repo.html_url)}">Open on GitHub ↗</a>
      <div class="up-two"><button class="btn btn-secondary" id="up-browse">Browse Files</button><button class="btn btn-secondary" id="up-done">Done</button></div></div>`;
    r.scrollTop = 0;
    r.querySelector('#up-done').onclick = close;
    r.querySelector('#up-browse').onclick = () => { close(); o.onBrowse && o.onBrowse(); };
    r.querySelector('#up-copy').onclick = e => { navigator.clipboard && navigator.clipboard.writeText(o.repo.html_url); e.target.textContent = 'Copied ✓'; };
    const pub = r.querySelector('#up-publish');
    if (pub) pub.onclick = async () => {
      pub.disabled = true; pub.textContent = 'Publishing…';
      try {
        const url = await o.onPublish();
        document.getElementById('up-live').innerHTML = `<div class="up-liveurl"><span class="live-dot building"></span> Live link (ready in 1–2 min)
          <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>
          <button class="btn-link small" id="up-copy2">Copy link</button></div>`;
        document.getElementById('up-copy2').onclick = e => { navigator.clipboard && navigator.clipboard.writeText(url); e.target.textContent = 'Copied ✓'; };
      } catch (err) { pub.disabled = false; pub.textContent = '🌐 Publish with GitHub Pages'; }
    };
  }
  return { open, progress, success, close };
})();
