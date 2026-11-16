import { chromium, expect } from '@playwright/test';
import axe from 'axe-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { fixture: contrastFixture, sampleContrast, interactiveContrast } = createRequire(import.meta.url)('../test/helpers/vscode-contrast.cjs');

const repo = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repo, 'vscode/package.json'), 'utf8'));
const harnessHashes = {};
for (const name of ['scripts/test-vscode-ide.mjs', 'test/vscode-ide/driver.cjs', 'test/helpers/vscode-contrast.cjs']) harnessHashes[name] = createHash('sha256').update(await readFile(path.join(repo, name))).digest('hex');
const packagePath = process.argv[2];
const scenario = process.env.MARKDOWN_DIFF_IDE_SCENARIO || 'full';
assert(['full', 'restricted', 'virtual'].includes(scenario), 'Unknown IDE acceptance scenario.');
const packageSha256 = packagePath ? createHash('sha256').update(await readFile(packagePath)).digest('hex') : null;
const expectedRuntimeHashes = {};
for (const name of ['extension.cjs', 'dist/webview.js', 'dist/webview.css']) {
  const bytes = packagePath ? execFileSync('unzip', ['-p', path.resolve(packagePath), `extension/${name}`]) : await readFile(path.join(repo, 'vscode', name));
  expectedRuntimeHashes[name] = createHash('sha256').update(bytes).digest('hex');
}
const executable = process.env.VSCODE_EXECUTABLE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-diff-ide-'));
console.log(`Isolated VS Code profile ${root}`);
const outputName = process.env.MARKDOWN_DIFF_IDE_ARTIFACT_NAME || (scenario === 'full' ? (packagePath ? 'vscode-ide-installed' : 'vscode-ide-development') : `vscode-ide-${scenario}`);
const output = path.join(repo, 'artifacts', path.basename(outputName));
for (const name of ['workspace', 'profile/User', 'extensions', 'shared', 'crashes', 'driver']) await mkdir(path.join(root, name), { recursive: true });
await mkdir(output, { recursive: true });
await Promise.all(['results.json', 'failure.png'].map(name => rm(path.join(output, name), { force: true })));
await writeFile(path.join(root, 'driver/package.json'), JSON.stringify({ name: 'markdown-diff-acceptance-driver', publisher: 'verification', version: '0.0.0', engines: { vscode: '^1.85.0' } }));
const contrastTexts = contrastFixture();
const intro = '# Plan\n\n| Task | Status |\n| --- | --- |\n| Test | Ready |\n\nKeep **format**.\n\n![Blocked image](https://example.invalid/acceptance.png)\n';
const before = intro + '\n' + contrastTexts.before;
const after = intro.replace('Ready', 'Done').replace('**format**', '*format*') + '\n' + contrastTexts.after + '\n<script>globalThis.__markdownAcceptanceInjected = true</script>\n\n[Unsafe link](command:workbench.action.closeWindow)\n';
await Promise.all(['before.md', 'tracked.md'].map(name => writeFile(path.join(root, 'workspace', name), before)));
await writeFile(path.join(root, 'workspace', 'after.md'), after);
const git = (...args) => execFileSync('git', args, { cwd: path.join(root, 'workspace'), encoding: 'utf8' });
git('init', '-b', 'main');
git('add', '.');
git('-c', 'user.name=Markdown acceptance', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial fixture');
await writeFile(path.join(root, 'workspace', 'tracked.md'), after.replace('Done', 'STAGED_ONLY'));
git('add', 'tracked.md');
await writeFile(path.join(root, 'workspace', 'tracked.md'), after.replace('Done', 'WORKTREE_ONLY'));
await writeFile(path.join(root, 'profile/User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none', 'workbench.enableExperiments': false,
  'update.mode': 'none', 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off',
  'files.hotExit': 'off', 'security.workspace.trust.enabled': scenario === 'restricted',
  'security.workspace.trust.startupPrompt': 'never', 'security.workspace.trust.untrustedFiles': 'open',
  'window.commandCenter': false, 'workbench.colorTheme': 'Default Dark Modern',
  'chat.disableAIFeatures': true,
  'editor.accessibilitySupport': 'on',
}));
const isolated = ['--user-data-dir', path.join(root, 'profile'), '--extensions-dir', path.join(root, 'extensions'), '--shared-data-dir', path.join(root, 'shared')];
if (packagePath) execFileSync(process.env.VSCODE_CLI || 'code', [...isolated, '--install-extension', path.resolve(packagePath), '--force'], { stdio: 'inherit' });
const port = await new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const env = { ...process.env, MARKDOWN_DIFF_IDE_ROOT: root, MARKDOWN_DIFF_IDE_EXTENSION: `${manifest.publisher}.${manifest.name}`, MARKDOWN_DIFF_IDE_COMMAND: manifest.contributes.commands[0].command };
env.MARKDOWN_DIFF_IDE_SCENARIO = scenario;
if (packagePath) env.MARKDOWN_DIFF_EXPECT_INSTALLED = '1';
delete env.ELECTRON_RUN_AS_NODE;
const args = [...isolated, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', '--disable-backgrounding-occluded-windows', `--crash-reporter-directory=${path.join(root, 'crashes')}`, `--remote-debugging-port=${port}`, `--extensionTestsPath=${path.join(repo, 'test/vscode-ide/driver.cjs')}`];
if (scenario !== 'restricted') args.push('--disable-workspace-trust');
args.push(`--extensionDevelopmentPath=${packagePath ? path.join(root, 'driver') : path.join(repo, 'vscode')}`);
if (scenario === 'virtual') {
  await writeFile(path.join(root, 'virtual.code-workspace'), JSON.stringify({ folders: [{ uri: 'markdown-diff-fs:/workspace' }] }));
  args.push(path.join(root, 'virtual.code-workspace'));
} else args.push(path.join(root, 'workspace'));
const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
let spawnError;
child.on('error', error => { spawnError = error; logs += error.stack; });
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
let browser;
let connectionError;
const checks = [];
const accessibility = [];
const performanceTrials = [];
const performanceProfiles = [];
let providerReadFailures = 0;
const imageRequests = [];
const previewDiagnostics = [];
const previewLocation = value => value?.includes('vscode-webview:') || value?.includes('/dist/webview.js');
const record = name => { checks.push(name); console.log(`PASS ${name}`); };
async function json(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } }
let requestId = 0;
async function request(action) {
  requestId++;
  const input = path.join(root, `request-${requestId}.json`);
  await writeFile(`${input}.tmp`, JSON.stringify(action));
  await rename(`${input}.tmp`, input);
  let result;
  await expect.poll(async () => { result = await json(path.join(root, `response-${requestId}.json`)); return result !== null; }, { timeout: 30000 }).toBe(true);
  assert(result.ok, result.error);
  return result.value;
}
async function comparisonFrame() {
  let found;
  await expect.poll(async () => {
    for (const context of browser.contexts()) for (const page of context.pages()) for (const frame of page.frames().reverse()) {
      if (await frame.locator('#comparison').isVisible().catch(() => false) && await frame.evaluate(() => document.visibilityState === 'visible').catch(() => false)) { found = frame; return true; }
    }
    return false;
  }, { timeout: 30000 }).toBe(true);
  return found;
}
async function prepareSourceCheck(frame) {
  await frame.evaluate(() => {
    window.__sourceAcceptance = { captureId: 0, result: null };
    window.addEventListener('message', ({ data }) => {
      if (data?.type === 'state' && data.status === 'ready' && data.snapshot) window.__sourceAcceptance.captureId = data.snapshot.captureId;
      if (data?.type === 'sourceStatus') window.__sourceAcceptance.result = data;
    });
  });
}
async function confirmedCurrentSources(frame) {
  await expect.poll(() => frame.evaluate(() => {
    const probe = window.__sourceAcceptance;
    return probe.captureId > 0 && probe.result?.captureId === probe.captureId && probe.result.status === 'current';
  })).toBe(true);
  await expect(frame.locator('#source-status')).toBeHidden();
}
async function renderedAnchor(frame) {
  return frame.evaluate(() => {
    const y = document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2;
    const row = document.elementFromPoint(innerWidth / 4, y)?.closest('.pair-row');
    return row ? { index: [...document.querySelectorAll('.pair-row')].indexOf(row), text: row.textContent, offset: y - row.getBoundingClientRect().top } : null;
  });
}
async function checkAnchor(frame, anchor) {
  const row = frame.locator('.pair-row').nth(anchor.index);
  await expect(row).toHaveText(anchor.text);
  const offset = await row.evaluate(row => document.querySelector('.extension-toolbar').getBoundingClientRect().bottom + 2 - row.getBoundingClientRect().top);
  assert(Math.abs(offset - anchor.offset) < 3, `The logical reading position moved by ${offset - anchor.offset}px.`);
}
async function reloadPreview(frame) {
  const marker = `reload-${Date.now()}`;
  await frame.evaluate(value => { globalThis.__markdownAcceptanceReload = value; }, marker);
  await request({ op: 'reload-preview' });
  await expect.poll(async () => {
    frame = await comparisonFrame();
    return frame.evaluate(value => globalThis.__markdownAcceptanceReload !== value, marker).catch(() => false);
  }, { timeout: 30000 }).toBe(true);
  return frame;
}
async function verifyProviderRecovery() {
  await request({ op: 'provider' });
  let frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('Provider changed');
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#snapshot-label')).toContainText('Snapshot captured');
  const timestamp = await frame.locator('#snapshot-label').textContent();
  await request({ op: 'provider-failure' });
  frame = await comparisonFrame();
  await frame.getByRole('button', { name: /Refresh/i }).click();
  await expect(frame.getByRole('alert')).toContainText('Refresh failed');
  await expect(frame.locator('#comparison')).toContainText('Provider changed');
  await expect(frame.locator('#snapshot-label')).toHaveText(timestamp);
  providerReadFailures = (await request({ op: 'provider-status' })).readFailures;
  assert(providerReadFailures > 0, 'The failing provider must actually have been called.');
  frame = await reloadPreview(frame);
  await expect(frame.locator('#comparison')).toContainText('Provider changed');
  await expect(frame.locator('#snapshot-label')).toHaveText(timestamp);
  await expect(frame.getByRole('alert')).toContainText(/previous snapshot/i);
  return frame;
}
async function audit(frame, name) {
  await frame.evaluate(axe.source);
  const result = await frame.evaluate(async () => {
    const report = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, preload: false });
    return {
      version: report.testEngine.version,
      violations: report.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ html, failureSummary }) => ({ html, failureSummary })) })),
      incomplete: report.incomplete.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ html, failureSummary }) => ({ html, failureSummary })) })),
      passedRules: report.passes.length,
    };
  });
  const viewport = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  accessibility.push({ name, viewport, ...result });
  await writeFile(path.join(output, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
  assert.deepEqual(result.violations, [], `Accessibility violations in ${name}: ${JSON.stringify(result.violations)}`);
  assert.deepEqual(result.incomplete, [], `Incomplete accessibility checks in ${name}: ${JSON.stringify(result.incomplete)}`);
}
async function finish(runtime) {
  for (const [name, hash] of Object.entries(harnessHashes)) assert.equal(createHash('sha256').update(await readFile(path.join(repo, name))).digest('hex'), hash, 'The harness must not change during acceptance.');
  assert.deepEqual(imageRequests, [], 'No document image request may occur during any accepted state.');
  assert.deepEqual(runtime.runtimeHashes, expectedRuntimeHashes, 'Loaded runtime bytes must match the requested package or development files.');
  assert.deepEqual(previewDiagnostics, [], 'Preview console and content-policy errors must not be ignored.');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ success: true, testedAt: new Date().toISOString(), ...runtime, scenario, installedPackage: packagePath ? path.resolve(packagePath) : null, packageSha256, expectedRuntimeHashes, harnessHashes, checks, accessibility, performanceTrials, performanceProfiles, providerReadFailures, previewDiagnostics, logicalCores: os.availableParallelism(), loadAverage: os.loadavg(), temporaryProfile: root }, null, 2));
  await request({ op: 'finish' });
}
async function captureRefresh(frame, profiling = false) {
  await frame.evaluate(profiling => {
    const region = document.querySelector('#comparison');
    const probe = { started: false, done: false, clickedAt: null, gaps: [], longTasks: [] };
    globalThis.__markdownAcceptanceProbe = probe;
    const originalWorker = window.Worker;
    if (profiling) {
      window.Worker = class extends originalWorker {
        constructor(...args) {
          super(...args);
          probe.workerCreatedAt = performance.now();
          this.addEventListener('message', () => { probe.workerMessageAt = performance.now(); }, { once: true });
        }
      };
    }
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (probe.clickedAt !== null && entry.startTime + entry.duration >= probe.clickedAt) probe.longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask' });
    let previousFrame;
    const tick = () => {
      const now = performance.now();
      if (probe.clickedAt !== null) {
        if (previousFrame !== undefined) probe.gaps.push(now - previousFrame);
        previousFrame = now;
      }
      if (!probe.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.querySelector('#refresh').addEventListener('click', () => {
      probe.clickedAt = performance.now();
      previousFrame = probe.clickedAt;
      probe.visibility = document.visibilityState;
    }, { once: true, capture: true });
    const mutation = new MutationObserver(() => {
      if (region.getAttribute('aria-busy') === 'true') probe.started = true;
      else if (probe.started) {
        mutation.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          probe.completedAt = performance.now();
          probe.elapsedMs = probe.completedAt - probe.clickedAt;
          probe.maxFrameGapMs = Math.max(0, ...probe.gaps);
          probe.maxLongTaskMs = Math.max(0, ...probe.longTasks);
          probe.framesDuringWork = probe.gaps.length;
          if (probe.workerMessageAt) probe.workerSignalMs = probe.workerMessageAt - probe.workerCreatedAt;
          observer.disconnect();
          window.Worker = originalWorker;
          probe.done = true;
        }));
      }
    });
    mutation.observe(region, { attributes: true, attributeFilter: ['aria-busy'] });
  }, profiling);
  await frame.getByRole('button', { name: /Refresh/i }).click();
  await expect.poll(() => frame.evaluate(() => globalThis.__markdownAcceptanceProbe.done), { timeout: 15000 }).toBe(true);
  const probe = await frame.evaluate(() => globalThis.__markdownAcceptanceProbe);
  return probe;
}
function checkResponsiveness(probe) {
  assert.equal(probe.visibility, 'visible');
  assert(probe.framesDuringWork > 1, 'The UI must continue presenting frames during the measured work.');
  assert(probe.elapsedMs < 12000, 'The complete warm Refresh must finish within its workload budget.');
  assert(probe.maxFrameGapMs < 250, 'The representative large comparison must not stall UI frames for a quarter second.');
}
async function measureRefresh(frame, profiling = false) {
  const probe = await captureRefresh(frame, profiling);
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#stats')).toHaveText('Lines · 0 added · 0 removed · 1 changed');
  checkResponsiveness(probe);
  return probe;
}
async function measureWorkload(frame, workload, name) {
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await frame.page().bringToFront();
  let profiler;
  let profileTarget;
  for (let target = frame; target; target = target.parentFrame()) {
    try {
      profiler = await frame.page().context().newCDPSession(target);
      profileTarget = target.url();
      break;
    } catch (error) {
      if (!error.message.includes('separate CDP session')) throw error;
    }
  }
  assert(profiler, 'The profiling trial must attach to a real renderer target.');
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.start');
  const profileTrial = await measureRefresh(frame, true);
  profileTrial.profileTarget = profileTarget;
  performanceProfiles.push({ workload: name, ...profileTrial });
  const profile = await profiler.send('Profiler.stop');
  await profiler.detach();
  await writeFile(path.join(output, `performance-${name}-profile.json`), JSON.stringify(profile));
  const trials = [];
  for (let trial = 0; trial < 5; trial++) {
    const value = await measureRefresh(frame);
    trials.push(value);
    performanceTrials.push({ workload: name, ...value });
  }
  const elapsed = trials.map(trial => trial.elapsedMs).sort((a, b) => a - b);
  const report = {
    workload, trials, medianMs: elapsed[2], rangeMs: [elapsed[0], elapsed.at(-1)],
    maxObservedFrameGapMs: Math.max(...trials.map(trial => trial.maxFrameGapMs)),
    maxObservedLongTaskMs: Math.max(...trials.map(trial => trial.maxLongTaskMs)),
    failures: 0, logicalCores: os.availableParallelism(), loadAverage: os.loadavg(),
    viewport: await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })),
    profiledTrialExcluded: profileTrial,
    method: 'Warm Refresh capture-phase click to successful initial DOM mount and two animation frames. Includes host reads, worker startup, comparison, transfer, and initial DOM construction. Excludes opening the native diff and traversing all pages. One installed artifact on one host. No speedup claim.',
  };
  await writeFile(path.join(output, `performance-${name}.json`), JSON.stringify(report, null, 2));
  if (name === 'code') await writeFile(path.join(output, 'performance.json'), JSON.stringify(report, null, 2));
}
async function verify() {
  await expect.poll(async () => {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000, noDefaults: true }); connectionError = undefined; return true; }
    catch (error) { connectionError = error.message; if (spawnError) throw spawnError; if (child.exitCode !== null) throw new Error(`VS Code exited with ${child.exitCode}.\n${logs}`); return false; }
  }, { timeout: 30000 }).toBe(true);
  await expect.poll(async () => (await json(path.join(root, 'ready.json')))?.ready, { timeout: 60000 }).toBe(true);
  const runtime = await json(path.join(root, 'ready.json'));
  assert.equal(runtime.accessibilitySupport, 'on', 'The isolated host must run in its screen-reader support mode without an autodetection prompt.');
  assert.equal(runtime.initiallyActive, false, 'The installed extension must activate through the user action, not the test driver.');
  if (scenario === 'restricted') assert.equal(runtime.trusted, false, 'The restricted-mode scenario must actually be untrusted.');
  if (scenario === 'virtual') assert.equal(runtime.virtualWorkspace, true, 'The virtual scenario must actually use a virtual workspace.');
  let page;
  await expect.poll(() => {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('vscode-file:'));
    return !!page;
  }, { timeout: 30000 }).toBe(true);
  await page.bringToFront();
  page.on('console', message => {
    if (message.type() === 'error' && (previewLocation(message.location().url) || /Content Security Policy|Refused to (load|execute)/i.test(message.text()))) previewDiagnostics.push({ type: 'console', text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => {
    if (previewLocation(error.stack)) previewDiagnostics.push({ type: 'pageerror', text: error.message, stack: error.stack });
  });
  page.on('request', request => { if (request.url().startsWith('https://example.invalid/')) imageRequests.push(request.url()); });
  const documents = await request({ op: 'manual', invoke: false });
  if (scenario !== 'virtual') assert(documents[1].dirty);
  const sourceGroup = page.locator('.editor-group-container').filter({ has: page.getByRole('tab', { name: 'Markdown acceptance comparison', exact: false }) }).first();
  const titleAction = sourceGroup.getByRole('button', { name: /Render this comparison/i });
  await expect(titleAction).toBeVisible();
  if (scenario === 'full') {
    await request({ op: 'second-group' });
    await expect(titleAction).toHaveCount(0);
    assert.equal(await request({ op: 'first-group' }), 1);
    await expect(titleAction).toBeVisible();
  }
  await titleAction.click();
  let frame = await comparisonFrame();
  assert.equal(await request({ op: 'activation-status' }), true, 'The title action must activate the installed extension.');
  record('The native title action activates the installed extension on demand');
  if (scenario !== 'virtual') await expect(frame.locator('#comparison')).toContainText('UNSAVED_ONLY');
  await expect(frame.locator('#comparison')).toContainText('Done');
  record(scenario === 'virtual' ? 'Title action renders the selected documents in a virtual workspace' : 'Editor title action uses the selected diff and includes unsaved text');
  if (scenario === 'full') {
    await request({ op: 'close-secondary' });
    frame = await comparisonFrame();
  }
  assert.equal(await frame.evaluate(() => globalThis.__markdownAcceptanceInjected), undefined);
  await expect(frame.getByRole('link', { name: 'Unsafe link' })).toHaveCount(0);
  await expect(frame.locator('#comparison img')).toHaveCount(0);
  await expect(frame.locator('.image-placeholder')).toHaveCount(6);
  for (const name of ['Deploy release', 'Code task', 'Quote task']) await expect(frame.getByRole('checkbox', { name, exact: true })).toHaveCount(2);
  assert.deepEqual(imageRequests, []);
  record('Real webview blocks unsafe Markdown and image requests');
  if (scenario === 'full') {
    const reused = await request({ op: 'reuse-second-group' });
    assert(reused.targetInitiallySecond, 'The reuse scenario must start in a different active editor group.');
    assert(reused.previewInTargetGroup && reused.matchingPreviews === 1, `Reusing the pair must reveal its one preview in the selected group: ${JSON.stringify(reused)}`);
    frame = await comparisonFrame();
    await expect(frame.locator('#comparison')).toContainText('UNSAVED_ONLY');
    await request({ op: 'join-groups' });
    frame = await comparisonFrame();
    record('Reusing the same pair reveals its single preview in the newly active editor group');
  }
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  const originalPreview = await request({ op: 'active-label' });
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).focus();
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).press('Enter');
  const nativeSource = await request({ op: 'active-diff' });
  assert.deepEqual(nativeSource.uris, documents.map(document => document.uri));
  assert.deepEqual(nativeSource.hashes, documents.map(document => createHash('sha256').update(document.text).digest('hex')));
  assert.equal(nativeSource.pairTabs, 1, 'Source must reuse the original native diff.');
  await page.getByRole('tab', { name: originalPreview, exact: false }).click();
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('.source-row')).toHaveCount(0);
  record('Keyboard Source action reuses the exact native URI pair and live text without a third tab');
  if (scenario !== 'full') {
    await audit(frame, `${scenario}-rendered`);
    await request({ op: 'capability-update' });
    await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
    const changed = await request({ op: 'active-diff' });
    assert.notEqual(changed.hashes[1], nativeSource.hashes[1]);
    assert.deepEqual(changed.uris, nativeSource.uris);
    await page.getByRole('tab', { name: originalPreview, exact: false }).click();
    frame = await comparisonFrame();
    await expect(frame.locator('#status')).toHaveText('Comparison ready');
    await expect(frame.locator('#source-status')).toContainText('Source changed since capture');
    await expect(frame.locator('#comparison')).not.toContainText('CAPABILITY_REFRESH');
    await prepareSourceCheck(frame);
    await frame.getByRole('button', { name: /Refresh/i }).focus();
    await frame.getByRole('button', { name: /Refresh/i }).press('Enter');
    await expect(frame.locator('#comparison')).toContainText('CAPABILITY_REFRESH');
    await confirmedCurrentSources(frame);
    await expect(frame.getByRole('button', { name: /Refresh/i })).toBeFocused();
    record('Refresh observes new native/provider text without losing keyboard focus');
    frame = await verifyProviderRecovery();
    record('Actual provider failure and verified reload preserve matching content and timestamp');
    await audit(frame, `${scenario}-recovery`);
    record(scenario === 'restricted' ? 'The installed extension works in actual Restricted Mode' : 'The installed extension works in an actual virtual workspace');
    await finish(runtime);
    return;
  }
  const capturedAt = await frame.locator('#snapshot-label').textContent();
  await request({ op: 'edit' });
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  const editedSource = await request({ op: 'active-diff' });
  assert.deepEqual(editedSource.uris, nativeSource.uris);
  assert.notEqual(editedSource.hashes[1], nativeSource.hashes[1]);
  assert.equal(editedSource.pairTabs, 1);
  await page.getByRole('tab', { name: originalPreview, exact: false }).click();
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#comparison')).not.toContainText('REFRESHED_ONLY');
  await expect(frame.locator('#snapshot-label')).toHaveText(capturedAt);
  await expect(frame.locator('#source-status')).toContainText('Source changed since capture');
  record('Live edits stay separate from the captured preview and its timestamp, with an accurate stale notice');
  await prepareSourceCheck(frame);
  await frame.getByRole('button', { name: /Refresh/i }).focus();
  await frame.getByRole('button', { name: /Refresh/i }).press('Enter');
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await confirmedCurrentSources(frame);
  await expect(frame.getByRole('button', { name: /Refresh/i })).toBeFocused();
  record('Keyboard Refresh updates the fixed pair, clears staleness and retains focus');
  const previewLabel = await request({ op: 'hide' });
  await page.getByRole('tab', { name: previewLabel, exact: false }).click();
  frame = await comparisonFrame();
  frame = await reloadPreview(frame);
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#comparison')).toHaveAttribute('aria-busy', 'false');
  await expect(frame.locator('#snapshot-label')).toContainText('Snapshot captured');
  record('Hide/reveal and actual webview reload restore the captured Rendered comparison');
  await audit(frame, 'rendered-reloaded');
  await request({ op: 'reading-layout' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => frame.locator('.document-cell pre').first().evaluate(pre => pre.scrollWidth <= pre.clientWidth)).toBe(true);
  const themes = await request({ op: 'themes' });
  assert(themes.some(theme => theme.uiTheme === 'hc-black') && themes.some(theme => theme.uiTheme === 'hc-light'), 'Both native high-contrast themes must be installed.');
  const contrastRecords = [];
  for (const theme of themes) {
    await request({ op: 'theme', name: theme.id });
    await expect(frame.locator('body')).toHaveAttribute('data-vscode-theme-id', theme.id);
    await frame.locator('.document-cell pre').first().scrollIntoViewIfNeeded();
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(frame.locator('#notice')).toContainText('A table with merged cells');
    const contrast = await frame.evaluate(sampleContrast);
    for (const kind of ['add', 'remove']) {
      assert(contrast.samples.some(sample => sample.code && sample.edit === kind), `Missing inline ${kind} code contrast in ${theme.id}.`);
      assert(contrast.samples.some(sample => sample.code && sample.change === kind), `Missing whole-block ${kind} code contrast in ${theme.id}.`);
      for (const tag of ['A', 'H3', 'TH', 'SUMMARY']) assert(contrast.samples.some(sample => sample.tag === tag && sample.change === kind), `Missing ${tag} on ${kind} fill in ${theme.id}.`);
    }
    assert(contrast.samples.some(sample => sample.code && sample.quote && !sample.edit), `Missing quoted code contrast in ${theme.id}.`);
    assert(contrast.samples.some(sample => sample.tag === 'BUTTON' && sample.text === 'Next'), `Missing enabled pagination contrast in ${theme.id}.`);
    assert(contrast.samples.some(sample => sample.code && sample.link && !sample.change), `Missing linked code contrast in ${theme.id}.`);
    if (theme.uiTheme === 'vs-dark') assert.deepEqual(contrast.palette.body.foreground, contrast.palette.nativeEditor.foreground, `Unfilled page ink must retain ${theme.id}'s editor foreground.`);
    assert(contrast.nonText.some(sample => sample.kind === 'task-checkmark'), `Missing task-state contrast in ${theme.id}.`);
    contrastRecords.push({ theme, ...contrast });
    await writeFile(path.join(output, 'contrast.json'), JSON.stringify(contrastRecords, null, 2));
    assert.deepEqual(contrast.failures, [], `Text contrast in ${theme.id}: ${JSON.stringify(contrast.failures)}`);
    assert.deepEqual(contrast.nonTextFailures, [], `State-cue contrast in ${theme.id}: ${JSON.stringify(contrast.nonTextFailures)}`);
    const interactions = await interactiveContrast(page, frame);
    contrastRecords.push(...interactions.map(state => ({ theme, ...state })));
    await writeFile(path.join(output, 'contrast.json'), JSON.stringify(contrastRecords, null, 2));
    for (const state of interactions) {
      assert.deepEqual(state.failures, [], `Text contrast in ${theme.id}, ${state.state}, ${state.target}: ${JSON.stringify(state.failures)}`);
      assert.deepEqual(state.nonTextFailures, [], `State-cue contrast in ${theme.id}, ${state.state}, ${state.target}: ${JSON.stringify(state.nonTextFailures)}`);
      if (state.state === 'keyboard-focus') assert(state.nonText.some(sample => sample.kind === 'focus-ring'), `Missing visible focus ring in ${theme.id}.`);
    }
    await frame.locator('.document-cell pre').first().scrollIntoViewIfNeeded();
    await expect(page.getByText('Are you using a screen reader to operate VS Code?', { exact: true })).toBeHidden();
    await audit(frame, theme.id);
    const name = theme.id.replace(/[^a-z0-9]+/gi, '-');
    if (theme.uiTheme === 'hc-light') {
      await frame.locator('#refresh').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(frame.locator('#open-source')).toBeFocused();
      await page.screenshot({ path: path.join(output, `${name}-source-focus.png`) });
      const codeLink = frame.getByRole('link', { name: 'codeGuide()', exact: true }).first();
      await codeLink.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(codeLink).toBeFocused();
      await page.screenshot({ path: path.join(output, `${name}-code-link-focus.png`) });
    }
    await frame.evaluate(() => document.activeElement.blur());
    if (theme.uiTheme === 'hc-light' || theme.id === 'Abyss') await frame.locator('.pair-row').filter({ has: frame.getByRole('checkbox', { name: 'Task before', exact: true }) }).screenshot({ path: path.join(output, `${name}-task-states.png`) });
    await frame.locator('.document-cell pre').first().scrollIntoViewIfNeeded();
    await frame.locator('.document-cell pre').first().screenshot({ path: path.join(output, `${name}-code.png`) });
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  await request({ op: 'theme', name: themes.find(theme => theme.uiTheme === 'hc-light').id });
  await expect(frame.locator('body')).toHaveClass(/vscode-high-contrast-light/);
  await frame.evaluate(() => window.scrollTo(0, 0));
  record('Every installed native theme passes code/diff text contrast and automated WCAG checks, with its exact theme ID confirmed');
  await request({ op: 'reading-layout' });
  await page.setViewportSize({ width: 1000, height: 700 });
  await request({ op: 'zoom', level: Math.log(2) / Math.log(1.2) });
  await expect(frame.getByRole('button', { name: 'Open live Source diff', exact: true })).toBeInViewport();
  await expect(frame.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport();
  const narrowViewport = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  assert(narrowViewport.width >= 300 && narrowViewport.width <= 600, `Expected a narrow readable editor column, got ${narrowViewport.width}px.`);
  assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The narrow zoomed preview must not overflow horizontally.');
  await frame.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'narrow-top.png') });
  await frame.locator('#notice').scrollIntoViewIfNeeded();
  await expect(frame.locator('#notice')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: path.join(output, 'narrow-warning.png') });
  await frame.locator('#comparison h1').first().scrollIntoViewIfNeeded();
  await expect(frame.locator('#comparison h1').first()).toBeInViewport({ ratio: 1 });
  await audit(frame, 'narrow-200-percent');
  await page.screenshot({ path: path.join(output, 'narrow-zoom.png') });
  await request({ op: 'zoom', level: 0 });
  await page.setViewportSize({ width: 1440, height: 900 });
  record('The installed preview remains usable in a narrow column at 200 percent zoom');
  const successfulContent = await frame.locator('#comparison').textContent();
  const successfulProvenance = await frame.locator('#snapshot-label').textContent();
  await request({ op: 'edit' });
  await frame.evaluate(() => {
    const append = Element.prototype.append;
    Element.prototype.append = function (...children) {
      if (this.classList.contains('pair-row')) {
        Element.prototype.append = append;
        throw new Error('Injected DOM presentation fault');
      }
      return append.apply(this, children);
    };
  });
  await frame.getByRole('button', { name: /Refresh/i }).click();
  await expect(frame.getByRole('alert')).toContainText('Injected DOM presentation fault');
  await expect(frame.locator('#comparison')).toHaveText(successfulContent);
  await expect(frame.locator('#snapshot-label')).toHaveText(successfulProvenance);
  frame = await reloadPreview(frame);
  await expect(frame.locator('#comparison')).toHaveText(successfulContent);
  await expect(frame.locator('#snapshot-label')).toHaveText(successfulProvenance);
  await expect(frame.getByRole('alert')).toContainText(/previous snapshot/i);
  await audit(frame, 'presentation-error-recovery');
  await frame.locator('body').screenshot({ path: path.join(output, 'presentation-recovery.png') });
  record('A real DOM presentation fault retains matching content and provenance through a verified webview reload');
  await request({ op: 'malformed' });
  await frame.getByRole('button', { name: /Refresh/i }).click();
  await expect(frame.getByRole('alert')).toContainText(/previous snapshot/i);
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  for (const theme of themes) {
    await request({ op: 'theme', name: theme.id });
    await expect(frame.locator('body')).toHaveAttribute('data-vscode-theme-id', theme.id);
    const contrast = await frame.evaluate(sampleContrast);
    contrastRecords.push({ theme, state: 'comparison-error', ...contrast });
    await writeFile(path.join(output, 'contrast.json'), JSON.stringify(contrastRecords, null, 2));
    assert.deepEqual(contrast.failures, [], `Error-state text contrast in ${theme.id}: ${JSON.stringify(contrast.failures)}`);
    assert.deepEqual(contrast.nonTextFailures, [], `Error-state cue contrast in ${theme.id}: ${JSON.stringify(contrast.nonTextFailures)}`);
  }
  record('Recovery notices and the retained comparison stay readable across every installed native theme');
  const failedPreviewLabel = await request({ op: 'hide' });
  await page.getByRole('tab', { name: failedPreviewLabel, exact: false }).click();
  frame = await comparisonFrame();
  await expect(frame.getByRole('alert')).toContainText(/previous snapshot/i);
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  record('Failed comparisons preserve the previous snapshot after webview recreation');
  await request({ op: 'dispose' });
  await request({ op: 'manual' });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('UNSAVED_ONLY');
  record('Closing and reopening a comparison creates a working fresh preview');
  await request({ op: 'git', staged: false });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('WORKTREE_ONLY');
  await expect(frame.locator('#comparison')).not.toContainText('STAGED_ONLY');
  record('Real Git working-tree comparison preserves its selected documents');
  await request({ op: 'git', staged: true });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('STAGED_ONLY');
  await expect(frame.locator('#comparison')).not.toContainText('WORKTREE_ONLY');
  record('Real Git staged comparison preserves the index baseline');
  const previewDocuments = await request({ op: 'preview-diff' });
  assert(previewDocuments.every(document => document.preview), 'The native input must really begin as a clean preview-mode diff tab.');
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  const previewSource = await request({ op: 'active-diff' });
  assert.deepEqual(previewSource.uris, previewDocuments.map(document => document.uri));
  assert.deepEqual(previewSource.hashes, previewDocuments.map(document => createHash('sha256').update(document.text).digest('hex')));
  assert.equal(previewSource.pairTabs, 1);
  record('Live Source supports an original preview-mode native diff without duplicating or substituting the pair');
  await request({ op: 'reading-state' });
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  while (await frame.locator('.pair-row').count() < 480) {
    const count = await frame.locator('.pair-row').count();
    await frame.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => frame.locator('.pair-row').count()).toBeGreaterThan(count);
  }
  await frame.locator('.pair-row').nth(360).scrollIntoViewIfNeeded();
  await frame.locator('.pair-row').nth(360).evaluate(row => scrollBy(0, row.getBoundingClientRect().top - 100));
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))));
  const anchor = await renderedAnchor(frame);
  assert(anchor?.index > 120, 'The actual visible reading position must be beyond the initial Rendered batch.');
  const readingTimestamp = await frame.locator('#snapshot-label').textContent();
  const readingPreview = await request({ op: 'active-label' });
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  await request({ op: 'active-diff' });
  await page.getByRole('tab', { name: readingPreview, exact: false }).click();
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#snapshot-label')).toHaveText(readingTimestamp);
  await checkAnchor(frame, anchor);
  record('The actual Source round trip preserves a Rendered reading position beyond the initial batch');
  frame = await reloadPreview(frame);
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#snapshot-label')).toHaveText(readingTimestamp);
  await checkAnchor(frame, anchor);
  record('Verified webview reload preserves the same deep Rendered row and offset');
  const tableWorkload = await request({ op: 'large' });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('Row 0');
  await expect(frame.locator('#comparison').getByRole('button', { name: /next/i }).first()).toBeVisible();
  record('A 1200-row table uses rendered pagination');
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) await frame.locator('#comparison').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(frame.locator('.table-pager [role=status]')).toContainText('Rows 301');
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  frame = await reloadPreview(frame);
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('.table-pager [role=status]')).toContainText('Rows 301');
  await expect(frame.locator('#comparison')).toContainText('Row 300');
  record('Verified webview reload restores a nonzero rendered table page');
  await measureWorkload(frame, tableWorkload, 'table');
  record('Five measured 1200-row table refreshes finish correctly with bounded observed UI frame gaps');
  const proseWorkload = await request({ op: 'prose' });
  frame = await comparisonFrame();
  await measureWorkload(frame, proseWorkload, 'prose');
  record('Five measured 100-section prose refreshes finish correctly with bounded observed UI frame gaps');
  const workload = await request({ op: 'large-code' });
  frame = await comparisonFrame();
  await measureWorkload(frame, workload, 'code');
  record('Five measured 50000-line code refreshes finish correctly with bounded observed UI frame gaps');
  const codePreview = await request({ op: 'active-label' });
  await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
  const nativeCode = await request({ op: 'active-diff' });
  assert.equal(nativeCode.pairTabs, 1);
  assert.match(await request({ op: 'live-position', line: 39999 }), /line39996/);
  const visibleLine = () => page.locator('.editor-group-container.active .view-line').filter({ hasText: 'line39996' }).first();
  await expect(visibleLine()).toBeVisible();
  const sourceTrials = [];
  for (let trial = 0; trial < 5; trial++) {
    const previewStarted = performance.now();
    await page.getByRole('tab', { name: codePreview, exact: false }).click();
    frame = await comparisonFrame();
    await expect(frame.locator('#status')).toHaveText('Comparison ready');
    await expect(frame.locator('.source-row')).toHaveCount(0);
    const previewReturnMs = performance.now() - previewStarted;
    const started = performance.now();
    await frame.getByRole('button', { name: 'Open live Source diff', exact: true }).click();
    await expect(visibleLine()).toBeVisible();
    const elapsedMs = performance.now() - started;
    const source = await request({ op: 'active-diff' });
    assert.deepEqual(source.uris, nativeCode.uris);
    assert.deepEqual(source.hashes, nativeCode.hashes);
    assert.equal(source.pairTabs, 1);
    assert(source.visibleRanges.some(range => range.start <= 39999 && range.end >= 39999));
    sourceTrials.push({ elapsedMs, previewReturnMs });
  }
  await writeFile(path.join(output, 'native-source.json'), JSON.stringify({ packageSha256, version: runtime.version,
    line: 39999, workload, trials: sourceTrials,
    method: 'Five warm round trips between the captured preview and the existing original native diff near line 40000 of the 50000-line code fixture. elapsedMs is Source click to visible native line; previewReturnMs is preview-tab click to Comparison ready. Both include automation overhead and cached inputs; preview return includes rebuilding the captured comparison. Original URI pair, text hashes, one diff tab and visible range asserted. No process memory, pixel offset or user percentile claim.' }, null, 2));
  await page.getByRole('tab', { name: codePreview, exact: false }).click();
  frame = await comparisonFrame();
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  record('Five native Source returns reuse the same live pair and preserve visible line 40000 without Source DOM');
  const admittedContent = await frame.locator('#comparison').textContent();
  const admittedTimestamp = await frame.locator('#snapshot-label').textContent();
  const oversized = await request({ op: 'oversized' });
  assert(oversized.characters < 8000000 && oversized.lines < 200000, 'The stress fixture must pass the coarse input caps.');
  const stress = await captureRefresh(frame);
  await expect(frame.getByRole('alert')).toContainText('section is too large');
  await expect(frame.locator('#comparison')).toHaveText(admittedContent);
  await expect(frame.locator('#snapshot-label')).toHaveText(admittedTimestamp);
  checkResponsiveness(stress);
  await writeFile(path.join(output, 'oversized-section.json'), JSON.stringify({ input: oversized, observation: stress, rejectedBeforePresentation: true }, null, 2));
  record('An oversized legal-size section is rejected before presentation while the prior view and UI responsiveness remain intact');
  frame = await verifyProviderRecovery();
  record('Actual provider failure and verified reload preserve matching content and timestamp');
  assert.equal(await readFile(path.join(root, 'workspace', 'after.md'), 'utf8'), after);
  record('Preview and refresh never write the source file');
  await finish(runtime);
}
try { await verify(); } catch (error) {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ success: false, testedAt: new Date().toISOString(), packageSha256, checksCompleted: checks, previewDiagnostics, error: error.stack, connectionError, temporaryProfile: root }, null, 2));
  if (!browser && connectionError) console.error(connectionError);
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'vscode.log'), logs);
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill('SIGTERM');
}
