import { partners } from './partners.js';

// Presents the rendered tables of one pair row: the .table-scroll wrapper, --table-columns, and
// proportional horizontal scroll sync between a table and its partner on the other side.
export function presentTables(before, after, sideName) {
  for (const [cell, side] of [[before, 'before'], [after, 'after']]) {
    for (const table of cell.querySelectorAll('table')) {
      table.style.setProperty('--table-columns', String(columnCount(table)));
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll';
      wrapper.dataset.scrollLabel = `${sideName(side)}, table, horizontally scrollable`;
      table.before(wrapper);
      wrapper.append(table);
    }
  }
  for (const [left, right] of partners(before, after, 'table')) link(left.parentElement, right.parentElement);
}

// A direct colgroup can only come from compareTable (the sanitizer drops authored ones).
function columnCount(table) {
  const cols = table.querySelectorAll(':scope > colgroup > col');
  if (cols.length) return Math.max(1, [...cols].filter((col) => !col.hasAttribute('data-gap')).length);
  let columns = 1;
  for (const row of table.rows) {
    let width = 0;
    for (const cell of row.cells) width += cell.colSpan;
    columns = Math.max(columns, width);
  }
  return columns;
}


// Scroll events from a programmatic write arrive asynchronously, so the written value is remembered
// and the echo it causes is swallowed instead of mirrored back.
const written = new WeakMap();
function link(left, right) {
  const follow = (from, to) => from.addEventListener('scroll', () => {
    if (written.has(from) && Math.abs(from.scrollLeft - written.get(from)) < 1) { written.delete(from); return; }
    const range = from.scrollWidth - from.clientWidth;
    const other = to.scrollWidth - to.clientWidth;
    if (range <= 0 || other <= 0) return;
    const target = from.scrollLeft / range * other;
    if (Math.abs(to.scrollLeft - target) < 1) return;
    written.set(to, target);
    to.scrollLeft = target;
  }, { passive: true });
  follow(left, right);
  follow(right, left);
}
