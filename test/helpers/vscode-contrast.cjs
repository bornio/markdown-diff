exports.fixture = function () {
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
    ['Tasks', '- [ ] Task before\n- [x] Existing checked task', '- [x] Task after\n- [x] Existing checked task'],
    ['Details', '<details><summary>Review details</summary>\n\nHidden before detail.\n\n</details>', '<details><summary>Review details</summary>\n\nHidden after detail.\n\n</details>'],
    ['Images and inactive links', '![Before image](https://example.invalid/before.png)\n\n[Before local link](before.md)', '![After image](https://example.invalid/after.png)\n\n[After local link](after.md)'],
    ['Merged cells', '<table><tr><td colspan="2">before merged cell</td></tr></table>', '<table><tr><td colspan="2">after merged cell</td></tr></table>'],
    ['Paged list', Array.from({ length: 130 }, (_, i) => `- List item ${i}`).join('\n'), Array.from({ length: 130 }, (_, i) => `- List item ${i === 120 ? 'changed' : i}`).join('\n')],
  ];
  return { before: '# Contrast states\n\n' + sections.map(([name, text]) => `## ${name}\n\n${text}\n`).join('\n'),
    after: '# Contrast states\n\n' + sections.map(([name, , text]) => `## ${name}\n\n${text}\n`).join('\n') };
};

exports.sampleContrast = function () {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const pixel = () => [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255);
  const paint = color => { context.fillStyle = color; context.fillRect(0, 0, 1, 1); };
  const luminance = color => color.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const samples = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode;
    const element = text.parentElement;
    if (!text.textContent.trim() || element.closest('script,style,[hidden],.sr-only,button:disabled,button[aria-disabled=true]')) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || ![...range.getClientRects()].some(rect => rect.width > 1 && rect.height > 1)) continue;
    const ancestors = [];
    for (let current = element; current; current = current.parentElement) ancestors.unshift(current);
    paint('#ffffff');
    for (const ancestor of ancestors) paint(getComputedStyle(ancestor).backgroundColor);
    const background = pixel();
    paint(style.color);
    const foreground = pixel();
    const lightness = [foreground, background].map(luminance);
    const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
    samples.push({ text: text.textContent.trim().slice(0, 100), tag: element.tagName,
      code: !!element.closest('code,pre'), quote: !!element.closest('blockquote'),
      edit: element.closest('[data-edit]')?.getAttribute('data-edit') || null,
      change: element.closest('[data-change]')?.getAttribute('data-change') || null,
      color: style.color, foreground: foreground.map(value => Math.round(value * 255)), background: background.map(value => Math.round(value * 255)),
      ratio: (Math.max(...lightness) + .05) / (Math.min(...lightness) + .05), required: large ? 3 : 4.5 });
  }
  return { samples, failures: samples.filter(sample => sample.ratio < sample.required).sort((a, b) => a.ratio - b.ratio) };
};
