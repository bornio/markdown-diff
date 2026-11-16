# VS Code extension verification

This record covers the installable desktop extension that renders an existing Markdown text comparison. The source comparison selects both documents and owns editing. The extension owns a read-only snapshot and explicit Refresh.

## Artifact and environment

The tested package is `markdown-diff-vscode-0.1.0.vsix`.

SHA-256 `46435e82fb843fa51844eb524315c1aaf28b141068eba1947cef5fa0844860d1`.

The [structured record](vscode-verification.json) includes the exact runtime and acceptance-harness hashes. Every installed run verifies the loaded extension directory, hashes its host and webview files, and confirms those bytes match the package. The harness must remain unchanged during each run. The installed copy, source bundle, and package agree across the matrix.

The runs used one macOS arm64 host with 10 logical CPU cores. Desktop VS Code 1.146.0 and the declared minimum 1.85.0 each passed 19 acceptance checks against the same package. The minimum build came from Microsoft's update service. Its Microsoft Corporation signature and notarized Gatekeeper assessment passed before execution.

Separate 1.146.0 runs passed the four capability checks in actual Restricted Mode with `workspace.isTrusted` false, and in an actual virtual workspace backed by a read-only test filesystem. This proves those scenarios, not every external provider or operating system.

## Correctness and recovery

The actual IDE checks exercise the editor-title action after switching groups, dirty native editor text, exact Source syntax, fixed-pair Refresh, keyboard focus, non-default Source restoration, a verified new webview JavaScript context, and real Git working-tree and staged inputs.

A one-shot DOM insertion fault in the actual webview must preserve prior content and its timestamp through reload. The bundled browser suite additionally injects immediate, later-frame, alignment, pager, and scrolling faults. It exercises both recreation/failure orders, stale candidate cancellation, empty results, and failed rollback without a retry loop. The host remembers input as successful only after the first view mounts and aligns.

A failing provider must actually receive a read attempt. Its failure keeps the previous view. The fixture file remains unchanged, and production host inspection finds no document-write operation. These checks do not pretend to enumerate every filesystem or provider behavior.

The current test gates passed 12 host tests, 19 bundled Chrome tests, 80 Node tests in the full website check, and 31 website browser tests. Some host tests are included in the Node total. Do not add these counts as independent coverage.

## Accessibility and layout

Pinned controls use a compact action bar. Provenance and statistics scroll with the document. Persistent notices change their live text only when the message changes. Refresh remains focusable while a new capture supersedes older work.

Each full installed run audits Source, all four default native themes, native 200 percent zoom in a narrow editor column, and the presentation-error recovery state with axe-core 4.14.0. All seven states in each version reported zero WCAG-tagged violations and zero incomplete checks. Restricted and virtual runs each added a Source audit with the same result. The structured record preserves the measured frame dimensions and scale factors.

The old-version audits found and drove fixes for Source line-number contrast, selected controls, and high-contrast hover states. No rule was disabled to obtain the final result. Keyboard focus and Source-mode reload behavior are separate functional assertions. Automated checks and markup inspection are not a manual screen-reader study or a claim of universal accessibility conformance.

## Responsiveness observations

These are medians of five successful warm Refresh trials for each workload and version. Values are milliseconds.

| VS Code | Workload per document | Median wait | Trial range | Largest observed frame gap | Largest observed long task |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 1,200-row table | 180.1 | 171.5 to 195.6 | 19.1 | 0.0 |
| 1.146.0 | 100-section prose | 263.8 | 251.1 to 279.6 | 18.9 | 0.0 |
| 1.146.0 | 50,000 code lines | 711.7 | 683.5 to 713.5 | 46.7 | 0.0 |
| 1.85.0 | 1,200-row table | 227.7 | 218.7 to 232.2 | 24.7 | 0.0 |
| 1.85.0 | 100-section prose | 266.9 | 261.8 to 269.3 | 23.0 | 0.0 |
| 1.85.0 | 50,000 code lines | 1098.7 | 1079.1 to 1114.7 | 96.3 | 82.0 |

The table inputs total 45,875 bytes, prose inputs 15,174 bytes, and code inputs 7,077,821 bytes. Timing starts in the capture phase of the Refresh click. It ends after successful initial mounting and two animation frames. The interval includes host reads, fresh worker startup, comparison, transfer, and initial DOM construction. It excludes opening the native diff, traversing all later pages, and first file loading. Inputs are already open and cached, as they are for Refresh.

A separate profiling trial precedes each set and is excluded from its median and range. It captures a real renderer CPU profile and the worker-construction-to-first-message interval. The worker interval includes startup, computation, and transfer, so it is not pure worker CPU time. Code wait is dominated by that round trip. Prose wait includes the deliberately incremental initial DOM batch and rendering-frame cadence. The structured record keeps those stage observations; raw profiles and every trial are in local artifacts.

Every measured trial validates the changed source-line count and successful output. The runs recorded zero failures. The 1.146.0 trials recorded no overlapping main-thread task at the observer's 50 ms threshold. The 1.85.0 large-code trials recorded a largest task of 82 ms and an animation-frame gap of 96.3 ms. Zero in the long-task column means no task at that threshold was observed, not that the main thread did no work. Frame-gap sampling is an observation of callbacks, not proof that every paint or interaction was captured. These are absolute observations for this host, not a speedup comparison or a user percentile estimate.

## Boundaries and delivery

The host rejects more than 200,000 native editor lines before copying document text, and rejects more than 8 million characters per side. Worker work has a 12-second timeout. The engine's existing work limits, coarse warnings, incremental mounting, and pagination remain. A large unpaginated prose or HTML structure can still cost more than the representative fixtures. Peak memory, low-end devices, complete page traversal, other desktop platforms, and arbitrary remote providers were not measured.

Images remain explicit placeholders. Inert preparation is tested independently with image CSP relaxed in a fixture, including later pages. Production CSP remains restrictive. Credential-free HTTPS links are the only external action. The package has seven entries and contains no tests or source tree.

The default non-retained webview lifecycle releases hidden DOM and result trees. The host retains candidate and last-good inputs, then rebuilds presentation when needed. Retaining hidden contexts could save some recomputation but would keep those derived objects for each open preview and would not remove reload recovery. No memory saving is presented as a measured number.

Official vsce packages the extension. A scoped override selects patched minimatch 11.0.1 for that development tool. The saved dependency audit reported zero vulnerabilities. The matcher is not part of the runtime package.

Reproduce the gates from the repository root.

```sh
npm ci
npm run check
npm run test:vscode
npm run package:vscode
npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
MARKDOWN_DIFF_IDE_SCENARIO=restricted npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
MARKDOWN_DIFF_IDE_SCENARIO=virtual npm run test:vscode:ide -- artifacts/markdown-diff-vscode-0.1.0.vsix
```

Set `VSCODE_EXECUTABLE_PATH` and a distinct `MARKDOWN_DIFF_IDE_ARTIFACT_NAME` for another installed version. The test connection preserves Electron's default browser context because older Electron lacks Chromium's browser-context download controls. All IDE runs use temporary profiles and extension directories.

Logs, screenshots, audits, trial records, runtime hashes, and CPU profiles are written under `artifacts/`. That directory is ignored by Git. The structured record commits the portable summary without temporary profile paths. No public Marketplace deployment is part of this validation.
