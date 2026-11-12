import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubUrl, fetchHistory } from '../src/github.js';

const native = globalThis.fetch;
afterEach(() => { globalThis.fetch = native; });

test('repo file links keep owner, repo, and path, and ignore query strings and line anchors', () => {
  for (const link of [
    'https://github.com/bornio/markdown-diff/blob/main/docs/performance.md',
    'https://github.com/bornio/markdown-diff/blob/main/docs/performance.md?plain=1#L10',
    'github.com/bornio/markdown-diff/blob/main/docs/performance.md',
    '  https://www.github.com/bornio/markdown-diff/blob/main/docs/performance.md  ',
    'https://raw.githubusercontent.com/bornio/markdown-diff/main/docs/performance.md',
  ]) {
    const source = parseGitHubUrl(link);
    assert.equal(source.kind, 'repo', link);
    assert.deepEqual([source.owner, source.repo, source.ref, source.path], ['bornio', 'markdown-diff', 'main', 'docs/performance.md'], link);
    assert.equal(source.url, 'https://github.com/bornio/markdown-diff/blob/main/docs/performance.md', link);
  }
});

test('gist links accept an owner or not, and a #file- anchor picks the file', () => {
  const id = '52d051abee338d0a210bf269e9b2b32c';
  assert.deepEqual(parseGitHubUrl(`https://gist.github.com/bornio/${id}`), { kind: 'gist', owner: 'bornio', id, fileHint: null, url: `https://gist.github.com/bornio/${id}` });
  assert.equal(parseGitHubUrl(`https://gist.github.com/${id}`).url, `https://gist.github.com/${id}`);
  assert.equal(parseGitHubUrl(`https://gist.github.com/bornio/${id}#file-release-notes-md`).fileHint, 'release-notes-md');
});

test('links to anything but a Markdown file or gist are refused', () => {
  for (const link of [
    '', 'hello', '# Title', 'https://github.com/bornio/markdown-diff', 'https://github.com/bornio/markdown-diff/blob/main/src/app.js',
    'https://github.com/bornio/markdown-diff/tree/main/docs', 'https://gist.github.com/bornio', 'https://gitlab.com/a/b/blob/main/README.md',
  ]) assert.equal(parseGitHubUrl(link), null, link);
});

test('a branch with slashes is found by moving one path segment at a time into the branch name', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams;
    asked.push(`${query.get('sha')} ${query.get('path')}`);
    if (query.get('sha') === 'feat') return new Response('{"message":"No commit found"}', { status: 404 });
    const commits = query.get('sha') === 'feat/notes' ? [{ sha: 'a'.repeat(40), author: null, commit: { message: 'Write it\n\nBody', author: { name: 'Ann', date: '2026-01-02T00:00:00Z' } } }] : [];
    return new Response(JSON.stringify(commits), { status: 200 });
  };
  const source = parseGitHubUrl('https://github.com/o/r/blob/feat/notes/docs/plan.md');
  const { entries } = await fetchHistory(source);
  assert.deepEqual(asked, ['feat notes/docs/plan.md', 'feat/notes docs/plan.md']);
  assert.deepEqual([source.ref, source.path], ['feat/notes', 'docs/plan.md']);
  assert.deepEqual(entries, [{ sha: 'a'.repeat(40), date: '2026-01-02T00:00:00Z', author: 'Ann', message: 'Write it' }]);
});

test('a spent hourly limit says when to try again', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } });
  await assert.rejects(fetchHistory(parseGitHubUrl('https://github.com/o/r/blob/main/README.md')), (error) => error.kind === 'rate-limit' && /Try again after/.test(error.message));
});
