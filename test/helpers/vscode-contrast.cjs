const { expect } = require('@playwright/test');

exports.fixture = function () {
  const surface = label => `<div><h3>${label} surface heading</h3><blockquote><p>${label} surface quote <code>quoted()</code></p></blockquote><table><thead><tr><th>${label} surface header</th></tr></thead><tbody><tr><td>Surface cell</td></tr></tbody></table><details><summary>${label} surface summary</summary><p>Hidden detail</p></details><p><a href="https://example.test/surface">${label} surface link</a> <a href="surface.md">${label} inactive link</a> <strong>Surface strong</strong> <code>surface()</code></p></div>`;
  const taskDetails = '\n- [ ] **![Deploy release](https://example.invalid/deploy.png)**\n- [ ] Code task\n  ```text\n  Unrelated code\n  ```\n- [ ] Quote task\n  > Unrelated quote';
  const sections = [
    ['Changed fenced code', '```js\nconst greeting = "before";\nconst count = 10;\n// unchanged comment\n```', '```js\nconst greeting = "after";\nconst count = 20;\n// unchanged comment\n```'],
    ['Removed code block', '```text\nremoved code block\nsecond removed line\n```', ''],
    ['Added code block', '', '```text\nadded code block\nsecond added line\n```'],
    ['Quoted code', '> ```js\n> const greeting = "before";\n> const count = 10;\n> ```', '> ```js\n> const greeting = "after";\n> const count = 20;\n> ```'],
    ['Added quoted code', '', '> ```text\n> added quoted code\n> ```'],
    ['Removed quoted code', '> ```text\n> removed quoted code\n> ```', ''],
    ['Inline code', 'Use `before()` and `unchanged()` here.', 'Use `after()` and `unchanged()` here.'],
    ['Quoted inline code', '> Use `before()` and `unchanged()` here.', '> Use `after()` and `unchanged()` here.'],
    ['Changed list code', '- Item\n\n  ```js\n  const value = "before";\n  ```', '- Item\n\n  ```js\n  const value = "after";\n  ```'],
    ['Table code and links', '| Kind | Value |\n| --- | --- |\n| Code | `before()` |\n| Link | [before link](https://example.test/before) |', '| Kind | Value |\n| --- | --- |\n| Code | `after()` |\n| Link | [after link](https://example.test/after) |'],
    ['Tasks', '- [ ] Task before\n- [x] Existing checked task' + taskDetails, '- [x] Task after\n- [x] Existing checked task' + taskDetails],
    ['Details', '<details><summary>Review details</summary>\n\nHidden before detail.\n\n</details>', '<details><summary>Review details</summary>\n\nHidden after detail.\n\n</details>'],
    ['Images and inactive links', '![Before image](https://example.invalid/before.png)\n\n[Before local link](before.md)', '![After image](https://example.invalid/after.png)\n\n[After local link](after.md)'],
    ['Merged cells', '<table><tr><td colspan="2">before merged cell</td></tr></table>', '<table><tr><td colspan="2">after merged cell</td></tr></table>'],
    ['Added surface roles', '', surface('Added')],
    ['Removed surface roles', surface('Removed'), ''],
    ['Quote roles', '<blockquote><h3>Quote heading</h3><p>Quote prose <a href="https://example.test/quote">quote link</a> and <code>quote()</code>.</p><table><thead><tr><th>Quote header</th></tr></thead><tbody><tr><td>Quote cell</td></tr></tbody></table></blockquote>', '<blockquote><h3>Quote heading</h3><p>Quote prose <a href="https://example.test/quote">quote link</a> and <code>quote()</code>.</p><table><thead><tr><th>Quote header</th></tr></thead><tbody><tr><td>Quote cell</td></tr></tbody></table></blockquote>'],
    ['Code links', '[`codeGuide()`](https://example.test/code) and [`localGuide()`](local.md)', '[`codeGuide()`](https://example.test/code) and [`localGuide()`](local.md)'],
    ['Paged list', Array.from({ length: 130 }, (_, i) => `- List item ${i}`).join('\n'), Array.from({ length: 130 }, (_, i) => `- List item ${i === 120 ? 'changed' : i}`).join('\n')],
  ];
  return { before: '# Contrast states\n\n' + sections.map(([name, text]) => `## ${name}\n\n${text}\n`).join('\n'),
    after: '# Contrast states\n\n' + sections.map(([name, , text]) => `## ${name}\n\n${text}\n`).join('\n') };
};

exports.sampleContrast = function (scope = document.body) {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const pixel = () => [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255);
  const paint = color => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); };
  const luminance = color => color.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const measure = (element, color) => {
    const ancestors = [];
    for (let current = element; current; current = current.parentElement) ancestors.unshift(current);
    paint('#ffffff');
    for (const ancestor of ancestors) paint(getComputedStyle(ancestor).backgroundColor);
    const background = pixel();
    paint(color);
    const foreground = pixel();
    const lightness = [foreground, background].map(luminance);
    return { color, foreground: foreground.map(value => Math.round(value * 255)), background: background.map(value => Math.round(value * 255)),
      ratio: (Math.max(...lightness) + .05) / (Math.min(...lightness) + .05) };
  };
  const samples = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const element = text.parentElement;
    if (!text.textContent.trim() || element.closest('script,style,[hidden],.sr-only,button:disabled,button[aria-disabled=true]')) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || ![...range.getClientRects()].some(rect => rect.width > 1 && rect.height > 1)) continue;
    const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
    samples.push({ text: text.textContent.trim().slice(0, 100), tag: element.tagName,
      code: !!element.closest('code,pre'), quote: !!element.closest('blockquote'),
      link: !!element.closest('a'),
      edit: element.closest('[data-edit]')?.getAttribute('data-edit') || null,
      change: element.closest('[data-change]')?.getAttribute('data-change') || null,
      ...measure(element, style.color), required: large ? 3 : 4.5 });
  }
  const nonText = [];
  for (const checkbox of scope.querySelectorAll('input[type=checkbox]')) {
    nonText.push({ kind: 'task-border', checked: checkbox.checked, required: 3, ...measure(checkbox.parentElement, getComputedStyle(checkbox).borderTopColor) });
    if (checkbox.checked) nonText.push({ kind: 'task-checkmark', required: 3, ...measure(checkbox, getComputedStyle(checkbox, '::after').borderLeftColor) });
  }
  for (const cell of scope.querySelectorAll('.document-cell[data-change-cue]')) {
    nonText.push({ kind: 'change-marker', change: cell.dataset.changeCue, required: 3, ...measure(cell, getComputedStyle(cell, '::before').borderLeftColor) });
  }
  const focusSelector = 'button:focus-visible,a:focus-visible,[tabindex]:focus-visible';
  for (const element of [scope, ...scope.querySelectorAll(focusSelector)].filter(element => element.matches(focusSelector))) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const spread = Math.max(0, parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth));
    let clipped = false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (!/\b(paint|strict|content)\b/.test(getComputedStyle(ancestor).contain)) continue;
      const bounds = ancestor.getBoundingClientRect();
      if (rect.left - spread < bounds.left || rect.right + spread > bounds.right || rect.top - spread < bounds.top || rect.bottom + spread > bounds.bottom) clipped = true;
    }
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) nonText.push({ kind: 'focus-ring', target: element.id || element.textContent, width: style.outlineWidth, required: 3,
      clipped, ...measure(parseFloat(style.outlineOffset) < 0 ? element : element.parentElement, style.outlineColor) });
  }
  const root = getComputedStyle(document.documentElement);
  const bodyColor = getComputedStyle(document.body).color;
  const palette = scope === document.body ? { body: measure(document.body, bodyColor), nativeEditor: measure(document.body, root.getPropertyValue('--vscode-editor-foreground').trim() || bodyColor),
    metadata: measure(document.querySelector('#snapshot-label'), getComputedStyle(document.querySelector('#snapshot-label')).color) } : null;
  return { samples, palette, failures: samples.filter(sample => sample.ratio < sample.required).sort((a, b) => a.ratio - b.ratio),
    nonText, nonTextFailures: nonText.filter(sample => sample.ratio < sample.required || sample.clipped) };
};

exports.interactiveContrast = async function (page, frame) {
  const records = [];
  const snapshot = await frame.locator('#snapshot-label').textContent();
  const buttons = ['Open live Source diff', 'Refresh', 'Next'].map(name => ({ name, locator: frame.getByRole('button', { name, exact: true }) }));
  const links = ['codeGuide()', 'Added surface link', 'Removed surface link', 'quote link'].map(name => ({ name, locator: frame.getByRole('link', { name, exact: true }).first() }));
  const capture = async (state, target) => {
    if (state === 'keyboard-focus') await expect.poll(() => target.locator.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!hit && (hit === element || element.contains(hit));
    })).toBe(true);
    records.push({ state, target: target.name, ...await target.locator.evaluate(exports.sampleContrast) });
  };
  for (const target of [...buttons, ...links]) {
    await target.locator.hover();
    await capture('hover', target);
    await target.locator.evaluate(element => element.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { once: true, capture: true }));
    await page.mouse.down();
    try {
      await expect.poll(() => target.locator.evaluate(element => element.matches(':active'))).toBe(true);
      await capture('pressed', target);
    } finally {
      await page.mouse.up();
    }
  }
  await frame.getByRole('button', { name: 'Refresh', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(frame.locator('#open-source')).toBeFocused();
  await capture('keyboard-focus', buttons[0]);
  await page.keyboard.press('Tab');
  await expect(frame.locator('#refresh')).toBeFocused();
  await capture('keyboard-focus', buttons[1]);
  await frame.locator('#comparison').focus();
  const next = frame.getByRole('button', { name: 'Next', exact: true });
  const limit = await frame.locator('a[href],button:not([disabled]),summary,[tabindex]').count();
  for (let step = 0; step <= limit && !await next.evaluate(element => element === document.activeElement); step++) await page.keyboard.press('Tab');
  await expect(next).toBeFocused();
  await expect.poll(() => next.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await capture('keyboard-focus', buttons[2]);
  for (const target of links) {
    await target.locator.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(target.locator).toBeFocused();
    await expect.poll(() => target.locator.evaluate(element => element.matches(':focus-visible'))).toBe(true);
    await capture('keyboard-focus', target);
  }
  await frame.evaluate(() => document.activeElement.blur());
  await expect(frame.locator('#snapshot-label')).toHaveText(snapshot);
  return records;
};
