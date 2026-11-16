# VS Code extension verification

This record covers the read-only snapshot of the native Markdown text comparison. Native VS Code selects the pair and owns editing. The shared engine compares captured text, and explicit Refresh reads the same pair again.

## Artifact identity

Package `markdown-diff-vscode-0.1.0.vsix`, SHA-256 `83c578a111d56ef26af50d84d6aa35f36ada748105560a27de16cd8cdfc9e7f3`.

The [structured record](vscode-verification.json) binds source inputs, bundled outputs, archive entries, installed runtime files, and the unchanged acceptance harness. The build hashes inputs before bundling and checks them afterward. Each installed run compares its loaded bytes directly with the requested archive. The recorder refuses stale or inconsistent records and can be rerun with `npm run record:vscode`.

## Installed matrix

All runs use the same package on one macOS arm64 host. The minimum application was Microsoft's official signed and notarized build, verified before execution. Each scenario below passed its named checks. Capability runs do not claim every external provider.

| Scenario | VS Code | Trusted | Virtual workspace | Checks | Audited states |
| --- | --- | --- | --- | ---: | ---: |
| installed | 1.146.0 | true | false | 23 | 7 |
| minimum | 1.85.0 | true | false | 23 | 7 |
| restricted | 1.146.0 | false | false | 6 | 2 |
| virtual | 1.146.0 | true | true | 6 | 2 |

The source gates passed 88 Node tests and 31 website browser tests, plus the separately invoked 14 host and 31 bundled browser tests. Some counts overlap. They are not independent totals to add.

## Correctness, recovery and reading state

Installed checks exercise the title action, unsaved text, exact Source syntax, fixed-pair Refresh, keyboard focus, group reuse, real Git pairs, provider failure, and actual webview reload. A DOM insertion fault must keep content and timestamp coherent. Browser checks cover both failure/recreation orders, stale completions, initial and later DOM faults, alignment, paging, cancellation and bounded failed rollback.

The host remembers the last current input confirmed after initial DOM mounting and alignment. The client owns actual visibility and notice wording. A narrowly crossed native-command re-run can recover an earlier coherent confirmed snapshot. This accepted fallback does not corrupt or write files and is not a claim of atomic pixels across processes.

Logical reading bookmarks contain a row anchor, offset and page indices, tied to the snapshot ID. They contain no document text. Reload restores deep Source and a nonzero page after mounting the needed frontier and bounded layout settling. User navigation can cancel an automatic jump. Restoration is linear in preceding rows; errors deliberately return to a safe beginning rather than re-enter a faulty page.

## Accessibility and diagnostics

The 18 saved axe-core states report zero WCAG-tagged violations and zero incomplete checks, both of which the runner asserts. Full runs include Source, four native themes, native 200 percent zoom and recovery. Capability runs include Source and recovery. Refresh stays focusable, persistent live messages are not needlessly rewritten, and visible/audible side vocabulary agrees. Automated checks and semantic markup are not a manual screen-reader study or universal conformance claim.

The runner records preview-associated console, page and content-policy diagnostics separately from main-process logs and fails on unexpected preview errors. Narrow layout also has explicit viewport assertions; its whole-window image is supporting evidence, not a substitute for them.

## Responsiveness observations

Each row summarizes five successful warm Refresh trials. Values are milliseconds. A separate profiling trial is excluded from each range and median.

| VS Code | Workload per document | Median wait | Trial range | Largest observed frame gap | Largest observed long task |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 1,200-row table | 179.6 | 170.2 to 196.9 | 18.3 | 0.0 |
| 1.146.0 | 100-section prose | 265.0 | 254.9 to 282.7 | 18.9 | 0.0 |
| 1.146.0 | 50,000 code lines | 666.1 | 661.7 to 694.6 | 45.5 | 0.0 |
| 1.85.0 | 1,200-row table | 215.8 | 206.3 to 216.4 | 24.2 | 0.0 |
| 1.85.0 | 100-section prose | 265.4 | 251.5 to 268.3 | 23.0 | 0.0 |
| 1.85.0 | 50,000 code lines | 1081.8 | 1075.7 to 1095.9 | 92.4 | 80.0 |

Timing starts at the capture-phase click and ends after the initial mounted frontier plus two animation frames. It includes cached native reads, worker startup, comparison, transfer and initial DOM construction. It excludes opening the native diff, every later page and first file loading. Every trial validates successful output and one changed source line. Raw records preserve input bytes, host load, actual viewport and observed callbacks.

Profiles separate the broad worker round trip from the remaining initial-view work. That interval includes startup, computation and transfer, not pure CPU time. There is no speedup claim. Zero long-task values mean no observed overlapping task at the 50 ms threshold; frame sampling is not every paint or a user percentile.

## Resource limits and delivery

The host checks 200,000 native lines before copying text and 8 million characters per side. The extension worker admits at most 262,144 serialized UTF-16 characters and 8,000 opening elements per paired materialized row/page or Source row. Supported paginated code is checked per page, not by total output. Oversized indivisible sections fail explicitly before DOM parsing; native source access remains. No text is silently truncated.

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
npm run record:vscode
```

Set `VSCODE_EXECUTABLE_PATH` and a distinct `MARKDOWN_DIFF_IDE_ARTIFACT_NAME` for another installed version. All profiles and extension directories are temporary. The CDP connection preserves Electron's browser context because older Electron does not implement Chromium's download-context controls. CI execution and council judgments are recorded separately on the PR.
