# VS Code extension acceptance, 2026-11-16

The [contrast and accessibility follow-up](vscode-contrast.md) supersedes this record's color coverage. This document retains the pre-correction artifact and its performance measurements.

This record covers a captured Rendered preview and live native Source. VS Code selects the original ordered URI pair and owns editing. Source opens that live pair. Refresh captures its current text for the preview.

## Artifact identity

Package `markdown-diff-vscode-0.1.0.vsix`, SHA-256 `504649bac3fb6c49eb3d3e59396d562faa7d62a1e8d46f7e69906f1cbe9bd6fd`.

All installed runs below assert that their loaded runtime files match this archive. They also record the exact harness hashes. This is a dated candidate, not a claim about every future build. Raw records, trials, profiles and screenshots live in ignored `artifacts/`.

## Installed acceptance

All four scenarios use this archive on one macOS arm64 host in isolated Extension Development Hosts. The extension stays inactive until the native title action activates it. The minimum application is Microsoft's signed and notarized VS Code build, verified before execution. Capability runs establish actual Restricted Mode and a controlled read-only virtual filesystem, not every provider.

| Scenario | VS Code | Trusted | Virtual | Checks | Audited states |
| --- | --- | --- | --- | ---: | ---: |
| installed | 1.146.0 | true | false | 27 | 7 |
| minimum | 1.85.0 | true | false | 27 | 7 |
| restricted | 1.146.0 | false | false | 7 | 2 |
| virtual | 1.146.0 | true | true | 7 | 2 |

Local gates pass 96 Node tests and 31 website browser tests, plus separately invoked 21 host and 41 bundled-browser tests. Counts overlap.

The installed checks exercise title activation, unsaved text, native preview-mode tabs, fixed-pair Refresh, positive current-Source confirmation, group reuse, actual Git pairs, provider failure, real webview recreation and explicit reload. Both full runs preserve a Rendered row beyond the first batch through Source return and reload, with the same visible text and offset under 3 pixels. A nonzero rendered table page also survives reload. DOM faults keep the prior content and timestamp coherent.

The host retains the last current input confirmed after presentation. A narrowly crossed command rerun can recover an earlier coherent confirmed capture. Failed rollback stops truthfully; it does not loop or claim an empty view is shown. Source action failure is independent of rendering failure. Source checks compare actual text, so resetting a document version cannot hide a change.

## Retained content and layout

Selection and navigation remain available over loaded content. No rows are unloaded while scrolling. The extension groups Rendered rows into blocks of 64 and observes those blocks, reducing the number of boxes involved in offscreen layout work. The website's default row path and Source mode stay unchanged.

Before a saved Rendered anchor, the existing 8 ms / 32,768-character budget governs each construction batch instead of an additional 12-row ceiling. The look-ahead and normal scrolling retain their row caps. No restore pass was added and the 3-pixel acceptance threshold was not relaxed.

This reduces measured cost; it is not constant-depth rendering. DOM, heap and prefix reconstruction still grow with content. A long active selection can require rendering its full span. The native Source action avoids Source DOM entirely, while Source-to-preview returns still recompute and rebuild the captured view. Refresh deliberately starts a new view.

## Controlled deep scrolling and return

Five alternating trials per arm compare frozen baseline `80df7e4` against this exact candidate archive. Every trial starts a fresh isolated current VS Code instance, loads the same 20,000-paragraph fixture, crosses the loading frontier three times at each depth, and scrolls for 64 animation-frame steps inside already-mounted rows. The latter asserts that no new rows mounted during its measurement. Values below are the median of each trial's median observed frame gap, with the five-trial range, in milliseconds. Display cadence limits resolution below a frame; these are not user percentiles.

| Position | Baseline median | Trial range | Candidate median | Trial range |
| --- | ---: | ---: | ---: | ---: |
| Near top | 16.7 | 16.7 to 16.7 | 16.7 | 16.7 to 16.7 |
| About 10% | 16.7 | 16.7 to 16.7 | 16.7 | 16.7 to 16.7 |
| About 40% | 33.2 | 18.6 to 33.3 | 16.7 | 16.7 to 16.7 |
| About 90% | 116.6 | 116.6 to 116.7 | 16.7 | 16.7 to 16.7 |

Every trial then opens actual live Source, edits the native document, and returns around paragraph 8,000. The preview must retain its captured text and timestamp, show the stale notice, recreate its webview, and restore the same row within 3 pixels. Baseline median return is 15271.4 ms, range 15216.0 to 15789.8. Candidate median is 1739.9 ms, range 1725.6 to 1759.3. All ten trials pass output and geometry checks; the protocol stops on a failure without retries.

First presentation includes opening the native diff, activation and initial output. Its baseline median is 1696.2 ms, range 1692.2 to 1835.2; candidate 1696.9 ms, range 1693.7 to 1709.9. Warm OS/application inputs, automation overhead, host load and one display are included. There is no platform-wide or cold-cache claim.

An excluded baseline trace attributed the growing per-frame cost mainly to browser intersection and layout work over mounted row boxes, while JavaScript construction stayed small. Diagnostic observer-only and retained-group arms separated those effects. The grouping change is a smaller depth coefficient, not proof that growth has disappeared. Exploratory mixed and dense changed-table/code fixtures showed no observed long-task regression; they are supporting checks, not additional controlled speedup results.

## Warm representative Refresh

Each row summarizes five successful warm Refresh trials on this archive. A separate profiling trial is excluded. Values are milliseconds.

| VS Code | Per-document workload | Median wait | Trial range | Largest frame gap | Largest long task |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 1,200-row table | 171.4 | 169.6 to 172.3 | 17.8 | 0.0 |
| 1.146.0 | 100-section prose | 254.8 | 250.6 to 266.0 | 17.9 | 0.0 |
| 1.146.0 | 50,000 code lines | 635.6 | 627.0 to 637.9 | 18.5 | 0.0 |
| 1.85.0 | 1,200-row table | 219.3 | 214.6 to 229.9 | 20.8 | 0.0 |
| 1.85.0 | 100-section prose | 261.4 | 250.8 to 267.7 | 20.7 | 0.0 |
| 1.85.0 | 50,000 code lines | 1001.8 | 987.7 to 1015.6 | 24.1 | 0.0 |

Timing starts at the capture-phase click and ends after initial presentation plus two animation frames. It includes cached native reads, worker startup, comparison, transfer and DOM construction, but excludes opening the native diff and later pages. Each trial validates output and one changed source line. Zero long-task values mean none observed at the 50 ms threshold, not exhaustive capture.

## Both directions of a native Source round trip

Five warm round trips use the 50,000-line code fixture with native Source positioned near line 40,000. Values are milliseconds.

| VS Code | To Source median | Trial range | Back to preview median | Trial range |
| --- | ---: | ---: | ---: | ---: |
| 1.146.0 | 190.5 | 172.5 to 195.9 | 989.8 | 982.2 to 1001.1 |
| 1.85.0 | 191.0 | 182.7 to 201.5 | 1503.3 | 1483.6 to 1510.6 |

To Source ends when the actual native line is visible. Back to preview ends at Comparison ready and includes recomputing the capture. Each trial asserts the original URI pair, text hashes, one native diff tab and the native visible range. These timings include automation and cached editors; they do not establish cold-open time, native pixel offsets or peak memory.

## Selection, accessibility and diagnostics

A differential 900-row fixture preserved long selection, Select All and semantic ARIA snapshots against baseline. After continuously visiting its content in forced-accessibility Chrome mode, the normalized native Chromium accessibility trees also matched exactly. Distant forward/backward Tab navigation passed. Before visiting all content, both versions expose viewport-dependent native snapshots; grouping changes the exposure of implicit offscreen paragraph containers. This is a browser-level parity check, not a manual screen-reader study or universal conformance claim.

The 18 historical installed axe states have zero WCAG-tagged violations and zero incomplete checks, both asserted. They cover four native theme kinds, native 200 percent zoom and recovery, plus capability-mode content and recovery. Their fixture omitted code blocks and task lists, so these passes did not establish code contrast or checkbox labelling. The follow-up expands both fixtures and confirms exact theme IDs. The historical narrow screenshot supports explicit viewport assertions, including a fully visible first heading. Refresh keeps focus; persistent live regions are not rewritten unnecessarily. Read and presentation failures use alerts; source staleness and precision warnings use polite status regions.

Installed runs assert no unexpected preview-associated console, page or content-policy diagnostics. The isolated runner disables Chromium occluded-window throttling and requires a visible frame; product timeouts and rendering code are unchanged by that test flag.

## Resource limits and delivery

The host checks 200,000 native lines and 8 million characters per input. The extension worker admits at most 262,144 serialized UTF-16 characters and 8,000 opening elements per paired Rendered row/page. Supported code is checked per page. Oversized indivisible paragraphs or dense markup fail before DOM parsing, without silent truncation. Native Source stays available.

Unused Source rows are neither checked against this DOM budget nor transferred to the webview. A 140 KB inline-image source with a small sanitized Rendered row is now admitted; its image still becomes an inert placeholder. The website worker keeps its complete output. Only credential-free HTTPS links cross the external-action boundary. Product code has no document-write operation.

The budgets control admission, not hard paint time or peak memory. Worker comparison still has a 12-second timeout. Other desktop platforms, low-end machines, complete traversal at the input ceiling and every provider remain unverified.

Official vsce builds the installer. The workflow is configured to keep its VSIX as an artifact and log its checksum. Manual runs are configured to repeat both Rendered row and page restoration cases 20 times each on Ubuntu. Final-head CI execution and independent council results are recorded on the PR separately from this local acceptance record.

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

Set `VSCODE_EXECUTABLE_PATH` and a distinct `MARKDOWN_DIFF_IDE_ARTIFACT_NAME` for another installed version. All test profiles and extension directories are temporary. The CDP connection preserves Electron's context because older Electron lacks Chromium's download-context controls. No normal-profile installation or Marketplace publishing is part of this record.
