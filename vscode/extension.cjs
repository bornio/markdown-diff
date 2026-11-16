const vscode = require('vscode');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

const supported = (document) => document.languageId === 'markdown' || /\.(md|markdown|mdx|txt)$/i.test(document.uri.path);
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function html(webview, extensionUri) {
  const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name));
  const nonce = randomBytes(24).toString('base64');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; worker-src blob:; img-src 'none'; connect-src 'none'; font-src 'none';">
  <link rel="stylesheet" href="${escape(String(asset('webview.css')))}">
  <title>Markdown comparison</title>
</head>
<body>
  <header class="extension-toolbar">
    <div class="extension-actions">
      <div class="view-switch" role="group" aria-label="Comparison view">
        <button id="rendered-view" type="button" aria-pressed="true">Rendered</button>
        <button id="source-view" type="button" aria-pressed="false">Source</button>
      </div>
      <button id="refresh" type="button" title="Read the same two documents again">Refresh</button>
    </div>
  </header>
  <main>
  <div class="comparison-metadata">
    <p id="source-label" class="source-label"></p>
    <p id="snapshot-label" class="snapshot-label">Reading the comparison…</p>
    <div class="document-labels">
      <div><span class="side-label">Original</span><span id="before-label"></span></div>
      <div><span class="side-label">Changed</span><span id="after-label"></span></div>
    </div>
    <div class="comparison-summary"><span id="status" role="status" aria-live="polite"></span><span id="stats"></span></div>
  </div>
    <div id="notice" class="notice" role="status" hidden></div>
    <section id="comparison" aria-label="Markdown comparison" tabindex="0" aria-busy="true"></section>
  </main>
  <script type="module" nonce="${nonce}" src="${escape(String(asset('webview.js')))}"></script>
</body>
</html>`;
}

function activate(context) {
  const sessions = new Map();
  context.subscriptions.push(vscode.commands.registerCommand('markdownDiff.renderComparison', async () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(tab?.input instanceof vscode.TabInputTextDiff)) {
      await vscode.window.showInformationMessage('Open a Markdown text comparison first, then run Markdown Diff: Render this comparison.');
      return;
    }
    const sources = [tab.input.original, tab.input.modified];
    const key = JSON.stringify(sources.map((uri) => uri.toString()));
    if (sessions.has(key)) {
      const session = sessions.get(key);
      session.panel.reveal(vscode.window.tabGroups.activeTabGroup.viewColumn);
      await session.capture();
      return;
    }
    const panel = vscode.window.createWebviewPanel('markdownDiff.comparison', `Markdown Diff · ${tab.label}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
    });
    const session = {
      panel, sources, sourceLabel: tab.label, snapshot: null, confirmedSnapshot: null, captureId: 0,
      status: 'reading', message: '', closed: false,
    };
    sessions.set(key, session);
    const send = (includeSnapshot = false) => {
      if (session.closed) return;
      void panel.webview.postMessage({
        type: 'state', captureId: session.captureId, status: session.status, message: session.message,
        sourceLabel: session.sourceLabel,
        ...(includeSnapshot ? { snapshot: session.status === 'error' ? session.confirmedSnapshot : session.snapshot } : {}),
      });
    };
    session.capture = async () => {
      const captureId = ++session.captureId;
      session.status = 'reading';
      session.message = '';
      send();
      try {
        const documents = await Promise.all(sources.map((uri) => vscode.workspace.openTextDocument(uri)));
        if (session.closed || captureId !== session.captureId) return;
        if (!documents.every(supported)) throw new Error('Choose a comparison of Markdown files. Supported extensions are .md, .markdown, .mdx, and .txt.');
        if (documents.some((document) => document.lineCount > 200_000)) throw new Error('This comparison is too large. Each document must contain at most 200,000 lines. Split the documents into smaller files.');
        const sides = documents.map((document) => ({
          uri: document.uri.toString(), label: path.posix.basename(document.uri.path) || 'Untitled',
          text: document.getText(), version: document.version, dirty: document.isDirty,
        }));
        if (sides.some((side) => side.text.length > 8_000_000)) throw new Error('This comparison is too large. Each document must contain at most 8 million characters. Split the documents into smaller files.');
        session.snapshot = { captureId, capturedAt: new Date().toISOString(), before: sides[0], after: sides[1] };
        session.status = 'ready';
        send(true);
      } catch (error) {
        if (session.closed || captureId !== session.captureId) return;
        session.status = 'error';
        session.message = `${session.confirmedSnapshot ? 'Refresh failed. ' : 'Could not read this comparison. '}${error instanceof Error ? error.message : 'The document provider did not return text.'}`;
        send(true);
      }
    };
    const receive = panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') send(true);
      else if (message.type === 'refresh') await session.capture();
      else if (message.type === 'comparisonRendered' && session.status === 'ready' && message.captureId === session.captureId && message.captureId === session.snapshot?.captureId) {
        session.confirmedSnapshot = session.snapshot;
      } else if (message.type === 'comparisonFailed' && message.captureId === session.snapshot?.captureId && session.status !== 'reading' && typeof message.message === 'string') {
        session.status = 'error';
        session.message = message.message.slice(0, 1900);
        send(!!session.confirmedSnapshot && session.confirmedSnapshot.captureId !== message.captureId);
      } else if (message.type === 'openExternal' && typeof message.url === 'string' && message.url.length <= 8192) {
        try {
          const url = new URL(message.url);
          if (url.protocol === 'https:' && !url.username && !url.password) await vscode.env.openExternal(vscode.Uri.parse(url.href));
        } catch {}
      }
    });
    panel.onDidDispose(() => {
      session.closed = true;
      ++session.captureId;
      receive.dispose();
      sessions.delete(key);
    });
    panel.webview.html = html(panel.webview, context.extensionUri);
    await session.capture();
  }));
  context.subscriptions.push({ dispose() { for (const { panel } of sessions.values()) panel.dispose(); } });
}

module.exports = { activate };
