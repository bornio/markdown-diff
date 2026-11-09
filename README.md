# Markdown Diff

Drop one or two Markdown files to compare them side by side. Switch between rendered Markdown and source, navigate changes, and choose a light or dark theme.

**[Open the app](https://bornio.github.io/markdown-diff/)** · **[Try the example](https://bornio.github.io/markdown-diff/example/)**

Supports GitHub Flavored Markdown, including tables, task lists, nested lists, fenced code, and strikethrough. The example demonstrates these features with two built-in documents.

Files are read and compared in your browser, with diff computation in a Web Worker. No uploads, backend, accounts, or API keys. Images referenced by a document may load from their original URLs.

## Development

Requires Node.js 22.12+ or 24+.

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

GitHub Actions tests, builds, and deploys `main` to GitHub Pages. The output is entirely static HTML, CSS, JavaScript, and SVG files in `dist/`. The example has its own `example/index.html`, so direct links work without a server-side router.

For another static host, deploy `dist/`. Set `VITE_BASE_PATH` when building for a subdirectory; it defaults to `/`.

```sh
VITE_BASE_PATH=/markdown-diff/ npm run build
VITE_BASE_PATH=/markdown-diff/ npm run preview
```
