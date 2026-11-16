import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFile(path.join(root, name));
const json = async name => JSON.parse(await read(name));
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = await json('vscode/package.json');
const packageName = `${manifest.name}-${manifest.version}.vsix`;
const packagePath = path.join(root, 'artifacts', packageName);
const packageSha256 = sha(await readFile(packagePath));
const built = await json('artifacts/vscode-build.json');
for (const [name, hash] of Object.entries({ ...built.inputs, ...built.outputs })) assert.equal(sha(await read(name)), hash, `Stale build record for ${name}.`);
const runtime = {};
for (const name of ['extension.cjs', 'dist/webview.js', 'dist/webview.css']) {
  runtime[name] = sha(execFileSync('unzip', ['-p', packagePath, `extension/${name}`]));
  assert.equal(runtime[name], sha(await read(`vscode/${name}`)), `Package differs from local runtime ${name}.`);
}
assert.deepEqual(JSON.parse(execFileSync('unzip', ['-p', packagePath, 'extension/package.json'])), manifest);
assert.equal(sha(execFileSync('unzip', ['-p', packagePath, 'extension/readme.md'])), sha(await read('vscode/README.md')));

const matrix = [];
let harnessHashes;
for (const scenario of ['installed', 'minimum', 'restricted', 'virtual']) {
  const folder = `artifacts/vscode-ide-${scenario}`;
  const run = await json(`${folder}/results.json`);
  assert(run.success, `Acceptance did not pass for ${scenario}.`);
  assert.equal(run.packageSha256, packageSha256);
  assert.deepEqual(run.runtimeHashes, runtime);
  assert.deepEqual(run.expectedRuntimeHashes, runtime);
  assert.deepEqual(run.previewDiagnostics, []);
  for (const [name, hash] of Object.entries(run.harnessHashes)) assert.equal(sha(await read(name)), hash, `Harness changed since ${scenario}.`);
  if (harnessHashes) assert.deepEqual(run.harnessHashes, harnessHashes);
  harnessHashes = run.harnessHashes;
  assert(run.accessibility.every(audit => !audit.violations.length && !audit.incomplete.length));
  const measurements = [];
  if (scenario === 'installed' || scenario === 'minimum') {
    for (const name of ['table', 'prose', 'code']) {
      const report = await json(`${folder}/performance-${name}.json`);
      const trials = run.performanceTrials.filter(trial => trial.workload === name).map(({ workload, ...trial }) => trial);
      assert.deepEqual(report.trials, trials, `Timing data is not from the ${scenario} run.`);
      assert.equal(trials.length, 5);
      assert.equal(report.failures, 0);
      const elapsed = trials.map(trial => trial.elapsedMs).sort((a, b) => a - b);
      assert.equal(report.medianMs, elapsed[2]);
      assert.deepEqual(report.rangeMs, [elapsed[0], elapsed.at(-1)]);
      measurements.push({ workload: name, input: report.workload, trials: trials.length,
        median_ms: report.medianMs, range_ms: report.rangeMs,
        maximum_observed_frame_gap_ms: report.maxObservedFrameGapMs,
        maximum_observed_long_task_ms: report.maxObservedLongTaskMs,
        failures: report.failures, profiled_trial_total_ms: report.profiledTrialExcluded.elapsedMs,
        profiled_worker_round_trip_ms: report.profiledTrialExcluded.workerSignalMs });
    }
  }
  matrix.push({ scenario, vscode_version: run.version, trusted: run.trusted, virtual_workspace: run.virtualWorkspace,
    completed_checks: run.checks, accessibility_states: run.accessibility.map(audit => ({ name: audit.name, viewport: audit.viewport,
      axe_version: audit.version, violations: audit.violations.length, incomplete: audit.incomplete.length })),
    measurements, tested_at: run.testedAt });
}
const count = (log, expression) => {
  const matches = [...log.replace(/\x1b\[[0-9;]*m/g, '').matchAll(expression)];
  assert(matches.length, 'Test count missing from log.');
  return Number(matches.at(-1)[1]);
};
const website = (await read('artifacts/website-check.log')).toString();
const preview = (await read('artifacts/vscode-check.log')).toString();
const checks = { website_node_tests: count(website, /(?:ℹ |# )tests\s+(\d+)/g),
  website_browser_tests: count(website, /(\d+) passed\s*\(/g),
  host_tests: count(preview, /(?:ℹ |# )tests\s+(\d+)/g),
  bundled_browser_tests: count(preview, /(\d+) passed\s*\(/g) };
const policy = await json('vscode/preview-limits.json');
const summary = { package: packageName, package_sha256: packageSha256, runtime_sha256: runtime,
  build: { inputs: built.inputs, outputs: built.outputs, node_version: built.nodeVersion },
  harness_sha256: harnessHashes, recorder_sha256: sha(await read('scripts/record-vscode-verification.mjs')),
  platform: 'macOS arm64', checks, policy, matrix,
  limits: ['One host and desktop platform.', 'No manual screen-reader study.',
    'Warm cached inputs and initial mounting, not complete traversal.', 'No hard paint-time or peak-memory bound.',
    'Not every external provider.', 'No speedup or user-percentile claim.'] };
await writeFile(path.join(root, 'docs/vscode-verification.json'), `${JSON.stringify(summary, null, 2)}\n`);
const versions = matrix.filter(run => run.measurements.length);
const auditCount = matrix.reduce((total, run) => total + run.accessibility_states.length, 0);
const labels = { table: '1,200-row table', prose: '100-section prose', code: '50,000 code lines' };
const rows = versions.flatMap(run => run.measurements.map(value => `| ${run.vscode_version} | ${labels[value.workload]} | ${value.median_ms.toFixed(1)} | ${value.range_ms.map(x => x.toFixed(1)).join(' to ')} | ${value.maximum_observed_frame_gap_ms.toFixed(1)} | ${value.maximum_observed_long_task_ms.toFixed(1)} |`));
const scenarios = matrix.map(run => `| ${run.scenario} | ${run.vscode_version} | ${run.trusted} | ${run.virtual_workspace} | ${run.completed_checks.length} | ${run.accessibility_states.length} |`);
const report = `# VS Code extension verification

This record covers the read-only snapshot of the native Markdown text comparison. Native VS Code selects the pair and owns editing. The shared engine compares captured text, and explicit Refresh reads the same pair again.

## Artifact identity

Package \`${packageName}\`, SHA-256 \`${packageSha256}\`.

The [structured record](vscode-verification.json) binds source inputs, bundled outputs, archive entries, installed runtime files, and the unchanged acceptance harness. The build hashes inputs before bundling and checks them afterward. Each installed run compares its loaded bytes directly with the requested archive. The recorder refuses stale or inconsistent records and can be rerun with \`npm run record:vscode\`.

## Installed matrix

All runs use the same package on one macOS arm64 host. The minimum application was Microsoft's official signed and notarized build, verified before execution. Each scenario below passed its named checks. Capability runs do not claim every external provider.

| Scenario | VS Code | Trusted | Virtual workspace | Checks | Audited states |
| --- | --- | --- | --- | ---: | ---: |
${scenarios.join('\n')}

The source gates passed ${checks.website_node_tests} Node tests and ${checks.website_browser_tests} website browser tests, plus the separately invoked ${checks.host_tests} host and ${checks.bundled_browser_tests} bundled browser tests. Some counts overlap. They are not independent totals to add.

## Correctness, recovery and reading state

Installed checks exercise the title action, unsaved text, exact Source syntax, fixed-pair Refresh, keyboard focus, group reuse, real Git pairs, provider failure, and actual webview reload. A DOM insertion fault must keep content and timestamp coherent. Browser checks cover both failure/recreation orders, stale completions, initial and later DOM faults, alignment, paging, cancellation and bounded failed rollback.

The host remembers the last current input confirmed after initial DOM mounting and alignment. The client owns actual visibility and notice wording. A narrowly crossed native-command re-run can recover an earlier coherent confirmed snapshot. This accepted fallback does not corrupt or write files and is not a claim of atomic pixels across processes.

Logical reading bookmarks contain a row anchor, offset and page indices, tied to the snapshot ID. They contain no document text. Reload restores deep Source and a nonzero page after mounting the needed frontier and bounded layout settling. User navigation can cancel an automatic jump. Restoration is linear in preceding rows; errors deliberately return to a safe beginning rather than re-enter a faulty page.

## Accessibility and diagnostics

The ${auditCount} saved axe-core states report zero WCAG-tagged violations and zero incomplete checks, both of which the runner asserts. Full runs include Source, four native themes, native 200 percent zoom and recovery. Capability runs include Source and recovery. Refresh stays focusable, persistent live messages are not needlessly rewritten, and visible/audible side vocabulary agrees. Automated checks and semantic markup are not a manual screen-reader study or universal conformance claim.

The runner records preview-associated console, page and content-policy diagnostics separately from main-process logs and fails on unexpected preview errors. Narrow layout also has explicit viewport assertions; its whole-window image is supporting evidence, not a substitute for them.

## Responsiveness observations

Each row summarizes five successful warm Refresh trials. Values are milliseconds. A separate profiling trial is excluded from each range and median.

| VS Code | Workload per document | Median wait | Trial range | Largest observed frame gap | Largest observed long task |
| --- | --- | ---: | ---: | ---: | ---: |
${rows.join('\n')}

Timing starts at the capture-phase click and ends after the initial mounted frontier plus two animation frames. It includes cached native reads, worker startup, comparison, transfer and initial DOM construction. It excludes opening the native diff, every later page and first file loading. Every trial validates successful output and one changed source line. Raw records preserve input bytes, host load, actual viewport and observed callbacks.

Profiles separate the broad worker round trip from the remaining initial-view work. That interval includes startup, computation and transfer, not pure CPU time. There is no speedup claim. Zero long-task values mean no observed overlapping task at the 50 ms threshold; frame sampling is not every paint or a user percentile.

## Resource limits and delivery

The host checks 200,000 native lines before copying text and 8 million characters per side. The extension worker admits at most ${policy.worker.characters.toLocaleString('en-US')} serialized UTF-16 characters and ${policy.worker.elements.toLocaleString('en-US')} opening elements per paired materialized row/page or Source row. Supported paginated code is checked per page, not by total output. Oversized indivisible sections fail explicitly before DOM parsing; native source access remains. No text is silently truncated.

View batches use row caps plus ${policy.batch.characters.toLocaleString('en-US')} characters or ${policy.batch.milliseconds} ms of scheduling admission. One admitted row is indivisible. These are work-admission guards, not hard paint-time or peak-memory bounds. Worker computation has its existing 12-second timeout. Low-end machines, full traversal and other desktop platforms remain unmeasured.

Images are placeholders. Inert preparation is tested with image CSP relaxed in a fixture, including later pages; production CSP remains strict. Only credential-free HTTPS links cross the external-action boundary. Production code has no document-write operation.

The default lifecycle can release hidden DOM and derived results. The host retains inputs and rebuilds presentation when needed. Retaining hidden views would not eliminate explicit reload recovery. No memory-saving number is claimed.

Official vsce creates the installer, with a scoped patched minimatch development-tool dependency. The saved dependency audit is separate evidence. Raw logs, screenshots, hashes, profiles and trials live under ignored \`artifacts/\`; this portable summary omits temporary profile paths.

## Reproduce

\`\`\`sh
npm ci
npm run check
npm run test:vscode
npm run package:vscode
npm run test:vscode:ide -- artifacts/${packageName}
MARKDOWN_DIFF_IDE_SCENARIO=restricted npm run test:vscode:ide -- artifacts/${packageName}
MARKDOWN_DIFF_IDE_SCENARIO=virtual npm run test:vscode:ide -- artifacts/${packageName}
npm run record:vscode
\`\`\`

Set \`VSCODE_EXECUTABLE_PATH\` and a distinct \`MARKDOWN_DIFF_IDE_ARTIFACT_NAME\` for another installed version. All profiles and extension directories are temporary. The CDP connection preserves Electron's browser context because older Electron does not implement Chromium's download-context controls. CI execution and council judgments are recorded separately on the PR.
`;
await writeFile(path.join(root, 'docs/vscode-verification.md'), report);
console.log(`Recorded ${matrix.length} matching installed scenarios for ${packageSha256}.`);
