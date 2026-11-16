const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

exports.run = async function () {
  const root = process.env.MARKDOWN_DIFF_IDE_ROOT;
  const virtual = process.env.MARKDOWN_DIFF_IDE_SCENARIO === 'virtual';
  const command = process.env.MARKDOWN_DIFF_IDE_COMMAND;
  const extension = vscode.extensions.getExtension(process.env.MARKDOWN_DIFF_IDE_EXTENSION);
  assert(extension, 'The extension must be installed or loaded for development.');
  if (process.env.MARKDOWN_DIFF_EXPECT_INSTALLED) {
    const installedRoot = await fs.realpath(path.join(root, 'extensions'));
    assert((await fs.realpath(extension.extensionPath)).startsWith(`${installedRoot}${path.sep}`), 'The installed test must execute the VSIX installation, not repository code.');
  }
  let virtualProvider;
  if (virtual) {
    const events = new vscode.EventEmitter();
    const readVirtualFile = async uri => {
      if (!['/workspace/before.md', '/workspace/after.md'].includes(uri.path)) throw vscode.FileSystemError.FileNotFound(uri);
      return fs.readFile(path.join(root, 'workspace', path.basename(uri.path)));
    };
    const denyWrite = () => { throw vscode.FileSystemError.NoPermissions('The acceptance filesystem is read-only.'); };
    virtualProvider = vscode.workspace.registerFileSystemProvider('markdown-diff-fs', {
      onDidChangeFile: events.event,
      watch: () => new vscode.Disposable(() => {}),
      async stat(uri) {
        if (uri.path === '/workspace' || uri.path === '/workspace/') return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: (await readVirtualFile(uri)).length };
      },
      readDirectory: () => [['before.md', vscode.FileType.File], ['after.md', vscode.FileType.File]],
      readFile: readVirtualFile,
      writeFile: denyWrite, delete: denyWrite, rename: denyWrite, createDirectory: denyWrite,
    }, { isReadonly: true, isCaseSensitive: true });
  }
  await extension.activate();
  let right;
  let providerFails = false;
  let providerReadFailures = 0;
  const provider = vscode.workspace.registerTextDocumentContentProvider('markdown-diff-test', {
    provideTextDocumentContent(uri) {
      if (providerFails) { providerReadFailures++; throw new Error('Acceptance test provider is unavailable.'); }
      return uri.path.includes('before') ? '# Provider original\n' : '# Provider changed\n';
    },
  });

  async function replace(document, text) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert(await vscode.workspace.applyEdit(edit), 'The test edit must reach the native document.');
  }

  async function render(original, modified, title, invoke = true) {
    await vscode.commands.executeCommand('vscode.diff', original, modified, title, { viewColumn: vscode.ViewColumn.One, preview: false });
    assert(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
    if (invoke) await vscode.commands.executeCommand(command);
    const documents = await Promise.all([original, modified].map(uri => vscode.workspace.openTextDocument(uri)));
    return documents.map(document => ({ uri: document.uri.toString(), text: document.getText(), dirty: document.isDirty }));
  }

  async function act(request) {
    if (request.op === 'manual') {
      const leftUri = virtual ? vscode.Uri.parse('markdown-diff-fs:/workspace/before.md') : vscode.Uri.file(path.join(root, 'workspace', 'before.md'));
      const rightUri = virtual ? vscode.Uri.parse('markdown-diff-fs:/workspace/after.md') : vscode.Uri.file(path.join(root, 'workspace', 'after.md'));
      right = await vscode.workspace.openTextDocument(rightUri);
      if (!virtual) await replace(right, `${await fs.readFile(rightUri.fsPath, 'utf8')}\nUNSAVED_ONLY\n`);
      return render(leftUri, rightUri, 'Markdown acceptance comparison', request.invoke !== false);
    }
    if (request.op === 'edit') {
      await replace(right, `${right.getText()}\nREFRESHED_ONLY\n`);
      return { dirty: right.isDirty, text: right.getText() };
    }
    if (request.op === 'malformed') {
      await replace(right, `${'<blockquote>'.repeat(120)}Too deeply nested${'</blockquote>'.repeat(120)}`);
      return true;
    }
    if (request.op === 'theme') {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', request.name, vscode.ConfigurationTarget.Global);
      return request.name;
    }
    if (request.op === 'zoom') {
      await vscode.workspace.getConfiguration('window').update('zoomLevel', request.level, vscode.ConfigurationTarget.Global);
      return true;
    }
    if (request.op === 'reading-layout') {
      for (const id of ['workbench.action.closeSidebar', 'workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel']) await vscode.commands.executeCommand(id);
      return true;
    }
    if (request.op === 'reload-preview') {
      await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
      return true;
    }
    if (request.op === 'second-group') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'workspace', 'before.md'))), { viewColumn: vscode.ViewColumn.Two, preview: false });
      return true;
    }
    if (request.op === 'close-secondary') {
      const tabs = vscode.window.tabGroups.all.filter(group => group.viewColumn === vscode.ViewColumn.Two).flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText);
      await vscode.window.tabGroups.close(tabs, true);
      return true;
    }
    if (request.op === 'hide') {
      const label = vscode.window.tabGroups.activeTabGroup.activeTab.label;
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'workspace', 'before.md'))), { viewColumn: vscode.ViewColumn.One, preview: false });
      return label;
    }
    if (request.op === 'dispose') {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert(tab.input instanceof vscode.TabInputWebview);
      assert(tab.label.startsWith('Markdown Diff'));
      await vscode.window.tabGroups.close(tab, true);
      return true;
    }
    if (request.op === 'git') {
      const git = await vscode.extensions.getExtension('vscode.git').activate();
      const api = git.getAPI(1);
      const uri = vscode.Uri.file(path.join(root, 'workspace', 'tracked.md'));
      await api.openRepository(vscode.Uri.file(path.join(root, 'workspace')));
      const modified = request.staged ? api.toGitUri(uri, '') : uri;
      return render(api.toGitUri(uri, 'HEAD'), modified, request.staged ? 'Staged Markdown acceptance' : 'Working tree Markdown acceptance');
    }
    if (request.op === 'provider') {
      return render(vscode.Uri.parse('markdown-diff-test:/before.md'), vscode.Uri.parse('markdown-diff-test:/after.md'), 'Provider Markdown acceptance');
    }
    if (request.op === 'provider-failure') {
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff && tab.input.original.scheme === 'markdown-diff-test');
      await vscode.window.tabGroups.close(tabs, true);
      providerFails = true;
      return true;
    }
    if (request.op === 'provider-status') return { readFailures: providerReadFailures };
    if (request.op === 'large') {
      const count = 1200;
      const rows = Array.from({ length: count }, (_, i) => `| Row ${i} | ${i === 600 ? 'before' : 'same'} |`).join('\n');
      const before = `# Large table\n\n| Item | Value |\n| --- | --- |\n${rows}\n`;
      const after = before.replace('| before |', '| after |');
      await fs.writeFile(path.join(root, 'workspace', 'large-before.md'), before);
      await fs.writeFile(path.join(root, 'workspace', 'large-after.md'), after);
      await render(vscode.Uri.file(path.join(root, 'workspace', 'large-before.md')), vscode.Uri.file(path.join(root, 'workspace', 'large-after.md')), 'Large Markdown acceptance');
      return { tableRows: count, combinedInputBytes: Buffer.byteLength(before) + Buffer.byteLength(after) };
    }
    if (request.op === 'prose') {
      const before = Array.from({ length: 100 }, (_, i) => `## Section ${i + 1}\n\nA representative paragraph ${i + 1} for ordinary Markdown review.\n`).join('\n');
      const after = before.replace('paragraph 50 for', 'paragraph 50 changed for');
      await fs.writeFile(path.join(root, 'workspace', 'prose-before.md'), before);
      await fs.writeFile(path.join(root, 'workspace', 'prose-after.md'), after);
      await render(vscode.Uri.file(path.join(root, 'workspace', 'prose-before.md')), vscode.Uri.file(path.join(root, 'workspace', 'prose-after.md')), 'Prose acceptance');
      return { sectionsPerDocument: 100, combinedInputBytes: Buffer.byteLength(before) + Buffer.byteLength(after) };
    }
    if (request.op === 'large-code') {
      const lines = Array.from({ length: 50_000 }, (_, i) => `const line${i} = "a representative source value for this comparison";`).join('\n');
      const before = `# Large code\n\n\`\`\`js\n${lines}\n\`\`\`\n`;
      const after = before.replace('line25000 = "a representative', 'line25000 = "a changed');
      await fs.writeFile(path.join(root, 'workspace', 'code-before.md'), before);
      await fs.writeFile(path.join(root, 'workspace', 'code-after.md'), after);
      await render(vscode.Uri.file(path.join(root, 'workspace', 'code-before.md')), vscode.Uri.file(path.join(root, 'workspace', 'code-after.md')), 'Large code acceptance');
      return { linesPerDocument: 50_000, combinedInputBytes: Buffer.byteLength(before) + Buffer.byteLength(after) };
    }
    if (request.op === 'plain') {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'workspace', 'before.md'))));
      await vscode.commands.executeCommand(command);
      return vscode.window.tabGroups.activeTabGroup.activeTab.label;
    }
    if (request.op === 'finish') {
      provider.dispose();
      virtualProvider?.dispose();
      return true;
    }
    throw new Error(`Unknown acceptance action ${request.op}`);
  }

  const runtimeHashes = {};
  for (const name of ['extension.cjs', 'dist/webview.js', 'dist/webview.css']) {
    runtimeHashes[name] = createHash('sha256').update(await fs.readFile(path.join(extension.extensionPath, name))).digest('hex');
  }
  await fs.writeFile(path.join(root, 'ready.json'), JSON.stringify({ ready: true, version: vscode.version, trusted: vscode.workspace.isTrusted, virtualWorkspace: !!vscode.workspace.workspaceFolders?.length && vscode.workspace.workspaceFolders.every(folder => folder.uri.scheme !== 'file'), extensionPath: extension.extensionPath, runtimeHashes }));
  let requestId = 1;
  while (true) {
    const input = path.join(root, `request-${requestId}.json`);
    let request;
    try { request = JSON.parse(await fs.readFile(input, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    let result;
    try { result = { ok: true, value: await act(request) }; }
    catch (error) { result = { ok: false, error: error.stack }; }
    await fs.writeFile(path.join(root, `response-${requestId}.json`), JSON.stringify(result));
    if (request.op === 'finish') break;
    requestId++;
  }
};
