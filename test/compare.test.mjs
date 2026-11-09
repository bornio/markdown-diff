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

test('ordered list pages preserve numbering and all items', () => {
  const value = Array.from({length:215},(_,i) => `${i+7}. Item ${i}`).join('\n');
  const result = compareMarkdown(value, value.replace('Item 102','Edited 102'));
  const row = result.rows[0];
  assert.equal(row.pages.length,3);
  assert.match(row.pages[1].after, /start="107"/);
  assert.match(row.pages[2].after, /Item 214/);
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
