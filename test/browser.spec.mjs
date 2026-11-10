import { test, expect } from '@playwright/test';

const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const fence = (lines) => `\`\`\`txt\n${lines.join('\n')}\n\`\`\``;
const failures = new WeakMap();

test.beforeEach(async ({ page, baseURL }) => {
  const errors = [];
  failures.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(baseURL) && request.url().includes('/assets/') && request.failure().errorText !== 'net::ERR_ABORTED') errors.push(request.url());
  });
  page.on('response', (response) => {
    if (response.url().startsWith(baseURL) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

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
  for (let control = 0; control < 32; control++) {
    if ([9, 10, 13].includes(control)) continue;
    await page.locator('#before-input').setInputFiles(file(`binary-${control}.md`, Buffer.from([control])));
    await expect(page.locator('#notice')).toContainText(`binary-${control}.md looks like a binary file`);
  }
  for (const extension of ['md', 'markdown', 'txt', 'mdx', 'MD']) {
    await page.locator('#before-input').setInputFiles([file(`left.${extension}`, '\ufeff# Héllo 😀\t\r\n'), file(`right.${extension}`, '\ufeff# Héllo 😀\t\r\n')]);
    await expect(status).toHaveText('Files are identical');
    await expect(status).not.toHaveClass(/sr-only/);
    await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  }
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
  await expect(page.locator('#notice')).toHaveText('This document is nested more than 100 levels deep. Your selected files are kept. Choose another file or try swapping the sides.');
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
  await summary.click();
  await expect(page.locator('#before-name')).not.toHaveAttribute('open');
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await listRow.scrollIntoViewIfNeeded();
  await expect.poll(() => listRow.evaluate((row) => {
    const pairs = new Map();
    for (const node of row.querySelectorAll('li[data-pair]')) {
      const height = node.getBoundingClientRect().height;
      const previous = pairs.get(node.dataset.pair);
      if (previous !== undefined && Math.abs(previous - height) > 1) return false;
      pairs.set(node.dataset.pair, height);
    }
    return pairs.size > 0 && parseFloat(row.style.containIntrinsicBlockSize.split(' ').at(-1)) > 0;
  })).toBe(true);
  await page.evaluate(() => globalThis.scrollTo(0, 700));
  const scroll = await page.evaluate(() => globalThis.scrollY);
  await page.locator('#source-view').click();
  await expect(page.locator('.source-view')).toBeVisible();
  await expect.poll(async () => (await page.locator('.source-cell[data-side=before] .source-code').allTextContents()).join('')).toBe(before);
  await page.locator('#rendered-view').click();
  await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeCloseTo(scroll, 0);
});

test('deferred native reads preserve independent sides and reject stale reads after replace, Clear, and Swap', async ({ page }) => {
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

test('the real worker timeout keeps selected files without waiting twelve real seconds', async ({ page }) => {
  let release;
  await page.route('**/assets/compare.worker-*.js', async (route) => {
    await new Promise((resolve) => { release = resolve; });
    await route.continue();
  });
  await page.clock.install();
  await page.locator('#before-input').setInputFiles([file('left.md', 'kept left'), file('right.md', 'kept right')]);
  await expect(page.locator('#status')).toHaveText('Comparing files…');
  await expect.poll(() => typeof release).toBe('function');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(12001);
  await expect(page.locator('#status')).toHaveText('Comparison stopped');
  await expect(page.locator('#status')).not.toHaveClass(/sr-only/);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#notice')).toContainText('Your selected files are kept');
  await expect(page.locator('#before-name')).toHaveAttribute('title', 'left.md');
  await expect(page.locator('#after-name')).toHaveAttribute('title', 'right.md');
  release();
  await page.unrouteAll({ behavior: 'wait' });
  await page.locator('#swap').click();
  await expect(page.locator('.document-cell[data-side=before]')).toHaveText('kept right');
  await expect(page.locator('.document-cell[data-side=after]')).toHaveText('kept left');
});

test('tall fixed input bounds initial mounting and later append batches in each view', async ({ page }) => {
  await page.evaluate(() => {
    globalThis.appendBatches = { rendered: [], source: [] };
    new globalThis.MutationObserver((records) => {
      for (const record of records) {
        const rows = [...record.addedNodes].filter((node) => node.nodeType === 1 && node.matches('.pair-row'));
        if (rows.length) globalThis.appendBatches[record.target.classList.contains('source-view') ? 'source' : 'rendered'].push(rows.length);
      }
    }).observe(globalThis.document.querySelector('#comparison'), { childList: true, subtree: true });
  });
  const corpus = Array.from({ length: 300 }, (_, i) => `Section ${i}\n\n${Array.from({ length: 12 }, (_, j) => `Tall ${i} line ${j}  `).join('\n')}`).join('\n\n');
  await page.locator('#before-input').setInputFiles([file('left.md', corpus), file('right.md', corpus.replace('Tall 150 line 4', 'Edited 150 line 4'))]);
  await expect(page.locator('.rendered-view .mount-progress')).toBeAttached();
  expect(await page.locator('.rendered-view .pair-row').count()).toBe(120);
  await page.locator('.rendered-view .mount-progress').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.rendered-view .pair-row').count()).toBeGreaterThan(120);
  expect(await page.locator('.rendered-view .pair-row').count()).toBeLessThanOrEqual(240);
  await page.locator('#source-view').click();
  await expect(page.locator('.source-view .mount-progress')).toBeAttached();
  expect(await page.locator('.source-view .pair-row').count()).toBe(400);
  await page.locator('.source-view .mount-progress').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.source-view .pair-row').count()).toBeGreaterThan(400);
  expect(await page.locator('.source-view .pair-row').count()).toBeLessThanOrEqual(800);
  const batches = await page.evaluate(() => globalThis.appendBatches);
  expect(batches.rendered.length).toBeGreaterThan(1);
  expect(batches.source.length).toBeGreaterThan(1);
  expect(Math.max(...batches.rendered)).toBeLessThanOrEqual(12);
  expect(Math.max(...batches.source)).toBeLessThanOrEqual(80);
});
