import assert from 'node:assert/strict';
import test from 'node:test';
import { document, extensionHost, uri } from './helpers/vscode-host.mjs';

const latest = (panel) => panel.messages.at(-1);
const rendered = async (panel, captureId) => {
  await panel.receive({ type: 'comparisonReady', captureId });
  await panel.receive({ type: 'comparisonRendered', captureId });
};

test('an ordinary editor explains how to start without opening a panel', async () => {
  const host = extensionHost();
  host.api.window.tabGroups.activeTabGroup.activeTab = { input: {} };
  await host.run();
  assert.equal(host.panels.length, 0);
  assert.match(host.notices[0], /Open a Markdown text comparison/);
});

test('a comparison captures dirty editor text, both labels, and provider URIs without interpretation', async () => {
  const before = document('README.md', '# old', { uri: uri('git:/workspace/README.md?opaque=baseline') });
  const after = document('README.md', '# unsaved', { isDirty: true, version: 8 });
  const host = extensionHost(before, after);
  await host.run();
  const panel = host.panels[0];
  const state = latest(panel);
  assert.equal(state.status, 'ready');
  assert.equal(state.snapshot.before.text, '# old');
  assert.equal(state.snapshot.before.uri, before.uri.toString());
  assert.equal(state.snapshot.after.text, '# unsaved');
  assert.equal(state.snapshot.after.version, 8);
  assert.equal(state.snapshot.after.dirty, true);
  assert.equal(state.sourceLabel, 'README.md (Working Tree)');
  assert.equal(panel.options.localResourceRoots.length, 1);
  assert.equal(panel.column, host.api.ViewColumn.Active);
  assert.match(panel.webview.html, /default-src 'none'/);
  assert.match(panel.webview.html, /img-src 'none'/);
  assert.match(panel.webview.html, /script-src 'nonce-/);
});

test('Refresh uses the original pair after focus changes and keeps the previous snapshot on failure', async () => {
  const before = document('old.md', 'before');
  const after = document('new.md', 'first');
  const host = extensionHost(before, after);
  await host.run();
  const panel = host.panels[0];
  host.api.window.tabGroups.activeTabGroup.activeTab = { input: {} };
  host.documents.set(after.uri.toString(), document('new.md', 'second', { isDirty: true, version: 2 }));
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).snapshot.after.text, 'second');
  await rendered(panel, latest(panel).snapshot.captureId);
  host.documents.delete(before.uri.toString());
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).status, 'error');
  assert.match(latest(panel).message, /previous snapshot is still shown/);
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).snapshot.after.text, 'second');
  assert.equal(latest(panel).status, 'error');
});

test('a failed comparison followed by webview recreation restores the last successful input', async () => {
  const after = document('after.md', 'first');
  const host = extensionHost(document('before.md', 'before'), after);
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  host.documents.set(after.uri.toString(), document('after.md', 'invalid next input'));
  await panel.receive({ type: 'refresh' });
  await panel.receive({ type: 'comparisonFailed', captureId: 2, message: 'Could not compare.' });
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).status, 'error');
  assert.equal(latest(panel).snapshot.captureId, 1);
  assert.equal(latest(panel).snapshot.after.text, 'first');
  await rendered(panel, 1);
  assert.equal(latest(panel).type, 'comparisonAccepted');
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).status, 'error');
  assert.match(latest(panel).message, /Could not compare/);
  assert.equal(latest(panel).snapshot.after.text, 'first');
});

test('a recreated preview receives the last successful input when its new comparison fails', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  await panel.receive({ type: 'refresh' });
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).snapshot.captureId, 2);
  await panel.receive({ type: 'comparisonFailed', captureId: 2, message: 'The comparison could not finish.' });
  assert.equal(latest(panel).snapshot.captureId, 1);
  assert.match(latest(panel).message, /previous snapshot is still shown/);
});

test('a late render acknowledgment during a newer read cannot replace the remembered successful input', async () => {
  const after = document('after.md', 'first successful preview');
  const host = extensionHost(document('before.md', 'baseline'), after);
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  host.documents.set(after.uri.toString(), document('after.md', 'unconfirmed second preview'));
  await panel.receive({ type: 'refresh' });
  const reads = [];
  host.api.workspace.openTextDocument = () => new Promise((resolve, reject) => reads.push({ resolve, reject }));
  const refreshing = panel.receive({ type: 'refresh' });
  const count = panel.messages.length;
  await panel.receive({ type: 'comparisonReady', captureId: 2 });
  await panel.receive({ type: 'comparisonRendered', captureId: 2 });
  assert.equal(panel.messages.length, count);
  reads[0].reject(new Error('Provider unavailable'));
  reads[1].reject(new Error('Provider unavailable'));
  await refreshing;
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).status, 'error');
  assert.equal(latest(panel).snapshot.captureId, 1);
  assert.equal(latest(panel).snapshot.after.text, 'first successful preview');
});

test('worker authorization does not promote an input whose DOM never mounted', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  await panel.receive({ type: 'refresh' });
  await panel.receive({ type: 'comparisonReady', captureId: 2 });
  assert.equal(latest(panel).type, 'comparisonAccepted');
  await panel.receive({ type: 'comparisonFailed', captureId: 2, message: 'DOM construction failed.' });
  assert.equal(latest(panel).snapshot.captureId, 1);
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).snapshot.captureId, 1);
  assert.match(latest(panel).message, /DOM construction failed/);
});

test('a later Refresh supersedes a pending read and a closed panel cannot publish', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  const deferred = [];
  host.api.workspace.openTextDocument = (target) => new Promise((resolve) => deferred.push({ resolve, target }));
  const slow = panel.receive({ type: 'refresh' });
  const fast = panel.receive({ type: 'refresh' });
  deferred[2].resolve(document('before.md', 'new baseline'));
  deferred[3].resolve(document('after.md', 'new modified'));
  await fast;
  assert.equal(latest(panel).snapshot.after.text, 'new modified');
  const count = panel.messages.length;
  deferred[0].resolve(document('before.md', 'stale baseline'));
  deferred[1].resolve(document('after.md', 'stale modified'));
  await slow;
  assert.equal(panel.messages.length, count);
  const closing = panel.receive({ type: 'refresh' });
  panel.dispose();
  const closedCount = panel.messages.length;
  deferred[4].resolve(document('before.md', 'closed baseline'));
  deferred[5].resolve(document('after.md', 'closed modified'));
  await closing;
  assert.equal(panel.messages.length, closedCount);
});

test('reopening the same comparison reveals and refreshes its existing panel', async () => {
  const host = extensionHost();
  await host.run();
  await host.run();
  assert.equal(host.panels.length, 1);
  assert.equal(host.panels[0].reveals, 1);
  assert.equal(latest(host.panels[0]).snapshot.captureId, 2);
  host.panels[0].dispose();
  await host.run();
  assert.equal(host.panels.length, 2);
});

test('only credential-free HTTPS links cross the external-link boundary', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  for (const url of ['command:workbench.action.closeWindow', 'file:///private/secret', 'javascript:alert(1)', '../relative.md', 'https://user:password@example.com', 'not a URL']) {
    await panel.receive({ type: 'openExternal', url });
  }
  assert.deepEqual(host.external, []);
  await panel.receive({ type: 'openExternal', url: 'https://example.com/guide?q=one' });
  assert.deepEqual(host.external, ['https://example.com/guide?q=one']);
});

test('unsupported file types and oversized inputs fail visibly without a false empty comparison', async () => {
  const host = extensionHost(document('old.js', 'const a = 1', { languageId: 'javascript' }), document('new.js', 'const a = 2', { languageId: 'javascript' }));
  await host.run();
  assert.equal(latest(host.panels[0]).status, 'error');
  assert.equal(latest(host.panels[0]).snapshot, null);
  assert.match(latest(host.panels[0]).message, /Supported extensions/);
  const large = extensionHost(document('old.md', 'x'.repeat(8_000_001)), document('new.md', 'new'));
  await large.run();
  assert.match(latest(large.panels[0]).message, /8 million characters/);
});

test('the native line budget is checked before reading text and a rejected Refresh retains the shown input', async () => {
  const after = document('after.md', '# Good input');
  const host = extensionHost(document('before.md', '# Baseline'), after);
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  host.documents.set(after.uri.toString(), document('after.md', '\n'.repeat(200_000), { getText() { assert.fail('Over-budget documents must not be copied with getText.'); } }));
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).status, 'error');
  assert.match(latest(panel).message, /at most 200,000 lines/);
  assert.match(latest(panel).message, /previous snapshot is still shown/);
  assert.equal(latest(panel).snapshot.after.text, '# Good input');
  const withinBudget = '\n'.repeat(199_999);
  host.documents.set(after.uri.toString(), document('after.md', withinBudget));
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).status, 'ready');
  assert.equal(latest(panel).snapshot.after.text, withinBudget);
});
