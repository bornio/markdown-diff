# Markdown Diff

Compare Markdown files side by side, with changes inside rendered tables, lists, headings, and text. Switch to Source to see the Markdown itself.

[Open the app](https://bornio.github.io/markdown-diff/) · [Try the example](https://bornio.github.io/markdown-diff/example/)

## Compare files

Drop two files together. The first is the original (left) and the second the changed version (right). Use the swap arrows to reverse them. Drop a file on either side to replace it, or start with one file to compare it against an empty document.

You can also paste text: the first paste fills the original, the next fills the changed side, and later pastes replace the changed side. Focus a side first to paste into it.

Click a truncated filename to expand it, then click again to collapse it. Tab and Enter or Space work too. Names that already fit stay plain.

Use Rendered or Source to switch views. The sun or moon switches between light and dark. Upload icons choose local files; the × clears the comparison. Each control has a hover hint and an accessible label. The app accepts UTF-8 `.md`, `.markdown`, `.txt`, and `.mdx` files. It treats `.mdx` as Markdown and does not execute components.

GitHub Flavored Markdown support includes tables, task lists, nested lists, fenced code, strikethrough, and links. Large tables, lists, and supported code blocks use pages. You cannot select text across rendered pages. Source retains the complete file. A notice identifies comparisons that use simpler highlighting after a work limit.

Wide tables scroll within each pane. Some HTML tables use block highlighting or stay whole to preserve merged cells and header context.

Gutter lines mark changed sections: red on the left, green on the right. Word highlights show text edits and shading shows added or removed content. A dotted outline marks an element whose formatting or attributes changed; a replaced image gets a red or green outline and a changed checkbox a solid one. Use Source to inspect the exact syntax.

Your files stay in the browser. Comparison runs in a Web Worker. There is no backend, account, upload, or API key. Images referenced in a document can load from their URLs.

## Development

Use Node.js 24. The browser tests run in your installed Google Chrome.

```sh
npm ci
npm run dev
```

```sh
npm run check
```

`check` runs the Node tests, a production build, and the browser tests. `npm test` runs only the Node tests.

## Deployment

GitHub Actions runs `npm run check` for pull requests and `main`. After that check, a push or manual run on `main` deploys to GitHub Pages. Pull requests do not deploy. The build produces static HTML, CSS, JavaScript, and SVG files in `dist/`. The example has its own `example/index.html`, so direct links work on a static host.

To use another host, deploy `dist/`. For a subdirectory, set the same base path when building and previewing. The default is `/`.

```sh
VITE_BASE_PATH=/markdown-diff/ npm run build
VITE_BASE_PATH=/markdown-diff/ npm run preview
```

The [performance review](docs/performance.md) records the measured workloads, results, and limits.
