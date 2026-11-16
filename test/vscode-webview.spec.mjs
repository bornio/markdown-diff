import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { document, extensionHost } from './helpers/vscode-host.mjs';

const before = '# Plan\n\n| Item | State |\n| --- | --- |\n| Build | Planned |\n\nA **strong** word.\n\n![Old image](https://example.com/old.png)\n\n[Guide](https://example.com/guide) [Relative](next.md) [Command](command:workbench.action.closeWindow)\n';
const after = before.replace('Planned', 'Done').replace('**strong**', '*strong*').replace('Old image', 'New image').replace('old.png', 'new.png');

async function openPreview(page, texts = [before, after], mode = 'rendered', ready = true, { allowImages = false } = {}) {
  let capture = 0;
  const documents = [document('before.md', texts[0]), document('after.md', texts[1], { isDirty: true, version: 2 })];
  const host = extensionHost(...documents, { now: () => Date.UTC(2025, 0, 1, 0, 0, capture++) });
  await host.run();
  const panel = host.panels[0];
  const state = panel.messages.at(-1);
  await page.route('https://assets.test/**', async (route) => {
    const filename = new URL(route.request().url()).pathname.slice(1);
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
  await page.addInitScript(({ mode }) => {
    window.messages = [];
    window.acquireVsCodeApi = () => ({
      getState: () => {
        const next = sessionStorage.getItem('preview-next-state');
        sessionStorage.removeItem('preview-next-state');
        return JSON.parse(next || sessionStorage.getItem('preview-state') || 'null') || { mode };
      },
      setState: (value) => { window.saved = value; sessionStorage.setItem('preview-state', JSON.stringify(value)); },
      postMessage: (message) => {
        window.messages.push(message);
        window.hostSettled = window.sendToHost(message);
      },
    });
  }, { mode });
  await page.route('https://preview.test/', (route) => route.fulfill({ body: allowImages ? panel.webview.html.replace("img-src 'none'", 'img-src https:') : panel.webview.html, contentType: 'text/html' }));
  await page.goto('https://preview.test/');
  if (ready) await expect(page.locator('#status')).toHaveText('Comparison ready');
  if (ready) await page.evaluate(() => window.hostSettled);
  const refresh = async (texts) => {
    for (let i = 0; i < texts.length; i++) host.documents.set(documents[i].uri.toString(), document(i ? 'after.md' : 'before.md', texts[i], { version: capture + 1 }));
    await panel.receive({ type: 'refresh' });
  };
  return { host, panel, state, refresh };
}

test('the real bundled worker renders tables and formatting while image and link policies preserve Source', async ({ page }) => {
  const failures = [];
  const requests = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => { if (request.url().startsWith('https://example.com/')) requests.push(request.url()); });
  await openPreview(page);
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
  await page.getByRole('button', { name: 'Source', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#source-view')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.source-cell[data-side=before] .source-code').allTextContents()).toEqual(before.match(/[^\n]*\n|[^\n]+$/g));
  expect(await page.locator('.source-cell[data-side=after] .source-code').allTextContents()).toEqual(after.match(/[^\n]*\n|[^\n]+$/g));
  expect(requests).toEqual([]);
  expect(failures).toEqual([]);
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
  await openPreview(page, [text, text.replace('late.png', 'new.png')], 'rendered', true, { allowImages: true });
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
  await openPreview(page, ['# Baseline', '> '.repeat(110) + 'too deeply nested'], 'rendered', false);
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
  expect(panel.messages.at(-1).snapshot.captureId).toBe(1);
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
    expect(panel.messages.at(-1).snapshot.captureId).toBe(1);
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
  expect(panel.messages.at(-1).snapshot.captureId).toBe(1);
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
  expect(panel.messages.at(-1).snapshot.captureId).toBe(1);
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
  expect(panel.messages.at(-1).snapshot.captureId).toBe(3);
});

test('a mode change during mounting completes the chosen mode and Source survives recreation', async ({ page }) => {
  const { refresh } = await openPreview(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('#comparison').textContent.includes('MODE_SWITCH')) return;
      observer.disconnect();
      document.querySelector('#source-view').click();
    });
    observer.observe(document.querySelector('#comparison'), { childList: true, subtree: true });
  });
  const text = Array.from({ length: 200 }, (_, i) => `MODE_SWITCH paragraph ${i}.`).join('\n\n');
  await refresh([text, text.replace('paragraph 190', 'updated 190')]);
  await expect(page.locator('#source-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.source-code').first()).toContainText('MODE_SWITCH');
  await page.evaluate(() => window.hostSettled);
  await page.reload();
  await expect(page.locator('#source-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.source-code').first()).toContainText('MODE_SWITCH');
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
  const { refresh, panel } = await openPreview(page, ['', ''], 'source', false);
  await expect(page.locator('#status')).toHaveText('Files are identical');
  await page.evaluate(() => window.hostSettled);
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
  await refresh(['', '> '.repeat(110) + 'too deeply nested']);
  await expect(page.locator('#notice')).toContainText('previous snapshot is still shown');
  await expect(page.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await panel.receive({ type: 'ready' });
  expect(panel.messages.at(-1).snapshot.captureId).toBe(1);
});

test('Refresh keeps keyboard focus and unchanged notices do not announce again on mode changes', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Rendered', exact: true }).click();
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

test('a deep Source reading bookmark survives a real preview reload beyond the initial frontier', async ({ page }) => {
  const text = Array.from({ length: 1600 }, (_, i) => `Exact source line ${i}.`).join('\n\n');
  await openPreview(page, [text, text.replace('line 1500', 'changed 1500')]);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  for (let batch = 0; batch < 4; batch++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(70);
  }
  const target = page.locator('.source-row').nth(1050);
  await expect(target).toBeAttached();
  await target.evaluate(node => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top + 5));
  await expect.poll(() => page.evaluate(() => window.saved?.view?.source?.anchor.row)).toBeGreaterThan(1000);
  const visibleAnchor = () => page.evaluate(() => {
    const y = document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2;
    const row = document.elementFromPoint(innerWidth / 4, y)?.closest('.source-row');
    return row ? { line: row.querySelector('.source-number').textContent, offset: y - row.getBoundingClientRect().top } : null;
  });
  const visible = await visibleAnchor();
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('#source-view')).toHaveAttribute('aria-pressed', 'true');
  const visibleRow = page.locator('.source-row').nth(Number(visible.line) - 1);
  await expect(visibleRow.locator('.source-number').first()).toHaveText(visible.line);
  const restoredOffset = await visibleRow.evaluate(row =>
    document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2 - row.getBoundingClientRect().top);
  expect(Math.abs(restoredOffset - visible.offset)).toBeLessThan(3);
  expect(await page.locator('.source-row').nth(1050).locator('.source-code').first().textContent()).toBe('Exact source line 525.\n');
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

test('malformed and mismatched bookmarks do not apply to the current snapshot', async ({ page }) => {
  const text = Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n');
  await openPreview(page, [text, text.replace('Line 20', 'Changed 20')]);
  for (const saved of [
    { snapshotId: 999, mode: 'source', view: { source: { anchor: { row: 20, offset: 5 }, pages: [] } } },
    { snapshotId: 1, mode: 'source', view: { source: { anchor: { row: '20', offset: null }, pages: [[0, -10], null, ['x', 999]] } } },
  ]) {
    await page.evaluate(saved => sessionStorage.setItem('preview-next-state', JSON.stringify(saved)), saved);
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Comparison ready');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator('.source-code').first()).toContainText('Line 0');
  }
});

test('user navigation cancels an automatic deep bookmark jump while mounting', async ({ page }) => {
  const text = Array.from({ length: 1600 }, (_, i) => `Line ${i}`).join('\n');
  await openPreview(page, [text, text.replace('Line 1500', 'Changed 1500')]);
  await page.evaluate(() => sessionStorage.setItem('preview-next-state', JSON.stringify({ snapshotId: 1, mode: 'source', view: { source: { anchor: { row: 1400, offset: 5 }, pages: [] } } })));
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.source-row')) return;
      observer.disconnect();
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }));
      window.cancelledRestore = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  expect(await page.evaluate(() => window.cancelledRestore)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(500);
  expect(await page.locator('.source-row').count()).toBeLessThan(1400);
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
  await openPreview(page, ['word '.repeat(80000), 'changed '.repeat(80000)], 'rendered', false);
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
  const text = Array.from({ length: 3000 }, (_, i) => `RESTORE_INPUT line ${i}`).join('\n');
  const { refresh } = await openPreview(page, [text, text.replace('line 2500', 'changed 2500')]);
  await page.evaluate(() => sessionStorage.setItem('preview-next-state', JSON.stringify({ snapshotId: 1, mode: 'source', view: { source: { anchor: { row: 2600, offset: 5 }, pages: [] } } })));
  await page.exposeFunction('supersedeRestore', () => refresh(['# Final original', '# Final changed']));
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('.source-row')) return;
      observer.disconnect();
      window.supersedeRestore();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Comparison ready');
  await expect(page.locator('.source-cell[data-side=after]')).toContainText('# Final changed');
  expect(await page.evaluate(() => window.messages.some(message => message.type === 'comparisonRendered' && message.captureId === 1))).toBe(false);
  expect(await page.locator('.source-row').count()).toBe(1);
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
  await openPreview(page, [text, text + '<p>Changed</p>'], 'rendered', false);
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
