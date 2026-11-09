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

test('code pages bound annotation nodes without changing which text is marked', () => {
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
