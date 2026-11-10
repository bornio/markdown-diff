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
async function download(page, side) {
  const [saved] = await Promise.all([page.waitForEvent('download'), page.locator(`.file-download[data-side=${side}]`).click()]);
  return { name: saved.suggestedFilename(), text: await readFile(await saved.path(), 'utf8') };
}

test.beforeEach(async ({ page }) => { await page.goto('./'); });

test('file boundaries, status visibility, and actual Source survive success and read errors', async ({ page }) => {
  const status = page.locator('#status');
  await expect(status).toHaveText('Ready when you are');
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#stats')).toBeHidden();
  for (const input of ['before', 'after']) await expect(page.locator(`#${input}-input`)).toHaveAttribute('accept', '.md,.markdown,.txt,.mdx');
  await page.locator('#before-input').setInputFiles(file('bad.pdf', 'bad'));
  await expect(status).toHaveText('Could not open file');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#notice')).toContainText('Choose a .md, .markdown, .txt, or .mdx text file.');
  await page.locator('#before-input').setInputFiles(file('bad.md', Buffer.from([255])));
  await expect(page.locator('#notice')).toContainText('not a UTF-8 text file');
  await page.locator('#before-input').setInputFiles(file('binary.md', Buffer.from([0])));
  await expect(page.locator('#notice')).toContainText('binary.md looks like a binary file');
  await page.locator('#before-input').setInputFiles([file('left.md', '# Héllo 😀\n'), file('right.md', '# Héllo 😀\n')]);
  await expect(status).toHaveText('Files are identical');
  await page.locator('#before-input').setInputFiles([file('left.md', '**same**\n'), file('right.md', '__same__\n')]);
  await expect(status).toHaveText('Same rendered content');
  await expect(status).not.toHaveClass(/sr-only/);
  await page.locator('#source-view').click();
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('.source-code').last()).toHaveText('__same__\n');
  await page.locator('#after-input').setInputFiles(file('right.md', '<span>new & safe</span>\n'));
  await expect(status).toHaveText('Comparison ready');
  await expect(status).toHaveClass('sr-only');
  await expect(page.locator('#stats')).toBeVisible();
  expect(await page.locator('.source-cell[data-side=after] .source-code').textContent()).toBe('<span>new & safe</span>\n');
  await expect(page.locator('.source-code span')).toHaveCount(0);
  await page.evaluate(() => {
    const dataTransfer = new globalThis.DataTransfer();
    dataTransfer.items.add(new globalThis.File(['invalid'], 'dropped.pdf'));
    globalThis.document.querySelector('.file-bar[data-side=after]').dispatchEvent(new globalThis.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(status).toHaveText('Could not open file');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('.source-cell[data-side=after] .source-code')).toContainText('new & safe');
  await page.locator('#rendered-view').click();
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('new & safe');
  await page.locator('#before-input').setInputFiles([file('deep.md', '<div>'.repeat(110) + 'deep' + '</div>'.repeat(110)), file('safe.md', 'safe')]);
  await expect(status).toHaveText('Comparison stopped');
  await expect(status).not.toHaveClass(/sr-only/);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toHaveText('This document is nested more than 100 levels deep. Your text is open for editing. Fix it and press Compare, or choose another file.');
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
  await page.locator('#before-input').setInputFiles([file(name, before), file('right.md', `${changed.join('\n')}\n\n${fence(lines).replace('line 150 old', 'line 150 new')}`)]);
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
  await page.locator('#before-input').setInputFiles(file('hold-left.md', 'independent left'));
  await expect(page.locator('#status')).toHaveText('Reading files…');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#after-input').setInputFiles(file('hold-right.md', 'independent right'));
  await expect.poll(() => page.evaluate(() => globalThis.pendingReads())).toEqual(['hold-left.md', 'hold-right.md']);
  await page.evaluate(() => globalThis.releaseRead('hold-right.md'));
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'hold-right.md');
  await page.evaluate(() => globalThis.releaseRead('hold-left.md'));
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('independent left');
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('independent right');
  await page.locator('#before-input').setInputFiles(file('hold-stale.md', 'obsolete left'));
  await page.locator('#before-input').setInputFiles(file('fresh.md', 'fresh left'));
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'fresh.md');
  await page.evaluate(() => globalThis.releaseRead('hold-stale.md'));
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('fresh left');
  await page.locator('#after-input').setInputFiles(file('hold-clear.md', 'obsolete clear'));
  await page.locator('#clear').click();
  await page.evaluate(() => globalThis.releaseRead('hold-clear.md'));
  await expect(page.locator('#status')).toHaveText('Ready when you are');
  await expect(page.locator('#comparison')).toBeEmpty();
  await page.locator('#before-input').setInputFiles([file('left.md', 'original left'), file('right.md', 'original right')]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await page.locator('#before-input').setInputFiles(file('hold-swap.md', 'obsolete swap'));
  await page.locator('#swap').click();
  await page.evaluate(() => globalThis.releaseRead('hold-swap.md'));
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('original right');
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('original left');
});

test('pasted text fills the original, then the changed side', async ({ page }) => {
  const paste = (text) => page.evaluate((value) => {
    const clipboardData = new globalThis.DataTransfer();
    clipboardData.setData('text/plain', value);
    globalThis.document.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, text);
  await paste('# Title\n\nold words');
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'Pasted text.md');
  await paste('# Title\n\nnew words');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=before] del')).toHaveText('old');
  await expect(page.locator('.document-cell[data-side=after] ins')).toHaveText('new');
});

test('editing Source pauses the diff until Compare, then marks and downloads the edited side', async ({ page }) => {
  await page.locator('#before-input').setInputFiles([file('left.md', '# Title\n\nold words\n'), file('right.md', '# Title\n\nnew words\n')]);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code', { hasText: 'new words' }).click();
  await expect(page.locator('#editor [data-side=after]')).toBeFocused();
  await expect(page.locator('#status')).toHaveText('Edits not compared');
  await expect(page.locator('#stats')).toBeHidden();
  await page.keyboard.type('added ');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('.source-cell[data-side=after] ins').first()).toContainText('added');
  await expect(page.locator('#after-name')).toContainText('right.md (edited)');
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  expect(await download(page, 'after')).toEqual({ name: 'right.md', text: '# Title\n\nadded new words\n' });
});

test('an untouched CRLF side downloads byte-identical while the other side is edited', async ({ page }) => {
  const original = '# Title\r\n\r\nsame line\r\n';
  await page.locator('#before-input').setInputFiles([file('crlf.md', original), file('lf.md', '# Title\n\nsame line\n')]);
  await expect(page.locator('#status')).toHaveText(/Comparison ready|Same rendered content/);
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code', { hasText: 'same line' }).click();
  await page.keyboard.type('edited ');
  expect(await download(page, 'before')).toEqual({ name: 'crlf.md', text: original });
  expect(await download(page, 'after')).toEqual({ name: 'lf.md', text: '# Title\n\nedited same line\n' });
  await page.locator('#compare-edits').click();
  await expect(page.locator('#after-name')).toContainText('(edited)');
  await expect(page.locator('#before-name')).not.toContainText('(edited)');
});

test('pastes and file reads while editing keep the drafts', async ({ page }) => {
  await holdReads(page);
  await page.locator('#before-input').setInputFiles(file('hold-early.md', 'early original'));
  await page.locator('#after-input').setInputFiles(file('right.md', 'changed text'));
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#source-view').click();
  await page.locator('.source-cell[data-side=after] .source-code').click();
  const draft = page.locator('#editor [data-side=after]');
  await releaseRead(page, 'hold-early.md');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'Empty document');
  expect(await draft.evaluate((textarea) => {
    const clipboardData = new globalThis.DataTransfer();
    clipboardData.setData('text/plain', 'pasted');
    return textarea.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  })).toBe(true);
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  await page.locator('#before-input').setInputFiles(file('bad.pdf', 'bad'));
  await expect(page.locator('#notice')).toContainText('Choose a .md');
  await expect(page.locator('#editor')).toBeVisible();
  await expect(draft).toHaveValue('changed text');
  await page.locator('#before-input').setInputFiles(file('hold-new.md', 'new original'));
  await draft.evaluate((textarea) => { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); });
  await page.keyboard.type(' typed while reading');
  await releaseRead(page, 'hold-new.md');
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'hold-new.md');
  await expect(page.locator('.source-cell[data-side=after] .source-code')).toContainText('changed text typed while reading');
});

test('a failed comparison opens the editor to fix and retry, and empty documents can be edited', async ({ page }) => {
  const deep = '<div>'.repeat(110) + 'deep' + '</div>'.repeat(110);
  await page.locator('#before-input').setInputFiles([file('deep.md', deep), file('safe.md', 'safe')]);
  await expect(page.locator('#status')).toHaveText('Comparison stopped');
  await expect(page.locator('#editor [data-side=before]')).toHaveValue(deep);
  await page.locator('#editor [data-side=before]').fill('shallow');
  await page.locator('#compare-edits').click();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#before-name')).toContainText('deep.md (edited)');
  await page.locator('#before-input').setInputFiles([file('a.md', ''), file('b.md', '')]);
  await expect(page.locator('#status')).toHaveText('Files are identical');
  await page.locator('#source-view').click();
  await page.locator('#comparison').click();
  await expect(page.locator('#editor')).toBeVisible();
});

