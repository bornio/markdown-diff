import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const fence = (lines) => `\`\`\`txt\n${lines.join('\n')}\n\`\`\``;
const releaseRead = (page, name) => page.evaluate((held) => globalThis.releaseRead(held), name);
// Files named hold-* are read only when the test calls releaseRead.
async function holdReads(page) {
  await page.addInitScript(() => {
    const native = globalThis.File.prototype.arrayBuffer;
    const pending = new Map();
    globalThis.pendingReads = () => [...pending.keys()];
    globalThis.releaseRead = (name) => pending.get(name)();
    globalThis.File.prototype.arrayBuffer = function () {
      if (!this.name.startsWith('hold-')) return native.call(this);
      return new Promise((resolve) => pending.set(this.name, async () => {
        const buffer = await native.call(this);
        pending.delete(this.name);
        resolve(buffer);
      }));
    };
  });
  await page.goto('./');
}
const titleHidden = (page) => page.evaluate(() => {
  const controls = globalThis.document.querySelector('.toolbar-controls').getBoundingClientRect();
  const title = globalThis.document.querySelector('.comparison-title').getBoundingClientRect();
  return Math.round(controls.bottom - title.top);
});
const scrollTo = (page, y) => page.evaluate((top) => globalThis.scrollTo(0, top), y);
// Drops files on a side's filename, as when dragging them in from the desktop.
const drop = (page, side, files) => page.evaluate(({ side, files }) => {
  const dataTransfer = new globalThis.DataTransfer();
  for (const { name, bytes } of files) dataTransfer.items.add(new globalThis.File([new Uint8Array(bytes)], name, { type: 'text/plain' }));
  globalThis.document.querySelector(`#${side}-name`).dispatchEvent(new globalThis.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
}, { side, files: [files].flat().map(({ name, buffer }) => ({ name, bytes: [...buffer] })) });

const sha = (n) => n.toString(16).padStart(40, '0');
const gistId = 'abcdef0123456789abcd';
const REPO_LINK = 'https://github.com/o/r/blob/main/docs/plan.md';
const GIST_LINK = `https://gist.github.com/ann/${gistId}`;
const linkTo = (link, params = {}) => `./?${new URLSearchParams({ gh: link, ...params })}`;
const query = (page) => Object.fromEntries(new URL(page.url()).searchParams);
// A made-up repo file and gist, so the tests never reach GitHub. `fail` makes the history request
// return 404, run out the hourly limit, or drop the connection; `paged` serves repo history two commits a page.
async function mockGitHub(page, { fail = null, paged = false } = {}) {
  const repo = [3, 2, 1].map((n) => ({ sha: sha(n), author: { login: 'ann' }, commit: { message: `Plan, take ${n}`, author: { name: 'Ann', date: `2026-0${n}-01T12:00:00Z` } } }));
  const gist = {
    'notes.md': { [sha(13)]: 'Notes two\n', [sha(12)]: 'Notes one\n', [sha(11)]: 'Notes one\n' },
    'todo.md': { [sha(13)]: 'Todo\n', [sha(12)]: 'Todo\n' },
  };
  const revisions = [13, 12, 11].map((n) => ({ version: sha(n), committed_at: `2026-0${n - 10}-02T12:00:00Z`, user: { login: 'ann' }, change_status: { additions: 1, deletions: 1 } }));
  const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Link, X-RateLimit-Remaining, X-RateLimit-Reset' };
  await page.route(/^https:\/\/(api\.github\.com|raw\.githubusercontent\.com|gist\.githubusercontent\.com)\//, (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/').slice(1);
    if (url.hostname === 'api.github.com') {
      if (fail === 'missing') return route.fulfill({ status: 404, headers, json: { message: 'Not Found' } });
      if (fail === 'limit') return route.fulfill({ status: 403, headers: { ...headers, 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }, json: {} });
      if (fail === 'offline') return route.abort();
      if (parts[0] === 'repos' && paged) {
        const number = Number(url.searchParams.get('page'));
        const next = number === 1 ? { link: `<${url.href.replace('page=1', 'page=2')}>; rel="next"` } : {};
        return route.fulfill({ headers: { ...headers, ...next }, json: repo.slice((number - 1) * 2, number * 2) });
      }
      if (parts[0] === 'repos') return route.fulfill({ headers, json: repo });
      if (parts.length === 2) return route.fulfill({ headers, json: { owner: { login: 'ann' }, files: { 'notes.md': {}, 'todo.md': {}, 'run.sh': {} } } });
      return route.fulfill({ headers, json: revisions });
    }
    const text = url.hostname === 'raw.githubusercontent.com'
      ? Object.fromEntries(repo.map(({ sha: version }, i) => [version, `# Plan\n\nTake ${3 - i}.\n`]))[parts[2]]
      : gist[decodeURIComponent(parts[4])]?.[parts[3]];
    return route.fulfill(text == null ? { status: 404, headers, body: '404: Not Found' } : { headers, body: text });
  });
}

test.beforeEach(async ({ page }) => { await page.goto('./'); });

test('file boundaries, status visibility, and actual Source survive success and read errors', async ({ page }) => {
  const status = page.locator('#status');
  await expect(status).toHaveText('Ready when you are');
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#stats')).toBeHidden();
  await drop(page, 'before', file('bad.pdf', 'bad'));
  await expect(status).toHaveText('Could not open file');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#notice')).toContainText('Choose a .md, .markdown, .txt, or .mdx text file.');
  await drop(page, 'before', file('bad.md', Buffer.from([255])));
  await expect(page.locator('#notice')).toContainText('not a UTF-8 text file');
  await drop(page, 'before', file('binary.md', Buffer.from([0])));
  await expect(page.locator('#notice')).toContainText('binary.md looks like a binary file');
  await drop(page, 'before', [file('left.md', '# Héllo 😀\n'), file('right.md', '# Héllo 😀\n')]);
  await expect(status).toHaveText('Files are identical');
  await drop(page, 'before', [file('left.md', '**same**\n'), file('right.md', '__same__\n')]);
  await expect(status).toHaveText('Same rendered content');
  await expect(status).not.toHaveClass(/sr-only/);
  await page.locator('#source-view').click();
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('.source-code').last()).toHaveText('__same__\n');
  await drop(page, 'after', file('right.md', '<span>new & safe</span>\n'));
  await expect(status).toHaveText('Comparison ready');
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('#stats')).toBeVisible();
  expect(await page.locator('.source-cell[data-side=after] .source-code').textContent()).toBe('<span>new & safe</span>\n');
  await expect(page.locator('.source-code span')).toHaveCount(0);
  await drop(page, 'after', file('dropped.pdf', 'invalid'));
  await expect(status).toHaveText('Could not open file');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('.source-cell[data-side=after] .source-code')).toContainText('new & safe');
  await page.locator('#rendered-view').click();
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('new & safe');
  await drop(page, 'before', [file('deep.md', '<div>'.repeat(110) + 'deep' + '</div>'.repeat(110)), file('safe.md', 'safe')]);
  await expect(status).toHaveText('Comparison stopped');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toHaveText('This document is nested more than 100 levels deep. Your text is open for editing. Fix it and choose Rendered or Source, or drop another file.');
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'deep.md');
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'safe.md');
  await page.locator('#clear').click();
  await expect(status).toHaveText('Ready when you are');
  await expect(page.locator('#stats')).toBeHidden();
  await expect(page.locator('#comparison')).toBeEmpty();
});

test('filenames, theme, paged lists and code retain content and layout in both directions', async ({ page }) => {
  const name = `${'long-project-name-'.repeat(20)}.md`;
  const entries = Array.from({ length: 120 }, (_, i) => `Entry ${i} ${'wrapping words '.repeat(8)}`.trimEnd());
  const list = entries.map((entry, i) => `${i + 7}. ${entry}`);
  const changed = [...list];
  changed.splice(42, 0, '49. Inserted item with unequal wrapping');
  const lines = Array.from({ length: 240 }, (_, i) => `line ${i} old value`);
  const before = `${list.join('\n')}\n\n${fence(lines)}`;
  await drop(page, 'before', [file(name, before), file('right.md', `${changed.join('\n')}\n\n${fence(lines).replace('line 150 old', 'line 150 new')}`)]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  const listRow = page.locator('.pair-row:has(ol)');
  await listRow.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(listRow.locator('[data-side=before] li:not([data-gap])').first()).toHaveAttribute('value', '106');
  expect(await listRow.locator('[data-side=before] li:not([data-gap])').allTextContents()).toEqual(entries.slice(99));
  await listRow.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(listRow.locator('[data-side=before] li').first()).toHaveAttribute('value', '7');
  await expect(listRow.locator('[data-side=before] li[data-gap]')).toHaveCount(1);
  const codeRow = page.locator('.pair-row:has(pre)');
  await expect(codeRow.locator('[data-side=before] code')).toHaveText(lines.slice(0, 100).join('\n') + '\n');
  await codeRow.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await codeRow.locator('[data-side=after] code').textContent()).toBe(lines.slice(100, 200).join('\n').replace('line 150 old', 'line 150 new') + '\n');
  await codeRow.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(codeRow.locator('[data-side=before] code')).toHaveText(lines.slice(0, 100).join('\n') + '\n');
  await page.setViewportSize({ width: 320, height: 800 });
  const summary = page.locator('#before-name summary');
  await expect(summary).toHaveAttribute('tabindex', '0');
  expect(await summary.textContent()).toBe(name);
  await summary.focus();
  await summary.press('Enter');
  await expect(page.locator('#before-name')).toHaveAttribute('open', '');
  await page.locator('#source-view').click();
  await expect(page.locator('#before-name')).toHaveAttribute('open', '');
  await page.locator('#rendered-view').click();
  await expect(page.locator('#before-name')).toHaveAttribute('open', '');
  await summary.click();
  await expect(page.locator('#before-name')).not.toHaveAttribute('open');
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.evaluate(() => globalThis.scrollTo(0, 700));
  const scroll = await page.evaluate(() => globalThis.scrollY);
  await page.locator('#source-view').click();
  await expect(page.locator('.source-view')).toBeVisible();
  await expect.poll(async () => (await page.locator('.source-cell[data-side=before] .source-code').allTextContents()).join('')).toBe(before);
  await page.locator('#rendered-view').click();
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeCloseTo(scroll, 0);
});

test('deferred native reads preserve independent sides and reject stale reads after replace, Clear, and Swap', async ({ page }) => {
  await holdReads(page);
  await drop(page, 'before', file('hold-left.md', 'independent left'));
  await expect(page.locator('#status')).toHaveText('Reading files…');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'true');
  await drop(page, 'after', file('hold-right.md', 'independent right'));
  await expect.poll(() => page.evaluate(() => globalThis.pendingReads())).toEqual(['hold-left.md', 'hold-right.md']);
  await page.evaluate(() => globalThis.releaseRead('hold-right.md'));
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'hold-right.md');
  await page.evaluate(() => globalThis.releaseRead('hold-left.md'));
  await expect(page.locator('#editor [data-side=before]')).toHaveValue('independent left');
  await expect(page.locator('#editor [data-side=after]')).toHaveValue('independent right');
  await page.locator('#rendered-view').click();
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('independent left');
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('independent right');
  await drop(page, 'before', file('hold-stale.md', 'obsolete left'));
  await drop(page, 'before', file('fresh.md', 'fresh left'));
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'fresh.md');
  await page.evaluate(() => globalThis.releaseRead('hold-stale.md'));
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('fresh left');
  await drop(page, 'after', file('hold-clear.md', 'obsolete clear'));
  await page.locator('#clear').click();
  await page.evaluate(() => globalThis.releaseRead('hold-clear.md'));
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#comparison')).toBeEmpty();
  await drop(page, 'before', [file('left.md', 'original left'), file('right.md', 'original right')]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await drop(page, 'before', file('hold-swap.md', 'obsolete swap'));
  await page.locator('#swap').click();
  await page.evaluate(() => globalThis.releaseRead('hold-swap.md'));
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('original right');
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('original left');
});

test('pasting outside the editor fills the original, then the changed side', async ({ page }) => {
  const paste = (text) => page.evaluate((value) => {
    const clipboardData = new globalThis.DataTransfer();
    clipboardData.setData('text/plain', value);
    globalThis.document.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await page.evaluate(() => globalThis.document.activeElement.blur());
  await paste('# Title\n\nold words');
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'Pasted text.md');
  await paste('# Title\n\nnew words');
  await expect(page.locator('#editor [data-side=after]')).toHaveValue('# Title\n\nnew words');
  await page.locator('#rendered-view').click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('old');
  await expect(page.locator('.document-cell[data-side=after] ins')).toHaveText('new');
});

test('editing Source pauses the diff until a view is chosen, then marks the edited side', async ({ page }) => {
  await drop(page, 'before', [file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code', { hasText: 'new words' }).click();
  await expect(page.locator('#editor [data-side=after]')).toBeFocused();
  await expect(page.locator('#status')).toHaveText('Choose Rendered or Source to compare');
  await expect(page.locator('#stats')).toBeHidden();
  await page.keyboard.type('added ');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('.source-cell[data-side=after] ins').first()).toContainText('added');
  await expect(page.locator('#after-name')).toContainText('right.md (edited)');
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
});

test('the view switch shows Edit as its own mode and leaves it through Rendered or Source', async ({ page }) => {
  const pressed = () => page.locator('.view-switch [aria-pressed=true]').allTextContents();
  await drop(page, 'before', [file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(await pressed()).toEqual(['Rendered']);
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code', { hasText: 'new words' }).click();
  expect(await pressed()).toEqual(['Edit']);
  await page.locator('#rendered-view').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('.document-cell[data-side=after] ins')).toHaveText('new');
  expect(await pressed()).toEqual(['Rendered']);
  await page.locator('#edit-view').click();
  await expect(page.locator('#editor [data-side=after]')).toBeFocused();
  await expect(page.locator('#status')).toHaveText('Choose Rendered or Source to compare');
  expect(await pressed()).toEqual(['Edit']);
});

test('an untouched CRLF side stays unmarked while the other side is edited', async ({ page }) => {
  const original = '# Title\r\n\r\nsame line\r\n';
  await drop(page, 'before', [file('crlf.md', original), file('lf.md', '# Title\n\nsame line\n')]);
  await expect(page.locator('#status')).toHaveText(/Comparison ready|Same rendered content/);
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code', { hasText: 'same line' }).click();
  await page.keyboard.type('edited ');
  await page.locator('#source-view').click();
  await expect(page.locator('#after-name')).toContainText('(edited)');
  await expect(page.locator('#before-name')).not.toContainText('(edited)');
});

test('pastes and file reads while editing keep the drafts', async ({ page }) => {
  await holdReads(page);
  await drop(page, 'before', file('hold-early.md', 'early original'));
  await drop(page, 'after', file('right.md', 'changed text'));
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code').click();
  const draft = page.locator('#editor [data-side=after]');
  await releaseRead(page, 'hold-early.md');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'Original');
  expect(await draft.evaluate((textarea) => {
    const clipboardData = new globalThis.DataTransfer();
    clipboardData.setData('text/plain', 'pasted');
    return textarea.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  })).toBe(true);
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  await drop(page, 'before', file('bad.pdf', 'bad'));
  await expect(page.locator('#notice')).toContainText('Choose a .md');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(draft).toHaveValue('changed text');
  await drop(page, 'before', file('hold-new.md', 'new original'));
  await draft.evaluate((textarea) => { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); });
  await page.keyboard.type(' typed while reading');
  await releaseRead(page, 'hold-new.md');
  await expect(page.locator('#editor [data-side=before]')).toHaveValue('new original');
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'hold-new.md');
  await page.locator('#source-view').click();
  await expect(page.locator('.source-cell[data-side=after] .source-code')).toContainText('changed text typed while reading');
});

test('a failed comparison opens the editor to fix and retry, and empty documents can be edited', async ({ page }) => {
  const deep = '<div>'.repeat(110) + 'deep' + '</div>'.repeat(110);
  await drop(page, 'before', [file('deep.md', deep), file('safe.md', 'safe')]);
  await expect(page.locator('#status')).toHaveText('Comparison stopped');
  await expect(page.locator('#editor [data-side=before]')).toHaveValue(deep);
  await page.locator('#editor [data-side=before]').fill('shallow');
  await page.locator('#rendered-view').click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#before-name')).toContainText('deep.md (edited)');
  await drop(page, 'before', [file('a.md', ''), file('b.md', '')]);
  await expect(page.locator('#status')).toHaveText('Files are identical');
  await page.locator('#source-view').click();
  await page.locator('#comparison').click();
  await expect(page.locator('#editor')).toBeVisible();
});

test('the landing page starts in the editor, and one opened file waits for a view to be chosen', async ({ page }) => {
  await expect(page.locator('#editor [data-side=before]')).toBeFocused();
  await expect(page.locator('#example')).toBeVisible();
  await page.keyboard.type('# Title\n\nold words');
  await drop(page, 'after', file('right.md', '# Title\n\nnew words'));
  await expect(page.locator('#editor [data-side=after]')).toHaveValue('# Title\n\nnew words');
  await expect(page.locator('#comparison')).toBeHidden();
  await page.locator('#rendered-view').click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('old');
  await expect(page.locator('#example')).toBeHidden();
});


test('opening or closing an expandable section does the same on the other side', async ({ page }) => {
  const details = (open, body) => `<details${open ? ' open' : ''}>\n<summary>Configuration</summary>\n\n${body}\n\n</details>\n`;
  await drop(page, 'before', [file('left.md', details(false, 'old body')), file('right.md', details(true, 'new body'))]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  const left = page.locator('.document-cell[data-side=before] details');
  const right = page.locator('.document-cell[data-side=after] details');
  await expect(left).not.toHaveAttribute('open');
  await expect(right).toHaveAttribute('open', '');
  await left.locator('summary').click();
  await expect(left).toHaveAttribute('open', '');
  await expect(right).toHaveAttribute('open', '');
  await right.locator('summary').press('Enter');
  await expect(left).not.toHaveAttribute('open');
  await expect(right).not.toHaveAttribute('open');
  await page.goto('./example/');
  await page.locator('.document-cell[data-side=after] summary', { hasText: 'example configuration' }).click();
  await expect(page.locator('.document-cell[data-side=before] details')).toHaveAttribute('open', '');
  await expect(page.locator('.document-cell[data-side=before] details del').first()).toBeVisible();
});

test('the brand opens the GitHub repository in a new tab and is drawn from the favicon', async ({ page }) => {
  const brand = page.getByRole('link', { name: 'Markdown Diff on GitHub (opens in a new tab)' });
  await expect(brand).toHaveAttribute('href', 'https://github.com/bornio/markdown-diff');
  await expect(brand).toHaveAttribute('target', '_blank');
  const icon = await page.locator('link[rel=icon]').getAttribute('href');
  const response = await page.request.get(new URL(icon, page.url()).href);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  await expect.poll(() => brand.locator('use').evaluate((use) => use.getBBox().width)).toBeGreaterThan(0);
});

test('a GitHub link compares the latest two versions, and each filename picks another', async ({ page }) => {
  await mockGitHub(page);
  await page.goto(linkTo(REPO_LINK));
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(query(page)).toMatchObject({ a: sha(2), b: sha(3) });
  await expect(page.locator('#before-name')).toHaveText(/plan\.md\s*Feb 1/);
  await expect(page.locator('.document-cell[data-side=after] ins')).toHaveText('3');
  await page.locator('#before-name summary').click();
  const menu = page.getByRole('dialog', { name: 'Original version' });
  await expect(menu.getByRole('option')).toHaveText([/Plan, take 3\s*Latest\s*Changed/, /Plan, take 2\s*Original/, /Plan, take 1/]);
  await expect(menu.getByRole('option', { selected: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.locator('#before-name')).toHaveText(/Jan 1/);
  expect(query(page)).toMatchObject({ a: sha(1), b: sha(3) });
  await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('1');
  await page.goBack();
  await expect(page.locator('#before-name')).toHaveText(/Feb 1/);
  await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('2');
  await page.locator('#swap').click();
  expect(query(page)).toMatchObject({ a: sha(3), b: sha(2) });
  await page.locator('#after-name summary').click();
  await page.getByRole('option', { name: /Plan, take 3/ }).click();
  await expect(page.locator('#status')).toHaveText('Same version on both sides');
  await page.locator('#clear').click();
  expect(query(page)).toEqual({});
  await expect(page.locator('#github-form')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#status')).toHaveText('Same version on both sides');
});

test('a long history loads older versions into the open menu', async ({ page }) => {
  await mockGitHub(page, { paged: true });
  await page.goto(linkTo(REPO_LINK));
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await page.locator('#before-name summary').click();
  const menu = page.getByRole('dialog', { name: 'Original version' });
  await expect(menu.getByRole('option')).toHaveCount(2);
  await menu.getByRole('button', { name: 'Load older versions' }).click();
  await expect(menu.getByRole('option')).toHaveCount(3);
  await expect(menu.locator('.version-foot')).toHaveText('3 versions');
  await expect(menu.getByRole('option').last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#before-name')).toHaveText(/Jan 1/);
});

test('a gist compares the last change to its file, can switch files, and dims versions that leave a file alone', async ({ page }) => {
  await mockGitHub(page);
  await page.goto(linkTo(GIST_LINK));
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(query(page)).toMatchObject({ file: 'notes.md', a: sha(11), b: sha(13) });
  await page.locator('#before-name summary').click();
  const menu = page.getByRole('dialog', { name: 'Original version' });
  const unchanged = menu.getByRole('listbox', { name: 'Versions' }).getByRole('option').nth(1);
  await expect(unchanged).toHaveClass(/dim/);
  await expect(unchanged).toContainText('No change to notes.md');
  await expect(menu.getByRole('combobox', { name: 'File in this gist' }).locator('option')).toHaveText(['notes.md', 'todo.md']);
  await menu.getByRole('combobox', { name: 'File in this gist' }).selectOption('todo.md');
  await expect(page.locator('#notice')).toHaveText('todo.md has only one version, so everything shows as added.');
  expect(query(page)).toMatchObject({ file: 'todo.md', b: sha(12) });
  expect(query(page).a).toBeUndefined();
  await page.locator('#after-name summary').click();
  await page.getByRole('option', { name: /Jan 2/ }).click();
  await expect(page.locator('#notice')).toContainText("todo.md isn't in the Jan 2, ");
  await expect(page.locator('#after-name')).toHaveText(/not in Jan 2/);
});

test('GitHub links come from the form, a paste, or an empty editor box, and edits stay out of the page link', async ({ page }) => {
  await mockGitHub(page);
  await page.locator('#github-url').fill('github.com/o/r/tree/main');
  await page.locator('#github-url').press('Enter');
  await expect(page.locator('#github-url-error')).toBeVisible();
  await expect(page.locator('#github-url')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#github-url').fill('github.com/o/r/blob/main/docs/plan.md');
  await page.getByRole('button', { name: 'Load versions' }).click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  const before = page.url();
  await page.locator('#edit-view').click();
  await page.locator('#editor [data-side=after]').fill('# Plan\n\nTake 4.\n');
  await page.locator('#rendered-view').click();
  await expect(page.locator('#after-name')).toHaveText(/plan\.md \(edited\)/);
  await expect(page.locator('#notice')).toHaveText('The page link opens the GitHub versions, without your changes.');
  expect(page.url()).toBe(before);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#after-name summary').click();
  await page.getByRole('option', { name: /Plan, take 3/ }).click();
  await expect(page.locator('#after-name')).not.toHaveText(/edited/);
  await expect(page.locator('#notice')).toBeHidden();
  await page.locator('#clear').click();
  await page.evaluate((link) => {
    const data = new globalThis.DataTransfer();
    data.setData('text/plain', link);
    globalThis.document.querySelector('#editor [data-side=after]').dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, GIST_LINK);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(query(page).file).toBe('notes.md');
});

test('GitHub failures explain themselves and offer a retry only when one can help', async ({ page }) => {
  await mockGitHub(page, { fail: 'missing' });
  await page.goto(linkTo(REPO_LINK));
  await expect(page.locator('#status')).toHaveText('Could not load from GitHub');
  await expect(page.locator('#notice')).toHaveText("GitHub couldn't find that. Private repos can't be loaded.");
  await expect(page.locator('#github-url')).toHaveValue(REPO_LINK);
  await expect(page.locator('#github-url')).toBeFocused();
  await page.unrouteAll();
  await mockGitHub(page, { fail: 'limit' });
  await page.reload();
  await expect(page.locator('#notice')).toContainText("GitHub's hourly limit for your network is used up. Try again after");
  await expect(page.locator('#notice button')).toHaveCount(0);
  await page.unrouteAll();
  await mockGitHub(page, { fail: 'offline' });
  await page.reload();
  await expect(page.locator('#notice')).toContainText("Couldn't reach GitHub.");
  await page.unrouteAll();
  await mockGitHub(page);
  await page.locator('#notice').getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#notice')).toBeHidden();
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] });

  test('a GitHub filename opens a sheet of versions', async ({ page }) => {
    await mockGitHub(page);
    await page.goto(linkTo(REPO_LINK));
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    await page.locator('#before-name summary').tap();
    const sheet = page.getByRole('dialog', { name: 'Original version' });
    await expect(sheet).toBeVisible();
    await expect(page.locator('#file-sheet')).toBeHidden();
    await sheet.getByRole('option', { name: /Plan, take 1/ }).tap();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#before-name')).toHaveText(/Jan 1/);
    expect(query(page).a).toBe(sha(1));
  });

  test('a filename opens its file sheet to open, paste, save, or swap', async ({ page }) => {
    // Use the download fallback; real phones get the share sheet.
    await page.addInitScript(() => Object.defineProperty(globalThis.navigator, 'canShare', { value: undefined }));
    await page.goto('./');
    const sheet = page.locator('#file-sheet');
    await page.locator('#before-name summary').tap();
    await expect(sheet).toBeVisible();
    await expect(page.locator('#file-sheet-name')).toHaveText('No file yet');
    await expect(sheet.getByRole('button', { name: 'Save or share a copy' })).toBeHidden();
    await page.touchscreen.tap(195, 200);
    await expect(sheet).toBeHidden();
    await drop(page, 'before', [file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    await page.locator('#after-name summary').tap();
    await expect(sheet).toBeVisible();
    await expect(page.locator('#after-name')).not.toHaveAttribute('open');
    await expect(page.locator('#file-sheet-name')).toHaveText('right.md');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Open a file…' }).tap()]);
    await chooser.setFiles(file('phone.md', '# Title\n\nphone words\n'));
    await expect(page.locator('#after-name')).toHaveAttribute('title', 'phone.md');
    await expect(sheet).toBeHidden();
    await page.evaluate(() => globalThis.navigator.clipboard.writeText('# Title\n\npasted words\n'));
    await page.locator('#before-name summary').tap();
    await sheet.getByRole('button', { name: 'Paste from clipboard' }).tap();
    await expect(page.locator('#before-name')).toHaveAttribute('title', 'Pasted text.md');
    await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('pasted');
    await page.locator('#after-name summary').tap();
    const [saved] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Save or share a copy' }).tap()]);
    expect(saved.suggestedFilename()).toBe('phone.md');
    await page.locator('#after-name summary').tap();
    await sheet.getByRole('button', { name: 'Swap sides' }).tap();
    await expect(page.locator('#before-name')).toHaveAttribute('title', 'phone.md');
    await page.locator('#edit-view').tap();
    await expect(page.locator('#editor [data-side=after]')).toHaveCSS('font-size', '16px');
  });

  test('the file sheet saves the draft being edited, and opening it marks nothing as edited', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(globalThis.navigator, 'canShare', { value: undefined }));
    await page.goto('./');
    await drop(page, 'before', [file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    await page.locator('#edit-view').tap();
    const draft = page.locator('#editor [data-side=after]');
    await draft.fill('# Title\n\nnew words, typed\n');
    const sheet = page.locator('#file-sheet');
    await page.locator('#after-name summary').tap();
    await expect(page.locator('#file-sheet-name')).toHaveText('right.md');
    const [saved] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Save or share a copy' }).tap()]);
    expect(saved.suggestedFilename()).toBe('right.md');
    expect(await readFile(await saved.path(), 'utf8')).toBe('# Title\n\nnew words, typed\n');
    await page.locator('#after-name summary').tap();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await draft.fill('# Title\n\nnew words\n');
    await page.locator('#rendered-view').tap();
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    await expect(page.locator('#after-name')).toHaveText('right.md');
    await expect(page.locator('#before-name')).toHaveText('left.md');
  });

  test('the file sheet keeps keyboard focus inside until Escape returns it to the filename', async ({ page }) => {
    await drop(page, 'before', [file('left.md', 'old words'), file('right.md', 'new words')]);
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    const sheet = page.locator('#file-sheet');
    await page.locator('#after-name summary').tap();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Open a file…' })).toBeFocused();
    const focused = () => page.evaluate(() => {
      const active = globalThis.document.activeElement;
      return active === globalThis.document.body ? 'browser' : active.closest('#file-sheet') ? active.textContent : 'page';
    });
    const visited = [];
    for (let press = 0; press < 6; press++) {
      await page.keyboard.press('Tab');
      visited.push(await focused());
    }
    expect(visited).toEqual(['Paste from clipboard', 'Save or share a copy', 'Swap sides', 'browser', 'Open a file…', 'Paste from clipboard']);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('#after-name summary')).toBeFocused();
  });

  test('the filename row hides while scrolling down and returns on scroll up', async ({ page }) => {
    await page.goto('./example/');
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    const hidden = () => titleHidden(page);
    // Reads the row's offset right after the scroll event, before it settles.
    const scrollAndRead = async (y) => {
      await page.evaluate(async (top) => {
        const scrolled = new Promise((resolve) => globalThis.addEventListener('scroll', resolve, { once: true }));
        globalThis.scrollTo(0, top);
        await scrolled;
      }, y);
      return hidden();
    };
    const range = await page.locator('.comparison-title').evaluate((node) => node.offsetHeight);
    expect(await scrollAndRead(20)).toBe(20);
    for (let y = 80; y <= 600; y += 40) await scrollTo(page, y);
    await expect.poll(hidden).toBe(range);
    await expect(page.locator('#rendered-view')).toBeInViewport();
    expect(await scrollAndRead(585)).toBe(range - 15);
    await expect.poll(hidden).toBe(range);
    for (let y = 540; y >= 300; y -= 60) await scrollTo(page, y);
    await expect.poll(hidden).toBe(0);
    for (let y = 360; y <= 900; y += 60) await scrollTo(page, y);
    await expect.poll(hidden).toBe(range);
    await page.locator('#source-view').tap();
    await expect.poll(hidden).toBe(0);
  });

  test('a page turn lands just below the controls once the filename row has hidden', async ({ page }) => {
    const intro = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}.`).join('\n\n');
    const code = fence(Array.from({ length: 240 }, (_, i) => `line ${i} old value`));
    await drop(page, 'before', [file('left.md', `${intro}\n\n${code}`), file('right.md', `${intro}\n\n${code.replace('line 150 old', 'line 150 new')}`)]);
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    const range = await page.locator('.comparison-title').evaluate((node) => node.offsetHeight);
    await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollHeight - globalThis.innerHeight)).toBeGreaterThan(range * 4);
    const pager = page.locator('.pair-row:has(pre) .table-pager');
    const target = await pager.evaluate((node) => globalThis.scrollY + node.getBoundingClientRect().top - globalThis.innerHeight / 2);
    for (let y = 100; y < target; y += 100) await scrollTo(page, y);
    await scrollTo(page, target);
    await expect.poll(() => titleHidden(page)).toBe(range);
    await pager.getByRole('button', { name: 'Next', exact: true }).tap();
    await expect(pager.getByRole('status')).toHaveText('Part 2 of 3');
    const gap = () => page.evaluate(() => {
      const controls = globalThis.document.querySelector('.toolbar-controls').getBoundingClientRect();
      const pagerTop = globalThis.document.querySelector('.pair-row:has(pre) .table-pager').getBoundingClientRect().top;
      return pagerTop - controls.bottom;
    });
    await expect.poll(async () => Math.abs(await gap() - 8)).toBeLessThan(1.5);
    expect(await titleHidden(page)).toBe(range);
  });

  test('tabbing into the hidden filename row brings it back', async ({ page }) => {
    await page.goto('./example/');
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    for (let y = 80; y <= 600; y += 40) await scrollTo(page, y);
    const range = await page.locator('.comparison-title').evaluate((node) => node.offsetHeight);
    await expect.poll(() => titleHidden(page)).toBe(range);
    await page.locator('#theme-toggle').focus();
    await page.keyboard.press('Tab');
    const summary = page.locator('#before-name summary');
    await expect(summary).toBeFocused();
    await expect.poll(() => titleHidden(page)).toBe(0);
    const covered = await summary.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return !node.contains(globalThis.document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    });
    expect(covered).toBe(false);
  });
});

test.describe('on a touch phone in landscape', () => {
  test.use({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });

  test('the filename row scrolls away with the page and still opens the file sheet', async ({ page }) => {
    await page.goto('./example/');
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    for (let y = 40; y <= 600; y += 40) {
      await scrollTo(page, y);
      expect(await titleHidden(page)).toBe(0);
    }
    await expect.poll(() => titleHidden(page)).toBe(0);
    await scrollTo(page, 0);
    await page.locator('#after-name summary').tap();
    await expect(page.getByRole('dialog', { name: 'Changed' })).toBeVisible();
  });
});

test.describe('on a touch tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('a filename opens the file sheet, which can open a file', async ({ page }) => {
    await drop(page, 'before', [file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    await page.locator('#after-name summary').tap();
    const sheet = page.getByRole('dialog', { name: 'Changed' });
    await expect(sheet).toBeVisible();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), sheet.getByRole('button', { name: 'Open a file…' }).tap()]);
    await chooser.setFiles(file('tablet.md', '# Title\n\ntablet words\n'));
    await expect(page.locator('#after-name')).toHaveAttribute('title', 'tablet.md');
    await expect(page.locator('.document-cell[data-side=after] ins')).toHaveText('tablet');
  });
});
