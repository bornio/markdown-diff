# Preview lifecycle

The extension has three owners: the host owns the captured input and its confirmation, the webview owns computation and recovery, and the shared view owns DOM presentation and reading positions.

The webview keeps two concurrent records. `capture` contains the host epoch, the attempted snapshot and input work (`reading`, `computing` or `idle`). A computing record owns its worker and timeout. `screen` is `empty`, `candidate`, `restoring`, `visible` or `stopped`; its `good` value is the only client record of a successfully presented snapshot. Reading new input can overlap restoring an older view, so these concerns remain separate.

A worker result is a candidate. The shared view calls `onPresented` once after mounting, alignment and any bookmark restoration. Only then does the webview promote the candidate, update its provenance and acknowledge the host. Later settled page, prefix and resize changes use `onViewStateChanged` to save position. They cannot confirm another snapshot. The shared view samples its bookmark once and passes it to either callback. All bookkeeping completes before the callback, so a callback may reset or replace the view without stale work running afterward.

A presentation failure restores the last good result from a safe starting position. Failed restoration clears the display and cancels work, so an already queued worker reply cannot revive it. Explicit recapture permits another attempt. The attempted-snapshot latch suppresses repeated attempts within a host epoch, including error messages replaying an older confirmed input.

Scroll events schedule one save after 200 ms. Settled view changes, opening Source and page exit flush the current position immediately. Position is associated with the displayed snapshot, never a pending candidate. Disposal releases that displayed state before clearing DOM, preventing a later callback from overwriting the final bookmark.

Each view owns its settled bookmark. `show(mode, bookmark)` validates a saved bookmark when creating that view; `getState()` reads the current view's position with its last settled pages. The webview alone wraps this in the existing saved-state format. The website retains its per-mode DOM and pixel scroll positions without reading or maintaining a separate bookmark map. Error handling and normal pause share one cancellation routine; pause alone records heights and pixel position before stopping work.

Hidden previews retain VS Code's default disposal lifecycle. Keeping them alive could avoid ordinary return reconstruction at a memory cost, but it would not remove explicit-reload recovery. That policy and Refresh starting at the top are unchanged. Loaded content is retained for selection and navigation.

## Verification

The refactor preserves the existing host, website and preview behavior checks. Added cases cover one confirmation through page/resize/batch changes, reset and reentrant callbacks, terminal rollback with overlapping computation, and immediate reload, Source navigation and page exit.

The queued-result case failed before the ownership change: a newer worker could repopulate the DOM after failed rollback. It passes when terminal recovery invalidates the computing record. No existing outcome assertion, restore threshold or timeout was relaxed.

The final local suites pass 96 Node and 33 website-browser tests, plus 28 extension Node and 56 bundled-preview tests (counts overlap). Installed acceptance passes 28 checks each on VS Code 1.146.0 and 1.85.0, plus seven each in Restricted Mode and a read-only virtual workspace. All four runs use one VSIX, SHA-256 `4b468b330a8c3e27ee168f72e3e269409482905f2dbc1888dc7b6da905d439d6`, with matching loaded runtime and harness hashes. Their 46 automated accessibility states have zero violations or incomplete checks. Raw results live in ignored `artifacts/lifecycle-ide-*/`. One initial minimum-version run stopped because a simulated press did not enter `:active`; the unchanged rerun passed. That first attempt is retained separately, and is not counted as a successful run.

A five-pair alternating browser probe compared scroll-frame saving with the 200 ms timer over 600 visited paragraphs. Each trial scrolled for 180 frames and checked the final snapshot, pages and anchor. Saves and hit tests fell from 180 to 14 per trial, with zero final anchor error in all ten runs. This measures removed persistence work in the browser harness, not native IPC or user-visible latency. Input limits, construction budgets and retained-DOM growth remain unchanged.
