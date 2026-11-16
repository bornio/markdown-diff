import assert from 'node:assert/strict';
import test from 'node:test';
import { document, extensionHost, uri } from './helpers/vscode-host.mjs';

const latest = (panel) => panel.messages.findLast(message => message.type === 'state');
const rendered = async (panel, captureId) => {
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
  assert.doesNotMatch(latest(panel).message, /still shown/);
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
  assert.doesNotMatch(latest(panel).message, /still shown/);
});

for (const confirmationAfterFailure of [false, true]) {
  test(`a host capture crossing a late render confirmation keeps the older confirmed input (${confirmationAfterFailure ? 'failure first' : 'confirmation first'})`, async () => {
    const after = document('after.md', 'first successful preview');
    const host = extensionHost(document('before.md', 'baseline'), after);
    await host.run();
    const panel = host.panels[0];
    await rendered(panel, 1);
    host.documents.set(after.uri.toString(), document('after.md', 'unconfirmed second preview'));
    await host.run();
    const reads = [];
    host.api.workspace.openTextDocument = () => new Promise((resolve, reject) => reads.push({ resolve, reject }));
    const refreshing = panel.receive({ type: 'refresh' });
    if (!confirmationAfterFailure) await rendered(panel, 2);
    reads[0].reject(new Error('Provider unavailable'));
    reads[1].reject(new Error('Provider unavailable'));
    await refreshing;
    if (confirmationAfterFailure) await rendered(panel, 2);
    host.api.workspace.openTextDocument = async () => { throw new Error('Provider unavailable'); };
    await panel.receive({ type: 'ready' });
    assert.equal(latest(panel).status, 'error');
    assert.equal(latest(panel).snapshot.captureId, 1);
    assert.equal(latest(panel).snapshot.after.text, 'first successful preview');
  });
}

test('confirmation before a newer failing capture preserves the newer confirmed input', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  await host.run();
  await rendered(panel, 2);
  host.documents.clear();
  await host.run();
  assert.equal(latest(panel).status, 'error');
  assert.equal(latest(panel).snapshot.captureId, 2);
  assert.doesNotMatch(latest(panel).message, /still shown/);
});

test('computed input whose DOM never mounted cannot replace confirmed input', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  await panel.receive({ type: 'refresh' });
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
  host.api.window.tabGroups.activeTabGroup.viewColumn = 2;
  await host.run();
  assert.equal(host.panels.length, 1);
  assert.equal(host.panels[0].reveals, 1);
  assert.equal(host.panels[0].revealColumn, 2);
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
  assert.doesNotMatch(latest(panel).message, /still shown/);
  assert.equal(latest(panel).snapshot.after.text, '# Good input');
  const withinBudget = '\n'.repeat(199_999);
  host.documents.set(after.uri.toString(), document('after.md', withinBudget));
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).status, 'ready');
  assert.equal(latest(panel).snapshot.after.text, withinBudget);
});

const sourceStatus = (panel) => panel.messages.findLast(message => message.type === 'sourceStatus');

test('live Source uses the receiving session original URI pair and label even before rendering', async () => {
  const before = document('README.md', 'baseline', { uri: uri('git:/workspace/README.md?opaque=staged') });
  const after = document('README.md', 'dirty text', { isDirty: true });
  const host = extensionHost(before, after);
  await host.run();
  const panel = host.panels[0];
  const originalGroup = host.api.window.tabGroups.activeTabGroup;
  originalGroup.viewColumn = 3;
  host.api.window.tabGroups.activeTabGroup = { viewColumn: 1, activeTab: { label: 'Other', input: {} }, tabs: [] };
  const state = latest(panel);
  await panel.receive({ type: 'openSource', original: 'file:///unrelated.md', modified: 'command:unsafe', label: 'Untrusted' });
  const [command, left, right, label, options] = host.executions[0];
  assert.equal(command, 'vscode.diff');
  assert.equal(left, before.uri);
  assert.equal(right, after.uri);
  assert.equal(label, 'README.md (Working Tree)');
  assert.equal(options.viewColumn, 3);
  assert.equal(latest(panel), state);
  assert.match(panel.webview.html, />Open live Source diff<\/button>/);
  assert.doesNotMatch(panel.webview.html, /aria-pressed|id="source-view"|id="rendered-view"/);
});

test('closed native tabs reopen the fixed pair and Source failure leaves renderer recovery intact', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  host.api.window.tabGroups.all = [];
  await panel.receive({ type: 'openSource' });
  assert.equal(host.executions[0][4].viewColumn, host.api.ViewColumn.Active);
  await rendered(panel, 1);
  const state = latest(panel);
  host.api.commands.executeCommand = async () => { throw new Error('Native provider unavailable'); };
  await panel.receive({ type: 'openSource' });
  assert.equal(latest(panel), state);
  assert.match(host.errors[0], /Could not open live Source diff.*Native provider unavailable/);
  host.documents.clear();
  await panel.receive({ type: 'refresh' });
  assert.equal(latest(panel).snapshot.captureId, 1);
  assert.match(latest(panel).message, /Refresh failed/);
});

test('returning to the preview compares actual live text without changing the captured input', async () => {
  const before = document('before.md', 'old');
  const after = document('after.md', 'captured', { version: 7 });
  const host = extensionHost(before, after);
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  assert.equal(sourceStatus(panel).status, 'current');
  const state = latest(panel);
  host.documents.set(after.uri.toString(), document('after.md', 'captured', { version: 8 }));
  await panel.changeViewState(true);
  assert.equal(sourceStatus(panel).status, 'current');
  host.documents.set(after.uri.toString(), document('after.md', 'reopened different text', { version: 1 }));
  await panel.receive({ type: 'openSource' });
  await panel.changeViewState(true);
  assert.equal(sourceStatus(panel).status, 'changed');
  assert.equal(sourceStatus(panel).captureId, 1);
  assert.equal(latest(panel), state);
  assert.equal(state.snapshot.after.text, 'captured');
  await panel.receive({ type: 'refresh' });
  await rendered(panel, 2);
  assert.equal(sourceStatus(panel).captureId, 2);
  assert.equal(sourceStatus(panel).status, 'current');
  assert.equal(latest(panel).snapshot.after.text, 'reopened different text');
});

test('source changes during rendering and provider failures have independent informational results', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  host.documents.set('file:///workspace/before.md', document('before.md', 'changed before confirmation'));
  await rendered(panel, 1);
  assert.equal(sourceStatus(panel).status, 'changed');
  const state = latest(panel);
  host.documents.clear();
  await panel.changeViewState(true);
  assert.equal(sourceStatus(panel).status, 'unknown');
  assert.equal(latest(panel), state);
  await panel.receive({ type: 'ready' });
  assert.equal(latest(panel).status, 'ready');
  assert.equal(latest(panel).snapshot.before.text, '# Before');
});

test('a later source check supersedes a pending check for the same capture', async () => {
  const host = extensionHost();
  await host.run();
  const panel = host.panels[0];
  await rendered(panel, 1);
  const reads = [];
  host.api.workspace.openTextDocument = target => new Promise((resolve, reject) => reads.push({ target, resolve, reject }));
  const slow = panel.changeViewState(true);
  const fast = panel.changeViewState(true);
  reads[2].resolve(document('before.md', '# Before'));
  reads[3].resolve(document('after.md', '# After'));
  await fast;
  const count = panel.messages.length;
  reads[0].reject(new Error('Old check failure'));
  reads[1].resolve(document('after.md', 'old change'));
  await slow;
  assert.equal(panel.messages.length, count);
  assert.equal(sourceStatus(panel).status, 'current');
});

for (const closed of [false, true]) {
  test(`a pending source check cannot publish after ${closed ? 'disposal' : 'a different capture is confirmed'}`, async () => {
    const host = extensionHost();
    await host.run();
    const panel = host.panels[0];
    await rendered(panel, 1);
    const originalOpen = host.api.workspace.openTextDocument;
    const reads = [];
    host.api.workspace.openTextDocument = () => new Promise(resolve => reads.push(resolve));
    const checking = panel.changeViewState(true);
    host.api.workspace.openTextDocument = originalOpen;
    if (closed) panel.dispose();
    else {
      await panel.receive({ type: 'refresh' });
      await rendered(panel, 2);
    }
    const count = panel.messages.length;
    reads[0](document('before.md', 'outdated result'));
    reads[1](document('after.md', 'outdated result'));
    await checking;
    assert.equal(panel.messages.length, count);
  });
}
