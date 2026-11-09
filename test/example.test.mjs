import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareMarkdown } from '../src/compare.js';
const rendered = (result, side) => result.rows.flatMap((row) => row.pages || [row]).map((page) => page[side]).join('');

test('the example renders supported Markdown features and preserves both sources', async () => {
  const [before, after] = await Promise.all(['before', 'after'].map((side) => readFile(new URL(`../src/examples/${side}.md`, import.meta.url), 'utf8')));
  const result = compareMarkdown(before, after);
  for (const side of ['before', 'after']) {
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'input', 'strong', 'em', 'del', 'code', 'pre', 'a', 'img', 'blockquote', 'details', 'summary', 'br', 'hr']) {
      assert.match(rendered(result, side), new RegExp(`<${tag}(?:\\s|>)`), `${side} renders ${tag}`);
    }
  }
  assert.ok(result.rows.some((row) => row.kind === 'changed' && (row.pages || [row]).some((page) => page.after.includes('<table'))));
  assert.match(rendered(result, 'after'), /<ins data-edit="add">/);
  assert.match(rendered(result, 'after'), /src="\/examples\/workflow-after.svg"/);
  assert.equal(result.source.rows.map((row) => row.before?.text || '').join(''), before);
  assert.equal(result.source.rows.map((row) => row.after?.text || '').join(''), after);
});
