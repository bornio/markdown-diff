# VS Code contrast and accessibility follow-up, 2026-11-16

The earlier fixture missed a real code-block failure: installed High Contrast Light supplied white code text over the preview's light background, at 1.12:1. Other themes failed on diff fills, secondary surfaces and pagination controls. Expanded coverage also found links inside whole changed blocks, faint task/focus outlines and an unreadable pressed-link tint.

The correction assigns ink by background. Bare page text retains native editor foreground, including Abyss blue and Kimbie tan. Painted surfaces use native workbench foreground; metadata uses native description foreground. Light themes strengthen these by mixing in 20, 30 and 15 percent black respectively. High-contrast metadata uses full surface ink. The surface rule rebinds text, heading, emphasis, secondary and link aliases so nested content cannot inherit unsuitable page color. Code explicitly inherits its context, preserving linked-code color while defeating the host's mismatched preformat foreground.

Native diff fills, insertion underlines and deletion strikes remain. Buttons keep their native secondary foreground/background pair. Focus ink is strengthened in ordinary light/dark themes; link outlines fit the retained row's paint boundary. A pressed link keeps its document surface instead of stacking a translucent button tint over a diff fill. Task checkmarks use the native checkbox pair.

Task checkboxes take their own inline text and image descriptions as names, excluding nested tasks and following blocks. Rich text, disabled/checked state and selection remain. Unnamed raw checkboxes use “Task item”. Image descriptions remain inert, semantic and copyable; compact inline notices wrap inside emphasis without the old block-box overlap. The website and row-retention model are unchanged.

## Installed verification

VSIX SHA-256: `ae8703777ebaa3ca6230acb8d68be209008128a1b67beb9810137b9352c00e35`.

| Scenario | VS Code | Checks | Built-in themes | Theme/state observations | Axe states |
| --- | --- | ---: | ---: | ---: | ---: |
| Current | 1.146.0 | 28 | 19 | 437 | 22 |
| Minimum | 1.85.0 | 28 | 17 | 391 | 20 |
| Restricted Mode | 1.146.0 | 7 | — | — | 2 |
| Read-only virtual workspace | 1.146.0 | 7 | — | — | 2 |

All four install the same archive in isolated profiles on one macOS arm64 host, assert matching loaded runtime bytes, and record identical harness hashes. The minimum application passes signature and Gatekeeper checks. Screen-reader support is explicitly enabled and asserted in the isolated app, keeping its autodetection question out of screenshots; this is not a manual assistive-technology study.

Both full runs enumerate every installed built-in theme and confirm its exact ID. Each theme records a precision-warning view, a failed Refresh retaining the comparison, and hover, pointer-pressed and keyboard-focus states for three buttons and four links. Interaction records sample the affected target. Pressed probes cancel the subsequent click; separate acceptance steps activate real Source, Refresh and pagination actions. Keyboard targets are hit-tested for occlusion, and focus outlines must fit their paint-containing ancestors.

All 828 observations have zero text or essential-cue failures. Normal text meets 4.5:1; the lowest is an inactive code link in Dark 2026 at 4.566:1. The minimum host's lowest code text is 4.765:1. Task borders/checkmarks, change rails and focus rings meet 3:1; the lowest measured cue is 3.240:1. No measured focus outline is clipped. These native palette margins are finite; no AAA or arbitrary-theme guarantee is claimed. All 46 WCAG-tagged axe audits have zero violations and zero incomplete checks.

The fixture covers added/removed blocks containing links, headings, quotes, table headers, summaries, emphasis and code; quoted headings/tables/links; enabled and inactive linked code; image-only and nested task labels; and enabled pagination. Positive coverage and native dark-page color assertions prevent empty samples or flattened theme ink from passing silently.

Audits use an unclipped layout, plus a separate narrow column at native 200 percent zoom. Narrow screenshots show the top, the fully visible warning, and then the first heading after normal scrolling. They do not establish that the heading appears above the fold. Code and tables retain contained horizontal scrolling. Focus and task-state screenshots supplement numeric records in both versions.

Native checks retain title activation, fixed URI pairs, unsaved text, live Source, snapshot provenance, keyboard focus, provider recovery, deep row/page restoration and no source-file writes. The driver waits for the selected native editor and completed group moves, rather than treating a tab-model update as editor readiness. The bookmark browser test visits its prefix before establishing the starting position; it still requires row 180 or deeper and restores within 3 pixels. No restore algorithm, threshold or retry was added.

## Regressions and limits

Failing-before records reproduce native code/fill contrast, unnamed/image-only task names, the faint Monokai Dimmed focus cue, the Tomorrow Night Blue pressed link and a clipped code-link outline. A narrow emphasized-image notice separately reproduced axe's overlap result; the inline layout resolves it without excluding a rule. Final extension checks pass 21 host and 50 bundled-browser tests. The unchanged shared website retains its earlier 96 Node and 31 browser passes; counts overlap.

Raw records, ratios, screenshots and audits are in ignored `artifacts/contrast2-ide-{current,minimum,restricted,virtual}/`; the suite log is `artifacts/contrast2-browser.log`. Earlier contrast reports remain under `artifacts/contrast-ide-*/` and the frozen council folders.

The sampler composites uniform backgrounds and text alpha with an 8-bit canvas and WCAG sRGB luminance. It does not model arbitrary gradients or ancestor opacity. Disabled buttons are excluded; inactive link text and read-only task cues remain covered. Axe, geometry assertions and screenshots are separate evidence. Custom themes, user overrides, forced-color variations, other platforms and manual screen-reader behavior remain unproven.

The [earlier acceptance/performance record](vscode-verification.md) remains a dated pre-correction baseline. Its speed measurements belong to its recorded archive. This change makes no new speedup claim.
