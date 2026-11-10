# Markdown Diff

Compare Markdown files side by side, with changes inside rendered tables, lists, headings, and text. Switch to Source to see the Markdown itself.

[Open the app](https://bornio.github.io/markdown-diff/) · [Try the example](https://bornio.github.io/markdown-diff/example/)

## Compare files

Drop two files together. The first goes on the left and the second on the right. Use the swap arrows to reverse them. Drop a file on either side to replace it, or start with one file to compare it against an empty document.

Open a filename in the header to read it in full.

Use the eye icon for rendered Markdown and the code icon for Source. The sun or moon switches between light and dark. Upload icons choose local files; the × clears the comparison. Each control has a hover hint and an accessible label. The app accepts UTF-8 `.md`, `.markdown`, `.txt`, and `.mdx` files. It treats `.mdx` as Markdown and does not execute components.

GitHub Flavored Markdown support includes tables, task lists, nested lists, fenced code, strikethrough, and links. Large tables, lists, and supported code blocks use pages. You cannot select text across rendered pages. Source retains the complete file. A notice identifies comparisons that use simpler highlighting after a work limit.

Wide tables scroll within each pane. Some HTML tables use block highlighting or stay whole to preserve merged cells and header context.

Gutter lines mark changed sections: red on the left, green on the right. Word highlights show text edits; shading shows added or removed content and formatting or attribute changes. Use Source to inspect the exact syntax.

Your files stay in the browser. Comparison runs in a Web Worker. There is no backend, account, upload, or API key. Images referenced in a document can load from their URLs.

## Development

Use Node.js 24 or newer.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## Deployment

GitHub Actions tests and deploys `main` to GitHub Pages. The build produces static HTML, CSS, JavaScript, and SVG files in `dist/`. The example has its own `example/index.html`, so direct links work on a static host.

To use another host, deploy `dist/`. For a subdirectory, set the same base path when building and previewing. The default is `/`.

```sh
VITE_BASE_PATH=/markdown-diff/ npm run build
VITE_BASE_PATH=/markdown-diff/ npm run preview
```

The [performance review](docs/performance.md) records the measured workloads, results, and limits.
