/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * profile.js
 * Drives profile.html — a read-only mirror of the signed-in user's GitHub
 * profile: header (avatar, name, bio, followers/following, details), profile
 * README, pinned repositories, contribution graph, organizations, plus tabs
 * for Repositories, Stars, Followers and Following.
 * Everything comes straight from api.github.com using the saved token.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => UI.escapeHtml(s == null ? '' : String(s));
  const av = (u, size) => `${u}${String(u).includes('?') ? '&' : '?'}s=${size}`;
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());

  const state = { user: null, repos: [], loaded: {}, pages: {} };

  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26', CSS: '#563d7c',
    Java: '#b07219', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600', Go: '#00ADD8', Rust: '#dea584',
    PHP: '#4F5D95', Ruby: '#701516', Shell: '#89e051', Kotlin: '#A97BFF', Swift: '#F05138',
    Dart: '#00B4AB', Vue: '#41b883', SCSS: '#c6538c', Lua: '#000080'
  };

  const ICONS = {
    company: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>',
    location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    twitter: '<path d="M4 4l16 16M20 4L4 20"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

  function friendly(e) {
    if (!e) return 'Something went wrong. Please try again.';
    if (e.kind === 'auth') return 'GitHub authentication expired. Please reconnect your GitHub account.';
    if (e.kind === 'rate_limit') return 'GitHub API rate limit reached. Please wait a few minutes and try again.';
    if (e.kind === 'network') return 'Network error. Check your connection and try again.';
    return e.message || 'Something went wrong. Please try again.';
  }

  function safeUrl(u) {
    if (!u) return null;
    const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    try {
      const url = new URL(withScheme);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch (e) { return null; }
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return ''; }
  }
  function fmtShort(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
  }

  /** GitHub already sanitises its rendered README HTML; this is a second layer of defence. */
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta,base,svg').forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        const bad = /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value);
        if (n.startsWith('on') || ((n === 'href' || n === 'src') && bad)) el.removeAttribute(a.name);
      });
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    });
    return doc.body.innerHTML;
  }

  // ---------------- Boot ----------------

  async function boot() {
    if (!Auth.getToken()) {
      $('profile-not-connected').classList.remove('hidden');
      return;
    }
    $('profile-connected').classList.remove('hidden');

    const acc = Auth.getActiveAccount();
    if (acc) {
      $('pf-login').textContent = '@' + acc.login;
      if (acc.avatarUrl) $('pf-avatar').src = acc.avatarUrl;
    }
    initTabs();

    try {
      state.user = await GitHub.getUser();
    } catch (e) {
      $('pf-name').textContent = acc ? acc.login : 'Profile';
      UI.toast(friendly(e));
      return;
    }
    renderHeader(state.user);

    // Independent sections load in parallel; each one fails soft.
    loadRepos();
    loadStarCount();
    loadOrgs();
    loadReadme(state.user.login);
    loadGraphQL();
  }

  // ---------------- Header ----------------

  function renderHeader(u) {
    $('pf-avatar').src = u.avatar_url;
    $('pf-name').textContent = u.name || u.login;
    $('pf-login').textContent = '@' + u.login;
    if (u.type && u.type !== 'User') { $('pf-pill').textContent = u.type; $('pf-pill').classList.remove('hidden'); }
    else if (u.plan && u.plan.name && u.plan.name !== 'free') { $('pf-pill').textContent = u.plan.name; $('pf-pill').classList.remove('hidden'); }

    if (u.bio) { $('pf-bio').textContent = u.bio; $('pf-bio').classList.remove('hidden'); }

    $('pf-followers').textContent = fmt(u.followers);
    $('pf-following').textContent = fmt(u.following);
    $('pf-n-followers').textContent = fmt(u.followers);
    $('pf-n-following').textContent = fmt(u.following);

    const totalRepos = (u.public_repos || 0) + (u.owned_private_repos || 0);
    $('pf-s-repos').textContent = fmt(totalRepos);
    $('pf-n-repos').textContent = fmt(totalRepos);
    $('pf-s-gists').textContent = fmt((u.public_gists || 0) + (u.private_gists || 0));

    $('pf-open-gh').href = u.html_url;

    const rows = [];
    if (u.company) rows.push(['company', esc(u.company)]);
    if (u.location) rows.push(['location', esc(u.location)]);
    if (u.email) rows.push(['mail', `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>`]);
    const site = safeUrl(u.blog);
    if (site) rows.push(['link', `<a href="${esc(site.href)}" target="_blank" rel="noopener noreferrer">${esc(site.host + (site.pathname === '/' ? '' : site.pathname))}</a>`]);
    if (u.twitter_username) rows.push(['twitter', `<a href="https://x.com/${encodeURIComponent(u.twitter_username)}" target="_blank" rel="noopener noreferrer">@${esc(u.twitter_username)}</a>`]);
    if (u.hireable) rows.push(['briefcase', 'Available for hire']);
    if (u.created_at) rows.push(['calendar', `Joined ${esc(fmtDate(u.created_at))}`]);
    $('pf-meta').innerHTML = rows.map(([k, html]) => `<li>${icon(k)}<span>${html}</span></li>`).join('');
  }

  // ---------------- Stats / orgs ----------------

  async function loadStarCount() {
    try {
      const n = await GitHub.starredCount();
      $('pf-s-stars').textContent = fmt(n);
      $('pf-n-stars').textContent = fmt(n);
    } catch (e) { /* leave the dash */ }
  }

  async function loadOrgs() {
    try {
      const orgs = await GitHub.listOrgs();
      $('pf-s-orgs').textContent = fmt(orgs.length);
      if (!orgs.length) return;
      $('pf-orgs').innerHTML = orgs.map((o) =>
        `<a href="https://github.com/${encodeURIComponent(o.login)}" target="_blank" rel="noopener noreferrer" title="${esc(o.login)}"><img src="${esc(av(o.avatar_url, 72))}" alt="${esc(o.login)}"></a>`
      ).join('');
      $('pf-orgs-wrap').classList.remove('hidden');
    } catch (e) { $('pf-s-orgs').textContent = '0'; }
  }

  // ---------------- README (profile README repo) ----------------

  async function loadReadme(login) {
    const html = await GitHub.getProfileReadmeHtml(login);
    if (!html) return;
    $('pf-readme').innerHTML = sanitizeHtml(html);
    $('pf-readme-title').textContent = `${login} / README.md`;
    $('pf-readme-wrap').classList.remove('hidden');
  }

  // ---------------- Pinned repos + contribution graph (GraphQL) ----------------

  const GQL = `query {
    viewer {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes { ... on Repository {
          name nameWithOwner url description isPrivate stargazerCount forkCount
          primaryLanguage { name color }
        } }
      }
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount contributionLevel } }
        }
      }
    }
  }`;

  async function loadGraphQL() {
    let viewer = null;
    try {
      const res = await GitHub.graphql(GQL);
      viewer = res && res.data && res.data.viewer;
    } catch (e) { /* fall back below */ }

    const pinned = viewer && viewer.pinnedItems && viewer.pinnedItems.nodes
      ? viewer.pinnedItems.nodes.filter(Boolean) : [];
    if (pinned.length) {
      $('pf-pinned-title').textContent = 'Pinned';
      $('pf-pinned').innerHTML = pinned.map((n) => repoCard({
        name: n.name, html_url: n.url, description: n.description, private: n.isPrivate,
        language: n.primaryLanguage && n.primaryLanguage.name,
        languageColor: n.primaryLanguage && n.primaryLanguage.color,
        stargazers_count: n.stargazerCount, forks_count: n.forkCount
      })).join('');
    } else {
      state.pinnedFallback = true; // filled once the repo list arrives
      renderPopularFallback();
    }

    const cal = viewer && viewer.contributionsCollection && viewer.contributionsCollection.contributionCalendar;
    if (cal && cal.weeks) {
      renderGraph(cal);
    } else {
      $('pf-contrib-title').classList.add('hidden');
      $('pf-graph').parentElement.classList.add('hidden');
      $('pf-graph-note').classList.add('hidden');
    }
  }

  function renderPopularFallback() {
    if (!state.pinnedFallback || !state.loaded.repos) return;
    const top = state.repos.slice().sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at)).slice(0, 6);
    $('pf-pinned-title').textContent = 'Popular repositories';
    $('pf-pinned').innerHTML = top.length ? top.map(repoCard).join('') : '<div class="pf-empty">No repositories yet.</div>';
  }

  function renderGraph(cal) {
    const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
    const cells = [];
    cal.weeks.forEach((w, i) => {
      const days = w.contributionDays;
      if (i === 0 && days.length) {
        // The first week can start mid-week — pad so every column stays Sunday-first.
        const pad = new Date(days[0].date + 'T00:00:00Z').getUTCDay();
        for (let p = 0; p < pad; p++) cells.push('<i style="visibility:hidden"></i>');
      }
      days.forEach((d) => {
        const n = d.contributionCount;
        const label = `${n} contribution${n === 1 ? '' : 's'} on ${fmtShort(d.date + 'T00:00:00Z')}`;
        cells.push(`<i class="l${LEVEL[d.contributionLevel] || 0}" title="${esc(label)}"></i>`);
      });
    });
    $('pf-graph').innerHTML = cells.join('');
    $('pf-graph-note').textContent = `${fmt(cal.totalContributions)} contributions in the last year`;
    const wrap = $('pf-graph').parentElement;
    wrap.scrollLeft = wrap.scrollWidth; // show the most recent weeks first
  }

  // ---------------- Cards ----------------

  function repoCard(r) {
    const color = r.languageColor || LANG_COLORS[r.language] || '';
    const lang = r.language
      ? `<span><span class="pf-lang"${color ? ` style="background:${esc(color)}"` : ''}></span>${esc(r.language)}</span>` : '';
    const updated = r.pushed_at || r.updated_at;
    return `<div class="pf-card">
      <a class="t" href="${esc(r.html_url)}" target="_blank" rel="noopener noreferrer">${esc(r.full_name || r.name)}</a>${r.private ? '<span class="pf-vis">Private</span>' : ''}
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      <div class="row">${lang}<span>★ ${fmt(r.stargazers_count)}</span><span>⑂ ${fmt(r.forks_count)}</span>${updated ? `<span>Updated ${esc(fmtShort(updated))}</span>` : ''}</div>
    </div>`;
  }

  function userRow(u) {
    return `<a class="pf-user" href="${esc(u.html_url)}" target="_blank" rel="noopener noreferrer">
      <img src="${esc(av(u.avatar_url, 80))}" alt="" loading="lazy"><span>${esc(u.login)}</span><small>View ↗</small></a>`;
  }

  // ---------------- Repositories tab ----------------

  async function loadRepos() {
    try {
      const all = await GitHub.listRepos();
      const login = state.user.login.toLowerCase();
      state.repos = all.filter((r) => r.owner && r.owner.login.toLowerCase() === login);
      state.loaded.repos = true;
      $('pf-n-repos').textContent = fmt(state.repos.length);
      $('pf-s-repos').textContent = fmt(state.repos.length);
      renderRepos();
      renderPopularFallback();
    } catch (e) {
      $('pf-repos').innerHTML = `<div class="pf-empty">${esc(friendly(e))}</div>`;
    }
  }

  function renderRepos() {
    const q = ($('pf-repo-search').value || '').toLowerCase();
    const list = state.repos.filter((r) => r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
    $('pf-repos').innerHTML = list.length ? list.map(repoCard).join('') : '<div class="pf-empty">No repositories found.</div>';
  }

  // ---------------- Paged lists: stars / followers / following ----------------

  const LISTS = {
    stars:     { fetch: (p) => GitHub.listStarred(p),   el: 'pf-stars',          more: 'pf-stars-more',     row: repoCard, empty: 'No starred repositories yet.' },
    followers: { fetch: (p) => GitHub.listFollowers(p), el: 'pf-followers-list', more: 'pf-followers-more', row: userRow,  empty: 'No followers yet.' },
    following: { fetch: (p) => GitHub.listFollowing(p), el: 'pf-following-list', more: 'pf-following-more', row: userRow,  empty: 'Not following anyone yet.' }
  };

  async function loadPage(name) {
    const cfg = LISTS[name];
    const page = (state.pages[name] || 0) + 1;
    const moreBtn = $(cfg.more);
    moreBtn.disabled = true;
    try {
      const batch = await cfg.fetch(page);
      state.pages[name] = page;
      const el = $(cfg.el);
      if (page === 1 && !batch.length) el.innerHTML = `<div class="pf-empty">${cfg.empty}</div>`;
      else el.insertAdjacentHTML('beforeend', batch.map(cfg.row).join(''));
      state.loaded[name] = true;
      moreBtn.classList.toggle('hidden', batch.length < 30);
    } catch (e) {
      UI.toast(friendly(e));
      if (page === 1) $(cfg.el).innerHTML = `<div class="pf-empty">${esc(friendly(e))}</div>`;
    } finally {
      moreBtn.disabled = false;
    }
  }

  // ---------------- Tabs ----------------

  function showTab(name) {
    document.querySelectorAll('.pf-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.pf-pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
    if (LISTS[name] && !state.loaded[name]) loadPage(name);
  }

  function initTabs() {
    document.querySelectorAll('.pf-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
      showTab(b.dataset.goto);
      $('pf-tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const tab = document.querySelector(`.pf-tab[data-tab="${b.dataset.goto}"]`);
      if (tab) tab.scrollIntoView({ inline: 'center', block: 'nearest' });
    }));
    Object.keys(LISTS).forEach((n) => $(LISTS[n].more).addEventListener('click', () => loadPage(n)));
    $('pf-repo-search').addEventListener('input', renderRepos);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
