# VS Code extension acceptance, 2026-11-16

This record covers the read-only snapshot of the native Markdown text comparison. Native VS Code selects the pair and owns editing. The shared engine compares captured text, and explicit Refresh reads the same pair again.

## Artifact identity

Package `markdown-diff-vscode-0.1.0.vsix`, SHA-256 `93e8fa16ecdd3bbfed5aa83d7d54ddfed0707cb8c43b12a602f7e30462db0022`.

This dated snapshot describes one built candidate. Future candidates keep their own results. Each installed run asserts that its loaded runtime files match the requested archive. Raw records preserve the package and test-harness hashes, versions, named checks and trial data in ignored `artifacts/`.

## Installed matrix

All runs use the same package on one macOS arm64 host. The acceptance driver runs in an isolated Extension Development Host and asserts that product files come from the VSIX installation. It leaves the product inactive until the native title action activates it. The minimum application was Microsoft's official signed and notarized build, verified before execution. Each scenario below passed its named checks. Capability runs do not claim every external provider.

| Scenario | VS Code | Trusted | Virtual workspace | Checks | Audited states |
| --- | --- | --- | --- | ---: | ---: |
| installed | 1.146.0 | true | false | 24 | 7 |
| minimum | 1.85.0 | true | false | 24 | 7 |
| restricted | 1.146.0 | false | false | 7 | 2 |
| virtual | 1.146.0 | true | true | 7 | 2 |

The source gates passed 88 Node tests and 31 website browser tests, plus the separately invoked 14 host and 33 bundled browser tests. Some counts overlap. They are not independent totals to add.

## Correctness, recovery and reading state

Installed checks exercise the title action, unsaved text, exact Source syntax, fixed-pair Refresh, keyboard focus, group reuse, real Git pairs, provider failure, and actual webview reload. A DOM insertion fault must keep content and timestamp coherent. Browser checks cover both failure/recreation orders, stale completions, initial and later DOM faults, alignment, paging, cancellation and bounded failed rollback.

The host remembers the last current input confirmed after initial DOM mounting and alignment. The client owns actual visibility and notice wording. A narrowly crossed native-command re-run can recover an earlier coherent confirmed snapshot. This accepted fallback does not corrupt or write files and is not a claim of atomic pixels across processes.

Source rows use actual layout as they mount incrementally, so offscreen height estimates cannot move the reading position before capture. Rendered rows retain deferred content layout. Logical reading bookmarks contain a row anchor, offset and page indices, tied to the snapshot ID. They contain no document text. Reload restores deep Source and a nonzero page after mounting the needed frontier and bounded layout settling. User navigation can cancel an automatic jump. Restoration is linear in preceding rows; errors deliberately return to a safe beginning rather than re-enter a faulty page.

## Accessibility and diagnostics

The 18 saved axe-core states report zero WCAG-tagged violations and zero incomplete checks, both of which the runner asserts. Full runs include Source, four native themes, native 200 percent zoom and recovery. Capability runs include Source and recovery. Refresh stays focusable, persistent live messages are not needlessly rewritten, and visible/audible side vocabulary agrees. Precision warnings use a polite status region. Read and presentation failures use an urgent alert. Automated checks and semantic markup are not a manual screen-reader study or universal conformance claim.

The runner records preview-associated console, page and content-policy diagnostics separately from main-process logs and fails on unexpected preview errors. Narrow layout also has explicit viewport assertions, including a completely visible first heading at native 200 percent zoom; its whole-window image is supporting evidence, not a substitute for them.

## Responsiveness observations

Each row summarizes five successful warm Refresh trials. Values are milliseconds. A separate profiling trial is excluded from each range and median.

| VS Code | Workload per document | Median wait | Trial range | Largest observed frame gap | Largest observed long task |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 1,200-row table | 196.0 | 167.0 to 198.6 | 19.3 | 0.0 |
| 1.146.0 | 100-section prose | 263.6 | 262.4 to 279.4 | 18.8 | 0.0 |
| 1.146.0 | 50,000 code lines | 686.1 | 666.2 to 698.0 | 44.5 | 0.0 |
| 1.85.0 | 1,200-row table | 218.4 | 209.1 to 230.3 | 24.5 | 0.0 |
| 1.85.0 | 100-section prose | 265.8 | 262.7 to 266.9 | 24.6 | 0.0 |
| 1.85.0 | 50,000 code lines | 1070.3 | 1055.1 to 1079.2 | 98.8 | 79.0 |

Timing starts at the capture-phase click and ends after the initial mounted frontier plus two animation frames. It includes cached native reads, worker startup, comparison, transfer and initial DOM construction. It excludes opening the native diff, every later page and first file loading. Every trial validates successful output and one changed source line. Raw records preserve input bytes, host load, actual viewport and observed callbacks.

Profiles separate the broad worker round trip from the remaining initial-view work. That interval includes startup, computation and transfer, not pure CPU time. There is no speedup claim. Zero long-task values mean no observed overlapping task at the 50 ms threshold; frame sampling is not every paint or a user percentile.

## Initial Source layout

A separate diagnostic in VS Code 1.146.0 opened five fresh Source views of the 50,000-line code fixture. Initial mounting of 400 rows plus two frames took 144.1 to 155.6 ms, including automation observation overhead. The largest observed frame gap was 18.6 ms. No overlapping long task at the 50 ms threshold was observed. These trials reused cached native inputs and already completed Rendered comparisons. They exclude worker computation, full Source traversal and peak memory.

## Resource limits and delivery

The host checks 200,000 native lines before copying text and 8 million characters per side. The extension worker admits at most 262,144 serialized UTF-16 characters and 8,000 opening elements per paired materialized row/page or Source row. Supported paginated code is checked per page, not by total output. Oversized indivisible sections fail explicitly before DOM parsing; native source access remains. No text is silently truncated.

Inline base64 images and minified single-line content can exceed the paired Source-row budget even when unchanged. Both sides count. Use the native source comparison for those files.

View batches use row caps plus 32,768 characters or 8 ms of scheduling admission. One admitted row is indivisible. These are work-admission guards, not hard paint-time or peak-memory bounds. Worker computation has its existing 12-second timeout. Low-end machines, full traversal and other desktop platforms remain unmeasured.

Images are placeholders. Inert preparation is tested with image CSP relaxed in a fixture, including later pages; production CSP remains strict. Only credential-free HTTPS links cross the external-action boundary. Production code has no document-write operation.

The default lifecycle can release hidden DOM and derived results. The host retains inputs and rebuilds presentation when needed. Retaining hidden views would not eliminate explicit reload recovery. No memory-saving number is claimed.

Official vsce creates the installer, with a scoped patched minimatch development-tool dependency. The saved dependency audit is separate evidence. Raw logs, screenshots, hashes, profiles and trials live under ignored `artifacts/`; this portable summary omits temporary profile paths.

## Reproduce

```sh
npm ci
npm run check
npm run test:vscode
npm run package:vscode
npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
MARKDOWN_DIFF_IDE_SCENARIO=restricted npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
MARKDOWN_DIFF_IDE_SCENARIO=virtual npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
```

Set `VSCODE_EXECUTABLE_PATH` and a distinct `MARKDOWN_DIFF_IDE_ARTIFACT_NAME` for another installed version. All profiles and extension directories are temporary. The CDP connection preserves Electron's browser context because older Electron does not implement Chromium's download-context controls. Manual GitHub Actions runs also repeat each deep Source restoration case 20 times on Ubuntu. CI execution and council judgments are recorded separately on the PR.
