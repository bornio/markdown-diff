# VS Code extension acceptance, 2026-11-16

This record covers a rendered snapshot of the native Markdown text comparison and a live Source action. Native VS Code selects the pair and owns editing. Source returns to that original live pair; explicit Refresh captures its current text for the preview.

## Artifact identity

Package `markdown-diff-vscode-0.1.0.vsix`, SHA-256 `fe7ee6fd80465324418cb173543a91874c2598c12bdacc0f2c374fed4b3131f7`.

This dated snapshot describes one built candidate. Future candidates keep their own results. Each installed run asserts that its loaded runtime files match the requested archive. Raw records preserve the package and test-harness hashes, versions, named checks and trial data in ignored `artifacts/`.

## Installed matrix

All runs use the same package on one macOS arm64 host. The acceptance driver runs in an isolated Extension Development Host and asserts that product files come from the VSIX installation. It leaves the product inactive until the native title action activates it. The minimum application was Microsoft's official signed and notarized build, verified before execution. Each scenario below passed its named checks. Capability runs do not claim every external provider.

| Scenario | VS Code | Trusted | Virtual workspace | Checks | Audited states |
| --- | --- | --- | --- | ---: | ---: |
| installed | 1.146.0 | true | false | 24 | 7 |
| minimum | 1.85.0 | true | false | 24 | 7 |
| restricted | 1.146.0 | false | false | 7 | 2 |
| virtual | 1.146.0 | true | true | 7 | 2 |

The source gates passed 95 Node tests and 31 website browser tests, plus the separately invoked 21 host and 34 bundled browser tests. Some counts overlap. They are not independent totals to add.

## Correctness, recovery and reading state

Installed checks exercise the title action, unsaved text, exact native Source URI/text reuse, staleness, fixed-pair Refresh, keyboard focus, group reuse, real Git pairs, provider failure, and actual webview reload. A DOM insertion fault must keep content and timestamp coherent. Browser checks cover both failure/recreation orders, stale completions, initial and later DOM faults, alignment, paging, cancellation and bounded failed rollback.

The host remembers the last current input confirmed after initial DOM mounting and alignment. The client owns actual visibility and notice wording. A narrowly crossed native-command re-run can recover an earlier coherent confirmed snapshot. This accepted fallback does not corrupt or write files and is not a claim of atomic pixels across processes.

Source opens the original native URI pair in its existing editor group, or reopens it if closed. It does not refresh the preview or create a captured-source provider. Checks on return compare actual live text with the confirmed capture. A polite note identifies changed or unavailable Source; this is separate from renderer failure. Browser and host checks cover same text at a new version, different text at a reset version, crossed asynchronous checks, unavailable sources and native-open failure.

Rendered rows retain deferred content layout. Logical bookmarks contain a row anchor, offset and page indices, tied to the snapshot ID. They contain no document text. Reload restores a Rendered row beyond the initial batch and a nonzero page after mounting the needed prefix and bounded layout settling. User navigation can cancel an automatic jump. Errors deliberately return to a safe beginning rather than re-enter a faulty page.

Restoration cost grows with mounted predecessors and is not established as linear. Before the live change, an exploratory Source return around line 40,000 of the 50,000-line fixture timed out at 60 seconds. A task-local containment experiment completed correctly in 51.5 seconds; it was not adopted. The browser bottleneck was not profiled. Removing Source DOM eliminates this path for Source only.

Two exploratory installed Rendered diagnostics with matching runtime bytes returned around paragraph 8,000 of a 20,000-paragraph comparison in 18.26 and 13.62 seconds. Both restored the same row within 0.3 pixels and reconstructed 8,119 rows. The latter run used this exact VSIX. This is correctness evidence and a known performance limitation, not a representative user percentile, a full traversal result or a hard bound. The live Source change does not solve deep Rendered reconstruction. No renderer rewrite or hidden-view retention was added.

## Accessibility and diagnostics

The 18 saved axe-core states report zero WCAG-tagged violations and zero incomplete checks, both of which the runner asserts. Full runs include reloaded Rendered content, four native themes, native 200 percent zoom and recovery. Capability runs include Rendered content and recovery. Refresh stays focusable, persistent live messages are not needlessly rewritten, and visible/audible side vocabulary agrees. Precision warnings use a polite status region. Read and presentation failures use an urgent alert. Automated checks and semantic markup are not a manual screen-reader study or universal conformance claim.

The runner records preview-associated console, page and content-policy diagnostics separately from main-process logs and fails on unexpected preview errors. Narrow layout also has explicit viewport assertions, including a completely visible first heading at native 200 percent zoom; its whole-window image is supporting evidence, not a substitute for them.

## Responsiveness observations

Each row summarizes five successful warm Refresh trials. Values are milliseconds. A separate profiling trial is excluded from each range and median.

| VS Code | Workload per document | Median wait | Trial range | Largest observed frame gap | Largest observed long task |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 1,200-row table | 134.8 | 128.1 to 136.9 | 9.5 | 0.0 |
| 1.146.0 | 100-section prose | 153.3 | 152.1 to 162.5 | 10.9 | 0.0 |
| 1.146.0 | 50,000 code lines | 674.1 | 644.9 to 777.0 | 48.7 | 0.0 |
| 1.85.0 | 1,200-row table | 174.1 | 169.9 to 179.0 | 10.6 | 0.0 |
| 1.85.0 | 100-section prose | 153.6 | 152.8 to 162.1 | 10.5 | 0.0 |
| 1.85.0 | 50,000 code lines | 1102.2 | 1098.4 to 1159.9 | 95.9 | 89.0 |

Timing starts at the capture-phase click and ends after the initial mounted frontier plus two animation frames. It includes cached native reads, worker startup, comparison, transfer and initial DOM construction. It excludes opening the native diff, every later page and first file loading. Every trial validates successful output and one changed source line. Raw records preserve input bytes, host load, actual viewport and observed callbacks.

Profiles separate the broad worker round trip from the remaining initial-view work. That interval includes startup, computation and transfer, not pure CPU time. There is no speedup claim. Zero long-task values mean no observed overlapping task at the 50 ms threshold; frame sampling is not every paint or a user percentile.

## Native Source return

Each row summarizes five warm returns from the captured preview to the existing native diff around line 40,000 in the 50,000-line code fixture. Values are milliseconds.

| VS Code | Median return | Trial range |
| --- | ---: | ---: |
| 1.146.0 | 178.0 | 171.9 to 187.6 |
| 1.85.0 | 172.0 | 162.5 to 188.0 |

The timer starts before the automated Source click and ends when the actual native line is visible. Checks also assert the original ordered URI pair, unchanged text hashes, one native diff tab and the visible editor range. Timing includes automation overhead, cached editors and normal native diff layout. It is not a controlled speedup comparison, pixel-offset guarantee, cold-open time, peak-memory measurement or user percentile. The preview contains no Source rows.

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

Set `VSCODE_EXECUTABLE_PATH` and a distinct `MARKDOWN_DIFF_IDE_ARTIFACT_NAME` for another installed version. All profiles and extension directories are temporary. The CDP connection preserves Electron's browser context because older Electron does not implement Chromium's download-context controls. Manual GitHub Actions runs repeat the Rendered page-restoration case 20 times on Ubuntu. The runner disables Chromium occluded-window throttling in its isolated test process and requires a visible comparison frame; product behavior and timeouts are unchanged. CI execution and council judgments are recorded separately on the PR.
