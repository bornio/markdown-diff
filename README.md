# Markdown Diff

Compare Markdown files side by side, with changes inside rendered tables, lists, headings, and text. Switch to Source to see the Markdown itself. Paste a GitHub file or gist link to compare its versions.

[Open the app](https://bornio.github.io/markdown-diff/) · [Try the example](https://bornio.github.io/markdown-diff/example/)

## Compare files

The page opens in the editor. Type or paste the original on the left and the changed version on the right, or drop a file onto either side, then choose Rendered or Source (or press ⌘/Ctrl+Enter). Dropping two files together compares them right away: the first is the original and the second the changed version. Use the swap arrows to reverse them.

While viewing a comparison, dropping a file on a filename or pasting one replaces that side and compares again; a paste fills the original first if it is empty, otherwise the changed side.

To edit after comparing, choose Edit or click a line in Source. The comparison pauses while you type; choose Rendered or Source (or press ⌘/Ctrl+Enter) to update it. Edited sides are marked. If a comparison fails, the editor opens so you can fix the text and try again.

Click a truncated filename to expand it, then click again to collapse it. Tab and Enter or Space work too. Names that already fit stay plain.

On a touch screen, tap a filename to open a file, paste from the clipboard, save or share a copy, or swap sides. On a phone, the filename row also slides away while you scroll down and comes back when you scroll up; Rendered, Source, and Edit stay at the top.

Use Rendered, Source, or Edit at the top to switch modes. The sun or moon switches between light and dark, and the × clears the comparison. The logo opens this repository on GitHub in a new tab. Each control has a hover hint and an accessible label. The app accepts UTF-8 `.md`, `.markdown`, `.txt`, and `.mdx` files. It treats `.mdx` as Markdown and does not execute components.

GitHub Flavored Markdown support includes tables, task lists, nested lists, fenced code, strikethrough, and links. Large tables, lists, and supported code blocks use pages. You cannot select text across rendered pages. Source retains the complete file. A notice identifies comparisons that use simpler highlighting after a work limit.

Wide tables scroll within each pane. Some HTML tables use block highlighting or stay whole to preserve merged cells and header context.

Gutter lines mark changed sections: red on the left, green on the right. Word highlights show text edits and shading shows added or removed content. A dotted outline marks an element whose formatting or attributes changed; a replaced image gets a red or green outline and a changed checkbox a solid one. Use Source to inspect the exact syntax.

Your files stay in the browser. Comparison runs in a Web Worker. There is no backend, account, upload, or API key. Images referenced in a document can load from their URLs.

## Compare versions of a GitHub file

Paste a link to a Markdown file in a public GitHub repository, or to a gist, into the box above the editor and choose Load versions. Pasting the link anywhere outside a text box, or into an empty editor box, works too. The page compares the two latest versions: for a repository file, its last two commits; for a gist, the last two revisions that changed that file. Secret gists work, since anyone with the link can read them. Private repositories don't.

Each filename shows the date of its version. Click or tap it to choose another version for that side from the file's history, with commit messages for repositories. A gist with several Markdown files has a file menu at the top of the list, and versions that leave the chosen file unchanged are dimmed. History loads 100 versions at a time; Load older versions at the end of the list fetches more.

The page link keeps the whole choice, for example `?gh=https://github.com/owner/repo/blob/main/README.md&a=<sha>&b=<sha>`, so it reopens the same two versions. Back and Forward step through the versions you picked. Edits stay out of the link, and a notice says so.

The page reads history from the GitHub API, which allows 60 requests an hour from one network without signing in. Opening a repository file uses one request per 100 commits; a gist uses two. File text comes from GitHub's raw file hosts, which don't count toward that limit. Images with relative paths in a GitHub file don't load.

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
