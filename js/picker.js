/*!
 * GitSync — © 2026 CodeZing (https://youtube.com/@kudosc?si=au2Bagg75VuP_jEr)
 * All rights reserved. Source available for viewing only via the official
 * GitHub repository. No copying, re-hosting, modification-and-redistribution,
 * or resale without written permission. See LICENSE for full terms.
 */
/**
 * picker.js
 * A single reusable, in-app popup ("bottom sheet" on mobile, centered modal
 * on desktop) for choosing one item from a list — with search. This is what
 * backs the Repository and Branch selectors on the dashboard, replacing the
 * OS/browser's native <select> dropdown (which on some mobile browsers
 * needs two or three taps to actually open) with something that matches
 * the rest of the app and opens reliably on the first tap.
 */

const Picker = (() => {
  let items = [];
  let onPick = null;

  function els() {
    return {
      sheet: document.getElementById('picker-sheet'),
      title: document.getElementById('picker-sheet-title'),
      search: document.getElementById('picker-search'),
      list: document.getElementById('picker-list'),
      closeBtn: document.getElementById('picker-sheet-close')
    };
  }

  function renderList(query) {
    const { list } = els();
    const q = (query || '').trim().toLowerCase();
    const visible = q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
    list.innerHTML = '';

    if (!visible.length) {
      list.innerHTML = '<div class="hint" style="padding:18px 4px">No matches.</div>';
      return;
    }

    for (const item of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'picker-item' + (item.selected ? ' selected' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(!!item.selected));
      row.innerHTML = `
        <span class="picker-item-main">
          <span class="picker-item-label">${UI.escapeHtml(item.label)}</span>
          ${item.sub ? `<span class="picker-item-sub">${UI.escapeHtml(item.sub)}</span>` : ''}
        </span>
        ${item.selected ? '<span class="picker-item-check">✓</span>' : ''}
      `;
      row.addEventListener('click', () => {
        // Capture the callback before close() clears it — otherwise the
        // selection is silently dropped and the sheet just closes with
        // nothing changed.
        const selectCallback = onPick;
        const value = item.value;
        close();
        if (selectCallback) selectCallback(value);
      });
      list.appendChild(row);
    }
  }

  /**
   * Opens the picker.
   * @param {string} title
   * @param {Array<{value:string,label:string,sub?:string,selected?:boolean}>} newItems
   * @param {(value:string)=>void} onSelect
   * @param {string} [searchPlaceholder]
   */
  function open(title, newItems, onSelect, searchPlaceholder) {
    const { sheet, title: titleEl, search, closeBtn } = els();
    items = newItems || [];
    onPick = onSelect || null;
    titleEl.textContent = title || 'Select';
    search.value = '';
    search.placeholder = searchPlaceholder || 'Search…';
    renderList('');
    sheet.classList.remove('hidden');
    document.body.classList.add('no-scroll');

    // Scroll the currently-selected item into view so a long list (many
    // repos) doesn't force a hunt-and-scroll on open.
    requestAnimationFrame(() => {
      const selectedEl = els().list.querySelector('.picker-item.selected');
      if (selectedEl) selectedEl.scrollIntoView({ block: 'center' });
    });

    // Only steal focus (and pop the keyboard) on larger screens — on
    // mobile it's nicer to let the person see the list first.
    if (window.matchMedia('(min-width: 860px)').matches) search.focus();

    search.oninput = () => renderList(search.value);
    closeBtn.onclick = close;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
  }

  function close() {
    document.getElementById('picker-sheet').classList.add('hidden');
    document.body.classList.remove('no-scroll');
    items = [];
    onPick = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('picker-sheet').classList.contains('hidden')) close();
  });

  return { open, close };
})();
