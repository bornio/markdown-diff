import assert from 'node:assert/strict';
import test from 'node:test';
import { compareMarkdown } from '../src/compare.js';

const messages = [];
globalThis.self = { postMessage: message => messages.push(message) };
await import('../src/compare.worker.js');
const compare = (beforeText, afterText = beforeText, previewLimits = { characters: 262144, elements: 8000 }) => {
  self.onmessage({ data: { requestId: 7, beforeText, afterText, previewLimits } });
  return messages.pop();
};

test('preview limits reject a large unpaginated paragraph and dense markup before publishing a DOM payload', () => {
  for (const text of ['word '.repeat(80000), '<div>' + '<span>x</span>'.repeat(4500) + '</div>']) {
    const result = compare(text);
    assert.equal(result.status, 'error');
    assert.match(result.message, /native source comparison/);
    assert.equal(result.comparison, undefined);
  }
});

test('ordinary wide tables keep the engine output without unused Source payload', () => {
  const text = '| ' + Array.from({ length: 20 }, (_, i) => `Column ${i}`).join(' | ') + ' |\n| ' + Array(20).fill('---').join(' | ') + ' |\n' + Array.from({ length: 80 }, (_, i) => '| ' + Array.from({ length: 20 }, (_, j) => `${i},${j}`).join(' | ') + ' |').join('\n');
  const result = compare(text);
  assert.equal(result.status, 'ready');
  const { source, ...rendered } = compareMarkdown(text, text);
  assert.equal(Object.hasOwn(result.comparison, 'source'), false);
  assert.deepEqual(result.comparison, rendered);
});

test('large code is limited per page without limiting the whole paginated result', () => {
  const text = '```\n' + Array.from({ length: 50000 }, (_, i) => `line ${i}`).join('\n') + '\n```';
  const result = compare(text);
  assert.equal(result.status, 'ready');
  assert.ok(result.comparison.rows.some(row => row.pages?.length > 1));
  assert.equal(Object.hasOwn(result.comparison, 'source'), false);
});

test('the website worker has unchanged output when no preview policy is supplied', () => {
  const text = 'word '.repeat(30000);
  const result = compare(text, text, null);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.comparison, compareMarkdown(text, text));
});

test('invalid supplied preview limits are rejected at the worker boundary', () => {
  for (const policy of [{}, { characters: -1, elements: 8000 }, { characters: 100, elements: Infinity }]) {
    assert.equal(compare('text', 'text', policy).status, 'error');
  }
});

test('a long code line remains available through bounded rendered pages', () => {
  const text = '```\n' + 'x'.repeat(150000) + '\n```';
  assert.ok(compareMarkdown(text, text).rows[0].pages.length > 1);
  const result = compare(text);
  assert.equal(result.status, 'ready');
  assert.ok(result.comparison.rows[0].pages.length > 1);
  assert.equal(Object.hasOwn(result.comparison, 'source'), false);
});

test('unused inline-image Source does not reject a small sanitized rendered comparison', () => {
  const text = '# Inline asset\n\n![logo](data:image/png;base64,' + 'A'.repeat(140000) + ')\n\noriginal\n';
  const result = compare(text, text.replace('original', 'changed'));
  assert.equal(result.status, 'ready');
  assert.ok(result.comparison.rows.some(row => row.before.includes('logo')));
  assert.equal(Object.hasOwn(result.comparison, 'source'), false);
  assert.doesNotMatch(JSON.stringify(result.comparison), /A{100}/);
});
