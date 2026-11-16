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

const repo = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repo, 'vscode/package.json'), 'utf8'));
const harnessHashes = {};
for (const name of ['scripts/test-vscode-ide.mjs', 'test/vscode-ide/driver.cjs']) harnessHashes[name] = createHash('sha256').update(await readFile(path.join(repo, name))).digest('hex');
const packagePath = process.argv[2];
const scenario = process.env.MARKDOWN_DIFF_IDE_SCENARIO || 'full';
assert(['full', 'restricted', 'virtual'].includes(scenario), 'Unknown IDE acceptance scenario.');
const packageSha256 = packagePath ? createHash('sha256').update(await readFile(packagePath)).digest('hex') : null;
const executable = process.env.VSCODE_EXECUTABLE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const root = await mkdtemp(path.join(os.tmpdir(), 'markdown-diff-ide-'));
console.log(`Isolated VS Code profile ${root}`);
const outputName = process.env.MARKDOWN_DIFF_IDE_ARTIFACT_NAME || (scenario === 'full' ? (packagePath ? 'vscode-ide-installed' : 'vscode-ide-development') : `vscode-ide-${scenario}`);
const output = path.join(repo, 'artifacts', path.basename(outputName));
for (const name of ['workspace', 'profile/User', 'extensions', 'shared', 'crashes', 'driver']) await mkdir(path.join(root, name), { recursive: true });
await mkdir(output, { recursive: true });
await Promise.all(['results.json', 'failure.png'].map(name => rm(path.join(output, name), { force: true })));
await writeFile(path.join(root, 'driver/package.json'), JSON.stringify({ name: 'markdown-diff-acceptance-driver', publisher: 'verification', version: '0.0.0', engines: { vscode: '^1.85.0' } }));
const before = '# Plan\n\n| Task | Status |\n| --- | --- |\n| Test | Ready |\n\nKeep **format**.\n\n![Blocked image](https://example.invalid/acceptance.png)\n';
const after = before.replace('Ready', 'Done').replace('**format**', '*format*') + '\n<script>globalThis.__markdownAcceptanceInjected = true</script>\n\n[Unsafe link](command:workbench.action.closeWindow)\n';
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
const args = [...isolated, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-telemetry', `--crash-reporter-directory=${path.join(root, 'crashes')}`, `--remote-debugging-port=${port}`, `--extensionTestsPath=${path.join(repo, 'test/vscode-ide/driver.cjs')}`];
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
      if (await frame.locator('#comparison').isVisible().catch(() => false)) { found = frame; return true; }
    }
    return false;
  }, { timeout: 30000 }).toBe(true);
  return found;
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
}
async function finish(runtime) {
  for (const [name, hash] of Object.entries(harnessHashes)) assert.equal(createHash('sha256').update(await readFile(path.join(repo, name))).digest('hex'), hash, 'The harness must not change during acceptance.');
  assert.deepEqual(imageRequests, [], 'No document image request may occur during any accepted state.');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ success: true, testedAt: new Date().toISOString(), ...runtime, scenario, installedPackage: packagePath ? path.resolve(packagePath) : null, packageSha256, harnessHashes, checks, accessibility, performanceTrials, performanceProfiles, providerReadFailures, logicalCores: os.availableParallelism(), loadAverage: os.loadavg(), temporaryProfile: root }, null, 2));
  await request({ op: 'finish' });
}
async function measureRefresh(frame, profiling = false) {
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
  await expect(frame.locator('#status')).toHaveText('Comparison ready');
  await expect(frame.locator('#stats')).toHaveText('Lines · 0 added · 0 removed · 1 changed');
  assert.equal(probe.visibility, 'visible');
  assert(probe.framesDuringWork > 1, 'The UI must continue presenting frames during the measured work.');
  assert(probe.elapsedMs < 12000, 'The complete warm Refresh must finish within its workload budget.');
  assert(probe.maxFrameGapMs < 250, 'The representative large comparison must not stall UI frames for a quarter second.');
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
  if (scenario === 'restricted') assert.equal(runtime.trusted, false, 'The restricted-mode scenario must actually be untrusted.');
  if (scenario === 'virtual') assert.equal(runtime.virtualWorkspace, true, 'The virtual scenario must actually use a virtual workspace.');
  const page = browser.contexts()[0].pages()[0];
  page.on('request', request => { if (request.url().includes('acceptance.png')) imageRequests.push(request.url()); });
  const documents = await request({ op: 'manual', invoke: false });
  if (scenario !== 'virtual') assert(documents[1].dirty);
  const sourceGroup = page.locator('.editor-group-container').filter({ has: page.getByRole('tab', { name: 'Markdown acceptance comparison', exact: false }) }).first();
  const titleAction = sourceGroup.getByRole('button', { name: /Render this comparison/i });
  await expect(titleAction).toBeVisible();
  if (scenario === 'full') {
    await request({ op: 'second-group' });
    await sourceGroup.getByRole('tab', { name: 'Markdown acceptance comparison', exact: false }).click();
    await expect(titleAction).toBeVisible();
  }
  await titleAction.click();
  let frame = await comparisonFrame();
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
  await expect(frame.locator('.image-placeholder')).toHaveCount(2);
  assert.deepEqual(imageRequests, []);
  record('Real webview blocks unsafe Markdown and image requests');
  await frame.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(frame.locator('#comparison')).toContainText('**format**');
  await expect(frame.locator('#comparison')).toContainText('*format*');
  record('Source retains exact formatting syntax');
  if (scenario !== 'full') {
    await audit(frame, `${scenario}-source`);
    record(scenario === 'restricted' ? 'The installed extension works in actual Restricted Mode' : 'The installed extension works in an actual virtual workspace');
    await finish(runtime);
    return;
  }
  await request({ op: 'edit' });
  await expect(frame.locator('#comparison')).not.toContainText('REFRESHED_ONLY');
  await frame.getByRole('button', { name: /Refresh/i }).focus();
  await frame.getByRole('button', { name: /Refresh/i }).press('Enter');
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  await expect(frame.getByRole('button', { name: /Refresh/i })).toBeFocused();
  record('Refresh updates the fixed pair and snapshots stay fixed before refresh');
  await frame.getByRole('button', { name: 'Rendered', exact: true }).focus();
  await frame.getByRole('button', { name: 'Rendered', exact: true }).press('Enter');
  await expect(frame.getByRole('button', { name: 'Rendered', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await frame.getByRole('button', { name: 'Source', exact: true }).focus();
  await frame.getByRole('button', { name: 'Source', exact: true }).press('Enter');
  await expect(frame.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  record('Keyboard switches the comparison mode');
  const previewLabel = await request({ op: 'hide' });
  await page.getByRole('tab', { name: previewLabel, exact: false }).click();
  frame = await comparisonFrame();
  frame = await reloadPreview(frame);
  await expect(frame.locator('#comparison')).toContainText('REFRESHED_ONLY');
  await expect(frame.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  record('Hide/reveal and actual webview reload restore the snapshot and non-default Source mode');
  await audit(frame, 'source-dark');
  await frame.getByRole('button', { name: 'Rendered', exact: true }).click();
  for (const [name, theme] of [['dark', 'Default Dark Modern'], ['light', 'Default Light Modern'], ['high-contrast', 'Default High Contrast'], ['high-contrast-light', 'Default High Contrast Light']]) {
    await request({ op: 'theme', name: theme });
    await expect(frame.locator('body')).toHaveClass(new RegExp(name === 'high-contrast' ? 'vscode-high-contrast' : `vscode-${name}`));
    await frame.locator('body').screenshot({ path: path.join(output, `${name}.png`) });
    await audit(frame, name);
  }
  record('All four native themes and non-default Source mode pass automated WCAG checks');
  await request({ op: 'reading-layout' });
  await page.setViewportSize({ width: 1000, height: 700 });
  await request({ op: 'zoom', level: Math.log(2) / Math.log(1.2) });
  await expect(frame.getByRole('button', { name: 'Source', exact: true })).toBeInViewport();
  await expect(frame.getByRole('button', { name: 'Refresh', exact: true })).toBeInViewport();
  const narrowViewport = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  assert(narrowViewport.width >= 300 && narrowViewport.width <= 600, `Expected a narrow readable editor column, got ${narrowViewport.width}px.`);
  assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The narrow zoomed preview must not overflow horizontally.');
  await audit(frame, 'narrow-200-percent');
  await frame.locator('body').screenshot({ path: path.join(output, 'narrow-zoom.png') });
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
  const tableWorkload = await request({ op: 'large' });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('Row 0');
  await expect(frame.locator('#comparison').getByRole('button', { name: /next/i }).first()).toBeVisible();
  record('A 1200-row table uses rendered pagination');
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
  await request({ op: 'provider' });
  frame = await comparisonFrame();
  await expect(frame.locator('#comparison')).toContainText('Provider changed');
  await request({ op: 'provider-failure' });
  frame = await comparisonFrame();
  await frame.getByRole('button', { name: /Refresh/i }).click();
  await expect(frame.getByRole('alert')).toContainText('Refresh failed');
  await expect(frame.locator('#comparison')).toContainText('Provider changed');
  providerReadFailures = (await request({ op: 'provider-status' })).readFailures;
  assert(providerReadFailures > 0, 'The failing provider must actually have been called.');
  record('A provider failure preserves the last successful comparison');
  assert.equal(await readFile(path.join(root, 'workspace', 'after.md'), 'utf8'), after);
  record('Preview and refresh never write the source file');
  await finish(runtime);
}
try { await verify(); } catch (error) {
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ success: false, testedAt: new Date().toISOString(), packageSha256, checksCompleted: checks, error: error.stack, connectionError, temporaryProfile: root }, null, 2));
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
