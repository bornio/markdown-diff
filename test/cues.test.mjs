import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHtml } from 'hast-util-from-html';
import { compareMarkdown } from '../src/compare.js';
const rendered = (result, side) => result.rows.flatMap((row) => row.pages || [row]).map((page) => page[side]).join('');
const parse = (html) => fromHtml(html, { fragment: true });
const walk = (node) => [node, ...(node.children || []).flatMap(walk)];
const text = (node) => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
const all = (node, name) => walk(node).filter((child) => child.tagName === name);
// [tagName, data-format-target] for every targeted element on one side, in document order.
const targets = (result, side) => walk(parse(rendered(result, side)))
  .filter((node) => node.properties && Object.hasOwn(node.properties, 'dataFormatTarget'))
  .map((node) => [node.tagName, node.properties.dataFormatTarget]);
const both = (before, after) => { const r = compareMarkdown(before, after); return [targets(r, 'before'), targets(r, 'after')]; };

test('#11(b) format change without word edits targets the inner element', () => {
  assert.deepEqual(both('[same](https://old.example)', '[same](https://new.example)'), [[['a', '']], [['a', '']]]);
});
test('#11(a) checkbox with word edits keeps the checkbox target (test:71)', () => {
  assert.deepEqual(both('- [ ] old word', '- [x] new word'), [[['input', 'checkbox']], [['input', 'checkbox']]]);
});
test('#7 plain, loose and tight task items cue only the input', () => {
  for (const [a, b] of [['- [ ] a', '- [x] a'], ['- [ ] a\n\n  para', '- [x] a\n\n  para'], ['- [ ] a\n  - b', '- [x] a\n  - b']]) {
    assert.deepEqual(both(a, b), [[['input', 'checkbox']], [['input', 'checkbox']]], a);
  }
});
test('C3b changed item structure leaves the checkbox uncued', () => {
  const [left, right] = both('- [ ] a', '- [x] a [l](x)');
  assert.ok(![...left, ...right].some(([name]) => name === 'input'));
});
test('#11(a) image src change with word edits keeps replaced (test:74)', () => {
  assert.deepEqual(both('![alt](https://old.example/x.png) old word', '![new alt](https://new.example/x.png) new word'), [[['img', 'replaced']], [['img', 'replaced']]]);
});
test('#11(b) changed link before a replaced image with word edits', () => {
  assert.deepEqual(both('[same](old.html) ![a](x.png) old word', '[same](new.html) ![a](y.png) new word'), [[['img', 'replaced']], [['img', 'replaced']]]);
});
test('#11(b) two replaced images', () => {
  const expected = [['img', 'replaced'], ['img', 'replaced']];
  assert.deepEqual(both('![a](1.png) ![b](2.png)', '![a](3.png) ![b](4.png)'), [expected, expected]);
});
test('#11(b) bold added without word edits: strong on the new side, p on the old side', () => {
  assert.deepEqual(both('a b c', 'a **b** c'), [[['p', '']], [['strong', '']]]);
});
test('#11(c) raw HTML img block src change is replaced', () => {
  assert.deepEqual(both('<img src="1.png">', '<img src="2.png">'), [[['img', 'replaced']], [['img', 'replaced']]]);
});
test('#11(b) image inserted before unchanged ones is never called replaced', () => {
  const [left, right] = both('![a](1.png) ![b](2.png)', '![z](0.png) ![a](1.png) ![b](2.png)');
  assert.ok(![...left, ...right].some(([, kind]) => kind === 'replaced'));
});
test('#11(c) own-attribute changes target the element itself', () => {
  assert.deepEqual(both('3. a\n4. b', '5. a\n6. b'), [[['ol', '']], [['ol', '']]]);
  assert.deepEqual(both('<details>\n\nx\n\n</details>', '<details open>\n\nx\n\n</details>'), [[['details', '']], [['details', '']]]);
});
test('#11(a) a real empty cell paired with text is not outlined', () => {
  assert.deepEqual(both('| a | b |\n|---|---|\n| x |  |', '| a | b |\n|---|---|\n| x | y |'), [[], []]);
});
test('G1 authored data-format-target and data-gap are stripped', () => {
  for (const authored of ['data-gap aria-hidden="true"', 'data-gap="column"']) {
    const html = rendered(compareMarkdown('', `<p data-format-target="replaced" ${authored}>x</p>`), 'after');
    assert.doesNotMatch(html, /data-format-target|data-gap/);
  }
});
test('#9 gap columns are marked per side on the generated colgroup only', () => {
  const result = compareMarkdown('| A | B |\n|---|---|\n| 1 | 2 |', '| A | X | B |\n|---|---|---|\n| 1 | 9 | 2 |');
  const cols = (side) => walk(parse(rendered(result, side))).filter((node) => node.tagName === 'col').map((col) => Object.hasOwn(col.properties, 'dataGap'));
  assert.deepEqual(cols('before'), [false, true, false]);
  assert.deepEqual(cols('after'), [false, false, false]);
});
test('#9 a real empty column carries no gap marker', () => {
  const result = compareMarkdown('| A |  |\n|---|---|\n| 1 |  |', '| A |  |\n|---|---|\n| 2 |  |');
  for (const side of ['before', 'after']) assert.doesNotMatch(rendered(result, side), /data-gap/);
});
test('#15 boundary whitespace moves outside edits outside code only', () => {
  assert.match(rendered(compareMarkdown('a b', 'a x y b'), 'after'), /a <ins data-edit="add">x y<\/ins> b/);
  assert.match(rendered(compareMarkdown('one two', 'one'), 'before'), /one <del data-edit="remove">two<\/del>/);
  assert.match(rendered(compareMarkdown('keep this', 'keep  this'), 'after'), /keep<ins data-edit="add"> {2}<\/ins>this/);
  assert.match(rendered(compareMarkdown('```\na b\n```', '```\na x y b\n```'), 'after'), /<ins data-edit="add">x y <\/ins>/);
});
test('#9 gap-column cells are marked per side, gap-row cells elsewhere stay bare', () => {
  const result = compareMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', '| A | X | B |\n|---|---|---|\n| 1 | 9 | 2 |\n| n | m | o |\n| 3 | 8 | 4 |');
  const rows = (side) => walk(parse(rendered(result, side))).filter((node) => node.tagName === 'tr')
    .map((row) => row.children.filter((cell) => cell.type === 'element').map((cell) => cell.properties.dataGap));
  assert.deepEqual(rows('before'), [[undefined, 'column', undefined], [undefined, 'column', undefined], ['', 'column', ''], [undefined, 'column', undefined]]);
  assert.ok(rows('after').flat().every((gap) => gap === undefined));
});
test('#15 trimming spans text nodes, keeps literal text under the property path, and leaves Source alone', () => {
  const removed = all(parse(rendered(compareMarkdown('x old **bold** y', 'x y'), 'before')), 'del').map(text);
  assert.deepEqual(removed, ['old ', 'bold']);
  assert.match(rendered(compareMarkdown('<div><code>a c</code></div>', '<div><code>a b c</code></div>'), 'after'), /<ins data-edit="add">b <\/ins>/);
  assert.match(rendered(compareMarkdown('a `x y` b', 'a `x z y` c'), 'after'), /<code>x <ins data-edit="add">z <\/ins>y<\/code> <ins data-edit="add">c<\/ins>/);
  assert.match(compareMarkdown('a c', 'a b c').source.rows[0].after.html, /<ins>b <\/ins>/);
});
