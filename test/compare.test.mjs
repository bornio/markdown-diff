import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHtml } from 'hast-util-from-html';
import { compareMarkdown } from '../src/compare.js';
const rendered = (result, side) => result.rows.flatMap((row) => row.pages || [row]).map((page) => page[side]).join('');
const parse = (html) => fromHtml(html, { fragment: true });
const text = (node) => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
const all = (node, name) => [...(node.tagName === name ? [node] : []), ...(node.children || []).flatMap((child) => all(child, name))];
const has = (node, key) => Object.hasOwn(node.properties || {}, key);
const table = (rows) => `| Key | State |\n|---|---|\n${rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}`;
const fence = (value, language = 'js') => `\`\`\`${language}\n${value}\n\`\`\``;
const codePages = (row, side) => row.pages.map((page) => all(parse(page[side]), 'code')[0]);

function coverage(nodes) {
  const runs = [];
  function visit(node, edit = '') {
    if (node.type === 'text') {
      if (runs.at(-1)?.[0] === edit) runs.at(-1)[1] += node.value;
      else runs.push([edit, node.value]);
    } else for (const child of node.children || []) visit(child, node.properties?.dataEdit || edit);
  }
  for (const node of nodes) if (node) visit(node);
  return runs;
}

test('combined column and row insertion preserves mapped row identity and pads every row', () => {
  const result = compareMarkdown(table([['x','z'], ['q','r']]), '| Key | Extra | State |\n|---|---|---|\n| x | y | z |\n| new | n | row |\n| q | s | r |');
  assert.equal(Object.hasOwn(result, 'rendered'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'pages'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'itemCount'), false);
  const left = parse(rendered(result, 'before'));
  const right = parse(rendered(result, 'after'));
  assert.equal(all(left, 'table').length, 1);
  assert.equal(all(right, 'table').length, 1);
  const a = all(left, 'tr');
  const b = all(right, 'tr');
  assert.equal(text(a[1]), 'xz');
  assert.equal(text(b[1]), 'xyz');
  assert.ok(has(a[2], 'dataGap'));
  assert.equal(text(b[2]), 'newnrow');
  assert.equal(text(a[3]), 'qr');
  for (const row of [...a, ...b]) assert.equal(row.children.length, 3);
  assert.equal(all(left, 'del').length, 0);
  assert.equal(all(right, 'ins').length, 0);
});

test('header-only tables gain and lose complete annotated body sections', () => {
  const empty = table([]);
  const full = table([['x','z']]);
  for (const [a,b,change,side] of [[empty,full,'add','after'],[full,empty,'remove','before']]) {
    const result = compareMarkdown(a,b);
    const actual = all(parse(rendered(result, side)), 'tbody')[0].children[0];
    const blank = all(parse(rendered(result, side === 'after' ? 'before' : 'after')), 'tbody')[0].children[0];
    assert.equal(actual.properties.dataChange, change);
    assert.ok(has(blank, 'dataGap'));
    assert.equal(actual.children.length, blank.children.length);
  }
});

test('nested list insertion preserves native structure and localized words', () => {
  const result = compareMarkdown('- Buy **red** apples\n- Visit\n  - old stock\n  - unchanged', '- Inserted\n- Buy **green** apples\n- Visit\n  - new stock\n  - extra\n  - unchanged');
  assert.equal(all(parse(rendered(result, 'after')), 'ul').length, 2);
  assert.match(rendered(result, 'before'), /<strong><del data-edit="remove">red<\/del><\/strong>/);
  assert.match(rendered(result, 'after'), /<strong><ins data-edit="add">green<\/ins><\/strong>/);
  assert.equal(all(parse(rendered(result, 'after')), 'ins').map(text).join(''), 'greennew');
  assert.match(rendered(result, 'after'), /data-change="add"[^>]*>extra/);
});

test('checkbox, destination, image and formatting edits remain visible with text edits', () => {
  for (const [before, after] of [
    ['- [ ] old word', '- [x] new word'],
    ['[same](https://old.example) old word', '[same](https://new.example) new word'],
    ['**same** old word', '*same* new word'],
    ['![alt](https://old.example/x.png) old word', '![new alt](https://new.example/x.png) new word'],
  ]) {
    const result = compareMarkdown(before, after);
    assert.match(rendered(result, 'before'), /data-format-change/);
    assert.match(rendered(result, 'after'), /data-format-change/);
    assert.match(rendered(result, 'after'), /<ins data-edit="add">new<\/ins>/);
  }
});

test('deep inline formatting preserves text edits and detects structural changes', () => {
  const tags = Array.from({ length: 60 }, (_, i) => i % 2 ? 'em' : 'strong');
  const nested = (content, names, format = false) => `<p${format ? ' data-format-change' : ''}>${names.map((name) => `<${name}>`).join('')}${content}${[...names].reverse().map((name) => `</${name}>`).join('')}</p>`;
  const before = nested('keep old word 😀', tags) + '\r\n';
  for (const format of [false, true]) {
    const afterTags = [...tags];
    if (format) afterTags[30] = 'em';
    const after = nested('keep new word 😀', afterTags) + '\r\n';
    const result = compareMarkdown(before, after);
    assert.equal(result.precision.level, 'word');
    assert.equal(rendered(result, 'before').replace(/ data-pair="\d+"/g, ''), nested('keep <del data-edit="remove">old</del> word 😀', tags, format));
    assert.equal(rendered(result, 'after').replace(/ data-pair="\d+"/g, ''), nested('keep <ins data-edit="add">new</ins> word 😀', afterTags, format));
    assert.equal(result.source.rows.map((row) => row.before?.text || '').join(''), before);
    assert.equal(result.source.rows.map((row) => row.after?.text || '').join(''), after);
  }
});

test('source rows preserve every original character and paired line numbers', () => {
  for (const [before,after] of [['one\r\n😀 two\r\nlast','one\r\n😀 new\r\nlast\n'],['','\n'],['same\n','same'],['repeat\nrepeat\n','repeat\nnew\nrepeat\n']]) {
    const result = compareMarkdown(before,after);
    for (const [side,value] of [['before',before],['after',after]]) {
      const cells = result.source.rows.map((row) => row[side]).filter(Boolean);
      assert.equal(cells.map((cell) => cell.text).join(''), value);
      assert.deepEqual(cells.map((cell) => cell.line), cells.map((_,index) => index + 1));
    }
  }
  const result = compareMarkdown('old word\n','new word\n');
  assert.match(result.source.rows[0].before.html, /<del>old<\/del>/);
  assert.match(result.source.rows[0].after.html, /<ins>new<\/ins>/);
});

test('safe Markdown images and details survive while executable content is removed', () => {
  const result = compareMarkdown('', '<script>alert(1)</script>\n\n<img src="javascript:alert(1)" onerror="alert(2)">\n\n![photo](https://example.com/photo.png "Photo")\n\n<a href="javascript:alert(3)" onclick="alert(4)">unsafe</a>\n\n<details><summary>Read more</summary>Safe content</details>\n\n- [x] task');
  assert.doesNotMatch(rendered(result, 'after'), /<script|javascript:|onclick|onerror/);
  assert.match(rendered(result, 'after'), /src="https:\/\/example.com\/photo.png"/);
  assert.match(rendered(result, 'after'), /loading="lazy"/);
  assert.match(rendered(result, 'after'), /referrerpolicy="no-referrer"/);
  assert.match(rendered(result, 'after'), /<details/);
  assert.match(rendered(result, 'after'), /<summary>Read more<\/summary>/);
  assert.match(rendered(result, 'after'), /disabled/);
});

test('identical and empty documents do not receive change markers', () => {
  for (const value of ['', '# Heading\n\nSame **content**.\n', table([['a','b']])]) {
    const result = compareMarkdown(value,value);
    assert.doesNotMatch(rendered(result, 'before'), /data-change|<del>|<ins>|data-format/);
    assert.equal(result.stats.changed + result.stats.added + result.stats.removed, 0);
    assert.equal(result.precision.level, 'word');
  }
});

test('sanitization removes named anchors, secures links, and keeps exact escaped Source', () => {
  const source = '<a id="anchor" name="alias" href="https://example.com/">safe & sound</a>';
  const result = compareMarkdown(source, source);
  const html = rendered(result, 'after');
  assert.doesNotMatch(html, /\b(?:id|name)=/);
  const link = all(parse(html), 'a')[0];
  assert.equal(link.properties.href, 'https://example.com/');
  assert.equal(link.properties.target, '_blank');
  assert.deepEqual(link.properties.rel, ['noreferrer', 'noopener']);
  assert.equal(result.source.rows[0].after.text, source);
  assert.equal(result.source.rows[0].after.html, '&lt;a id=&quot;anchor&quot; name=&quot;alias&quot; href=&quot;https://example.com/&quot;&gt;safe &amp; sound&lt;/a&gt;');
});

test('empty and mixed raw containers preserve text and void elements while comments and doctypes disappear', () => {
  const before = '<!doctype html><div></div><div>Left <em>old</em><br><img src="/safe.png"><!--discard--><p>tail</p></div>';
  const after = before.replace('old', 'new');
  const result = compareMarkdown(before, after);
  for (const [side, word, source] of [['before', 'old', before], ['after', 'new', after]]) {
    const html = rendered(result, side);
    const tree = parse(html);
    assert.equal(all(tree, 'div').length, 2);
    assert.equal(text(tree), `Left ${word}tail`);
    assert.equal(all(tree, 'br').length, 1);
    assert.equal(all(tree, 'img').length, 1);
    assert.doesNotMatch(html, /<!--|<!doctype|discard/);
    assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), source);
  }
});

test('missing raw table sides keep cell gaps and unsupported nested code keeps its siblings', () => {
  const table = '<table><tbody><tr><td>kept</td><td></td></tr></tbody></table>';
  for (const side of ['before', 'after']) {
    const result = compareMarkdown(side === 'before' ? table : '', side === 'after' ? table : '');
    const real = parse(rendered(result, side));
    const blank = parse(rendered(result, side === 'before' ? 'after' : 'before'));
    assert.equal(text(real), 'kept');
    assert.equal(text(blank), '');
    assert.equal(all(real, 'td').length, 2);
    assert.ok(has(all(blank, 'table')[0], 'dataGap'));
  }
  const inserted = compareMarkdown(table, table.replace('</tbody>', '<tr><td>new</td><td>row</td></tr></tbody>'));
  const gap = all(parse(rendered(inserted, 'before')), 'tr').find((row) => has(row, 'dataGap'));
  assert.ok(gap);
  assert.equal(all(gap, 'td').length, 2);
  const code = Array.from({ length: 240 }, (_, i) => `line ${i}\n`).join('');
  const before = `<div><p>first sibling</p><pre><code><em>${code}</em></code></pre><p>last sibling</p></div>`;
  const after = before.replace('line 120', 'edited 120');
  const result = compareMarkdown(before, after);
  assert.equal(result.rows[0].pages, undefined);
  for (const [side, expected] of [['before', code], ['after', code.replace('line 120', 'edited 120')]]) {
    assert.equal(text(parse(rendered(result, side))), `first sibling${expected}last sibling`);
  }
});

test('large divergent regions fall back explicitly and retain all content', () => {
  const before = Array.from({length:250},(_,i) => `Original item ${i} alpha`).join('\n\n');
  const after = Array.from({length:250},(_,i) => `Replacement ${i} omega`).join('\n\n');
  const result = compareMarkdown(before, after);
  assert.equal(result.precision.level, 'coarse');
  assert.ok(result.precision.warnings.length);
  assert.match(rendered(result, 'before'), /Original item 249 alpha/);
  assert.match(rendered(result, 'after'), /Replacement 249 omega/);
  assert.equal(result.source.rows.map((row) => row.before?.text || '').join(''), before);
  assert.equal(result.source.rows.map((row) => row.after?.text || '').join(''), after);
});

test('large tables expose complete bounded pages with shared columns', () => {
  const before = table(Array.from({length:1250},(_,i) => [`Row ${i}`, `State ${i}`]));
  const result = compareMarkdown(before,before.replace('State 899','Changed 899'));
  const row = result.rows[0];
  assert.equal(Object.hasOwn(row, 'before'), false);
  assert.equal(Object.hasOwn(row, 'after'), false);
  assert.equal(row.pages.length, 13);
  assert.equal(row.itemCount, 1250);
  assert.equal(all(parse(row.pages[0].after),'tr').length, 101);
  assert.match(row.pages[8].after, /<ins data-edit="add">Changed<\/ins>/);
  assert.match(row.pages[12].after, /Row 1249/);
  assert.equal(all(parse(row.pages[12].before),'col').length, 2);
});

test('changed merged cells retain original table layouts instead of synthetic alignment cells', () => {
  const head = '<table><thead><tr><th>Group</th><th>Entry</th></tr></thead><tbody>';
  for (const cell of ['td', 'th']) {
    const merged = `${head}<tr><${cell} colspan="2">Draft</${cell}></tr></tbody></table>\r\n`;
    const separate = `${head}<tr><${cell}>Ready</${cell}><${cell}>Maya</${cell}></tr></tbody></table>\n`;
    for (const [before, after] of [[merged, separate], [separate, merged]]) {
      const result = compareMarkdown(before, after);
      assert.equal(result.precision.level, 'coarse');
      assert.equal(result.precision.warnings.length, 1);
      assert.match(result.precision.warnings[0], /merged cells.*removed and added blocks.*preserve.*layout/);
      for (const [side, original, change] of [['before', before, 'remove'], ['after', after, 'add']]) {
        const actual = all(parse(rendered(result, side)), 'table')[0];
        const expected = all(parse(original), 'table')[0];
        assert.equal(actual.properties.dataChange, change);
        assert.deepEqual(all(actual, 'tr').map((row) => row.children.length), all(expected, 'tr').map((row) => row.children.length));
        assert.deepEqual(all(actual, cell).map((node) => [text(node), node.properties.colSpan]), all(expected, cell).map((node) => [text(node), node.properties.colSpan]));
        assert.equal(all(actual, 'colgroup').length, 0);
        assert.doesNotMatch(rendered(result, side), /data-gap|data-edit|data-format-change/);
        assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
      }
    }
  }
});

test('rowspans crossing the 100-row boundary stay whole, including rowspan zero', () => {
  const rows = Array.from({ length: 99 }, (_, i) => `<tr><td>Group ${i + 1}</td><td>Entry ${i + 1}</td></tr>`).join('\r\n');
  for (const span of [2, 0]) for (const cell of ['td', 'th']) for (const changed of [false, true]) {
    const before = `<table><thead><tr><th>Group</th><th>Entry</th></tr></thead><tbody>${rows}\r\n<tr><${cell} rowspan="${span}">Shared group</${cell}><td>First</td></tr>\r\n<tr><td>Second</td></tr></tbody></table>\r\n`;
    const after = changed ? before.replace('Entry 1<', 'Updated 1<') : before;
    const result = compareMarkdown(before, after);
    assert.equal(result.rows[0].pages, undefined);
    assert.equal(result.rows[0].itemCount, undefined);
    assert.equal(result.precision.level, 'coarse');
    assert.equal(result.precision.warnings.length, changed ? 2 : 1);
    assert.ok(result.precision.warnings.some((warning) => /row-spanning cells.*whole.*paginated.*preserve.*layout/.test(warning)));
    assert.equal(result.rows[0].kind, changed ? 'changed' : 'same');
    for (const [side, original] of [['before', before], ['after', after]]) {
      const actual = parse(rendered(result, side));
      const actualRows = all(actual, 'tr');
      assert.equal(actualRows.length, 102);
      assert.deepEqual(actualRows.slice(-2).map((row) => row.children.length), [2, 1]);
      assert.equal(actualRows.at(-2).children[0].properties.rowSpan, span);
      assert.deepEqual(actualRows.slice(-2).map(text), ['Shared groupFirst', 'Second']);
      assert.doesNotMatch(rendered(result, side), /data-gap/);
      if (!changed) assert.doesNotMatch(rendered(result, side), /data-change|data-edit|data-format-change/);
      assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
    }
  }
});

test('explicit unit spans retain ordinary word comparison and bounded pagination', () => {
  const rows = Array.from({ length: 101 }, (_, i) => `<tr><td colspan="1" rowspan="1">Group ${i}</td><td>Entry ${i}</td></tr>`).join('\n');
  const before = `<table><thead><tr><th colspan="1" rowspan="1">Group</th><th>Entry</th></tr></thead><tbody>${rows}</tbody></table>`;
  const after = before.replace('Entry 50<', 'Updated 50<');
  const result = compareMarkdown(before, after);
  assert.equal(result.precision.level, 'word');
  assert.deepEqual(result.precision.warnings, []);
  assert.equal(result.rows[0].pages.length, 2);
  assert.match(rendered(result, 'after'), /<ins data-edit="add">Updated<\/ins>/);
  for (const [side, original] of [['before', before], ['after', after]]) {
    const tables = all(parse(rendered(result, side)), 'table');
    assert.ok(tables.every((node) => !has(node, 'dataChange')));
    const cells = [...all(parse(rendered(result, side)), 'th'), ...all(parse(rendered(result, side)), 'td')].filter((node) => has(node, 'colSpan'));
    assert.ok(cells.every((node) => node.properties.colSpan === 1 && node.properties.rowSpan === 1));
    assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
  }
});

test('column spans alone remain safely paginated with original cells and spans', () => {
  const rows = Array.from({ length: 215 }, (_, i) => `<tr><td colspan="2">Entry ${i}</td></tr>`).join('\n');
  const before = `<table><thead><tr><th>Group</th><th>Entry</th></tr></thead><tbody>${rows}</tbody></table>\r\n`;
  for (const changed of [false, true]) {
    const after = changed ? before.replace('<td colspan="2">Entry 100</td>', '<td>Ready</td><td>Maya</td>') : before;
    const result = compareMarkdown(before, after);
    const row = result.rows[0];
    assert.equal(row.pages.length, 3);
    assert.equal(row.itemCount, 215);
    assert.equal(result.precision.level, changed ? 'coarse' : 'word');
    assert.equal(result.precision.warnings.length, changed ? 1 : 0);
    if (changed) assert.match(result.precision.warnings[0], /merged cells/);
    for (const [side, original] of [['before', before], ['after', after]]) {
      const bodies = row.pages.map((page) => all(parse(page[side]), 'tbody')[0]);
      assert.deepEqual(bodies.map((body) => body.children.length), [100, 100, 15]);
      const cells = (body) => all(body, 'tr').map((tr) => tr.children.map((node) => [node.tagName, node.properties.colSpan, text(node)]));
      assert.deepEqual(bodies.flatMap(cells), cells(all(parse(original), 'tbody')[0]));
      assert.doesNotMatch(rendered(result, side), /data-gap/);
      assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), original);
    }
  }
});

const rowspanTable = (count, start, span) => {
  const end = span === 0 ? count : Math.min(count, start + span);
  const rows = Array.from({ length: count }, (_, i) => {
    const entry = `<td>Entry ${i}</td>`;
    if (i === start) return `<tr><td rowspan="${span}">Shared group</td>${entry}</tr>`;
    return `<tr>${i > start && i < end ? '' : `<td>Group ${i}</td>`}${entry}</tr>`;
  }).join('\r\n');
  return `<table><thead><tr><th>Group</th><th>Entry</th></tr></thead><tbody>${rows}</tbody></table>`;
};

test('row spans within fixed page boundaries retain bounded complete pages', () => {
  for (const [start, span] of [[0, 2], [98, 2], [100, 100], [999, 0], [999, 20]]) {
    const value = rowspanTable(1000, start, span);
    const result = compareMarkdown(value, value);
    assert.equal(result.precision.level, 'word');
    assert.deepEqual(result.precision.warnings, []);
    for (const side of ['before', 'after']) {
      const pages = result.rows[0].pages.map((page) => parse(page[side]));
      const rows = pages.flatMap((page) => all(page, 'tbody')[0].children.filter((node) => node.tagName === 'tr'));
      assert.equal(pages.length, 10);
      assert.ok(pages.every((page) => all(page, 'tbody')[0].children.filter((node) => node.tagName === 'tr').length === 100));
      assert.deepEqual(rows.map((row) => text(all(row, 'td').at(-1))), Array.from({ length: 1000 }, (_, i) => `Entry ${i}`));
      assert.deepEqual(pages.flatMap((page) => all(page, 'td')).filter((cell) => cell.properties.rowSpan !== undefined).map((cell) => cell.properties.rowSpan), [span]);
      assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), value);
    }
  }
});

test('a page-crossing span on either side keeps both original tables whole', () => {
  const before = rowspanTable(1000, 0, 2);
  const after = rowspanTable(1000, 99, 2);
  for (const [left, right] of [[before, after], [after, before]]) {
    const result = compareMarkdown(left, right);
    assert.equal(result.rows[0].pages, undefined);
    assert.ok(result.precision.warnings.some((warning) => warning.includes('row-spanning')));
    for (const [side, original] of [['before', left], ['after', right]]) {
      assert.equal(all(parse(result.rows[0][side]), 'tbody')[0].children.filter((node) => node.tagName === 'tr').length, 1000);
      assert.doesNotMatch(result.rows[0][side], /data-gap/);
      assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
    }
  }
});

test('row spans confined to repeated headers preserve bounded body pages', () => {
  const rows = Array.from({ length: 101 }, (_, i) => `<tr><td>Group ${i}</td><td>Entry ${i}</td></tr>`).join('\n');
  const value = `<table><thead><tr><th rowspan="2">Group</th><th>Entry</th></tr><tr><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
  const result = compareMarkdown(value, value);
  assert.equal(result.precision.level, 'word');
  for (const side of ['before', 'after']) {
    const pages = result.rows[0].pages.map((page) => parse(page[side]));
    assert.deepEqual(pages.map((page) => all(page, 'tbody')[0].children.filter((node) => node.tagName === 'tr').length), [100, 1]);
    for (const page of pages) {
      assert.equal(all(page, 'thead')[0].children.filter((node) => node.tagName === 'tr').length, 2);
      assert.equal(all(page, 'th')[0].properties.rowSpan, 2);
    }
    assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), value);
  }
});

test('scoped body headers retain their complete row group on both sides', () => {
  for (const scope of ['rowgroup', 'col', 'colgroup', 'ROWGROUP', 'COL']) for (const span of [1, 2]) {
    const before = rowspanTable(101, 0, span).replace(`<td rowspan="${span}">Shared group</td>`, `<th scope="${scope}" rowspan="${span}">Project Orion</th>`);
    for (const changed of [false, true]) {
      const other = changed ? before.replace('Entry 100', 'Updated task') : before;
      for (const [left, right] of [[before, other], [other, before]]) {
        const result = compareMarkdown(left, right);
        assert.equal(result.rows[0].pages, undefined);
        assert.ok(result.precision.warnings.some((warning) => warning.includes('body headers')));
        for (const [side, original] of [['before', left], ['after', right]]) {
          const body = all(parse(result.rows[0][side]), 'tbody')[0];
          const header = all(body, 'th')[0];
          assert.equal(String(header.properties.scope).toLowerCase(), scope.toLowerCase());
          assert.equal(header.properties.rowSpan, span);
          assert.equal(text(header), 'Project Orion');
          assert.equal(body.children.filter((node) => node.tagName === 'tr').length, 101);
          assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
        }
      }
    }
  }
});

test('implicit column headers in a body stay with their data', () => {
  const rows = Array.from({ length: 101 }, (_, i) => `<tr><td>Project ${i}</td><td>Ready</td></tr>`).join('\n');
  const value = `<table><tbody><tr><th>Project</th><th>Status</th></tr>${rows}</tbody></table>`;
  const expanded = value.replace('<th>Status</th>', '<th>Status</th><th>Owner</th>').replaceAll('</td></tr>', '</td><td>Maya</td></tr>');
  for (const [left, right] of [[value, value], [value, expanded], [expanded, value]]) {
    const result = compareMarkdown(left, right);
    assert.equal(result.rows[0].pages, undefined);
    assert.ok(result.precision.warnings.some((warning) => warning.includes('body headers')));
    for (const [side, original] of [['before', left], ['after', right]]) {
      const body = all(parse(result.rows[0][side]), 'tbody')[0];
      assert.equal(body.children.filter((node) => node.tagName === 'tr').length, 102);
      assert.deepEqual(all(body, 'th').map(text), original === expanded ? ['Project', 'Status', 'Owner'] : ['Project', 'Status']);
      assert.doesNotMatch(result.rows[0][side], /data-gap/);
      assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), original);
    }
  }
});

test('row-local and mixed automatic body headers retain bounded pages', () => {
  for (const scope of ['row', 'ROW', '']) {
    const rows = Array.from({ length: 215 }, (_, i) => `<tr><th${scope ? ` scope="${scope}"` : ''}>Project ${i}</th><td>Entry ${i}</td></tr>`).join('\n');
    const value = `<table><thead><tr><th>Project</th><th>Entry</th></tr></thead><tbody>${rows}</tbody></table>`;
    const result = compareMarkdown(value, value);
    assert.equal(result.precision.level, 'word');
    for (const side of ['before', 'after']) {
      const pages = result.rows[0].pages.map((page) => parse(page[side]));
      assert.deepEqual(pages.map((page) => all(page, 'tbody')[0].children.filter((node) => node.tagName === 'tr').length), [100, 100, 15]);
      assert.deepEqual(pages.flatMap((page) => all(all(page, 'tbody')[0], 'th')).map(text), Array.from({ length: 215 }, (_, i) => `Project ${i}`));
      assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), value);
    }
  }
  const value = rowspanTable(1000, 0, 2).replace('<td rowspan="2">Shared group</td>', '<th scope="row" rowspan="2">Shared group</th>');
  const result = compareMarkdown(value, value);
  assert.equal(result.precision.level, 'word');
  assert.equal(result.rows[0].pages.length, 10);
});

test('ordered list pages preserve numbering and all items', () => {
  const value = Array.from({length:215},(_,i) => `${i+7}. Item ${i}`).join('\n');
  const result = compareMarkdown(value, value.replace('Item 102','Edited 102'));
  const row = result.rows[0];
  assert.equal(row.pages.length,3);
  assert.match(row.pages[1].after, /start="107"/);
  assert.match(row.pages[2].after, /Item 214/);
});

test('large fenced code pages retain text, format markers, languages and source', () => {
  const body = Array.from({ length: 215 }, (_, i) => i % 7 ? `Line ${i} <&> 😀` : '').join('\n') + '\n\n';
  const before = fence(body).replaceAll('\n', '\r\n');
  const after = fence(body, 'python');
  const result = compareMarkdown(before, after);
  const row = result.rows[0];
  assert.equal(row.pageType, 'code');
  assert.ok(row.pages.length > 1);
  for (const [side, language, original] of [['before', 'language-js', before], ['after', 'language-python', after]]) {
    const fragments = codePages(row, side);
    assert.equal(fragments.map(text).join(''), body);
    assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), original);
    for (const [index, code] of fragments.entries()) {
      const pre = all(parse(row.pages[index][side]), 'pre')[0];
      assert.ok(has(pre, 'dataFormatChange'));
      assert.deepEqual(code.properties.className, [language]);
      assert.ok(text(code).length <= 16000);
      assert.ok((text(code).match(/\n/g) || []).length <= 100);
    }
  }
});

test('code pages keep long edited text and surrogate pairs across cuts', () => {
  const removed = 'a'.repeat(15999) + '😀b';
  const row = compareMarkdown(fence(removed), fence('z')).rows[0];
  assert.equal(row.pageType, 'code');
  const before = codePages(row, 'before');
  const after = codePages(row, 'after');
  assert.deepEqual(coverage(before), [['remove', removed], ['', '\n']]);
  assert.deepEqual(coverage(after), [['add', 'z'], ['', '\n']]);
  assert.equal(text(before[0]).length, 15999);
  assert.ok(text(before[1]).startsWith('😀'));
  for (const code of before) {
    const value = text(code);
    assert.ok(value.length <= 16000);
    assert.doesNotMatch(value, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u);
  }
  assert.ok(has(all(parse(row.pages[1].after), 'pre')[0], 'dataGap'));
});

test('code pages bound annotation nodes without changing which text is marked', (t) => {
  t.mock.method(Date, 'now', () => 0);
  const before = 'keep ' + 'old shared '.repeat(100) + 'tail';
  const after = 'keep ' + 'new shared '.repeat(100) + 'tail';
  const row = compareMarkdown(fence(before), fence(after)).rows[0];
  assert.equal(row.pageType, 'code');
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  for (const [side, word, edit] of [['before', 'old', 'remove'], ['after', 'new', 'add']]) {
    const expected = [['', 'keep ']];
    for (let i = 0; i < 100; i++) expected.push([edit, word], ['', ' shared ']);
    expected.at(-1)[1] += 'tail\n';
    assert.deepEqual(coverage(codePages(row, side)), expected);
    for (const page of row.pages) assert.ok(count(all(parse(page[side]), 'pre')[0]) <= 256);
  }
});

test('elapsed work limits keep complete code and source with coarse highlighting', (t) => {
  let time = 0;
  t.mock.method(Date, 'now', () => time += 50);
  const before = fence('keep ' + 'old shared '.repeat(100) + 'tail');
  const after = fence('keep ' + 'new shared '.repeat(100) + 'tail');
  const result = compareMarkdown(before, after);
  assert.equal(result.precision.level, 'coarse');
  assert.ok(result.precision.warnings.length > 0);
  for (const [side, value] of [['before', before], ['after', after]]) {
    assert.equal(text(all(parse(rendered(result, side)), 'code')[0]), value.slice(value.indexOf('\n') + 1, value.lastIndexOf('```')));
    assert.equal(result.source.rows.map((row) => row[side]?.text || '').join(''), value);
  }
});

test('unequal code lengths retain each side in order and pad the shorter side', () => {
  const long = 'line\n'.repeat(215);
  const short = 'line\n'.repeat(105);
  for (const [before, after] of [[long, short], [short, long]]) {
    const row = compareMarkdown(fence(before), fence(after)).rows[0];
    assert.equal(row.pageType, 'code');
    assert.equal(row.pages.length, 3);
    for (const [side, expected] of [['before', before], ['after', after]]) {
      assert.equal(codePages(row, side).filter(Boolean).map(text).join(''), expected);
      const last = all(parse(row.pages[2][side]), 'pre')[0];
      assert.equal(has(last, 'dataGap'), expected === short);
    }
  }
});

test('added and removed code pages preserve CRLF, attributes and opposite gaps', () => {
  const body = 'x'.repeat(15999) + '\r\ntail';
  const source = `<pre title="Example"><code class="language-js">${'x'.repeat(15999)}&#13;&#10;tail</code></pre>`;
  for (const [before, after, side, change] of [['', source, 'after', 'add'], [source, '', 'before', 'remove']]) {
    const result = compareMarkdown(before, after);
    const row = result.rows[0];
    assert.equal(row.pageType, 'code');
    const fragments = codePages(row, side);
    assert.equal(fragments.map(text).join(''), body);
    assert.equal(text(fragments[0]), 'x'.repeat(15999));
    assert.ok(text(fragments[1]).startsWith('\r\n'));
    const opposite = side === 'before' ? 'after' : 'before';
    for (const page of row.pages) {
      const pre = all(parse(page[side]), 'pre')[0];
      assert.equal(pre.properties.title, 'Example');
      assert.equal(pre.properties.dataChange, change);
      assert.ok(has(all(parse(page[opposite]), 'pre')[0], 'dataGap'));
    }
    assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), source);
  }
});

test('small code and unsupported nested markup keep the whole-row representation', () => {
  assert.equal(compareMarkdown(fence('short'), fence('short')).rows[0].pages, undefined);
  const source = `<pre><code><em>${'line\n'.repeat(101)}</em></code></pre>`;
  const row = compareMarkdown(source, source).rows[0];
  assert.equal(row.pages, undefined);
  assert.equal(text(all(parse(row.before), 'code')[0]), 'line\n'.repeat(101));
});

test('nested fenced code retains compound quote siblings, edits, bounds and source', () => {
  const body = Array.from({ length: 215 }, (_, i) => `Line ${i}${i === 5 ? ' old' : ''}`).join('\n');
  const quote = (value, language) => ['> Intro', '>', `> \`\`\`${language}`, ...value.split('\n').map((line) => `> ${line}`), '> ```', '>', '> Closing'].join('\n');
  const before = quote(body, 'js');
  const after = quote(body.replace(' old', ' new'), 'python');
  const result = compareMarkdown(before, after);
  const row = result.rows[0];
  assert.equal(row.pageType, 'code');
  assert.equal(row.pages.length, 3);
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  for (const [side, original, expected, language, edit] of [['before', before, body, 'language-js', 'remove'], ['after', after, body.replace(' old', ' new'), 'language-python', 'add']]) {
    const trees = row.pages.map((page) => parse(page[side]));
    assert.deepEqual(trees.flatMap((tree) => all(tree, 'p').map(text)), ['Intro', 'Closing']);
    const pres = trees.flatMap((tree) => all(tree, 'pre'));
    const codes = pres.map((pre) => all(pre, 'code')[0]);
    assert.equal(codes.map(text).join(''), `${expected}\n`);
    assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), original);
    assert.equal(coverage(codes).filter(([kind]) => kind === edit).map(([, value]) => value).join(''), edit === 'add' ? 'new' : 'old');
    for (const [index, pre] of pres.entries()) {
      assert.ok(has(pre, 'dataPair'));
      assert.ok(has(pre, 'dataFormatChange'));
      assert.deepEqual(codes[index].properties.className, [language]);
      assert.ok(text(codes[index]).length <= 16000);
      assert.ok((text(codes[index]).match(/\n/g) || []).length <= 100);
      assert.ok(count(pre) + 1 <= 256);
    }
  }
});

test('multiple nested code blocks and uneven sides keep siblings and gaps in order', () => {
  const firstLong = 'alpha\n'.repeat(215);
  const firstShort = 'alpha\n'.repeat(105);
  const secondLong = 'omega\n'.repeat(215);
  const secondShort = 'omega\n'.repeat(105);
  const quote = (first, second) => ['> Intro', '>', '> ```first', ...first.trimEnd().split('\n').map((line) => `> ${line}`), '> ```', '>', '> Middle', '>', '> ```second', ...second.trimEnd().split('\n').map((line) => `> ${line}`), '> ```', '>', '> Closing'].join('\n');
  const result = compareMarkdown(quote(firstLong, secondShort), quote(firstShort, secondLong));
  const row = result.rows[0];
  assert.equal(row.pageType, 'code');
  for (const [side, first, second] of [['before', firstLong, secondShort], ['after', firstShort, secondLong]]) {
    const trees = row.pages.map((page) => parse(page[side]));
    const events = [];
    for (const tree of trees) {
      const quoteNode = all(tree, 'blockquote')[0];
      const visible = quoteNode.children.filter((child) => !has(child, 'dataGap'));
      assert.ok(visible.filter((child) => child.tagName === 'pre').length <= 1);
      for (const child of visible) {
        const label = child.tagName === 'pre' ? all(child, 'code')[0].properties.className[0] : text(child);
        if (events.at(-1) !== label) events.push(label);
      }
    }
    assert.deepEqual(events, ['Intro', 'language-first', 'Middle', 'language-second', 'Closing']);
    const codes = trees.flatMap((tree) => all(tree, 'code'));
    assert.equal(codes.filter((code) => code.properties.className?.includes('language-first')).map(text).join(''), first);
    assert.equal(codes.filter((code) => code.properties.className?.includes('language-second')).map(text).join(''), second);
    const gaps = trees.flatMap((tree) => all(tree, 'pre')).filter((pre) => has(pre, 'dataGap'));
    assert.ok(gaps.length > 0);
    for (const gap of gaps) assert.equal(gap.properties.ariaHidden, 'true');
  }
});

test('added and removed nested containers hide empty opposite pages and retain CRLF', () => {
  const body = 'line\r\n'.repeat(215);
  const source = `<div title="Outer"><blockquote title="Quoted"><p>Intro</p><pre title="Example"><code class="language-js">${'line&#13;&#10;'.repeat(215)}</code></pre><p>Closing</p></blockquote></div>`;
  for (const [before, after, side, change] of [['', source, 'after', 'add'], [source, '', 'before', 'remove']]) {
    const result = compareMarkdown(before, after);
    const row = result.rows[0];
    const opposite = side === 'before' ? 'after' : 'before';
    assert.equal(row.pageType, 'code');
    assert.equal(row.pages.length, 3);
    const trees = row.pages.map((page) => parse(page[side]));
    assert.deepEqual(trees.flatMap((tree) => all(tree, 'p').map(text)), ['Intro', 'Closing']);
    assert.equal(trees.flatMap((tree) => all(tree, 'code')).map(text).join(''), body);
    assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), source);
    for (const [index, tree] of trees.entries()) {
      const root = all(tree, 'div')[0];
      assert.equal(root.properties.title, 'Outer');
      assert.equal(root.properties.dataChange, change);
      assert.equal(all(tree, 'blockquote')[0].properties.title, 'Quoted');
      assert.equal(all(tree, 'pre')[0].properties.title, 'Example');
      const blank = all(parse(row.pages[index][opposite]), 'div')[0];
      assert.ok(has(blank, 'dataGap'));
      assert.equal(blank.properties.ariaHidden, 'true');
    }
  }
});

test('nested code pages reserve nodes for ancestor wrappers and preserve edit coverage', () => {
  const source = (word) => `<blockquote>${'<div>'.repeat(20)}<pre><code>keep ${`${word} shared `.repeat(130)}tail</code></pre>${'</div>'.repeat(20)}</blockquote>`;
  const row = compareMarkdown(source('old'), source('new')).rows[0];
  assert.equal(row.pageType, 'code');
  assert.ok(row.pages.length > 1);
  const count = (node) => 1 + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  for (const [side, word, edit] of [['before', 'old', 'remove'], ['after', 'new', 'add']]) {
    const trees = row.pages.map((page) => parse(page[side]));
    const codes = trees.flatMap((tree) => all(tree, 'code'));
    assert.equal(codes.map(text).join(''), `keep ${`${word} shared `.repeat(130)}tail`);
    assert.equal(coverage(codes).filter(([kind]) => kind === edit).map(([, value]) => value).join(''), word.repeat(130));
    for (const tree of trees) {
      assert.equal(all(tree, 'div').length, 20);
      assert.ok(count(all(tree, 'pre')[0]) + 21 <= 256);
    }
  }
});

test('unsupported nested code markup stays whole next to paginated code', () => {
  const unsupported = 'outside\n'.repeat(105);
  const supported = 'inside\n'.repeat(215);
  const pre = `<pre><code><em>${unsupported}</em></code></pre>`;
  const single = `<blockquote>${pre}</blockquote>`;
  assert.equal(compareMarkdown(single, single).rows[0].pages, undefined);
  const source = `<blockquote>${pre}<p>Middle</p><pre><code>${supported}</code></pre></blockquote>`;
  const row = compareMarkdown(source, source).rows[0];
  assert.equal(row.pageType, 'code');
  for (const side of ['before', 'after']) {
    const trees = row.pages.map((page) => parse(page[side]));
    const emphasized = trees.flatMap((tree) => all(tree, 'em'));
    assert.equal(emphasized.length, 1);
    assert.equal(text(emphasized[0]), unsupported);
    assert.deepEqual(trees.flatMap((tree) => all(tree, 'p').map(text)), ['Middle']);
    assert.equal(trees.flatMap((tree) => all(tree, 'pre')).filter((node) => !all(node, 'em').length).map(text).join(''), supported);
  }
});

test('nested ordered lists retain values on continued items and ignore alignment gaps', () => {
  const body = 'line\n'.repeat(215);
  const source = (inserted) => `<blockquote><ol start="7">${inserted ? '<li>Inserted</li>' : ''}<li>Alpha</li><li value="12"><p>Inside</p><ul><li><ol start="3"><li value="5"><p>Inner</p><pre><code>${body}</code></pre><p>Inner end</p></li><li>Child tail</li></ol></li></ul><p>Outer end</p></li><li>Tail</li></ol></blockquote>`;
  const row = compareMarkdown(source(false), source(true)).rows[0];
  assert.equal(row.pageType, 'code');
  assert.equal(row.pages.length, 3);
  const values = (list) => {
    let next = Number(list.properties.start ?? 1);
    return list.children.filter((child) => child.tagName === 'li' && !has(child, 'dataGap')).map((item) => {
      const value = Number(item.properties.value ?? next);
      next = value + 1;
      return value;
    });
  };
  for (const [side, expected] of [['before', [[7, 12], [12], [12, 13]]], ['after', [[7, 8, 12], [12], [12, 13]]]]) {
    const trees = row.pages.map((page) => parse(page[side]));
    assert.deepEqual(trees.map((tree) => values(all(tree, 'ol')[0])), expected);
    assert.deepEqual(trees.map((tree) => values(all(tree, 'ol')[1])), [[5], [5], [5, 6]]);
    assert.deepEqual(trees.flatMap((tree) => all(tree, 'p').map(text)), ['Inside', 'Inner', 'Inner end', 'Outer end']);
    assert.equal(trees.flatMap((tree) => all(tree, 'code')).map(text).join(''), body);
    for (const tree of trees) {
      const pairs = all(tree, 'li').map((item) => item.properties.dataPair).filter(Boolean);
      assert.equal(new Set(pairs).size, pairs.length);
    }
  }
});

test('large top-level list keeps its item bound and ordinals around nested code', () => {
  const body = 'line\n'.repeat(215);
  const items = Array.from({ length: 215 }, (_, i) => i === 105
    ? `<li value="300"><p>Item ${i}</p><pre><code>${body}</code></pre></li>` : `<li>Item ${i}</li>`).join('');
  const source = `<ol start="7">${items}</ol>`;
  const result = compareMarkdown(source, source);
  const row = result.rows[0];
  assert.equal(row.pageType, 'code');
  assert.equal(row.itemCount, undefined);
  for (const side of ['before', 'after']) {
    const trees = row.pages.map((page) => parse(page[side]));
    const labels = [];
    for (const tree of trees) {
      const list = all(tree, 'ol')[0];
      const entries = list.children.filter((child) => child.tagName === 'li' && !has(child, 'dataGap'));
      assert.ok(entries.length <= 100);
      for (const item of entries) {
        const label = text({ children: item.children.filter((child) => child.tagName !== 'pre') });
        if (!label) assert.equal(Number(item.properties.value), 300);
        else {
          const index = Number(label.replace('Item ', ''));
          labels.push(label);
          assert.equal(Number(item.properties.value), index < 105 ? index + 7 : index - 105 + 300);
        }
      }
    }
    assert.deepEqual(labels, Array.from({ length: 215 }, (_, i) => `Item ${i}`));
    assert.equal(trees.flatMap((tree) => all(tree, 'code')).map(text).join(''), body);
    assert.equal(result.source.rows.map((sourceRow) => sourceRow[side]?.text || '').join(''), source);
  }
});

test('headerless raw tables retain their widest rows and caption', () => {
  const result = compareMarkdown('<table><caption>Counts</caption><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>', '<table><caption>Counts</caption><tr><td>a</td><td>new</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>');
  assert.match(rendered(result, 'after'), /<caption>Counts<\/caption>/);
  assert.match(rendered(result, 'after'), /<td>e<\/td>/);
});

test('over-budget sequence matching retains exact anchors between many edits', () => {
  const before = Array.from({length:1500},(_,i) => `## Section ${i}\n\nOld passage ${i}`).join('\n\n');
  const after = before.replaceAll('Old passage','New passage');
  const result = compareMarkdown(before,after);
  assert.equal(result.rows.length,3000);
  assert.equal(result.rows.filter((row) => row.kind === 'same').length,1500);
  assert.match(rendered(result, 'before'),/Section 1499/);
  assert.match(rendered(result, 'after'),/Section 1499/);
});

test('a UTF-8 BOM remains present in source and does not break rendered headings', () => {
  const result = compareMarkdown('', '\uFEFF# Heading\r\n');
  assert.match(rendered(result, 'after'), /<h1[^>]*>Heading<\/h1>/);
  assert.equal(result.source.rows.map((row) => row.after?.text || '').join(''),'\uFEFF# Heading\r\n');
});

test('authored strikethrough and insertion stay distinct from text diff annotations', () => {
  const before = '~~Deprecated~~ <ins>Authored insertion</ins> old word';
  const after = '~~Deprecated~~ <ins>Authored insertion</ins> new word';
  const result = compareMarkdown(before, after);
  for (const side of ['before', 'after']) {
    const tree = parse(rendered(result, side));
    const authored = [...all(tree, 'del'), ...all(tree, 'ins')].filter((node) => !has(node, 'dataEdit'));
    assert.deepEqual(authored.map((node) => [node.tagName, text(node)]), [['del', 'Deprecated'], ['ins', 'Authored insertion']]);
    const edits = [...all(tree, 'del'), ...all(tree, 'ins')].filter((node) => has(node, 'dataEdit'));
    assert.deepEqual(edits.map((node) => [node.properties.dataEdit, text(node)]), [[side === 'before' ? 'remove' : 'add', side === 'before' ? 'old' : 'new']]);
  }
});

test('raw tables retain every cell across short headers and uneven body rows', () => {
  const cases = [
    '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td><td>KEEP EXTRA</td></tr></tbody></table>',
    '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr><tr><td>ROW TWO</td><td>KEEP EXTRA</td><td>KEEP LAST</td></tr></tbody></table>',
    '<table><tr><td>x</td></tr><tr><td>ROW TWO</td><td>KEEP EXTRA</td><td>KEEP LAST</td></tr></table>',
    '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody><tbody><tr><td>KEEP SECOND BODY</td><td>KEEP EXTRA</td></tr></tbody></table>',
    `<table><tbody>${'<tr><td>x</td></tr>'.repeat(101)}</tbody><tbody><tr><td>KEEP SECOND BODY</td><td>KEEP EXTRA</td></tr></tbody></table>`,
  ];
  for (const before of cases) {
    const after = before.replace('>x<', '>y<');
    const result = compareMarkdown(before, after);
    if (all(parse(before), 'tbody').length > 1) assert.equal(result.rows[0].pages, undefined);
    for (const [side, source] of [['before', before], ['after', after]]) {
      const actual = parse(rendered(result, side));
      const expected = parse(source);
      const cells = (tree) => all(tree, 'tr').map((row) => row.children.filter((cell) => ['td', 'th'].includes(cell.tagName) && !has(cell, 'dataGap')).map(text));
      assert.deepEqual(cells(actual), cells(expected));
      const actualTable = all(actual, 'table')[0];
      assert.ok(actualTable.children.every((section) => ['caption', 'colgroup', 'thead', 'tbody', 'tfoot'].includes(section.tagName)));
      for (const section of actualTable.children.filter((node) => ['thead', 'tbody', 'tfoot'].includes(node.tagName))) {
        assert.ok(section.children.every((row) => row.tagName === 'tr'));
        for (const row of section.children) assert.ok(row.children.every((cell) => ['td', 'th'].includes(cell.tagName)));
      }
    }
  }
});

test('ordered list gaps retain original numbering through starts, nesting, and pages', () => {
  const numbers = (html) => all(parse(html), 'ol').map((list) => {
    let next = Number(list.properties.start ?? 1);
    const values = [];
    for (const item of list.children.filter((node) => node.tagName === 'li')) {
      next = Number(item.properties.value ?? next);
      if (!has(item, 'dataGap')) values.push(next);
      next++;
    }
    return values;
  });
  for (const start of [0, 1, 7]) {
    const before = `${start}. Alpha\n${start + 1}. Bravo`;
    const after = `${start}. Added\n${start + 1}. Alpha\n${start + 2}. Bravo`;
    for (const [a, b, left, right] of [[before, after, [start, start + 1], [start, start + 1, start + 2]], [after, before, [start, start + 1, start + 2], [start, start + 1]]]) {
      const result = compareMarkdown(a, b);
      assert.deepEqual(numbers(rendered(result, 'before')), [left]);
      assert.deepEqual(numbers(rendered(result, 'after')), [right]);
    }
  }
  const nested = compareMarkdown('7. Parent\n   3. Child A\n   4. Child B\n8. Tail', '7. Added\n8. Parent\n   3. Inserted\n   4. Child A\n   5. Child B\n9. Tail');
  assert.deepEqual(numbers(rendered(nested, 'before')), [[7, 8], [3, 4]]);
  assert.deepEqual(numbers(rendered(nested, 'after')), [[7, 8, 9], [3, 4, 5]]);
  const raw = compareMarkdown('<ol start="7"><li value="10">Alpha</li><li>Bravo</li></ol>', '<ol start="7"><li>Added</li><li value="10">Alpha</li><li>Bravo</li></ol>');
  assert.deepEqual(numbers(rendered(raw, 'before')), [[10, 11]]);
  assert.deepEqual(numbers(rendered(raw, 'after')), [[7, 10, 11]]);
  const before = Array.from({ length: 215 }, (_, i) => `${i + 7}. Item ${i}`).join('\n');
  const after = `7. Added\n${before}`;
  for (const [a, b, leftLength, rightLength] of [[before, after, 215, 216], [after, before, 216, 215]]) {
    const row = compareMarkdown(a, b).rows[0];
    assert.equal(row.pages.length, 3);
    assert.deepEqual(row.pages.flatMap((page) => numbers(page.before)[0]), Array.from({ length: leftLength }, (_, i) => i + 7));
    assert.deepEqual(row.pages.flatMap((page) => numbers(page.after)[0]), Array.from({ length: rightLength }, (_, i) => i + 7));
  }
});

test('150,000 source lines can be added and removed without losing characters', () => {
  const value = 'x\n'.repeat(150000);
  for (const [before, after] of [['', value], [value, '']]) {
    const result = compareMarkdown(before, after);
    assert.equal(result.source.rows.length, 150000);
    assert.equal(result.source.rows.map((row) => row.before?.text || '').join(''), before);
    assert.equal(result.source.rows.map((row) => row.after?.text || '').join(''), after);
    for (const [index, row] of result.source.rows.entries()) {
      assert.equal((row.before || row.after).line, index + 1);
    }
    assert.equal(text(parse(rendered(result, before ? 'before' : 'after'))), value.slice(0, -1));
  }
});
