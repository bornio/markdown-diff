import '../src/style.css';
import './webview.css';
import ComparisonWorker from '../src/compare.worker.js?worker&inline';
import { createComparisonView } from '../src/view.js';

const vscode = acquireVsCodeApi();
const $ = (selector) => document.querySelector(selector);
const comparison = $('#comparison');
const toolbar = $('.extension-toolbar');
const notice = $('#notice');
const refresh = $('#refresh');
const buttons = { rendered: $('#rendered-view'), source: $('#source-view') };
const saved = vscode.getState();
const state = {
  mode: saved?.mode === 'source' ? 'source' : 'rendered', snapshot: null, shown: null, pending: null, presentation: null,
  captureId: 0, reading: true, error: '', worker: null, timeout: null,
};
const display = createComparisonView(comparison, { scrollTo(target) {
  const top = typeof target === 'number' ? target : window.scrollY + target.getBoundingClientRect().top - toolbar.getBoundingClientRect().height - 12;
  window.scrollTo({ top, behavior: 'instant' });
} }, { renderDocument, onRendered: mounted, onError: presentationFailed });

function persist() {
  vscode.setState({ mode: state.mode, scroll: window.scrollY });
}

function update() {
  const result = state.presentation?.kind === 'failed' ? null : state.shown?.result;
  const busy = state.reading || !!state.worker || !!state.pending || (!!state.presentation && state.presentation.kind !== 'failed');
  comparison.setAttribute('aria-busy', String(busy));
  for (const [mode, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(mode === state.mode));
  const status = state.reading ? 'Reading documents…' : state.presentation?.kind === 'restore' ? 'Restoring previous snapshot…' : busy ? 'Comparing…'
    : state.error ? 'Comparison needs attention' : !result ? 'No comparison available'
      : !result.stats.added && !result.stats.removed && !result.stats.changed ? 'Files are identical'
        : result.rows.every((row) => row.kind === 'same') ? 'Same rendered content' : 'Comparison ready';
  if ($('#status').textContent !== status) $('#status').textContent = status;
  const warnings = result?.precision.warnings || [];
  const announcement = [state.error, ...warnings].filter(Boolean).join(' ');
  if (notice.textContent !== announcement) notice.textContent = announcement;
  notice.hidden = !notice.textContent;
  notice.classList.toggle('error', !!state.error);
  $('#stats').textContent = result ? `Lines · ${result.stats.added} added · ${result.stats.removed} removed · ${result.stats.changed} changed` : '';
  if (!state.snapshot) $('#snapshot-label').textContent = state.reading ? 'Reading the comparison…' : 'No snapshot captured.';
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

function mount(value, kind = 'candidate') {
  state.presentation = { ...value, kind };
  try {
    display.reset(value.result, { before: value.snapshot.before.label, after: value.snapshot.after.label });
    display.show(state.mode);
  } catch (error) { presentationFailed(error); }
  update();
}

function mounted() {
  const value = state.presentation;
  if (!value || value.kind === 'failed') return;
  describe(value.snapshot);
  state.presentation = null;
  if (value.kind === 'candidate') {
    state.shown = { snapshot: value.snapshot, result: value.result };
    vscode.postMessage({ type: 'comparisonRendered', captureId: value.snapshot.captureId });
  }
  if (saved?.scroll && !saved.restored) {
    requestAnimationFrame(() => window.scrollTo({ top: saved.scroll, behavior: 'instant' }));
    saved.restored = true;
  }
  update();
}

function presentationFailed(error) {
  const value = state.presentation;
  const snapshot = value?.snapshot || state.shown?.snapshot || state.snapshot;
  state.presentation = state.pending = null;
  state.error = `The comparison could not be displayed. ${error instanceof Error ? error.message : 'Refresh to try again.'}`;
  if (value?.kind === 'restore') {
    state.error = 'The previous preview could not be restored. Open the source comparison or Refresh to try again.';
    state.presentation = { ...value, kind: 'failed', message: state.error };
    state.shown = null;
    try { display.reset(); } catch {}
  } else {
    if (snapshot) vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: state.error });
    if (state.shown) mount(state.shown, 'restore');
    else { try { display.reset(); } catch {} }
  }
  update();
}

function cancelComparison() {
  stopWorker();
  state.pending = null;
  if (state.presentation?.kind === 'failed') state.presentation = null;
  if (state.presentation?.kind === 'candidate') {
    state.presentation = null;
    if (state.shown) mount(state.shown, 'restore');
    else display.reset();
  }
}

function compare(snapshot) {
  cancelComparison();
  state.snapshot = snapshot;
  if (!state.shown) describe(snapshot);
  let worker;
  try { worker = new ComparisonWorker(); }
  catch {
    state.error = 'The comparison worker could not start. Reload the preview or reinstall the extension.';
    vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: state.error });
    update();
    return;
  }
  state.worker = worker;
  const fail = (message) => {
    if (state.worker !== worker) return;
    stopWorker();
    state.error = message;
    vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: state.error });
    update();
  };
  worker.onmessage = ({ data }) => {
    if (state.worker !== worker || data.requestId !== snapshot.captureId) return;
    if (data.status === 'error') { fail(data.message); return; }
    stopWorker();
    const result = data.comparison;
    state.pending = { snapshot, result };
    vscode.postMessage({ type: 'comparisonReady', captureId: snapshot.captureId });
    update();
  };
  worker.onerror = () => fail('The comparison worker stopped unexpectedly. Refresh to try again.');
  state.timeout = setTimeout(() => fail('This comparison exceeded 12 seconds. Split very large or deeply nested documents into smaller files.'), 12000);
  worker.postMessage({ requestId: snapshot.captureId, beforeText: snapshot.before.text, afterText: snapshot.after.text });
  update();
}

window.addEventListener('message', ({ data }) => {
  if (data?.type === 'comparisonAccepted') {
    if (!state.pending || data.captureId !== state.pending.snapshot.captureId) return;
    const value = state.pending;
    state.pending = null;
    mount(value);
    return;
  }
  if (!data || data.type !== 'state' || !Number.isInteger(data.captureId) || data.captureId < state.captureId) return;
  state.captureId = data.captureId;
  state.reading = data.status === 'reading';
  if (state.reading) cancelComparison();
  state.error = state.presentation?.kind === 'failed' ? state.presentation.message : data.status === 'error' ? data.message : '';
  $('#source-label').textContent = data.sourceLabel;
  if (state.presentation?.kind === 'failed') { update(); return; }
  if (data.snapshot?.captureId === state.shown?.snapshot.captureId && state.shown) {
    state.snapshot = data.snapshot;
  } else if (data.snapshot && (data.snapshot.captureId !== state.snapshot?.captureId || (!state.shown && !state.worker && !state.pending && !state.presentation))) {
    if (state.reading) state.snapshot = data.snapshot;
    else compare(data.snapshot);
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
window.addEventListener('pagehide', () => { stopWorker(); display.reset(); });
update();
vscode.postMessage({ type: 'ready' });
