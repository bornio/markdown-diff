import { chromium, test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { document, extensionHost } from './helpers/vscode-host.mjs';
import { fixture, sampleContrast, interactiveContrast } from './helpers/vscode-contrast.cjs';

const before = '# Plan\n\n| Item | State |\n| --- | --- |\n| Build | Planned |\n\nA **strong** word.\n\n![Old image](https://example.com/old.png)\n\n[Guide](https://example.com/guide) [Relative](next.md) [Command](command:workbench.action.closeWindow)\n';
const after = before.replace('Planned', 'Done').replace('**strong**', '*strong*').replace('Old image', 'New image').replace('old.png', 'new.png');

async function openPreview(page, texts = [before, after], ready = true, { allowImages = false, theme } = {}) {
  let capture = 0;
  const documents = [document('before.md', texts[0]), document('after.md', texts[1], { isDirty: true, version: 2 })];
  const host = extensionHost(...documents, { now: () => Date.UTC(2025, 0, 1, 0, 0, capture++) });
  await host.run();
  const panel = host.panels[0];
  const state = panel.messages.findLast(message => message.type === 'state');
  await page.route('https://assets.test/**', async (route) => {
    const filename = new URL(route.request().url()).pathname.slice(1);
    if (filename === 'vscode-themes.css') return route.fulfill({ body: await readFile(new URL('./fixtures/vscode-themes.css', import.meta.url)), contentType: 'text/css' });
    if (!['webview.js', 'webview.css'].includes(filename)) return route.abort();
    await route.fulfill({ body: await readFile(new URL(`../vscode/dist/${filename}`, import.meta.url)), contentType: filename.endsWith('css') ? 'text/css' : 'text/javascript' });
  });
  await page.exposeFunction('sendToHost', message => panel.receive(message));
  const post = panel.webview.postMessage;
  panel.webview.postMessage = async message => {
    await post(message);
    await page.evaluate(message => window.postMessage(message, '*'), message).catch(() => {});
    return true;
  };
  await page.addInitScript(() => {
    window.messages = [];
    window.acquireVsCodeApi = () => ({
      getState: () => {
        const next = sessionStorage.getItem('preview-next-state');
        sessionStorage.removeItem('preview-next-state');
        window.loadedPreviewState = JSON.parse(next || sessionStorage.getItem('preview-state') || 'null') || {};
        return window.loadedPreviewState;
      },
      setState: (value) => { window.saved = value; sessionStorage.setItem('preview-state', JSON.stringify(value)); },
      postMessage: (message) => {
        window.messages.push(message);
        window.hostSettled = window.sendToHost(message);
      },
    });
  });
  await page.route('https://preview.test/', (route) => {
    let html = allowImages ? panel.webview.html.replace("img-src 'none'", 'img-src https:') : panel.webview.html;
    if (theme) html = html.replace('<html lang="en">', `<html lang="en" data-vscode-theme-id="${theme.id}">`).replace('<body>', `<body class="${theme.kind}">`).replace('<link rel="stylesheet"', '<link rel="stylesheet" href="https://assets.test/vscode-themes.css"><link rel="stylesheet"');
    return route.fulfill({ body: html, contentType: 'text/html' });
  });
  await page.goto('https://preview.test/');
  if (ready) await expect(page.locator('#status')).toHaveText('Comparison ready');
  if (ready) await page.evaluate(() => window.hostSettled);
  const refresh = async (texts) => {
    for (let i = 0; i < texts.length; i++) host.documents.set(documents[i].uri.toString(), document(i ? 'after.md' : 'before.md', texts[i], { version: capture + 1 }));
    await panel.receive({ type: 'refresh' });
  };
  return { host, panel, state, refresh };
}

for (const theme of [
  { id: 'Default High Contrast Light', kind: 'vscode-high-contrast-light' },
  { id: 'Quiet Light', kind: 'vscode-light' },
  { id: 'Solarized Light', kind: 'vscode-light' },
  { id: 'Abyss', kind: 'vscode-dark' },
]) {
  test(`native ${theme.id} styles keep rendered text and enabled pagination readable`, async ({ page }) => {
    const texts = fixture();
    await openPreview(page, [texts.before, texts.after], true, { theme });
    await expect(page.locator('#notice')).toContainText('A table with merged cells');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeEnabled();
    const { samples, failures, nonText, nonTextFailures } = await page.evaluate(sampleContrast);
    expect(samples.some(sample => sample.code && !sample.quote && !sample.edit && !sample.change)).toBe(true);
    for (const edit of ['add', 'remove']) {
      expect(samples.some(sample => sample.code && sample.edit === edit)).toBe(true);
      expect(samples.some(sample => sample.code && sample.change === edit)).toBe(true);
      for (const tag of ['A', 'H3', 'TH', 'SUMMARY']) expect(samples.some(sample => sample.tag === tag && sample.change === edit)).toBe(true);
    }
    expect(samples.some(sample => sample.code && sample.quote)).toBe(true);
    expect(samples.some(sample => sample.text === 'Next')).toBe(true);
    expect(failures.length, JSON.stringify(failures.slice(0, 3), null, 2)).toBe(0);
    if (theme.id === 'Abyss') {
      expect(await page.locator('body').evaluate(element => getComputedStyle(element).color)).toBe('rgb(102, 136, 204)');
      expect(await page.locator('#snapshot-label').evaluate(element => getComputedStyle(element).color)).not.toBe('rgb(102, 136, 204)');
    }
    expect(await page.locator('.document-cell a[href="https://example.test/code"] code').first().evaluate(element => getComputedStyle(element).color === getComputedStyle(element.parentElement).color)).toBe(true);
    expect(nonText.some(sample => sample.kind === 'task-checkmark')).toBe(true);
    expect(nonTextFailures, JSON.stringify(nonTextFailures.slice(0, 3), null, 2)).toEqual([]);
    const interactions = await interactiveContrast(page, page);
    for (const state of interactions) {
      expect(state.failures, `${theme.id} ${state.state} ${state.target}`).toEqual([]);
      expect(state.nonTextFailures, `${theme.id} ${state.state} ${state.target}`).toEqual([]);
      if (state.state === 'keyboard-focus') expect(state.nonText.some(sample => sample.kind === 'focus-ring')).toBe(true);
    }
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Rows 101' })).toContainText('Rows 101');
  });
}

test('the bundled renderer keeps image and link policies while Source opens the original native pair', async ({ page }) => {
  const failures = [];
  const requests = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => { if (request.url().startsWith('https://example.com/')) requests.push(request.url()); });
  const { host, panel } = await openPreview(page);
  await expect(page.locator('.document-cell[data-side=before] table')).toContainText('Planned');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('[data-format-change]').first()).toBeAttached();
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('.image-placeholder')).toHaveCount(2);
  await expect(page.locator('#after-label')).toContainText('unsaved changes');
  await expect(page.getByRole('link', { name: 'Relative' })).toHaveCount(0);
  await expect(page.locator('a').filter({ hasText: 'Command' }).first()).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('link', { name: 'Guide', exact: true }).first().click();
  expect(await page.evaluate(() => window.messages.at(-1))).toEqual({ type: 'openExternal', url: 'https://example.com/guide' });
  await page.getByRole('button', { name: 'Open live Source diff', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.hostSettled);
  expect(host.executions[0].slice(0, 4).map(value => typeof value === 'object' ? value.toString() : value)).toEqual([
    'vscode.diff', 'file:///workspace/before.md', 'file:///workspace/after.md', 'README.md (Working Tree)',
  ]);
  await expect(page.locator('.source-row, .source-cell, #source-view, #rendered-view')).toHaveCount(0);
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  expect(panel.messages.filter(message => message.type === 'state' && message.status === 'reading')).toHaveLength(1);
  expect(requests).toEqual([]);
  expect(failures).toEqual([]);
});

test('task checkboxes name their own rich text without nested task labels and preserve selection', async ({ page }) => {
  const text = '- [ ] Tight **parent** with `code`\n  1. [x] Tight child\n  2. [ ] Second child\n\n---\n\n- [x] Loose *parent*\n\n  Context paragraph.\n\n  - [ ] Loose child\n';
  const withUnnamedCheckbox = text + '\n<input type="checkbox">\n';
  await openPreview(page, [withUnnamedCheckbox, withUnnamedCheckbox.replace('- [ ] Tight', '- [x] Tight').replace('- [ ] Loose child', '- [x] Loose child')]);
  const names = ['Tight parent with code', 'Tight child', 'Second child', 'Loose parent', 'Loose child', 'Task item'];
  for (const side of ['before', 'after']) {
    const cells = page.locator(`.document-cell[data-side=${side}]`);
    const checkboxes = cells.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(names.length);
    for (let i = 0; i < names.length; i++) {
      await expect(checkboxes.nth(i)).toHaveAccessibleName(names[i]);
      await expect(checkboxes.nth(i)).toBeDisabled();
      await expect(checkboxes.nth(i)).toBeChecked({ checked: i === 1 || i === 3 || side === 'after' && (i === 0 || i === 4) });
    }
    await expect(cells.locator('strong')).toHaveText('parent');
    await expect(cells.locator('code')).toHaveText('code');
    await expect(cells.locator('em')).toHaveText('parent');
  }
  const selection = await page.locator('.document-cell[data-side=before] li').first().evaluate(item => {
    const range = document.createRange();
    range.selectNodeContents(item);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    return getSelection().toString();
  });
  for (const name of names.slice(0, 3)) expect(selection).toContain(name);
});

test('task names include image descriptions but exclude following code and quotes', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('https://example.invalid/')) requests.push(request.url()); });
  const text = [
    '- [ ] ![Deploy release](https://example.invalid/deploy.png)',
    '- [ ] **![Nested release](https://example.invalid/nested.png)**',
    '- [ ] Review ![rocket](https://example.invalid/rocket.png) now',
    '', '---', '',
    '- [ ] Code task', '  ```text', '  Unrelated code', '  ```',
    '- [ ] Quote task', '  > Unrelated quote', '',
  ].join('\n');
  await openPreview(page, [text, text + '\nA changed ending.']);
  for (const side of ['before', 'after']) {
    const cells = page.locator(`.document-cell[data-side=${side}]`);
    const checkboxes = cells.getByRole('checkbox');
    const names = ['Deploy release', 'Nested release', 'Review rocket now', 'Code task', 'Quote task'];
    await expect(checkboxes).toHaveCount(names.length);
    for (let i = 0; i < names.length; i++) {
      await expect(checkboxes.nth(i)).toHaveAccessibleName(names[i]);
      await expect(checkboxes.nth(i)).toBeDisabled();
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
    await expect(cells.locator('pre')).toHaveText('Unrelated code\n');
    await expect(cells.locator('blockquote')).toHaveText('Unrelated quote');
    await expect(cells.locator('.image-placeholder')).toHaveCount(3);
  }
  expect(requests).toEqual([]);
});

test('read failures preserve the displayed snapshot and Refresh stays bound to the host', async ({ page }) => {
  const { host, panel } = await openPreview(page);
  host.documents.delete([...host.documents.keys()][0]);
  await panel.receive({ type: 'refresh' });
  await expect(page.locator('#notice')).toContainText('Refresh failed');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'refresh').length)).toBe(1);
});

test('inert image preparation prevents requests independently of CSP, including later pages', async ({ page }) => {
  const requests = [];
  await page.route('https://example.com/**', route => { requests.push(route.request().url()); return route.abort(); });
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}${i === 219 ? ' ![Late image](https://example.com/late.png) [Inactive](command:workbench.action.closeWindow)' : ''}`).join('\n');
  await openPreview(page, [text, text.replace('late.png', 'new.png')], true, { allowImages: true });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.image-placeholder')).toHaveCount(2);
  await expect(page.locator('.image-placeholder').first()).toContainText('Image not loaded');
  await expect(page.locator('a').filter({ hasText: 'Inactive' }).first()).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(requests).toEqual([]);
});

test('large lists retain pagination, and narrow high-contrast mode keeps keyboard controls usable', async ({ page }) => {
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}`).join('\n');
  await openPreview(page, [text, text.replace('Item 220', 'Updated 220')]);
  await page.setViewportSize({ width: 440, height: 780 });
  await page.evaluate(() => document.body.classList.add('vscode-high-contrast'));
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Rows 101' })).toContainText('Rows 101');
  await page.keyboard.press('Enter');
  await expect(page.locator('.document-cell[data-side=after]')).toContainText('Updated 220');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a replaced snapshot discards old work and identical content has an explicit status', async ({ page }) => {
  const { state, refresh } = await openPreview(page);
  await refresh(['# Identical', '# Identical']);
  await expect(page.locator('#status')).toHaveText('Files are identical');
  await expect(page.locator('.document-cell[data-side=after] h1')).toHaveText('Identical');
  await page.evaluate((state) => window.postMessage(state, '*'), state);
  await expect(page.locator('.document-cell[data-side=after] h1')).toHaveText('Identical');
});

test('a comparison failure keeps the last successful result and its provenance visible', async ({ page }) => {
  const { refresh } = await openPreview(page);
  const label = await page.locator('#snapshot-label').textContent();
  await refresh([before, '> '.repeat(110) + 'too deeply nested']);
  await expect(page.locator('#notice')).toContainText('The previous snapshot is still shown.');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#after-label')).toContainText('after.md');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
});

test('an initial parser failure stops and permits Refresh without an automatic retry loop', async ({ page }) => {
  await openPreview(page, ['# Baseline', '> '.repeat(110) + 'too deeply nested'], false);
  await expect(page.locator('#notice')).toContainText('nested more than 100 levels');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(await page.evaluate(() => window.messages.filter((message) => message.type === 'comparisonFailed').length)).toBe(1);
});

test('a recreated preview restores the last good input when the new comparison fails', async ({ page }) => {
  const { refresh, panel } = await openPreview(page);
  const label = await page.locator('#snapshot-label').textContent();
  await page.goto('about:blank');
  await refresh([before, '> '.repeat(110) + 'too deeply nested']);
  await page.goto('https://preview.test/');
  await expect(page.locator('#notice')).toContainText('The previous snapshot is still shown.');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await panel.receive({ type: 'ready' });
  expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(1);
});

for (const failedRow of [0, 24]) {
  test(`a DOM failure in row ${failedRow + 1} restores content and provenance before confirming success`, async ({ page }) => {
    const { refresh, panel } = await openPreview(page);
    const label = await page.locator('#snapshot-label').textContent();
    await page.evaluate(marker => {
      const append = Element.prototype.append;
      window.injectedFailure = null;
      Element.prototype.append = function (...nodes) {
        if (!window.injectedFailure && this.classList.contains('pair-row') && nodes.some(node => node.textContent.includes(marker))) {
          window.injectedFailure = { mountedRows: document.querySelectorAll('#comparison .pair-row').length };
          throw new Error('Injected DOM presentation failure');
        }
        return append.apply(this, nodes);
      };
    }, `DOMFAIL_${failedRow}`);
    const baseline = Array.from({ length: 36 }, (_, i) => `Section ${i} baseline.`).join('\n\n');
    const candidate = Array.from({ length: 36 }, (_, i) => `Section ${i} ${i === failedRow ? `DOMFAIL_${i}` : 'updated'}.`).join('\n\n');
    await refresh([baseline, candidate]);
    await expect(page.locator('#notice')).toContainText('Injected DOM presentation failure');
    await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
    await expect(page.locator('#snapshot-label')).toHaveText(label);
    await expect(page.locator('#after-label')).toContainText('after.md');
    await expect(page.locator('#comparison')).not.toContainText('DOMFAIL_');
    await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
    const failure = await page.evaluate(() => window.injectedFailure);
    expect(failure).not.toBeNull();
    if (failedRow) expect(failure.mountedRows).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.messages.some(message => message.type === 'comparisonRendered' && message.captureId === 2))).toBe(false);
    await panel.receive({ type: 'ready' });
    expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(1);
    await page.reload();
    await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
    await expect(page.locator('#snapshot-label')).toHaveText(label);
    await expect(page.locator('#notice')).toContainText('Injected DOM presentation failure');
  });
}

test('a later page presentation failure returns to a usable first page', async ({ page }) => {
  const baseline = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}`).join('\n');
  const { panel } = await openPreview(page, [baseline, baseline.replace('Item 220', 'Updated 220')]);
  const label = await page.locator('#snapshot-label').textContent();
  await page.evaluate(() => {
    const append = Element.prototype.append;
    let failed = false;
    Element.prototype.append = function (...nodes) {
      if (!failed && this.classList.contains('document-cell') && nodes.some(node => node.textContent.includes('Item 101'))) {
        failed = true;
        throw new Error('Injected page presentation failure');
      }
      return append.apply(this, nodes);
    };
  });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Injected page presentation failure');
  await expect(page.getByRole('status').filter({ hasText: 'Rows 1' })).toContainText('Rows 1–100');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await panel.receive({ type: 'ready' });
  expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(1);
});

test('an initial alignment failure does not confirm the new snapshot', async ({ page }) => {
  const { refresh, panel } = await openPreview(page);
  const label = await page.locator('#snapshot-label').textContent();
  await page.evaluate(() => {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    let failed = false;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (!failed && this.matches('li[data-pair]') && this.textContent.includes('ALIGNMENT_CANDIDATE')) {
        failed = true;
        throw new Error('Injected alignment failure');
      }
      return measure.call(this);
    };
  });
  await refresh(['- ALIGNMENT_CANDIDATE before', '- ALIGNMENT_CANDIDATE after']);
  await expect(page.locator('#notice')).toContainText('Injected alignment failure');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
  await panel.receive({ type: 'ready' });
  expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(1);
});

test('a later scrolling batch failure restores the last mounted snapshot without retrying the failed rows', async ({ page }) => {
  const text = Array.from({ length: 200 }, (_, i) => `Section ${i} content${i === 150 ? ' SCROLL_FAILURE' : ''}.`).join('\n\n');
  await openPreview(page, [text, text.replace('Section 180', 'Updated 180')]);
  const label = await page.locator('#snapshot-label').textContent();
  await page.evaluate(() => {
    const append = Element.prototype.append;
    let failed = false;
    Element.prototype.append = function (...nodes) {
      if (!failed && this.classList.contains('pair-row') && nodes.some(node => node.textContent.includes('SCROLL_FAILURE'))) {
        failed = true;
        throw new Error('Injected scrolling presentation failure');
      }
      return append.apply(this, nodes);
    };
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(page.locator('#notice')).toContainText('Injected scrolling presentation failure');
  await expect(page.locator('#comparison')).toContainText('Section 0 content');
  await expect(page.locator('#comparison')).not.toContainText('SCROLL_FAILURE');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
});

test('a newer capture cancels a partially mounted candidate before it becomes remembered success', async ({ page }) => {
  const { refresh, host, panel } = await openPreview(page);
  await page.exposeFunction('supersedeCandidate', () => refresh(['# Final baseline', '# Final changed']));
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('#comparison').textContent.includes('CANDIDATE_2')) return;
      observer.disconnect();
      window.supersedeCandidate();
    });
    observer.observe(document.querySelector('#comparison'), { childList: true, subtree: true });
  });
  const text = Array.from({ length: 200 }, (_, i) => `CANDIDATE_2 section ${i}.`).join('\n\n');
  await refresh([text, text.replace('section 190', 'updated 190')]);
  await expect(page.locator('.document-cell[data-side=after] h1')).toHaveText('Final changed');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await page.evaluate(() => window.hostSettled);
  expect(await page.evaluate(() => window.messages.some(message => message.type === 'comparisonRendered' && message.captureId === 2))).toBe(false);
  host.documents.clear();
  await panel.receive({ type: 'refresh' });
  expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(3);
});

test('a failed rollback stops without retrying or claiming that a missing view is shown', async ({ page }) => {
  const { refresh, host } = await openPreview(page);
  await page.evaluate(() => {
    const append = Element.prototype.append;
    window.restoreAppend = () => { Element.prototype.append = append; };
    Element.prototype.append = function (...nodes) {
      if (this.classList.contains('pair-row')) throw new Error('Persistent DOM failure');
      return append.apply(this, nodes);
    };
  });
  await refresh(['# New baseline', '# New changed']);
  await expect(page.locator('#notice')).toContainText('The previous preview could not be restored.');
  await expect(page.locator('#notice')).not.toContainText('previous snapshot is still shown');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'comparisonFailed').length)).toBe(1);
  await page.evaluate(() => window.restoreAppend());
  host.documents.clear();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#notice')).toContainText('Refresh failed');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
});

test('an empty rendered comparison completes and can be restored after a failure', async ({ page }) => {
  const { refresh, panel } = await openPreview(page, ['', ''], false);
  await expect(page.locator('#status')).toHaveText('Files are identical');
  await page.evaluate(() => window.hostSettled);
  await refresh(['', '> '.repeat(110) + 'too deeply nested']);
  await expect(page.locator('#notice')).toContainText('previous snapshot is still shown');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await panel.receive({ type: 'ready' });
  expect(panel.messages.findLast(message => message.type === 'state').snapshot.captureId).toBe(1);
});

test('Refresh keeps keyboard focus and unchanged notices do not announce again when Source opens', async ({ page }) => {
  const { state } = await openPreview(page);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await refresh.focus();
  await refresh.press('Enter');
  await page.evaluate(state => window.postMessage({ ...state, status: 'reading', captureId: 2, snapshot: undefined }, '*'), state);
  await expect(refresh).toBeFocused();
  await page.evaluate(state => window.postMessage({ ...state, status: 'error', captureId: 2, snapshot: undefined, message: 'A retained warning.' }, '*'), state);
  await expect(page.locator('#notice')).toHaveText('A retained warning. The previous snapshot is still shown.');
  await page.evaluate(() => {
    window.noticeChanges = 0;
    new MutationObserver(records => { window.noticeChanges += records.length; }).observe(document.querySelector('#notice'), { childList: true, characterData: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  expect(await page.evaluate(() => window.noticeChanges)).toBe(0);
});

test('precision warnings are polite while read failures are urgent', async ({ page }) => {
  const { host, panel } = await openPreview(page, ['a '.repeat(10000), 'b '.repeat(10000)]);
  await expect(page.locator('#notice')).toContainText('work limit');
  await expect(page.locator('#notice')).toHaveAttribute('role', 'status');
  await expect(page.getByRole('alert')).toHaveCount(0);
  host.documents.clear();
  await panel.receive({ type: 'refresh' });
  await expect(page.getByRole('alert')).toContainText('Refresh failed');
});

test('only the compact action bar stays pinned in a narrow column', async ({ page }) => {
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i}`).join('\n');
  await page.setViewportSize({ width: 440, height: 400 });
  await openPreview(page, [text, text.replace('Item 220', 'Changed 220')]);
  const height = await page.locator('.extension-toolbar').evaluate(node => node.getBoundingClientRect().height);
  expect(height).toBeLessThan(80);
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect(page.locator('.extension-toolbar')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a nonzero rendered page survives a real preview reload', async ({ page }) => {
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}`).join('\n');
  await openPreview(page, [text, text.replace('Item 220', 'Updated 220')]);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.saved?.view?.rendered?.pages)).toEqual([[0, 2]]);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.getByRole('status').filter({ hasText: 'Rows 201' })).toContainText('Rows 201–230');
  await expect(page.locator('.document-cell[data-side=after]')).toContainText('Updated 220');
});

test('legacy Source mode and anchors are ignored and invalid rendered bookmarks do not apply', async ({ page }) => {
  const text = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
  await openPreview(page, [text, text.replace('Line 20', 'Changed 20')]);
  for (const saved of [
    { snapshotId: 1, mode: 'source', view: { source: { anchor: { row: 20, offset: 5 }, pages: [] } } },
    { snapshotId: 999, view: { rendered: { anchor: { row: 20, offset: 5 }, pages: [] } } },
    { snapshotId: 1, view: { rendered: { anchor: { row: '20', offset: null }, pages: [[0, -10], null, ['x', 999]] } } },
    { snapshotId: 999, mode: 'source', view: { source: { anchor: { row: 20, offset: 5 }, pages: [] } } },
    { snapshotId: 1, mode: 'source', view: { source: { anchor: { row: '20', offset: null }, pages: [[0, -10], null, ['x', 999]] } } },
  ]) {
    await page.evaluate(saved => sessionStorage.setItem('preview-next-state', JSON.stringify(saved)), saved);
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.document-cell').first()).toContainText('Line 0');
    await expect(page.locator('.source-row')).toHaveCount(0);
    expect(await page.evaluate(() => window.saved)).not.toHaveProperty('mode');
    expect(await page.evaluate(() => window.saved.view)).not.toHaveProperty('source');
  }
});

test('user navigation cancels an automatic deep bookmark jump while mounting', async ({ page }) => {
  const text = Array.from({ length: 1600 }, (_, i) => `Line ${i}`).join('\n\n');
  await openPreview(page, [text, text.replace('Line 1500', 'Changed 1500')]);
  await page.evaluate(() => sessionStorage.setItem('preview-next-state', JSON.stringify({ snapshotId: 1, view: { rendered: { anchor: { row: 1400, offset: 5 }, pages: [] } } })));
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.pair-row')) return;
      observer.disconnect();
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
      window.cancelledRestore = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(await page.evaluate(() => window.cancelledRestore)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(500);
  expect(await page.locator('.pair-row').count()).toBeLessThan(1400);
});

test('a failed confirmed-input replay is truthful and stops until explicit Refresh', async ({ page }) => {
  const { host, panel } = await openPreview(page);
  host.documents.clear();
  await panel.receive({ type: 'refresh' });
  await page.addInitScript(() => {
    window.workerStarts = 0;
    window.Worker = class {
      constructor() { window.workerStarts++; }
      postMessage({ requestId }) { queueMicrotask(() => this.onmessage?.({ data: { requestId, status: 'error', message: 'Injected replay failure' } })); }
      addEventListener() {}
      terminate() {}
    };
  });
  await page.reload();
  await expect(page.locator('#notice')).toContainText('The previous preview could not be restored.');
  await expect(page.locator('#notice')).not.toContainText('previous snapshot is still shown');
  await expect(page.locator('#comparison')).toBeEmpty();
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await panel.receive({ type: 'ready' });
  await panel.receive({ type: 'ready' });
  expect(await page.evaluate(() => window.workerStarts)).toBe(1);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.workerStarts)).toBe(2);
});

test('oversized preview units fail before creating document DOM and keep native-source guidance', async ({ page }) => {
  await openPreview(page, ['word '.repeat(80000), 'changed '.repeat(80000)], false);
  await expect(page.locator('#notice')).toContainText('native source comparison');
  await expect(page.locator('#comparison')).toBeEmpty();
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'comparisonFailed').length)).toBe(1);
});

test('presentation errors use sentence punctuation before the truthful prior-view notice', async ({ page }) => {
  const { refresh } = await openPreview(page);
  await page.evaluate(() => {
    const append = Element.prototype.append;
    let failed = false;
    Element.prototype.append = function (...nodes) {
      if (!failed && this.classList.contains('pair-row')) { failed = true; throw new Error('Injected punctuation fault'); }
      return append.apply(this, nodes);
    };
  });
  await refresh(['# New baseline', '# New changed']);
  await expect(page.locator('#notice')).toContainText('Injected punctuation fault. The previous snapshot is still shown.');
});

test('persisted row and page indices are clamped to this snapshot', async ({ page }) => {
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}`).join('\n');
  await openPreview(page, [text, text.replace('Item 220', 'Updated 220')]);
  await page.evaluate(() => sessionStorage.setItem('preview-next-state', JSON.stringify({ snapshotId: 1, mode: 'rendered', view: { rendered: { anchor: { row: 999, offset: 0 }, pages: [[0, 999]] } } })));
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.getByRole('status').filter({ hasText: 'Rows 201' })).toContainText('Rows 201–230');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.document-cell[data-side=after]')).toContainText('Updated 220');
});

test('a newer capture cancels an in-progress deep bookmark restoration', async ({ page }) => {
  const text = Array.from({ length: 3000 }, (_, i) => `RESTORE_INPUT line ${i}`).join('\n\n');
  const { refresh } = await openPreview(page, [text, text.replace('line 2500', 'changed 2500')]);
  await page.evaluate(() => sessionStorage.setItem('preview-next-state', JSON.stringify({ snapshotId: 1, view: { rendered: { anchor: { row: 2600, offset: 5 }, pages: [] } } })));
  await page.exposeFunction('supersedeRestore', () => refresh(['# Final original', '# Final changed']));
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.pair-row')) return;
      observer.disconnect();
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', captureId: 2, status: 'reading', sourceLabel: 'Newer comparison' } }));
      window.supersedeRestore();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=after]')).toContainText('Final changed');
  expect(await page.evaluate(() => window.messages.some(message => message.type === 'comparisonRendered' && message.captureId === 1))).toBe(false);
  expect(await page.locator('.pair-row').count()).toBe(1);
});

test('a failed page alignment never persists the faulty page destination', async ({ page }) => {
  const text = Array.from({ length: 230 }, (_, i) => `- Item ${i + 1}`).join('\n');
  await openPreview(page, [text, text.replace('Item 150', 'Updated 150')]);
  await page.evaluate(() => {
    const measure = HTMLElement.prototype.getBoundingClientRect;
    let failed = false;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (!failed && this.matches('li[data-pair]') && this.textContent.includes('Item 150')) { failed = true; throw new Error('Injected page alignment fault'); }
      return measure.call(this);
    };
  });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Injected page alignment fault');
  await expect(page.getByRole('status').filter({ hasText: 'Rows 1' })).toContainText('Rows 1–100');
  expect(await page.evaluate(() => window.saved.view.rendered.pages)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Rows 1' })).toContainText('Rows 1–100');
});


test('dense serialized markup is rejected before any preview DOM is parsed', async ({ page }) => {
  const text = '<div>' + '<span>x</span>'.repeat(4500) + '</div>';
  await openPreview(page, [text, text + '<p>Changed</p>'], false);
  await expect(page.locator('#notice')).toContainText('native source comparison');
  await expect(page.locator('#comparison')).toBeEmpty();
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
});

test('a newer capture terminates an old worker and ignores its queued completion', async ({ page }) => {
  const { refresh } = await openPreview(page);
  await page.evaluate(() => {
    const NativeWorker = Worker;
    let held = false;
    window.cancelledWorkers = 0;
    window.Worker = class extends NativeWorker {
      postMessage(data) {
        if (!held) {
          held = true;
          const handler = this.onmessage;
          window.releaseOldWorker = () => handler({ data: { requestId: data.requestId, status: 'error', message: 'Stale worker failure' } });
          return;
        }
        return super.postMessage(data);
      }
      terminate() { window.cancelledWorkers++; super.terminate(); }
    };
  });
  await refresh(['# Slow original', '# Slow changed']);
  await expect(page.locator('#status')).toHaveText('Comparing…');
  await refresh(['# Final original', '# Final changed']);
  await expect(page.locator('.document-cell[data-side=after] h1')).toHaveText('Final changed');
  await page.evaluate(() => window.releaseOldWorker());
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#notice')).not.toContainText('Stale worker failure');
  expect(await page.evaluate(() => window.cancelledWorkers)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.messages.some(message => message.captureId === 2 && ['comparisonRendered', 'comparisonFailed'].includes(message.type)))).toBe(false);
});

test('live edits leave the preview immutable and a polite note clears only after a new capture', async ({ page }) => {
  const { host, panel } = await openPreview(page);
  const label = await page.locator('#snapshot-label').textContent();
  host.documents.set('file:///workspace/after.md', document('after.md', '# Live edit', { version: 1, isDirty: true }));
  await page.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  await page.evaluate(() => window.hostSettled);
  await panel.changeViewState(true);
  await expect(page.locator('#source-status')).toHaveText('Source changed since capture. Refresh to update the preview.');
  await expect(page.locator('#source-status')).toHaveAttribute('role', 'status');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#snapshot-label')).toHaveText(label);
  await page.evaluate(() => {
    window.sourceAnnouncements = 0;
    new MutationObserver(records => { window.sourceAnnouncements += records.length; }).observe(document.querySelector('#source-status'), { childList: true, characterData: true, subtree: true });
  });
  await panel.changeViewState(true);
  expect(await page.evaluate(() => window.sourceAnnouncements)).toBe(0);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#source-status')).toContainText('Source changed since capture');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.document-cell[data-side=after] h1')).toHaveText('Live edit');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#source-status')).toBeHidden();
  await page.evaluate(() => window.postMessage({ type: 'sourceStatus', captureId: 1, status: 'changed' }, '*'));
  await expect(page.locator('#source-status')).toBeHidden();
});

test('same text in a new version is current and unknown Source checks do not become renderer errors', async ({ page }) => {
  const { host, panel } = await openPreview(page);
  host.documents.set('file:///workspace/after.md', document('after.md', after, { version: 99 }));
  await panel.changeViewState(true);
  await expect(page.locator('#source-status')).toBeHidden();
  host.documents.clear();
  await panel.changeViewState(true);
  await expect(page.locator('#source-status')).toContainText('Could not check live Source');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.document-cell[data-side=after] table')).toContainText('Done');
  await expect(page.locator('#notice')).toBeHidden();
});

test('native Source opens after a renderer failure without retrying the failed comparison', async ({ page }) => {
  const { host } = await openPreview(page, ['# Original', '> '.repeat(110) + 'too deeply nested'], false);
  await expect(page.locator('#notice')).toContainText('nested more than 100 levels');
  const failure = await page.locator('#notice').textContent();
  host.api.commands.executeCommand = async () => { throw new Error('Native open failed'); };
  await page.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  await page.evaluate(() => window.hostSettled);
  expect(host.errors).toEqual(['Could not open live Source diff. Native open failed']);
  await expect(page.locator('#notice')).toHaveText(failure);
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'comparisonFailed').length)).toBe(1);
  await expect(page.locator('#comparison')).toBeEmpty();
});

test('a rendered row bookmark beyond the initial batch survives preview reload', async ({ page }) => {
  const text = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} has a stable reading position.`).join('\n\n');
  await openPreview(page, [text, text.replace('Paragraph 390', 'Updated paragraph 390')]);
  const target = page.locator('.pair-row').nth(180);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(target).toBeAttached();
  for (let row = 0; row < 180; row += 40) await page.locator('.pair-row').nth(row).scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top + 5));
  await expect.poll(() => page.evaluate(() => window.saved?.view?.rendered?.anchor.row)).toBeGreaterThanOrEqual(180);
  const visible = await page.evaluate(() => {
    const y = document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2;
    const row = document.elementFromPoint(innerWidth / 4, y).closest('.pair-row');
    return { index: [...document.querySelectorAll('.pair-row')].indexOf(row), text: row.textContent, offset: y - row.getBoundingClientRect().top };
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  const restored = page.locator('.pair-row').nth(visible.index);
  await expect(restored).toHaveText(visible.text);
  const offset = await restored.evaluate(row => document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2 - row.getBoundingClientRect().top);
  expect(Math.abs(offset - visible.offset), JSON.stringify({ visible, offset })).toBeLessThan(3);
});

for (const rowIndex of [64, 70]) test(`a chunk placement fault at row ${rowIndex} preserves the confirmed snapshot`, async ({ page }) => {
  const { refresh } = await openPreview(page, ['# Last original', '# Last changed']);
  const timestamp = await page.locator('#snapshot-label').textContent();
  await page.evaluate(rowIndex => {
    const append = Element.prototype.append;
    Element.prototype.append = function (...children) {
      if (this.classList.contains('row-chunk') && children.some(child => child.comparisonRow === rowIndex)) {
        Element.prototype.append = append;
        throw new Error('Injected retained-chunk placement fault');
      }
      return append.apply(this, children);
    };
  }, rowIndex);
  const text = Array.from({ length: 200 }, (_, i) => `Candidate paragraph ${i}`).join('\n\n');
  await refresh([text, text.replace('paragraph 150', 'changed paragraph 150')]);
  await expect(page.locator('#notice')).toContainText('Injected retained-chunk placement fault');
  await expect(page.locator('#comparison')).toContainText('Last changed');
  await expect(page.locator('#snapshot-label')).toHaveText(timestamp);
  expect(await page.evaluate(() => window.messages.some(message => message.type === 'comparisonRendered' && message.captureId === 2))).toBe(false);
  await page.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  await expect(page.locator('#comparison')).toContainText('Last changed');
  await page.reload();
  await expect(page.locator('#comparison')).toContainText('Last changed');
  await expect(page.locator('#snapshot-label')).toHaveText(timestamp);
});


for (const targetRow of [191, 192, 220]) test(`mixed restore preserves a prior nonzero page and logical anchor ${targetRow}`, async ({ page }) => {
  const first = Array.from({ length: 50 }, (_, i) => `Before list paragraph ${i}.`).join('\n\n');
  const list = Array.from({ length: 230 }, (_, i) => `- Paged item ${i + 1}`).join('\n');
  const tail = Array.from({ length: 300 }, (_, i) => i % 17 === 0 ? `## Tail heading ${i}\n\nTail paragraph ${i} with **emphasis**.` : `Tail paragraph ${i}.`).join('\n\n');
  const text = `${first}\n\n${list}\n\n${tail}`;
  await openPreview(page, [text, text.replace('paragraph 299', 'changed paragraph 299')]);
  for (let turn = 0; turn < 2; turn++) await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await expect(page.locator('.table-pager [role=status]')).toContainText('Rows 201');
  await expect.poll(() => page.evaluate(() => window.saved?.view?.rendered?.pages.find(([row]) => row === 50)?.[1])).toBe(2);
  while (await page.locator('.pair-row').count() < targetRow + 3) {
    const count = await page.locator('.pair-row').count();
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.locator('.pair-row').count()).toBeGreaterThan(count);
  }
  const expectedText = await page.locator('.pair-row').nth(targetRow).textContent();
  const bookmark = await page.evaluate(row => {
    const saved = structuredClone(window.saved);
    saved.view.rendered.anchor = { row, offset: 5 - document.querySelector('.extension-toolbar').getBoundingClientRect().bottom };
    sessionStorage.setItem('preview-next-state', JSON.stringify(saved));
    return saved.view.rendered.anchor;
  }, targetRow);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.table-pager [role=status]')).toContainText('Rows 201');
  const restored = page.locator('.pair-row').nth(targetRow);
  await expect(restored).toHaveText(expectedText);
  const delta = await restored.evaluate((row, offset) => row.getBoundingClientRect().top + offset, bookmark.offset);
  expect(Math.abs(delta)).toBeLessThan(3);
});


test('large inline-image source is admitted when its rendered placeholder is small', async ({ page }) => {
  const text = '# Inline asset\n\n![logo](data:image/png;base64,' + 'A'.repeat(140000) + ')\n\noriginal\n';
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('data:')) requests.push(request.url()); });
  await openPreview(page, [text, text.replace('original', 'changed')]);
  await expect(page.locator('.image-placeholder')).toHaveCount(2);
  await expect(page.locator('#comparison img')).toHaveCount(0);
  await expect(page.locator('#comparison')).toContainText('changed');
  expect(requests).toEqual([]);
});

test('long selection and native keyboard and accessibility reach survive scrolling away', async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--force-renderer-accessibility'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const text = Array.from({ length: 900 }, (_, i) => i === 0 ? '[First target](https://example.test/first)' : i === 640 ? '[Far target](https://example.test/far)' : `Résumé paragraph ${i}. 同じ`).join('\n\n');
    await openPreview(page, [text, text.replace('paragraph 850', 'changed paragraph 850')]);
    while (await page.locator('.pair-row').count() < 900) {
      const count = await page.locator('.pair-row').count();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.locator('.pair-row').count()).toBeGreaterThan(count);
    }
    for (let row = 0; row < 900; row += 8) await page.locator('.pair-row').nth(row).scrollIntoViewIfNeeded();
    await page.locator('.pair-row').nth(800).scrollIntoViewIfNeeded();
    const session = await page.context().newCDPSession(page);
    await session.send('Accessibility.enable');
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    await session.detach();
    const labels = nodes.filter(node => !node.ignored).map(node => node.name?.value);
    for (let row = 1; row < 900; row++) if (row !== 640 && row !== 850) expect(labels).toContain(`Résumé paragraph ${row}. 同じ`);
    const first = page.locator('.document-cell[data-side=before] a[href="https://example.test/first"]');
    const second = page.locator('.document-cell[data-side=after] a[href="https://example.test/first"]');
    const far = page.locator('.document-cell[data-side=before] a[href="https://example.test/far"]');
    await first.focus();
    await page.keyboard.press('Tab');
    await expect(second).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(far).toBeFocused();
    await expect(far).toBeInViewport();
    await page.keyboard.press('Shift+Tab');
    await expect(second).toBeFocused();
    const selection = await page.evaluate(() => {
      const rows = document.querySelectorAll('.pair-row');
      const range = document.createRange();
      range.setStartBefore(rows[0]); range.setEndAfter(rows[640]);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return getSelection().toString();
    });
    for (let row = 1; row < 640; row++) expect(selection).toContain(`Résumé paragraph ${row}. 同じ`);
    await page.locator('.pair-row').nth(800).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => getSelection().toString())).toBe(selection);
    await page.locator('#comparison').focus();
    await page.keyboard.press('ControlOrMeta+A');
    expect(await page.evaluate(() => getSelection().toString())).toContain('Résumé paragraph 899. 同じ');
  } finally { await browser.close(); }
});
