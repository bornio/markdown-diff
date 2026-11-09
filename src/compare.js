import { marked } from 'marked';
import { fromHtml } from 'hast-util-from-html';
import { sanitize, defaultSchema } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { diffArrays, diffLines, diffWordsWithSpace } from 'diff';

const inline = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'pre', 'summary']);
const block = new Set(['p', 'ul', 'ol', 'table', 'blockquote', 'pre', 'div']);
const tag = (node) => node?.tagName || node?.type;
const element = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
const nodeText = (node) => node.type === 'text' ? node.value : (node.children || []).map(nodeText).join('');
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const lines = (value) => value.match(/[^\n]*\n|[^\n]+$/g) || [];

function cleanTree(source) {
  const schema = {
    ...defaultSchema,
    tagNames: [...defaultSchema.tagNames, 'caption'],
    attributes: {
      ...defaultSchema.attributes,
      '*': defaultSchema.attributes['*'].filter((key) => !['id', 'name'].includes(key)),
      img: [...defaultSchema.attributes.img, 'loading', 'decoding', 'referrerPolicy'],
      details: ['open'],
    },
  };
  const tree = sanitize(fromHtml(marked.parse(source.replace(/^\uFEFF/, ''), { gfm: true, async: false }), { fragment: true }), schema);
  let count = 0;
  function normalize(node, depth = 0) {
    if (++count > 200000) throw new RangeError('This document has more than 200,000 Markdown elements. Split it into smaller files.');
    if (depth > 100) throw new RangeError('This document is nested more than 100 levels deep.');
    if (tag(node) === 'img') Object.assign(node.properties, { loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
    if (tag(node) === 'a' && node.properties.href) Object.assign(node.properties, { target: '_blank', rel: ['noreferrer', 'noopener'] });
    if (node.children) {
      if (!['p', 'li', 'td', 'th', 'pre', 'code', 'summary'].includes(tag(node))) {
        node.children = node.children.filter((child) => child.type !== 'text' || child.value.trim());
      }
      node.children.forEach((child) => normalize(child, depth + 1));
    }
  }
  normalize(tree);
  return tree;
}

function createState() {
  const fingerprints = new WeakMap();
  const sketches = new WeakMap();
  return {
    pair: 0, cells: 0, deadline: Date.now() + 2500, warnings: new Set(),
    fingerprint(node) {
      if (!fingerprints.has(node)) fingerprints.set(node, node.type === 'text' ? node.value : toHtml(node));
      return fingerprints.get(node);
    },
    sketch(node) {
      if (!sketches.has(node)) {
        const words = nodeText(node).slice(0, 4000).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        sketches.set(node, new Set(words.slice(0, 128)));
      }
      return sketches.get(node);
    },
  };
}

function similarity(a, b, state) {
  if (tag(a) !== tag(b)) return 0;
  if (state.fingerprint(a) === state.fingerprint(b)) return 1;
  const aa = state.sketch(a);
  const bb = state.sketch(b);
  let same = 0;
  for (const word of aa) if (bb.has(word)) same++;
  return 0.25 + 0.75 * ((aa.size + bb.size) ? 2 * same / (aa.size + bb.size) : 1);
}

function alignGap(a, b, state, score) {
  if (!a.length) return b.map((node) => [undefined, node]);
  if (!b.length) return a.map((node) => [node, undefined]);
  state.cells += a.length * b.length;
  if (a.length * b.length > 4096 || state.cells > 200000 || Date.now() > state.deadline) {
    state.warnings.add('A large changed region is shown as removed and added blocks.');
    return [...a.map((node) => [node, undefined]), ...b.map((node) => [undefined, node])];
  }
  const costs = Array.from({ length: a.length + 1 }, () => new Float64Array(b.length + 1));
  const scores = Array.from({ length: a.length }, () => new Float64Array(b.length));
  for (let i = 0; i <= a.length; i++) costs[i][0] = i;
  for (let j = 0; j <= b.length; j++) costs[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const affinity = scores[i - 1][j - 1] = score(a[i - 1], b[j - 1]);
    costs[i][j] = Math.min(costs[i - 1][j] + 1, costs[i][j - 1] + 1, costs[i - 1][j - 1] + (affinity ? 1.5 * (1 - affinity) : 2.1));
  }
  const pairs = [];
  let i = a.length;
  let j = b.length;
  while (i || j) {
    const affinity = i && j ? scores[i - 1][j - 1] : 0;
    const diagonal = i && j ? costs[i - 1][j - 1] + (affinity ? 1.5 * (1 - affinity) : 2.1) : Infinity;
    if (Math.abs(costs[i][j] - diagonal) < 0.00001) pairs.push([a[--i], b[--j]]);
    else if (i && Math.abs(costs[i][j] - costs[i - 1][j] - 1) < 0.00001) pairs.push([a[--i], undefined]);
    else pairs.push([undefined, b[--j]]);
  }
  return pairs.reverse();
}

function exactAnchors(a, b) {
  const unique = (values) => {
    const map = new Map();
    values.forEach((value, index) => map.set(value, map.has(value) ? -1 : index));
    return map;
  };
  const aa = unique(a);
  const bb = unique(b);
  const candidates = [];
  for (let i = 0; i < a.length; i++) {
    const j = bb.get(a[i]);
    if (aa.get(a[i]) === i && j >= 0) candidates.push([i, j]);
  }
  const tails = [];
  const indices = [];
  const previous = [];
  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i][1];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    previous[i] = low ? indices[low - 1] : -1;
    tails[low] = value;
    indices[low] = i;
  }
  const anchors = [];
  let index = indices[tails.length - 1];
  while (index !== undefined && index >= 0) { anchors.push(candidates[index]); index = previous[index]; }
  return anchors.reverse();
}

function align(a, b, state, options = {}) {
  const score = options.score || ((x, y) => similarity(x, y, state));
  const keyA = options.keyA || state.fingerprint;
  const keyB = options.keyB || state.fingerprint;
  const keysA = a.map(keyA);
  const keysB = b.map(keyB);
  const chunks = Date.now() > state.deadline ? undefined : diffArrays(keysA, keysB, { maxEditLength: 2000, timeout: 30 });
  if (!chunks) {
    state.warnings.add('A large region uses exact anchors and conservative gap matching.');
    const pairs = [];
    let ai = 0;
    let bi = 0;
    for (const [i, j] of [...exactAnchors(keysA, keysB), [a.length, b.length]]) {
      for (const pair of alignGap(a.slice(ai, i), b.slice(bi, j), state, score)) pairs.push(pair);
      if (i < a.length) pairs.push([a[i], b[j]]);
      ai = i + 1;
      bi = j + 1;
    }
    return pairs;
  }
  const pairs = [];
  let ai = 0;
  let bi = 0;
  let removed = [];
  let added = [];
  const flush = () => { for (const pair of alignGap(removed, added, state, score)) pairs.push(pair); removed = []; added = []; };
  for (const chunk of chunks) {
    if (chunk.removed) { for (let i = 0; i < chunk.count; i++) removed.push(a[ai++]); }
    else if (chunk.added) { for (let i = 0; i < chunk.count; i++) added.push(b[bi++]); }
    else { flush(); for (let i = 0; i < chunk.count; i++) pairs.push([a[ai++], b[bi++]]); }
  }
  flush();
  return pairs;
}

const shape = (node) => JSON.stringify(node.type === 'text' ? '' : [tag(node), node.properties, (node.children || []).map((child) => shape(child))]);
function annotateText(node, intervals, offset = { value: 0 }) {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text') { annotateText(child, intervals, offset); return [child]; }
    const start = offset.value;
    offset.value += child.value.length;
    const pieces = [];
    let at = 0;
    for (const [from, to, kind] of intervals) {
      const left = Math.max(0, from - start);
      const right = Math.min(child.value.length, to - start);
      if (right <= left) continue;
      if (left > at) pieces.push({ type: 'text', value: child.value.slice(at, left) });
      pieces.push(element(kind === 'add' ? 'ins' : 'del', { 'data-edit': kind }, [{ type: 'text', value: child.value.slice(left, right) }]));
      at = right;
    }
    if (at < child.value.length) pieces.push({ type: 'text', value: child.value.slice(at) });
    return pieces;
  });
}

function wordEdits(before, after, state) {
  if (before.length + after.length > 20000 || Date.now() > state.deadline) return undefined;
  return diffWordsWithSpace(before, after, { maxEditLength: 1000, timeout: 20 });
}
function highlight(a, b, state) {
  const before = nodeText(a);
  const after = nodeText(b);
  if (shape(a) !== shape(b)) {
    a.properties['data-format-change'] = true;
    b.properties['data-format-change'] = true;
  }
  const edits = wordEdits(before, after, state);
  if (!edits) {
    a.properties['data-change'] = 'remove';
    b.properties['data-change'] = 'add';
    state.warnings.add('Some text regions use whole-block highlighting after a work limit.');
    return;
  }
  const oldRanges = [];
  const newRanges = [];
  let x = 0;
  let y = 0;
  for (const change of edits) {
    if (change.removed) oldRanges.push([x, x + change.value.length, 'remove']);
    if (change.added) newRanges.push([y, y + change.value.length, 'add']);
    if (!change.added) x += change.value.length;
    if (!change.removed) y += change.value.length;
  }
  annotateText(a, oldRanges);
  annotateText(b, newRanges);
}

function gap(node) {
  if (node.type !== 'element') return element('span', { 'data-gap': true, ariaHidden: 'true' });
  const children = tag(node) === 'tr' ? (node.children || []).map(gap) : [];
  return element(tag(node), { 'data-gap': true, ariaHidden: 'true' }, children);
}
function pairNodes(a, b, state) {
  const pair = String(++state.pair);
  if (a?.type === 'element') a.properties['data-pair'] = pair;
  if (b?.type === 'element') b.properties['data-pair'] = pair;
}

function compareTable(a, b, state) {
  const sections = ['thead', 'tbody', 'tfoot'];
  if ([a, b].some((table) => sections.some((name) => table.children.filter((node) => tag(node) === name).length > 1))) {
    a.properties['data-change'] = 'remove';
    b.properties['data-change'] = 'add';
    state.warnings.add('A table with repeated sections is shown as removed and added blocks to preserve every row.');
    return;
  }
  const columnCells = (table) => {
    const rows = table.children.flatMap((section) => section.children || []).filter((node) => tag(node) === 'tr');
    const first = table.children.find((section) => tag(section) === 'thead')?.children[0] || rows[0];
    const cells = (first?.children || []).slice();
    for (const row of rows) for (let i = cells.length; i < row.children.length; i++) cells.push(row.children[i]);
    return cells;
  };
  const cellsA = columnCells(a);
  const cellsB = columnCells(b);
  const columns = align(cellsA, cellsB, state).map(([x, y]) => [cellsA.indexOf(x), cellsB.indexOf(y)]);
  const common = columns.filter(([i, j]) => i >= 0 && j >= 0);
  const rowKey = (row, side) => JSON.stringify(common.map((column) => {
    const cell = row.children[column[side]];
    return cell ? state.fingerprint(cell) : '';
  }));
  const rowScore = (oldRow, newRow) => {
    if (!common.length) return 0;
    let affinity = 0;
    for (const [i, j] of common) if (oldRow.children[i] && newRow.children[j]) affinity += similarity(oldRow.children[i], newRow.children[j], state);
    affinity /= common.length;
    const [i, j] = common[0];
    const sameFirst = oldRow.children[i] && newRow.children[j] && state.fingerprint(oldRow.children[i]) === state.fingerprint(newRow.children[j]);
    return sameFirst ? 0.8 + 0.2 * affinity : 0.65 * affinity;
  };
  const leftSections = [];
  const rightSections = [];
  const oldCaption = a.children.find((node) => tag(node) === 'caption');
  const newCaption = b.children.find((node) => tag(node) === 'caption');
  if (oldCaption || newCaption) {
    const [left, right] = comparePair(oldCaption, newCaption, state);
    leftSections.push(left);
    rightSections.push(right);
  }
  for (const name of sections) {
    const oldSection = a.children.find((node) => tag(node) === name);
    const newSection = b.children.find((node) => tag(node) === name);
    if (!oldSection && !newSection) continue;
    const left = oldSection || element(name);
    const right = newSection || element(name);
    const rowPairs = align(left.children, right.children, state, { score: rowScore, keyA: (row) => rowKey(row, 0), keyB: (row) => rowKey(row, 1) });
    left.children = [];
    right.children = [];
    for (const [oldRow, newRow] of rowPairs) {
      const leftRow = oldRow || element('tr', { 'data-gap': true, ariaHidden: 'true' });
      const rightRow = newRow || element('tr', { 'data-gap': true, ariaHidden: 'true' });
      pairNodes(leftRow, rightRow, state);
      if (!newRow) leftRow.properties['data-change'] = 'remove';
      if (!oldRow) rightRow.properties['data-change'] = 'add';
      const oldCells = oldRow?.children || [];
      const newCells = newRow?.children || [];
      leftRow.children = [];
      rightRow.children = [];
      for (const [i, j] of columns) {
        const x = i < 0 ? undefined : oldCells[i];
        const y = j < 0 ? undefined : newCells[j];
        if (!x && !y) {
          const cellTag = name === 'thead' ? 'th' : 'td';
          leftRow.children.push(element(cellTag, { 'data-gap': true, ariaHidden: 'true' }));
          rightRow.children.push(element(cellTag, { 'data-gap': true, ariaHidden: 'true' }));
        } else {
          const [oldCell, newCell] = comparePair(x, y, state);
          leftRow.children.push(oldCell);
          rightRow.children.push(newCell);
        }
      }
      left.children.push(leftRow);
      right.children.push(rightRow);
    }
    leftSections.push(left);
    rightSections.push(right);
  }
  const colgroup = () => element('colgroup', {}, columns.map(() => element('col', { span: 1 })));
  a.children = [colgroup(), ...leftSections];
  b.children = [colgroup(), ...rightSections];
}

function comparePair(a, b, state) {
  if (!a || !b) {
    const original = a || b;
    const actual = original.type === 'text' ? element('span', {}, [original]) : original;
    const blank = gap(actual);
    actual.properties['data-change'] = a ? 'remove' : 'add';
    pairNodes(actual, blank, state);
    return a ? [actual, blank] : [blank, actual];
  }
  if (state.fingerprint(a) === state.fingerprint(b)) return [a, b];
  if (a.type === 'text' && b.type === 'text') {
    const left = element('span', {}, [a]);
    const right = element('span', {}, [b]);
    pairNodes(left, right, state);
    highlight(left, right, state);
    return [left, right];
  }
  if (a.type === 'element' && b.type === 'element') {
    pairNodes(a, b, state);
    if (tag(a) !== tag(b)) { a.properties['data-change'] = 'remove'; b.properties['data-change'] = 'add'; }
    else if (tag(a) === 'table') compareTable(a, b, state);
    else if (inline.has(tag(a)) || (tag(a) === 'li' && ![...a.children, ...b.children].some((node) => block.has(tag(node))))) highlight(a, b, state);
    else {
      if (JSON.stringify(a.properties) !== JSON.stringify(b.properties)) {
        a.properties['data-format-change'] = true;
        b.properties['data-format-change'] = true;
      }
      const children = align(a.children || [], b.children || [], state).map(([x, y]) => comparePair(x, y, state));
      if (tag(a) === 'ol') for (const list of [a, b]) {
        let value = Number(list.properties.start ?? 1);
        for (const item of list.children) if (tag(item) === 'li') {
          value = Number(item.properties.value ?? value);
          item.properties.value = value++;
        }
      }
      a.children = children.map(([x]) => x);
      b.children = children.map(([, y]) => y);
    }
  }
  return [a, b];
}

function sourceRows(before, after, state) {
  let chunks = diffLines(before, after, { maxEditLength: 4000, timeout: 50 });
  if (!chunks) {
    state.warnings.add('Source matching reached its work limit. The changed lines are paired in order.');
    chunks = [{ removed: true, value: before }, { added: true, value: after }];
  }
  const rows = [];
  let oldLine = 1;
  let newLine = 1;
  let removed = [];
  let added = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const oldText = removed[i];
      const newText = added[i];
      let oldHtml = oldText === undefined ? '' : escape(oldText);
      let newHtml = newText === undefined ? '' : escape(newText);
      if (oldText !== undefined && newText !== undefined) {
        const edits = wordEdits(oldText, newText, state);
        if (edits) {
          oldHtml = edits.filter((part) => !part.added).map((part) => part.removed ? `<del>${escape(part.value)}</del>` : escape(part.value)).join('');
          newHtml = edits.filter((part) => !part.removed).map((part) => part.added ? `<ins>${escape(part.value)}</ins>` : escape(part.value)).join('');
        } else state.warnings.add('Some source lines use whole-line highlighting after a work limit.');
      }
      rows.push({ kind: oldText === undefined ? 'add' : newText === undefined ? 'remove' : 'changed', before: oldText === undefined ? null : { line: oldLine++, text: oldText, html: oldHtml }, after: newText === undefined ? null : { line: newLine++, text: newText, html: newHtml } });
    }
    removed = [];
    added = [];
  };
  for (const chunk of chunks) {
    if (chunk.removed) { for (const value of lines(chunk.value)) removed.push(value); }
    else if (chunk.added) { for (const value of lines(chunk.value)) added.push(value); }
    else {
      flush();
      for (const value of lines(chunk.value)) rows.push({ kind: 'same', before: { line: oldLine++, text: value, html: escape(value) }, after: { line: newLine++, text: value, html: escape(value) } });
    }
  }
  flush();
  return rows;
}

function codePages(pre) {
  if (pre.properties['data-gap']) return [];
  if (pre.children.length !== 1 || tag(pre.children[0]) !== 'code') return undefined;
  const code = pre.children[0];
  const parts = [];
  let length = 0;
  function collect(node, wrappers) {
    if (node.type === 'text') {
      if (node.value) {
        parts.push({ value: node.value, wrappers, start: length, end: length + node.value.length });
        length += node.value.length;
      }
      return true;
    }
    if (node.type !== 'element' || !['ins', 'del'].includes(tag(node)) ||
        node.properties['data-edit'] !== (tag(node) === 'ins' ? 'add' : 'remove') || !node.children.length) return false;
    return node.children.every((child) => collect(child, [...wrappers, node]));
  }
  if (!code.children.every((child) => collect(child, []))) return undefined;
  if (!length) return [pre];

  const value = parts.map((part) => part.value).join('');
  const pages = [];
  let start = 0;
  let first = 0;
  while (start < value.length) {
    while (parts[first].end <= start) first++;
    let end = Math.min(start + 16000, value.length);
    const candidate = value.slice(start, end);
    let lineEnd = -1;
    for (let i = 0; i < 100; i++) {
      lineEnd = candidate.indexOf('\n', lineEnd + 1);
      if (lineEnd < 0) break;
      if (i === 99) end = start + lineEnd + 1;
    }
    let count = 2;
    let previous = [];
    for (let i = first; i < parts.length && parts[i].start < end; i++) {
      const wrappers = parts[i].wrappers;
      let common = 0;
      while (common < previous.length && common < wrappers.length && previous[common] === wrappers[common]) common++;
      count += wrappers.length - common + 1;
      if (count > 256) { end = parts[i].start; break; }
      previous = wrappers;
    }
    if (end < value.length) {
      const last = value.charCodeAt(end - 1);
      const next = value.charCodeAt(end);
      if ((last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) ||
          (last === 13 && next === 10)) end--;
    }
    const fragmentCode = { ...code, children: [] };
    const open = [fragmentCode];
    previous = [];
    for (let i = first; i < parts.length && parts[i].start < end; i++) {
      const part = parts[i];
      let common = 0;
      while (common < previous.length && common < part.wrappers.length && previous[common] === part.wrappers[common]) common++;
      open.length = common + 1;
      for (const wrapper of part.wrappers.slice(common)) {
        const clone = { ...wrapper, children: [] };
        open[open.length - 1].children.push(clone);
        open.push(clone);
      }
      open[open.length - 1].children.push({ type: 'text', value: part.value.slice(Math.max(start, part.start) - part.start, end - part.start) });
      previous = part.wrappers;
    }
    pages.push({ ...pre, children: [fragmentCode] });
    start = end;
  }
  return pages;
}

function paginatedPair(a, b) {
  if (tag(a) !== tag(b)) return undefined;
  const name = tag(a);
  if (name === 'pre') {
    const before = codePages(a);
    const after = codePages(b);
    if (!before || !after || Math.max(before.length, after.length) <= 1) return undefined;
    const pages = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      pages.push({ before: toHtml(before[i] || gap(a)).replaceAll('\r', '&#13;'), after: toHtml(after[i] || gap(b)).replaceAll('\r', '&#13;') });
    }
    return { pages, pageType: 'code' };
  }
  const table = name === 'table';
  if (!table && name !== 'ul' && name !== 'ol') return undefined;
  if (table && [a, b].some((node) => node.children.filter((child) => tag(child) === 'tbody').length > 1)) return undefined;
  const bodyA = table ? a.children.find((node) => tag(node) === 'tbody') : a;
  const bodyB = table ? b.children.find((node) => tag(node) === 'tbody') : b;
  const count = Math.max(bodyA?.children.length || 0, bodyB?.children.length || 0);
  if (count <= 100) return undefined;
  const fragment = (node, body, offset) => {
    const items = (body?.children || []).slice(offset, offset + 100);
    if (!table) return { ...node, properties: { ...node.properties, ...(name === 'ol' ? { start: items.find((item) => !item.properties['data-gap'])?.properties.value ?? Number(node.properties.start ?? 1) + offset } : {}) }, children: items };
    return { ...node, children: node.children.map((child) => tag(child) === 'tbody' ? { ...child, children: items } : child) };
  };
  const pages = [];
  for (let offset = 0; offset < count; offset += 100) pages.push({ before: toHtml(fragment(a, bodyA, offset)), after: toHtml(fragment(b, bodyB, offset)) });
  return { pages, itemCount: count };
}

export function compareMarkdown(beforeText, afterText) {
  if (typeof beforeText !== 'string' || typeof afterText !== 'string') throw new TypeError('Expected two Markdown strings.');
  const state = createState();
  const before = cleanTree(beforeText);
  const after = cleanTree(afterText);
  const pairs = align(before.children, after.children, state).map(([a, b]) => {
    const equal = a && b && state.fingerprint(a) === state.fingerprint(b);
    const kind = !a ? 'add' : !b ? 'remove' : equal ? 'same' : 'changed';
    const [left, right] = comparePair(a, b, state);
    return { kind, ...(paginatedPair(left, right) || { before: toHtml(left), after: toHtml(right) }) };
  });
  const source = sourceRows(beforeText, afterText, state);
  const stats = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  for (const row of source) stats[row.kind === 'add' ? 'added' : row.kind === 'remove' ? 'removed' : row.kind === 'same' ? 'unchanged' : 'changed']++;
  const warnings = [...state.warnings];
  return { rows: pairs, source: { rows: source }, stats, precision: { level: warnings.length ? 'coarse' : 'word', warnings } };
}
