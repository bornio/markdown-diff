import { partners } from './partners.js';
import { presentTables } from './tables.js';

export function createComparisonView(container, chrome, { renderDocument, onRendered, onError, batchLimits, chunkRows = 0 } = {}) {
  let comparison = null;
  let names = null;
  let current = null;
  let alignmentFrame = 0;
  let resetSizes = false;
  let bookmarks = {};
  const views = new Map();
  const nearTargets = new Set();
  const activeTargets = new Set();
  const measuredHeights = new WeakMap();

  function attempt(action) {
    if (!onError) return action();
    try { return action(); }
    catch (error) {
      if (current) {
        cancelAnimationFrame(current.frame);
        cancelAnimationFrame(current.readyFrame);
        current.frame = current.readyFrame = 0;
      }
      cancelAnimationFrame(alignmentFrame);
      alignmentFrame = 0;
      incremental.disconnect();
      activeTargets.clear();
      current = null;
      onError(error);
    }
  }

  function recordHeight(node, height) {
    if (height <= 0 || measuredHeights.get(node) === height) return;
    measuredHeights.set(node, height);
    node.style.containIntrinsicBlockSize = `auto ${height}px`;
  }

  function snapshotHeights(rows) {
    const sizes = [...rows].filter((node) => node.isConnected && current?.root.contains(node))
      .map((node) => [node, node.getBoundingClientRect().height]);
    for (const [node, height] of sizes) recordHeight(node, height);
  }

  const resized = new ResizeObserver((entries) => attempt(() => {
    for (const entry of entries) {
      const node = entry.target;
      if (!node.isConnected || !current?.root.contains(node)) continue;
      recordHeight(node, entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    }
    scheduleAlignment();
    if (current?.mounted) onRendered?.();
  }));
  const visible = new IntersectionObserver((entries) => {
    let entering = false;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target.isConnected) nearTargets.add(entry.target);
      else nearTargets.delete(entry.target);
      if (current && entry.isIntersecting && entry.target.isConnected && current.root.contains(entry.target)) {
        entering ||= !activeTargets.has(entry.target);
        activeTargets.add(entry.target);
      } else {
        activeTargets.delete(entry.target);
      }
    }
    scheduleAlignment(entering);
  }, { rootMargin: '600px 0px' });
  const incremental = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting && entry.target === current?.more)) mountNext(current);
  }, { rootMargin: '1200px 0px' });

  function sideName(side) {
    return `${side === 'before' ? 'Original' : 'Changed'}: ${names[side]}`;
  }

  function cell(content, source, side, kind) {
    const node = document.createElement('div');
    node.className = source ? 'source-cell' : 'document-cell';
    node.dataset.side = side;
    if (source) {
      const number = document.createElement('span');
      number.className = 'source-number';
      number.textContent = content?.line || '';
      number.setAttribute('aria-hidden', 'true');
      const code = document.createElement('span');
      code.className = 'source-code';
      code.innerHTML = content?.html || '';
      for (const edit of code.querySelectorAll('ins, del')) {
        edit.dataset.edit = edit.tagName === 'INS' ? 'add' : 'remove';
      }
      node.append(number, code);
    } else if (renderDocument) node.append(renderDocument(content));
    else node.innerHTML = content;

    const empty = source ? !content : ![...node.childNodes].some((child) =>
      child.nodeType === Node.TEXT_NODE ? child.textContent.trim().length > 0 :
        child.nodeType === Node.ELEMENT_NODE && !child.hasAttribute('data-gap'));
    if (source && !content) node.dataset.gap = '';
    if (empty) node.setAttribute('aria-hidden', 'true');
    else {
      node.setAttribute('role', 'group');
      const change = kind === 'same' ? '' : kind === 'changed' ? ', changed' : side === 'before' ? ', removed' : ', added';
      node.setAttribute('aria-label', `${sideName(side)}${source ? `, line ${content.line}` : ''}${change}`);
    }
    if (kind !== 'same' && !empty) node.dataset.changeCue = side === 'before' ? 'remove' : 'add';
    for (const edit of node.querySelectorAll('[data-edit]')) {
      edit.setAttribute('aria-description', edit.dataset.edit === 'add' ? 'Inserted text' : 'Removed text');
    }
    if (!source) prepareDocument(node, side);
    return node;
  }

  function prepareDocument(node, side) {
    const formats = node.querySelectorAll('[data-format-change]');
    if (formats.length) {
      const description = 'Formatting or attributes changed. Source shows the Markdown syntax.';
      node.title = description;
      node.setAttribute('aria-description', description);
    }
    const changed = '[data-edit],[data-change],[data-format-change]';
    for (const details of node.querySelectorAll('details')) {
      if (!details.matches(changed) && !details.querySelector(changed)) continue;
      let summary = details.querySelector(':scope > summary');
      if (!summary) {
        summary = document.createElement('summary');
        summary.textContent = 'Details';
        details.prepend(summary);
      }
      const chip = document.createElement('span');
      chip.className = 'change-chip';
      chip.innerHTML = '<span aria-hidden="true">changed</span><span class="sr-only">contains changes</span>';
      summary.append(chip);
    }
    for (const list of node.querySelectorAll('ol')) {
      let value = list.start;
      let digits = 1;
      for (const item of list.children) {
        if (item.tagName !== 'LI' || item.hasAttribute('data-gap')) continue;
        if (item.hasAttribute('value')) value = item.value;
        digits = Math.max(digits, String(value++).length);
      }
      list.style.setProperty('--list-digits', String(digits));
    }
    for (const pre of node.querySelectorAll('pre')) {
      pre.dataset.scrollLabel = `${sideName(side)}, code, scrollable`;
    }
    const first = node.firstElementChild;
    if (first?.matches('h1, h2, h3, h4')) node.dataset.blockKind = 'heading';
    else if (first?.matches('table')) node.dataset.blockKind = 'table';
  }

  function buildRow(row, source, index, view) {
    const node = document.createElement('div');
    node.className = `pair-row ${row.kind}${source ? ' source-row' : ''}`;
    let before;
    let after;
    node.comparisonRow = index;
    let page = view.pages.get(index) || 0;
    let pager;
    let back;
    let next;
    let range;
    const fill = () => {
      const content = row.pages ? row.pages[page] : row;
      const left = cell(content.before, source, 'before', row.kind);
      const right = cell(content.after, source, 'after', row.kind);
      if (before) { before.replaceWith(left); after.replaceWith(right); }
      else node.append(left, right);
      before = left;
      after = right;
      if (!source) presentTables(left, right, sideName);
      node.scrollers = [...node.querySelectorAll('[data-scroll-label]')];
      if (pager) {
        back.setAttribute('aria-disabled', String(page === 0));
        next.setAttribute('aria-disabled', String(page === row.pages.length - 1));
        range.textContent = row.pageType === 'code' ? `Part ${page + 1} of ${row.pages.length}` : `Rows ${page * 100 + 1}–${Math.min((page + 1) * 100, row.itemCount)} of ${row.itemCount}`;
      }
    };
    if (row.pages) {
      pager = document.createElement('div');
      pager.className = 'table-pager';
      pager.setAttribute('role', 'group');
      pager.setAttribute('aria-label', 'Document page');
      back = document.createElement('button');
      back.textContent = 'Previous';
      range = document.createElement('span');
      range.setAttribute('role', 'status');
      range.setAttribute('aria-live', 'polite');
      range.setAttribute('aria-atomic', 'true');
      next = document.createElement('button');
      next.textContent = 'Next';
      const turn = (direction) => attempt(() => {
        const destination = page + direction;
        if (destination < 0 || destination >= row.pages.length) return;
        page = destination;
        fill();
        if (page) view.pages.set(index, page);
        else view.pages.delete(index);
        view.mounted = false;
        scheduleAlignment(true);
        chrome.scrollTo(pager);
        notifyMounted(view);
      });
      back.onclick = () => turn(-1);
      next.onclick = () => turn(1);
      pager.append(back, range, next);
      node.append(pager);
    }
    fill();
    if (!view.chunkSize) { visible.observe(node); resized.observe(node); }
    return node;
  }

  function createView(mode) {
    const root = document.createElement('div');
    root.className = `${mode}-view`;
    const more = document.createElement('div');
    more.className = 'mount-progress';
    const rows = mode === 'source' ? comparison.source.rows : comparison.rows;
    if (mode === 'source') root.style.setProperty('--source-digits', String(String(rows.length || 1).length));
    const bookmark = bookmarks[mode];
    const view = {
      mode, root, more, rows,
      chunkSize: mode === 'rendered' ? chunkRows : 0,
      tail: null,
      pages: new Map(bookmark?.pages),
      restore: bookmark?.anchor ? { ...bookmark.anchor, passes: 0 } : null,
      position: 0, end: 0, scroll: 0,
      frame: 0, readyFrame: 0, mounted: false,
    };
    views.set(mode, view);
    return view;
  }

  function step(view) {
    return attempt(() => {
      view.frame = 0;
      if (view !== current) return;
      const source = view.mode === 'source';
      const stop = Math.min(view.restore && batchLimits && !source ? Math.max(view.position + 12, view.restore.row) : view.position + (source ? 80 : 12), view.end);
      const fragment = document.createDocumentFragment();
      const started = batchLimits ? performance.now() : 0;
      let characters = 0;
      while (view.position < stop) {
        const row = view.rows[view.position];
        const content = row.pages ? row.pages[view.pages.get(view.position) || 0] : row;
        const cost = !batchLimits ? 0 : source ? (content.before?.html.length || 0) + (content.after?.html.length || 0) : content.before.length + content.after.length;
        if (batchLimits && fragment.childNodes.length && (characters + cost > batchLimits.characters || performance.now() - started >= batchLimits.milliseconds)) break;
        fragment.append(buildRow(row, source, view.position++, view));
        characters += cost;
      }
      if (view.chunkSize) for (const node of [...fragment.childNodes]) {
        if (node.comparisonRow % view.chunkSize === 0) {
          view.tail = document.createElement('div');
          view.tail.className = 'row-chunk';
          view.tail.style.containIntrinsicBlockSize = `auto ${Math.min(view.chunkSize, view.rows.length - node.comparisonRow) * 100}px`;
          visible.observe(view.tail);
          resized.observe(view.tail);
          fragment.append(view.tail);
        }
        view.tail.append(node);
      }
      view.root.append(fragment);
      if (view.position < view.end) view.frame = requestAnimationFrame(() => step(view));
      else if (view.position < view.rows.length) {
        view.more.textContent = `Loading as you scroll · ${view.position.toLocaleString()} of ${view.rows.length.toLocaleString()} ${source ? 'lines' : 'sections'}`;
        view.root.append(view.more);
        incremental.observe(view.more);
      }
      scheduleAlignment();
      notifyMounted(view);
    });
  }

  function notifyMounted(view) {
    if ((!onRendered && !view.restore) || view !== current || view.mounted || view.readyFrame || view.position < view.end) return;
    view.readyFrame = requestAnimationFrame(() => attempt(() => {
      view.readyFrame = requestAnimationFrame(() => attempt(() => {
        view.readyFrame = 0;
        if (view !== current || view.mounted || view.position < view.end) return;
        if (alignmentFrame) { notifyMounted(view); return; }
        if (view.restore) {
          const anchor = view.restore;
          const row = view.chunkSize ? view.root.children[Math.floor(anchor.row / view.chunkSize)]?.children[anchor.row % view.chunkSize] : view.root.children[anchor.row];
          const offset = row ? Math.min(anchor.offset, Math.max(0, row.getBoundingClientRect().height - 1)) : 0;
          const delta = row ? row.getBoundingClientRect().top + offset : 0;
          if (row && Math.abs(delta) > 1 && anchor.passes++ < 4) {
            chrome.scrollTo(window.scrollY + delta);
            scheduleAlignment(true);
          } else view.restore = null;
          notifyMounted(view);
          return;
        }
        view.mounted = true;
        bookmarks = getState();
        onRendered?.();
      }));
    }));
  }

  function mountNext(view) {
    return attempt(() => {
      if (!view || view !== current || view.frame || view.position >= view.rows.length) return;
      incremental.disconnect();
      view.more.remove();
      view.mounted = false;
      view.end = Math.min(Math.max(view.position + (view.mode === 'source' ? 400 : 120), view.restore ? view.restore.row + (view.mode === 'source' ? 400 : 120) : 0), view.rows.length);
      step(view);
    });
  }

  function pause() {
    if (current) bookmarks = getState();
    snapshotHeights(activeTargets);
    if (current) {
      current.scroll = window.scrollY;
      cancelAnimationFrame(current.frame);
      cancelAnimationFrame(current.readyFrame);
      current.frame = 0;
      current.readyFrame = 0;
    }
    incremental.disconnect();
    activeTargets.clear();
    cancelAnimationFrame(alignmentFrame);
    alignmentFrame = 0;
    current = null;
  }

  function show(mode) {
    return attempt(() => {
      if (!comparison) return;
      pause();
      const view = views.get(mode) || createView(mode);
      current = view;
      container.replaceChildren(view.root);
      if (!view.restore) chrome.scrollTo(view.scroll);
      for (const row of nearTargets) {
        if (!row.isConnected || !view.root.contains(row)) continue;
        activeTargets.add(row);
      }
      if (view.position < view.end) step(view);
      else if (!view.position) mountNext(view);
      else if (view.position < view.rows.length) incremental.observe(view.more);
      scheduleAlignment(true);
      notifyMounted(view);
    });
  }

  const rowsIn = node => node.comparisonRow === undefined ? [...node.children] : [node];

  function scheduleAlignment(reset = false) {
    resetSizes ||= reset;
    if (alignmentFrame || current?.mode !== 'rendered') return;
    alignmentFrame = requestAnimationFrame(() => attempt(() => {
      alignmentFrame = 0;
      const pairs = [];
      for (const target of activeTargets) for (const row of rowsIn(target)) {
        const byId = new Map();
        for (const node of row.querySelectorAll('tr[data-pair], li[data-pair]')) {
          if (resetSizes) { node.style.minHeight = ''; node.style.height = ''; }
          const id = node.dataset.pair;
          if (byId.has(id)) pairs.push([byId.get(id), node]);
          else byId.set(id, node);
        }
        for (const scroller of row.scrollers) {
          const overflow = scroller.scrollWidth > scroller.clientWidth + 1 || scroller.scrollHeight > scroller.clientHeight + 1;
          if (overflow) {
            scroller.tabIndex = 0;
            scroller.setAttribute('role', 'group');
            scroller.setAttribute('aria-label', scroller.dataset.scrollLabel);
          } else {
            scroller.removeAttribute('tabindex');
            scroller.removeAttribute('role');
            scroller.removeAttribute('aria-label');
          }
        }
      }
      resetSizes = false;
      const measures = pairs.map(([a, b]) => [a, b, a.getBoundingClientRect().height, b.getBoundingClientRect().height]);
      for (const [a, b, ah, bh] of measures) {
        if (Math.abs(ah - bh) < .5) continue;
        const property = a.tagName === 'TR' ? 'height' : 'minHeight';
        a.style[property] = b.style[property] = `${Math.ceil(Math.max(ah, bh))}px`;
      }
    }));
  }

  function getState() {
    const result = { ...bookmarks };
    for (const [mode, view] of views) {
      let anchor = view.restore || result[mode]?.anchor || { row: 0, offset: 0 };
      if (view === current && !view.restore) {
        const bounds = view.root.getBoundingClientRect();
        const obscured = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-obscured')) || 0;
        const y = Math.min(innerHeight - 1, Math.max(obscured, bounds.top) + 1);
        const hit = document.elementFromPoint(bounds.left + bounds.width / 4, y)?.closest('.pair-row');
        const row = hit && view.root.contains(hit) ? hit : [...activeTargets].flatMap(rowsIn).filter(row => row.isConnected && row.getBoundingClientRect().bottom > 0)
          .sort((a, b) => a.comparisonRow - b.comparisonRow)[0];
        if (row) anchor = { row: row.comparisonRow, offset: -row.getBoundingClientRect().top };
      }
      result[mode] = { anchor: { row: anchor.row, offset: anchor.offset }, pages: view.mounted || view.restore ? [...view.pages] : result[mode]?.pages || [] };
    }
    return result;
  }

  function readBookmarks(value) {
    const result = {};
    for (const mode of ['rendered', 'source']) {
      const saved = value?.[mode];
      if (!saved || typeof saved !== 'object') continue;
      const rows = mode === 'source' ? comparison.source.rows : comparison.rows;
      const pages = new Map();
      if (Array.isArray(saved.pages)) for (const entry of saved.pages.slice(0, rows.length)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [row, page] = entry;
        if (!Number.isInteger(row) || !Number.isInteger(page) || !rows[row]?.pages) continue;
        const clamped = Math.max(0, Math.min(page, rows[row].pages.length - 1));
        if (clamped) pages.set(row, clamped);
      }
      const anchor = saved.anchor;
      result[mode] = { pages: [...pages], anchor: Number.isInteger(anchor?.row) && Number.isFinite(anchor?.offset) && rows.length ? {
        row: Math.max(0, Math.min(anchor.row, rows.length - 1)), offset: Math.max(-1000000, Math.min(anchor.offset, 1000000)),
      } : null };
    }
    return result;
  }

  function reset(result = null, filenames = null, viewState = null) {
    pause();
    resized.disconnect();
    visible.disconnect();
    nearTargets.clear();
    views.clear();
    comparison = result;
    names = filenames;
    bookmarks = result ? readBookmarks(viewState) : {};
    container.replaceChildren();
  }

  container.addEventListener('load', () => scheduleAlignment(true), true);
  container.addEventListener('toggle', () => scheduleAlignment(true), true);
  // Opening or closing an expandable section does the same to its partner. Only clicks are mirrored
  // (Enter and Space on a summary click it), so an open state the author wrote still shows on load.
  container.addEventListener('click', (event) => attempt(() => {
    const details = event.target.closest('summary')?.parentElement;
    const row = details?.closest('.pair-row');
    if (details?.tagName !== 'DETAILS' || !row) return;
    const [before, after] = ['before', 'after'].map((side) => row.querySelector(`:scope > .document-cell[data-side=${side}]`));
    for (const [left, right] of partners(before, after, 'details')) {
      if (left === details) right.open = !details.open;
      if (right === details) left.open = !details.open;
    }
  }));
  const cancelRestore = () => {
    if (!current?.restore) return;
    current.restore = null;
    current.end = Math.min(current.end, Math.max(current.position, current.mode === 'source' ? 400 : 120));
  };
  window.addEventListener('wheel', cancelRestore, { passive: true });
  window.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelRestore(); });
  window.addEventListener('resize', () => scheduleAlignment(true));
  return { reset, show, getState };
}
