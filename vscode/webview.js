import '../src/style.css';
import './webview.css';
import ComparisonWorker from '../src/compare.worker.js?worker&inline';
import { createComparisonView } from '../src/view.js';
import previewLimits from './preview-limits.json';

const vscode = acquireVsCodeApi();
const $ = (selector) => document.querySelector(selector);
const comparison = $('#comparison');
const toolbar = $('.extension-toolbar');
const notice = $('#notice');
const refresh = $('#refresh');
const buttons = { rendered: $('#rendered-view'), source: $('#source-view') };
const saved = vscode.getState();
const state = {
  mode: saved?.mode === 'source' ? 'source' : 'rendered', shown: null, presentation: null, attemptKey: '',
  captureId: 0, reading: true, error: '', worker: null, timeout: null,
};
const display = createComparisonView(comparison, { scrollTo(target) {
  const top = typeof target === 'number' ? target : window.scrollY + target.getBoundingClientRect().top - toolbar.getBoundingClientRect().height - 12;
  window.scrollTo({ top, behavior: 'instant' });
} }, { renderDocument, onRendered: mounted, onError: presentationFailed, batchLimits: previewLimits.batch });

function persist() {
  if (state.shown && !state.presentation) vscode.setState({ snapshotId: state.shown.snapshot.captureId, mode: state.mode, view: display.getState() });
}

function update() {
  const result = state.presentation?.kind === 'failed' ? null : state.shown?.result;
  const busy = state.reading || !!state.worker || (!!state.presentation && state.presentation.kind !== 'failed');
  comparison.setAttribute('aria-busy', String(busy));
  for (const [mode, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(mode === state.mode));
  const status = state.reading ? 'Reading documents…' : state.presentation?.kind === 'restore' ? 'Restoring previous snapshot…' : busy ? 'Comparing…'
    : state.error ? 'Comparison needs attention' : !result ? 'No comparison available'
      : !result.stats.added && !result.stats.removed && !result.stats.changed ? 'Files are identical'
        : result.rows.every((row) => row.kind === 'same') ? 'Same rendered content' : 'Comparison ready';
  if ($('#status').textContent !== status) $('#status').textContent = status;
  const warnings = result?.precision.warnings || [];
  const error = state.error && state.shown && !state.presentation ? `${sentence(state.error)} The previous snapshot is still shown.` : state.error;
  const announcement = [error, ...warnings].filter(Boolean).join(' ');
  if (notice.textContent !== announcement) notice.textContent = announcement;
  notice.hidden = !notice.textContent;
  notice.classList.toggle('error', !!state.error);
  $('#stats').textContent = result ? `Lines · ${result.stats.added} added · ${result.stats.removed} removed · ${result.stats.changed} changed` : '';
  if (!state.shown) $('#snapshot-label').textContent = state.reading ? 'Reading the comparison…' : 'No snapshot displayed.';
}

function stopWorker() {
  state.worker?.terminate();
  state.worker = null;
  clearTimeout(state.timeout);
  state.timeout = null;
}

function renderDocument(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll('img')) {
    const placeholder = document.createElement('span');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = `Image · ${image.alt || 'No description'}`;
    placeholder.title = 'Image preview is not loaded. Source shows its exact Markdown.';
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', `${image.alt || 'Image'}. Preview not loaded.`);
    for (const attribute of image.attributes) if (attribute.name.startsWith('data-')) placeholder.setAttribute(attribute.name, attribute.value);
    image.replaceWith(placeholder);
  }
  for (const link of template.content.querySelectorAll('a')) {
    try {
      const url = new URL(link.getAttribute('href'));
      if (url.protocol === 'https:' && !url.username && !url.password) continue;
    } catch {}
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.title = 'This link is inactive in the snapshot preview. Use the source comparison to open it.';
  }
  return template.content;
}

function describe(snapshot) {
  for (const side of ['before', 'after']) {
    const document = snapshot[side];
    $(`#${side}-label`).textContent = `${document.label}${document.dirty ? ' · unsaved changes' : ''}`;
    $(`#${side}-label`).title = document.uri.split('?')[0];
  }
  $('#snapshot-label').textContent = `Snapshot captured ${new Date(snapshot.capturedAt).toLocaleString()}. Refresh to read changes.`;
}

function sentence(message) {
  const text = String(message).trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function mount(value, kind = 'candidate', bookmark = null) {
  state.presentation = { ...value, kind };
  try {
    display.reset(value.result, { before: value.snapshot.before.label, after: value.snapshot.after.label }, bookmark);
    display.show(state.mode);
  } catch (error) { presentationFailed(error); }
  update();
}

function mounted() {
  const value = state.presentation;
  if (value?.kind === 'failed') return;
  if (value) {
    describe(value.snapshot);
    state.shown = { snapshot: value.snapshot, result: value.result };
    state.presentation = null;
    if (value.kind === 'candidate') vscode.postMessage({ type: 'comparisonRendered', captureId: value.snapshot.captureId });
  }
  persist();
  update();
}

function terminal(message) {
  state.error = message;
  state.presentation = { kind: 'failed', message };
  state.shown = null;
  try { display.reset(); } catch {}
  $('#before-label').textContent = $('#after-label').textContent = '';
}

function presentationFailed(error) {
  const value = state.presentation;
  const snapshot = value?.snapshot || state.shown?.snapshot;
  state.presentation = null;
  state.error = `The comparison could not be displayed. ${sentence(error instanceof Error ? error.message : 'Refresh to try again')}`;
  if (value?.kind === 'restore') {
    terminal('The previous preview could not be restored. Open the source comparison or Refresh to try again.');
  } else {
    if (snapshot) vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: state.error });
    if (state.shown) mount(state.shown, 'restore');
    else display.reset();
  }
  update();
}

function cancelComparison() {
  stopWorker();
  const displaced = state.presentation && state.presentation.kind !== 'failed';
  state.presentation = null;
  if (displaced) {
    if (state.shown) mount(state.shown, 'restore');
    else display.reset();
  }
}

function compare(snapshot, kind) {
  cancelComparison();
  const fail = (message) => {
    stopWorker();
    state.error = sentence(message);
    if (kind === 'candidate') vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: state.error });
    if (!state.shown && kind === 'restore') terminal(`The previous preview could not be restored. ${state.error} Open the source comparison or Refresh to try again.`);
    update();
  };
  let worker;
  try { worker = new ComparisonWorker(); }
  catch { fail('The comparison worker could not start. Reload the preview or reinstall the extension.'); return; }
  state.worker = worker;
  worker.onmessage = ({ data }) => {
    if (state.worker !== worker || data?.requestId !== snapshot.captureId) return;
    if (data.status === 'error' && typeof data.message === 'string') { fail(data.message); return; }
    if (data.status !== 'ready' || !data.comparison) { fail('The comparison worker returned an invalid result. Refresh to try again.'); return; }
    stopWorker();
    mount({ snapshot, result: data.comparison }, kind, saved?.snapshotId === snapshot.captureId ? saved.view : null);
  };
  worker.onerror = () => { if (state.worker === worker) fail('The comparison worker stopped unexpectedly. Refresh to try again.'); };
  state.timeout = setTimeout(() => { if (state.worker === worker) fail('This comparison exceeded 12 seconds. Split very large or deeply nested documents into smaller files.'); }, 12000);
  worker.postMessage({ requestId: snapshot.captureId, beforeText: snapshot.before.text, afterText: snapshot.after.text,
    previewLimits: previewLimits.worker });
  update();
}

window.addEventListener('message', ({ data }) => {
  if (!data || data.type !== 'state' || !Number.isInteger(data.captureId) || data.captureId < state.captureId || !['reading', 'ready', 'error'].includes(data.status)) return;
  const newer = data.captureId > state.captureId;
  state.captureId = data.captureId;
  state.reading = data.status === 'reading';
  if (newer || state.reading) cancelComparison();
  state.error = state.presentation?.kind === 'failed' ? state.presentation.message : data.status === 'error' && typeof data.message === 'string' ? data.message : '';
  $('#source-label').textContent = data.sourceLabel;
  if (!state.reading && state.presentation?.kind !== 'failed' && data.snapshot && Number.isInteger(data.snapshot.captureId)) {
    const key = `${data.captureId}:${data.snapshot.captureId}`;
    const alreadyVisible = data.snapshot.captureId === state.shown?.snapshot.captureId;
    const restoring = data.snapshot.captureId === state.presentation?.snapshot.captureId;
    if (!alreadyVisible && !restoring && key !== state.attemptKey) {
      state.attemptKey = key;
      compare(data.snapshot, data.status === 'error' ? 'restore' : 'candidate');
    }
  }
  update();
});

for (const [mode, button] of Object.entries(buttons)) button.addEventListener('click', () => {
  state.mode = mode;
  if (state.shown || state.presentation) display.show(mode);
  update();
  persist();
});
refresh.addEventListener('click', () => {
  state.reading = true;
  cancelComparison();
  update();
  vscode.postMessage({ type: 'refresh' });
});
comparison.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  if (link.hasAttribute('href')) vscode.postMessage({ type: 'openExternal', url: link.getAttribute('href') });
});
comparison.addEventListener('auxclick', (event) => { if (event.target.closest('a')) event.preventDefault(); });
let scrollFrame = 0;
window.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; persist(); });
}, { passive: true });
new ResizeObserver(() => document.documentElement.style.setProperty('--chrome-obscured', `${toolbar.getBoundingClientRect().height}px`)).observe(toolbar);
window.addEventListener('pagehide', () => { persist(); stopWorker(); display.reset(); });
update();
vscode.postMessage({ type: 'ready' });
