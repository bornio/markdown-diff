import { baseName, formatDate } from './versions.js';

const SIDE_TITLE = { before: 'Original version', after: 'Changed version' };
const ICON = {
  check: '<path d="m5 12 5 5 9-10"/>',
  swap: '<path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${ICON[name]}</svg>`;

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child != null && child !== false));
  return node;
}

/** A version's title line, detail line, and why it is dimmed, if it is. */
function describe(entry, { source, file }) {
  const when = formatDate(entry.date);
  const sha = entry.sha.slice(0, 7);
  return {
    title: source.kind === 'repo' ? entry.message : when,
    meta: source.kind === 'repo' ? `${when} · ${entry.author} · ${sha}` : `${entry.author} · ${sha} · +${entry.additions} −${entry.deletions} in gist`,
    note: entry.absent ? `No ${baseName(file)} in this version` : !entry.changed ? `No change to ${baseName(file)}` : '',
  };
}

export function githubHref(state, sha) {
  if (state.source.kind === 'gist') return `${state.url}/revisions`;
  const { owner, repo, ref, path } = state.source;
  const segments = (value) => value.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${owner}/${repo}/blob/${sha ?? segments(ref)}/${segments(path)}`;
}

/**
 * The version list behind a GitHub filename: a popover under it, or a bottom sheet when the header asks for one.
 * Picking a version only calls `versions.pick`; the menu keeps no state of its own beyond what is open.
 */
export function createVersionMenu(versions, { swap }) {
  let open = null;

  function close({ refocus = true } = {}) {
    if (!open) return;
    const { root, anchor, sheet, cleanup } = open;
    open = null;
    cleanup();
    anchor.setAttribute('aria-expanded', 'false');
    if (sheet) {
      root.close();
      setTimeout(() => root.remove(), 260);
    } else root.remove();
    if (refocus) anchor.focus({ preventScroll: true });
  }

  function list(side) {
    const state = versions.state;
    const current = side === 'before' ? state.a : state.b;
    const wrap = el('div', { class: 'version-list-wrap' });
    const rows = el('div', { class: 'version-list', role: 'listbox', 'aria-label': 'Versions' });
    const filter = state.history.length > 30 ? el('input', {
      class: 'version-filter', type: 'search', 'aria-label': 'Filter versions',
      placeholder: state.source.kind === 'repo' ? 'Filter by message, date, author, or SHA' : 'Filter by date, author, or SHA',
    }) : null;
    function row(entry) {
      const { title, meta, note } = describe(entry, state);
      const selected = entry.sha === current;
      const tags = [
        entry.index === 0 && el('span', { class: 'version-tag' }, 'Latest'),
        entry.sha === state.a && el('span', { class: 'version-tag before' }, 'Original'),
        entry.sha === state.b && el('span', { class: 'version-tag after' }, 'Changed'),
      ];
      const button = el('button', {
        type: 'button', class: `version-row${entry.changed && !entry.absent ? '' : ' dim'}`, role: 'option',
        'data-sha': entry.sha, 'aria-selected': String(selected),
      },
      el('span', { class: 'version-check', html: selected ? svg('check') : '' }),
      el('span', { class: 'version-text' },
        el('span', { class: 'version-title' }, el('span', { class: 'version-title-text' }, title), ...tags),
        el('span', { class: 'version-meta' }, note ? `${note} · ${meta}` : meta)));
      button.addEventListener('click', () => {
        close();
        versions.pick(side, entry.sha);
      });
      return button;
    }
    function draw() {
      const query = filter ? filter.value.trim().toLowerCase() : '';
      const shown = query ? state.history.filter((entry) => {
        const { title, meta } = describe(entry, state);
        return `${title} ${meta}`.toLowerCase().includes(query);
      }) : state.history;
      rows.replaceChildren(...shown.map(row));
      if (!shown.length) rows.append(el('p', { class: 'version-empty' }, 'No loaded versions match. Older versions may match once loaded.'));
    }
    filter?.addEventListener('input', draw);
    rows.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...rows.querySelectorAll('button')];
      const next = buttons[buttons.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      next.focus();
    });
    draw();
    const foot = el('div', { class: 'version-foot' });
    if (state.hasMore) {
      const more = el('button', { type: 'button', class: 'text-button' }, 'Load older versions');
      // aria-disabled rather than disabled, so keyboard focus stays on it while the page loads.
      more.addEventListener('click', () => {
        if (more.getAttribute('aria-disabled')) return;
        more.textContent = 'Loading older versions…';
        more.setAttribute('aria-disabled', 'true');
        versions.loadOlder();
      });
      foot.append(more);
    } else foot.append(`${state.history.length} ${state.history.length === 1 ? 'version' : 'versions'}`);
    wrap.append(...[filter, rows, foot].filter(Boolean));
    return wrap;
  }

  function body(side) {
    const state = versions.state;
    const chooser = state.files.length > 1 ? el('label', { class: 'version-file' }, el('span', {}, 'File'),
      el('select', { 'aria-label': 'File in this gist' }, ...state.files.map((file) => el('option', { value: file, selected: file === state.file }, file)))) : null;
    chooser?.querySelector('select').addEventListener('change', (event) => {
      close();
      versions.setFile(event.target.value);
    });
    const swapButton = el('button', { type: 'button', class: 'version-action', html: `${svg('swap')}Swap sides` });
    swapButton.addEventListener('click', () => {
      close();
      swap();
    });
    const sha = side === 'before' ? state.a : state.b;
    const github = el('a', { class: 'version-action', href: githubHref(state, sha), target: '_blank', rel: 'noopener', html: `${svg('external')}Open on GitHub` });
    return el('div', { class: 'version-body' }, chooser, list(side), el('div', { class: 'version-actions' }, swapButton, github));
  }

  function head(side) {
    const { source, file } = versions.state;
    const where = source.kind === 'repo' ? `${source.owner}/${source.repo} · ${source.path}` : `${source.owner ? `${source.owner}/` : ''}${source.id.slice(0, 7)} · ${file}`;
    return [el('span', { class: 'version-heading' }, SIDE_TITLE[side]), el('span', { class: 'version-source' }, where)];
  }

  function focusCurrent(root) {
    const current = root.querySelector('[aria-selected=true]');
    current?.scrollIntoView({ block: 'center' });
    (current || root.querySelector('input, button'))?.focus({ preventScroll: true });
  }

  return {
    /** @param {boolean} sheet  true where the header uses sheets for filename menus (touch screens) */
    open(side, anchor, sheet) {
      close();
      if (!versions.state?.history.length) return;
      let root;
      let cleanup;
      if (sheet) {
        root = el('dialog', { class: 'file-sheet version-sheet', 'aria-label': SIDE_TITLE[side] },
          el('div', { class: 'file-sheet-panel' },
            el('div', { class: 'file-sheet-handle', 'aria-hidden': 'true' }),
            el('div', { class: 'file-sheet-head' }, ...head(side)),
            body(side)));
        root.addEventListener('click', (event) => { if (event.target === root) close(); });
        root.addEventListener('cancel', (event) => {
          event.preventDefault();
          close();
        });
        document.body.append(root);
        root.showModal();
        cleanup = () => {};
      } else {
        root = el('div', { class: 'version-popover', role: 'dialog', 'aria-label': SIDE_TITLE[side] },
          el('div', { class: 'version-popover-head' }, ...head(side)), body(side));
        document.body.append(root);
        const rect = anchor.getBoundingClientRect();
        const width = Math.min(400, innerWidth - 24);
        root.style.width = `${width}px`;
        const left = side === 'before' ? rect.left : rect.right - width;
        root.style.left = `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`;
        root.style.top = `${rect.bottom + 6}px`;
        root.style.maxHeight = `${Math.min(560, innerHeight - rect.bottom - 24)}px`;
        const outside = (event) => { if (!root.contains(event.target) && !anchor.contains(event.target)) close(); };
        const escape = (event) => { if (event.key === 'Escape') close(); };
        const resize = () => close({ refocus: false });
        // Tabbing out of the popover closes it and leaves focus where it went.
        root.addEventListener('focusout', (event) => {
          if (event.relatedTarget && !root.contains(event.relatedTarget)) close({ refocus: false });
        });
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        addEventListener('resize', resize);
        cleanup = () => {
          document.removeEventListener('pointerdown', outside);
          document.removeEventListener('keydown', escape);
          removeEventListener('resize', resize);
        };
      }
      open = { root, anchor, sheet, side, cleanup };
      anchor.setAttribute('aria-expanded', 'true');
      focusCurrent(root);
    },
    /** Redraw an open menu after more history loads, keeping focus on the same version. */
    refresh() {
      if (!open) return;
      const wrap = open.root.querySelector('.version-list-wrap');
      const focused = document.activeElement?.dataset?.sha;
      const inFoot = !!document.activeElement?.closest('.version-foot');
      const scroll = open.root.querySelector('.version-list').scrollTop;
      const query = open.root.querySelector('.version-filter')?.value;
      const next = list(open.side);
      wrap.replaceWith(next);
      const filter = next.querySelector('.version-filter');
      if (filter && query) {
        filter.value = query;
        filter.dispatchEvent(new Event('input'));
      }
      next.querySelector('.version-list').scrollTop = scroll;
      if (focused) next.querySelector(`[data-sha="${focused}"]`)?.focus({ preventScroll: true });
      else if (inFoot) (next.querySelector('.version-foot button') || [...next.querySelectorAll('.version-row')].at(-1))?.focus({ preventScroll: true });
    },
    close,
  };
}
