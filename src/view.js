export function createComparisonView(container, chrome) {
  let comparison = null;
  let names = null;
  let current = null;
  let frame = 0;
  let resetSizes = false;
  const views = new Map();
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--chrome-height', `${chrome.getBoundingClientRect().height}px`);
  }).observe(chrome);
  const nearRows = new Set();
  const activeRows = new Set();
  const measuredHeights = new WeakMap();

  function recordHeight(node, height) {
    if (height <= 0 || measuredHeights.get(node) === height) return;
    measuredHeights.set(node, height);
    node.style.containIntrinsicBlockSize = `auto ${height}px`;
  }

  function snapshotRows(rows) {
    const sizes = [...rows].filter((node) => node.isConnected && current?.root.contains(node))
      .map((node) => [node, node.getBoundingClientRect().height]);
    for (const [node, height] of sizes) recordHeight(node, height);
  }

  const resized = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const node = entry.target;
      if (!node.isConnected || !current?.root.contains(node)) continue;
      recordHeight(node, entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    }
    scheduleAlignment();
  });
  const visible = new IntersectionObserver((entries) => {
    let entering = false;
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target.isConnected) nearRows.add(entry.target);
      else nearRows.delete(entry.target);
      if (current && entry.isIntersecting && entry.target.isConnected && current.root.contains(entry.target)) {
        entering ||= !activeRows.has(entry.target);
        activeRows.add(entry.target);
      } else {
        activeRows.delete(entry.target);
      }
    }
    scheduleAlignment(entering);
  }, { rootMargin: '600px 0px' });
  const incremental = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting && entry.target === current?.more)) mountNext(current);
  }, { rootMargin: '1200px 0px' });

  function sideName(side) {
    return `${side === 'before' ? 'Left' : 'Right'}: ${names[side]}`;
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
    } else node.innerHTML = content;

    const empty = source ? !content : ![...node.childNodes].some((child) =>
      child.nodeType === Node.TEXT_NODE ? child.textContent.trim().length > 0 :
        child.nodeType === Node.ELEMENT_NODE && !child.hasAttribute('data-gap'));
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
      for (const format of formats) {
        const target = format.matches('input[type=checkbox]') ? format.closest('li') || format : format;
        const media = target.matches('img, input') ||
          (target.parentElement !== node && target.querySelector('img') && !target.textContent.trim());
        target.dataset.formatCue = media ? 'media' : '';
      }
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
    for (const table of node.querySelectorAll('table')) {
      let columns = 1;
      for (const row of table.rows) {
        let width = 0;
        for (const cell of row.cells) width += cell.colSpan;
        columns = Math.max(columns, width);
      }
      table.style.setProperty('--table-columns', String(columns));
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll';
      wrapper.dataset.scrollLabel = `${sideName(side)}, table, horizontally scrollable`;
      table.before(wrapper);
      wrapper.append(table);
    }
    for (const pre of node.querySelectorAll('pre')) {
      pre.dataset.scrollLabel = `${sideName(side)}, code, scrollable`;
    }
    const first = node.firstElementChild;
    if (first?.matches('h1, h2, h3, h4')) node.dataset.blockKind = 'heading';
    else if (first?.classList.contains('table-scroll')) node.dataset.blockKind = 'table';
  }

  function buildRow(row, source) {
    const node = document.createElement('div');
    node.className = `pair-row ${row.kind}${source ? ' source-row' : ''}`;
    let before;
    let after;
    let page = 0;
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
      const turn = (direction) => {
        const destination = page + direction;
        if (destination < 0 || destination >= row.pages.length) return;
        page = destination;
        fill();
        scheduleAlignment(true);
        const obscured = getComputedStyle(chrome).position === 'sticky' ? chrome.getBoundingClientRect().height : 0;
        const top = window.scrollY + pager.getBoundingClientRect().top - obscured - 8;
        window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      };
      back.onclick = () => turn(-1);
      next.onclick = () => turn(1);
      pager.append(back, range, next);
      node.append(pager);
    }
    fill();
    visible.observe(node);
    resized.observe(node);
    return node;
  }

  function createView(mode) {
    const root = document.createElement('div');
    root.className = `${mode}-view`;
    const more = document.createElement('div');
    more.className = 'mount-progress';
    const rows = mode === 'source' ? comparison.source.rows : comparison.rows;
    if (mode === 'source') root.style.setProperty('--source-digits', String(String(rows.length || 1).length));
    const view = { mode, root, more, rows, position: 0, end: 0, scroll: 0, frame: 0 };
    views.set(mode, view);
    return view;
  }

  function step(view) {
    view.frame = 0;
    if (view !== current) return;
    const source = view.mode === 'source';
    const stop = Math.min(view.position + (source ? 80 : 12), view.end);
    const fragment = document.createDocumentFragment();
    while (view.position < stop) fragment.append(buildRow(view.rows[view.position++], source));
    view.root.append(fragment);
    if (view.position < view.end) view.frame = requestAnimationFrame(() => step(view));
    else if (view.position < view.rows.length) {
      view.more.textContent = `Loading as you scroll · ${view.position.toLocaleString()} of ${view.rows.length.toLocaleString()} ${source ? 'lines' : 'sections'}`;
      view.root.append(view.more);
      incremental.observe(view.more);
    }
    scheduleAlignment();
  }

  function mountNext(view) {
    if (!view || view !== current || view.frame || view.position >= view.rows.length) return;
    incremental.disconnect();
    view.more.remove();
    view.end = Math.min(view.position + (view.mode === 'source' ? 400 : 120), view.rows.length);
    step(view);
  }

  function pause() {
    snapshotRows(activeRows);
    if (current) {
      current.scroll = window.scrollY;
      cancelAnimationFrame(current.frame);
      current.frame = 0;
    }
    incremental.disconnect();
    activeRows.clear();
    cancelAnimationFrame(frame);
    frame = 0;
    current = null;
  }

  function show(mode) {
    if (!comparison) return;
    pause();
    const view = views.get(mode) || createView(mode);
    current = view;
    container.replaceChildren(view.root);
    window.scrollTo({ top: view.scroll, behavior: 'instant' });
    for (const row of nearRows) {
      if (!row.isConnected || !view.root.contains(row)) continue;
      activeRows.add(row);
    }
    if (view.position < view.end) step(view);
    else if (!view.position) mountNext(view);
    else if (view.position < view.rows.length) incremental.observe(view.more);
    scheduleAlignment(true);
  }

  function scheduleAlignment(reset = false) {
    resetSizes ||= reset;
    if (frame || current?.mode !== 'rendered') return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const pairs = [];
      for (const row of activeRows) {
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
    });
  }

  function reset(result = null, filenames = null) {
    pause();
    resized.disconnect();
    visible.disconnect();
    nearRows.clear();
    views.clear();
    comparison = result;
    names = filenames;
    container.replaceChildren();
  }

  container.addEventListener('load', () => scheduleAlignment(true), true);
  container.addEventListener('toggle', () => scheduleAlignment(true), true);
  window.addEventListener('resize', () => scheduleAlignment(true));
  return { reset, show };
}
