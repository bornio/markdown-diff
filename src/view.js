import { partners } from './partners.js';
import { presentTables } from './tables.js';

export function createComparisonView(container, chrome, { renderDocument, onPresented, onViewStateChanged, onError, batchLimits, chunkRows = 0 } = {}) {
  let comparison = null;
  let names = null;
  let current = null;
  let alignmentFrame = 0;
  let resetSizes = false;
  const views = new Map();
  const nearTargets = new Set();
  const activeTargets = new Set();
  const measuredHeights = new WeakMap();

  function attempt(action) {
    if (!onError) return action();
    try { return action(); }
    catch (error) {
      halt();
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
    if (current?.reported) {
      current.reported = false;
      scheduleSettlement(current);
    }
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
        view.reported = false;
        scheduleAlignment(true);
        chrome.scrollTo(pager);
        scheduleSettlement(view);
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

  function createView(mode, saved) {
    const root = document.createElement('div');
    root.className = `${mode}-view`;
    const more = document.createElement('div');
    more.className = 'mount-progress';
    const rows = mode === 'source' ? comparison.source.rows : comparison.rows;
    if (mode === 'source') root.style.setProperty('--source-digits', String(String(rows.length || 1).length));
    const bookmark = readBookmark(saved, rows);
    const view = {
      mode, root, more, rows,
      chunkSize: mode === 'rendered' ? chunkRows : 0,
      tail: null,
      pages: new Map(bookmark.pages),
      restore: bookmark.anchor ? { ...bookmark.anchor, passes: 0 } : null,
      settled: { anchor: bookmark.anchor || { row: 0, offset: 0 }, pages: bookmark.pages },
      position: 0, end: 0, scroll: 0,
      frame: 0, readyFrame: 0, reported: false, presented: false,
    };
    views.set(mode, view);
    return view;
  }

  function step(view) {
    return attempt(() => {
      view.frame = 0;
      if (view !== current) return;
      const source = view.mode === 'source';
      const nextRows = view.position + (source ? 80 : 12);
      const restoreRows = view.restore && batchLimits && !source ? Math.max(nextRows, view.restore.row) : nextRows;
      const stop = Math.min(restoreRows, view.end);
      const fragment = document.createDocumentFragment();
      const started = batchLimits ? performance.now() : 0;
      let characters = 0;
      while (view.position < stop) {
        const row = view.rows[view.position];
        const content = row.pages ? row.pages[view.pages.get(view.position) || 0] : row;
        let cost = 0;
        if (batchLimits) cost = source
          ? (content.before?.html.length || 0) + (content.after?.html.length || 0)
          : content.before.length + content.after.length;
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
      scheduleSettlement(view);
    });
  }

  function scheduleSettlement(view) {
    if ((!onPresented && !onViewStateChanged && !view.restore) ||
        view !== current || view.reported || view.readyFrame || view.position < view.end) return;
    view.readyFrame = requestAnimationFrame(() => attempt(() => {
      view.readyFrame = requestAnimationFrame(() => attempt(() => {
        view.readyFrame = 0;
        if (view !== current || view.reported || view.position < view.end) return;
        if (alignmentFrame) { scheduleSettlement(view); return; }
        if (view.restore) {
          const anchor = view.restore;
          const row = view.chunkSize ? view.root.children[Math.floor(anchor.row / view.chunkSize)]?.children[anchor.row % view.chunkSize] : view.root.children[anchor.row];
          const offset = row ? Math.min(anchor.offset, Math.max(0, row.getBoundingClientRect().height - 1)) : 0;
          const delta = row ? row.getBoundingClientRect().top + offset : 0;
          if (row && Math.abs(delta) > 1 && anchor.passes++ < 4) {
            chrome.scrollTo(window.scrollY + delta);
            scheduleAlignment(true);
          } else view.restore = null;
          scheduleSettlement(view);
          return;
        }
        view.reported = true;
        const firstPresentation = !view.presented;
        view.presented = true;
        view.settled = { anchor: readAnchor(view), pages: [...view.pages] };
        if (firstPresentation) onPresented?.(view.settled);
        else onViewStateChanged?.(view.settled);
      }));
    }));
  }

  function mountNext(view) {
    return attempt(() => {
      if (!view || view !== current || view.frame || view.position >= view.rows.length) return;
      incremental.disconnect();
      view.more.remove();
      view.reported = false;
      const windowSize = view.mode === 'source' ? 400 : 120;
      const nextEnd = view.position + windowSize;
      const restoreEnd = view.restore ? view.restore.row + windowSize : 0;
      view.end = Math.min(Math.max(nextEnd, restoreEnd), view.rows.length);
      step(view);
    });
  }

  function halt() {
    if (current) {
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

  function pause() {
    snapshotHeights(activeTargets);
    if (current) current.scroll = window.scrollY;
    halt();
  }

  function show(mode, bookmark = null) {
    return attempt(() => {
      if (!comparison) return;
      pause();
      const view = views.get(mode) || createView(mode, bookmark);
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
      scheduleSettlement(view);
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

  function readAnchor(view) {
    const bounds = view.root.getBoundingClientRect();
    const obscured = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-obscured')) || 0;
    const y = Math.min(innerHeight - 1, Math.max(obscured, bounds.top) + 1);
    const hit = document.elementFromPoint(bounds.left + bounds.width / 4, y)?.closest('.pair-row');
    const row = hit && view.root.contains(hit) ? hit : [...activeTargets].flatMap(rowsIn)
      .filter(row => row.isConnected && row.getBoundingClientRect().bottom > 0)
      .sort((a, b) => a.comparisonRow - b.comparisonRow)[0];
    return row ? { row: row.comparisonRow, offset: -row.getBoundingClientRect().top } : view.settled.anchor;
  }

  function getState() {
    return { anchor: readAnchor(current), pages: current.settled.pages };
  }

  function readBookmark(saved, rows) {
    const pages = new Map();
    if (Array.isArray(saved?.pages)) for (const entry of saved.pages.slice(0, rows.length)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [row, page] = entry;
      if (!Number.isInteger(row) || !Number.isInteger(page) || !rows[row]?.pages) continue;
      const clamped = Math.max(0, Math.min(page, rows[row].pages.length - 1));
      if (clamped) pages.set(row, clamped);
    }
    const anchor = saved?.anchor;
    return { pages: [...pages], anchor: Number.isInteger(anchor?.row) && Number.isFinite(anchor?.offset) && rows.length ? {
      row: Math.max(0, Math.min(anchor.row, rows.length - 1)), offset: Math.max(-1000000, Math.min(anchor.offset, 1000000)),
    } : null };
  }

  function reset(result = null, filenames = null) {
    halt();
    resized.disconnect();
    visible.disconnect();
    nearTargets.clear();
    views.clear();
    comparison = result;
    names = filenames;
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
