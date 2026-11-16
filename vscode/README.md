# Markdown Diff for VS Code

Read Markdown changes as rendered tables, lists, headings, and text. The extension uses the comparison already open in VS Code.

1. Open a Markdown text comparison from Source Control, or use **Select for Compare** and **Compare with Selected** in Explorer.
2. Choose **Markdown Diff: Render this comparison** from the Command Palette or the preview button in the diff editor title.
3. Choose **Open live Source diff** to return to the original native comparison. Edit in VS Code, then choose **Refresh** in the preview.

The preview is a snapshot. Refresh reads the same original and modified document URIs again, including unsaved editor text. It preserves the baseline selected by VS Code. It does not select HEAD, stage changes, write files, or follow another tab. The original comparison's label appears above both sides. Unsaved sides are marked. Reopening the same captured snapshot restores its logical reading position and page. Refresh or a new command capture starts a new view.

Source is live and can differ from the captured preview. Opening Source reuses the original native comparison when it is still open, or reopens the same URI pair. It does not refresh the preview. When you return, a note identifies text that changed since capture or a source check that could not finish. Choose **Refresh** to capture the current text. Running **Render this comparison** again also captures the current text. Source stays available when the rendered comparison fails.

Loaded rendered text stays in the document when you scroll away, preserving selection and navigation across the loaded preview. Returning from Source rebuilds the captured comparison.

The extension supports ordinary text diff tabs for `.md`, `.markdown`, `.mdx`, and `.txt` files, or documents with the Markdown language selected. It treats MDX as Markdown and does not execute components. Merge editors, multi-file changes editors, and ordinary single-file editors must first open a text comparison.

Images appear as labelled placeholders. This avoids displaying current workspace images as historical content. The rendered view marks changed image attributes. Open live Source to inspect the current Markdown. Only external HTTPS links are active in the preview. Relative links, file links, and command links stay inactive. No document images or remote scripts load.

Comparisons run in a cancellable Web Worker. Large tables, lists, and supported code blocks use pages. Precision warnings identify work limits. Each input is limited to 8 million characters and 200,000 editor lines, and comparison work stops after 12 seconds. Indivisible sections that exceed the preview work budget are rejected before DOM construction, with guidance to use the native source comparison or split the section. Nothing is silently truncated.

The preview size check covers rendered rows and pages. Each pair's HTML is limited to 262,144 characters and 8,000 opening elements, counting both sides. Oversized paragraphs or dense markup can reject the preview even when another part of the file changed. Use the native comparison or split ordinary text into smaller sections. Long code lines remain available when their rendered pages fit the limits. Source rows are not sent to the preview or checked against its DOM budget.

Recovery uses the last confirmed snapshot, with matching content and timestamp. An overlapping command re-run can return an earlier coherent confirmed snapshot. If the browser cannot restore a view, the preview stops and points you back to the original comparison. Failed page navigation recovers at a safe starting position rather than automatically re-entering the faulty page.

The preview follows the editor's theme and fonts, including high contrast. Controls work with Tab, Enter, and Space. Text can be selected and copied. Editing, saving, undo, and staging remain in VS Code.

## Install locally

Build from the repository root with Node.js 24 or newer.

```sh
npm ci
npm run package:vscode
code --install-extension artifacts/markdown-diff-vscode-0.1.0.vsix
```

You can also choose **Extensions: Install from VSIX** in VS Code. The package requires desktop VS Code 1.85 or newer. Browser VS Code and provider-specific remote behavior require separate verification. The repository's verification report records the exact tested versions and environments.

## Develop and test

```sh
npm run build:vscode
npm run test:vscode
```

`test:vscode` checks the extension host boundary and bundled webview in Chromium. Real IDE acceptance runs separately through `npm run test:vscode:ide`. The website keeps its existing build and checks.

To test the installed package in an isolated profile, run this from the repository root.

```sh
npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
```

The IDE runner uses the installed macOS VS Code by default. Set `VSCODE_EXECUTABLE_PATH` for another executable. Set `MARKDOWN_DIFF_IDE_SCENARIO=restricted` or `virtual` for the additional capability checks. Reports, runtime hashes, accessibility audits, screenshots, and responsiveness observations are written to `artifacts/`. Each installed run asserts that its loaded runtime matches the requested VSIX. The repository verification summary records one dated candidate; new candidates keep their own results.
