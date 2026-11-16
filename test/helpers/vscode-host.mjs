import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const extensionRoot = new URL('../../vscode/', import.meta.url);

export function document(name, text, extra = {}) {
  return { uri: uri(`file:///workspace/${name}`), languageId: 'markdown', version: 1, lineCount: text.split(/\r\n|\r|\n/).length, isDirty: false, getText: () => text, ...extra };
}

export function uri(value) {
  const parsed = new URL(value);
  return { path: decodeURIComponent(parsed.pathname), scheme: parsed.protocol.slice(0, -1), toString: () => value };
}

export function extensionHost(before = document('before.md', '# Before'), after = document('after.md', '# After'), { now = Date.now } = {}) {
  class TabInputTextDiff { constructor(original, modified) { Object.assign(this, { original, modified }); } }
  const documents = new Map([before, after].map((doc) => [doc.uri.toString(), doc]));
  const commands = new Map();
  const panels = [];
  const notices = [];
  const errors = [];
  const executions = [];
  const external = [];
  const context = { extensionUri: uri(pathToFileURL(fileURLToPath(extensionRoot)).href), subscriptions: [] };
  const api = {
    TabInputTextDiff,
    Uri: { parse: uri, joinPath: (base, ...segments) => uri(`${base.toString().replace(/\/$/, '')}/${segments.join('/')}`) },
    ViewColumn: { Active: -1 },
    env: { openExternal: async (target) => { external.push(target.toString()); return true; } },
    workspace: { openTextDocument: async (target) => {
      const found = documents.get(target.toString());
      if (!found) throw new Error('Document unavailable');
      return found;
    } },
    commands: {
      registerCommand: (id, action) => { commands.set(id, action); return { dispose() {} }; },
      executeCommand: async (...args) => { executions.push(args); },
    },
    window: {
      tabGroups: { activeTabGroup: { viewColumn: 1, activeTab: { label: 'README.md (Working Tree)', input: new TabInputTextDiff(before.uri, after.uri) } } },
      showInformationMessage: async (message) => notices.push(message),
      showErrorMessage: async (message) => errors.push(message),
      createWebviewPanel: (viewType, title, column, options) => {
        const disposals = [];
        const visibility = new Set();
        const panel = {
          viewType, title, column, options, messages: [], reveals: 0, active: true,
          webview: {
            cspSource: 'https://assets.test',
            asWebviewUri: (target) => `https://assets.test/${target.path.split('/').pop()}`,
            postMessage: async (message) => { panel.messages.push(message); return true; },
            onDidReceiveMessage: (listener) => { panel.receive = listener; return { dispose() { panel.receive = async () => {}; } }; },
          },
          onDidDispose: (listener) => disposals.push(listener),
          onDidChangeViewState: (listener) => { visibility.add(listener); return { dispose: () => visibility.delete(listener) }; },
          dispose: () => disposals.forEach((listener) => listener()),
          async changeViewState(active) { this.active = active; for (const listener of visibility) await listener({ webviewPanel: this }); },
          reveal(column) { this.reveals++; this.revealColumn = column; void this.changeViewState(true); },
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  api.window.tabGroups.activeTabGroup.tabs = [api.window.tabGroups.activeTabGroup.activeTab];
  api.window.tabGroups.all = [api.window.tabGroups.activeTabGroup];
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('extension.cjs', extensionRoot), 'utf8'), {
    require: (name) => name === 'vscode' ? api : require(name), module, URL, Error,
    Date: class extends Date {
      constructor(...values) { super(...(values.length ? values : [now()])); }
      static now() { return now(); }
    },
  }, { filename: 'extension.cjs' });
  module.exports.activate(context);
  const run = () => commands.get('markdownDiff.renderComparison')();
  return { api, panels, documents, context, notices, errors, executions, external, run };
}
