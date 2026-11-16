# VS Code contrast and accessibility follow-up, 2026-11-16

This corrects the code-block contrast missed by the earlier acceptance fixture. In the installed High Contrast Light theme, VS Code supplied white code text over the preview's light code background: 1.12:1. Native editor foregrounds and muted text also failed on some diff, quote, image and pagination surfaces.

The extension now sets its body and code foreground explicitly from the workbench foreground. Ordinary light themes mix in 20 percent black to keep text readable over the native red/green fills. Quotes and metadata use the same readable ink. Buttons use their secondary-button foreground. Notices use the editor-widget surface and preview text, retaining warning/error borders. Insertions stay underlined and deletions struck through; the theme's diff fills are unchanged.

The expanded fixture also exposed unnamed read-only task checkboxes. The extension gives each checkbox its adjacent task text as an accessible name, excluding nested subtasks. Checked state, disabled state, rich text and selection are preserved. An unnamed raw HTML checkbox gets the name “Task item”. The website is unchanged.

## Installed package

VSIX SHA-256: `eee9802f8eac060db0cfb0da95e45e0f1065c92a58e98df1853cbb4ed6d4912e`.

| Scenario | VS Code | Checks | Built-in themes | Contrast states | Axe states |
| --- | --- | ---: | ---: | ---: | ---: |
| Current | 1.146.0 | 28 | 19 | 38 | 22 |
| Minimum | 1.85.0 | 28 | 17 | 34 | 20 |
| Restricted Mode | 1.146.0 | 7 | — | — | 2 |
| Read-only virtual workspace | 1.146.0 | 7 | — | — | 2 |

All runs install the same archive into isolated profiles on one macOS arm64 host and assert that the three loaded runtime files match it. Their harness hashes match. The minimum application passes Microsoft's signature and Gatekeeper checks before execution.

Both full runs enumerate every installed built-in theme and assert its exact `data-vscode-theme-id`, including version-specific Modern theme IDs. Each theme checks a real precision warning and a failed Refresh retaining the prior comparison. The fixture includes plain, inserted, deleted, quoted, inline, list and table code; whole added/removed code blocks; links; image placeholders; task lists; closed details; and enabled pagination. Coverage assertions prevent missing code or pagination samples from passing silently.

All 72 theme/state contrast checks pass. The lowest sampled code-text ratio is 4.89:1; High Contrast Light code is at least 9.69:1. The lowest other sampled normal text is 4.69:1. No ratio is rounded before its threshold assertion. All 46 WCAG-tagged axe audits have zero violations and zero incomplete checks.

The code audit closes auxiliary UI and asserts that the sample fits without horizontal clipping. This matters in VS Code 1.85, where clipped code produced an inconclusive axe result. That result remained a failure; no audit rule was excluded. A separate narrow-column check uses native 200 percent zoom, checks both toolbar actions and horizontal document overflow, and scrolls the first heading fully into view before its screenshot and audit.

Existing native checks still exercise title activation, live Source, snapshot provenance, Refresh focus, recovery, provider failures, deep reading-position restoration and paginated content. Loaded rows remain present for selection and navigation. No rendering or retention model changed.

## Regressions and evidence limits

Four hermetic browser cases load an external fixture reproducing native body/code styles before the product stylesheet. Before the fix: `4 failed`; after: `4 passed`. A focused Abyss warning regression also failed before the neutral notice surface. Exact task-name assertions failed before the attribute fix and now pass for tight, loose and nested lists, rich formatting, states and selection.

Final local checks pass 96 Node tests, 31 website browser tests, and separately invoked 21 host and 46 bundled-browser tests. Counts overlap. Raw native records, ratios, axe results and screenshots are in ignored `artifacts/contrast-ide-{current,minimum,restricted,virtual}/`; browser logs are in `artifacts/contrast-final-browser.log` and `artifacts/contrast-website-browser.log`.

The contrast sampler composites uniform ancestor backgrounds and CSS text color using an 8-bit canvas and WCAG sRGB luminance. Disabled controls are excluded. It is not a general checker for gradients or ancestor opacity. Axe and screenshots provide separate evidence. These runs cover the built-in themes in the two tested applications, not arbitrary custom themes, user color overrides, every platform, or a manual screen-reader study.

The [earlier acceptance and performance record](vscode-verification.md) remains a dated pre-correction baseline. Its speed measurements belong to its recorded archive; this color and labelling change makes no new speedup claim.
