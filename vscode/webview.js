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
const saved = vscode.getState();
const capture = { id: 0, attemptedSnapshotId: null, work: { kind: 'reading' } };
let screen = { kind: 'empty' };
let sourceStatus = null;
let error = '';
let scrollSave = 0;
const display = createComparisonView(comparison, { scrollTo(target) {
  const top = typeof target === 'number' ? target : window.scrollY + target.getBoundingClientRect().top - toolbar.getBoundingClientRect().height - 12;
  window.scrollTo({ top, behavior: 'instant' });
} }, { renderDocument, onPresented: commitDraw, onViewStateChanged: persist, onError: failDraw, batchLimits: previewLimits.batch, chunkRows: 64 });

function persist(bookmark) {
  clearTimeout(scrollSave);
  scrollSave = 0;
  if (screen.kind === 'visible') {
    vscode.setState({ snapshotId: screen.good.snapshot.captureId, view: { rendered: bookmark || display.getState() } });
  }
}

function update() {
  const result = screen.good?.result;
  const reading = capture.work.kind === 'reading';
  const drawing = screen.kind === 'candidate' || screen.kind === 'restoring';
  const busy = capture.work.kind !== 'idle' || drawing;
  comparison.setAttribute('aria-busy', String(busy));
  const freshness = sourceStatus?.captureId === screen.good?.snapshot.captureId ? sourceStatus?.status : null;
  const sourceMessage = freshness === 'changed' ? 'Source changed since capture. Refresh to update the preview.'
    : freshness === 'unknown' ? 'Could not check live Source. The captured preview is unchanged. Refresh to try again.' : '';
  if ($('#source-status').textContent !== sourceMessage) $('#source-status').textContent = sourceMessage;
  $('#source-status').hidden = !sourceMessage;
  let status = 'Comparison ready';
  if (reading) status = 'Reading documents…';
  else if (screen.kind === 'restoring') status = 'Restoring previous snapshot…';
  else if (busy) status = 'Comparing…';
  else if (error) status = 'Comparison needs attention';
  else if (!result) status = 'No comparison available';
  else if (!result.stats.added && !result.stats.removed && !result.stats.changed) status = 'Files are identical';
  else if (result.rows.every((row) => row.kind === 'same')) status = 'Same rendered content';
  if ($('#status').textContent !== status) $('#status').textContent = status;
  const warnings = result?.precision.warnings || [];
  const errorMessage = error && screen.kind === 'visible' ? `${sentence(error)} The previous snapshot is still shown.` : error;
  const announcement = [errorMessage, ...warnings].filter(Boolean).join(' ');
  const role = error ? 'alert' : 'status';
  if (notice.getAttribute('role') !== role) notice.setAttribute('role', role);
  if (notice.textContent !== announcement) notice.textContent = announcement;
  notice.hidden = !notice.textContent;
  notice.classList.toggle('error', !!error);
  $('#stats').textContent = result ? `Lines · ${result.stats.added} added · ${result.stats.removed} removed · ${result.stats.changed} changed` : '';
  if (drawing) $('#snapshot-label').textContent = 'Preparing the snapshot…';
  else if (!screen.good) $('#snapshot-label').textContent = reading ? 'Reading the comparison…' : 'No snapshot displayed.';
}

function stopWork() {
  const work = capture.work;
  capture.work = { kind: 'idle' };
  if (work.kind === 'computing') {
    clearTimeout(work.timeout);
    work.worker?.terminate();
  }
}

function taskLabel(checkbox) {
  const boundary = 'blockquote,details,div,dl,h1,h2,h3,h4,h5,h6,hr,input,ol,p,pre,section,table,ul';
  const isBoundary = node => node.nodeType === Node.ELEMENT_NODE && node.matches(boundary);
  let label = '';
  for (let sibling = checkbox.nextSibling; sibling && !isBoundary(sibling); sibling = sibling.nextSibling) {
    const walker = document.createTreeWalker(sibling, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => isBoundary(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = sibling; node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) label += node.textContent;
      else if (node.nodeName === 'IMG') label += node.getAttribute('alt') || '';
      else if (node.nodeName === 'BR') label += ' ';
    }
  }
  return label.replace(/\s+/g, ' ').trim() || 'Task item';
}

function renderDocument(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const checkbox of template.content.querySelectorAll('input[type=checkbox]')) {
    checkbox.setAttribute('aria-label', taskLabel(checkbox));
  }
  for (const image of template.content.querySelectorAll('img')) {
    const placeholder = document.createElement('span');
    placeholder.className = 'image-placeholder';
    placeholder.textContent = `Image not loaded · ${image.alt || 'No description'}`;
    placeholder.title = 'Image preview is not loaded. Open live Source diff to inspect the current Markdown.';
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

function draw(value, kind, bookmark = null) {
  screen = { kind, value, good: screen.good || null };
  try {
    display.reset(value.result, { before: value.snapshot.before.label, after: value.snapshot.after.label });
    display.show('rendered', bookmark);
  } catch (cause) { failDraw(cause); }
  update();
}

function commitDraw(viewState) {
  if (screen.kind !== 'candidate' && screen.kind !== 'restoring') return;
  const completed = screen;
  const good = completed.value;
  screen = { kind: 'visible', good };
  describe(good.snapshot);
  if (completed.kind === 'candidate') vscode.postMessage({ type: 'comparisonRendered', captureId: good.snapshot.captureId });
  persist(viewState);
  update();
}

function terminal(message) {
  stopWork();
  error = message;
  screen = { kind: 'stopped' };
  try { display.reset(); } catch {}
  $('#before-label').textContent = $('#after-label').textContent = '';
}

function rollback(good) {
  if (good) draw(good, 'restoring');
  else { screen = { kind: 'empty' }; display.reset(); }
}

function failDraw(cause) {
  const failed = screen;
  error = `The comparison could not be displayed. ${sentence(cause instanceof Error ? cause.message : 'Refresh to try again')}`;
  if (failed.kind === 'restoring') {
    terminal('The previous preview could not be restored. Open the source comparison or Refresh to try again.');
  } else {
    const snapshot = failed.kind === 'candidate' ? failed.value.snapshot : failed.good?.snapshot;
    if (snapshot) vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: error });
    rollback(failed.good);
  }
  update();
}

function beginCapture(status = 'reading') {
  stopWork();
  capture.work = { kind: status === 'reading' ? 'reading' : 'idle' };
  if (screen.kind === 'stopped') screen = { kind: 'empty' };
  else if (screen.kind === 'candidate') rollback(screen.good);
}

function compare(snapshot, purpose) {
  stopWork();
  const work = { kind: 'computing', worker: null, timeout: null };
  capture.work = work;
  const fail = (message) => {
    if (capture.work !== work) return;
    stopWork();
    error = sentence(message);
    if (purpose === 'candidate') vscode.postMessage({ type: 'comparisonFailed', captureId: snapshot.captureId, message: error });
    if (!screen.good && purpose === 'restoring') terminal(`The previous preview could not be restored. ${error} Open the source comparison or Refresh to try again.`);
    update();
  };
  try { work.worker = new ComparisonWorker(); }
  catch { fail('The comparison worker could not start. Reload the preview or reinstall the extension.'); return; }
  work.worker.onmessage = ({ data }) => {
    if (capture.work !== work || data?.requestId !== snapshot.captureId) return;
    if (data.status === 'error' && typeof data.message === 'string') { fail(data.message); return; }
    if (data.status !== 'ready' || !data.comparison) { fail('The comparison worker returned an invalid result. Refresh to try again.'); return; }
    stopWork();
    draw({ snapshot, result: data.comparison }, purpose, saved?.snapshotId === snapshot.captureId ? saved.view?.rendered : null);
  };
  work.worker.onerror = () => fail('The comparison worker stopped unexpectedly. Refresh to try again.');
  work.timeout = setTimeout(() => fail('This comparison exceeded 12 seconds. Split very large or deeply nested documents into smaller files.'), 12000);
  work.worker.postMessage({ requestId: snapshot.captureId, beforeText: snapshot.before.text, afterText: snapshot.after.text,
    previewLimits: previewLimits.worker });
  update();
}

function receiveCapture(data) {
  if (!data || data.type !== 'state' || !Number.isInteger(data.captureId) || data.captureId < capture.id || !['reading', 'ready', 'error'].includes(data.status)) return;
  const newer = data.captureId > capture.id;
  if (newer || data.status === 'reading') beginCapture(data.status);
  if (newer) {
    capture.id = data.captureId;
    capture.attemptedSnapshotId = null;
  }
  if (data.status !== 'reading' && capture.work.kind === 'reading') capture.work = { kind: 'idle' };
  if (screen.kind !== 'stopped') error = data.status === 'error' && typeof data.message === 'string' ? data.message : '';
  $('#source-label').textContent = data.sourceLabel;
  if (data.status !== 'reading' && screen.kind !== 'stopped' && data.snapshot && Number.isInteger(data.snapshot.captureId)) {
    const alreadyGood = data.snapshot.captureId === screen.good?.snapshot.captureId;
    const drawing = data.snapshot.captureId === screen.value?.snapshot.captureId;
    if (!alreadyGood && !drawing && data.snapshot.captureId !== capture.attemptedSnapshotId) {
      capture.attemptedSnapshotId = data.snapshot.captureId;
      compare(data.snapshot, data.status === 'error' ? 'restoring' : 'candidate');
    }
  }
  update();
}

window.addEventListener('message', ({ data }) => {
  if (data?.type === 'sourceStatus' && Number.isInteger(data.captureId) && ['current', 'changed', 'unknown'].includes(data.status)) {
    if (!sourceStatus || data.captureId >= sourceStatus.captureId) sourceStatus = data;
    update();
  } else receiveCapture(data);
});

$('#open-source').addEventListener('click', () => { persist(); vscode.postMessage({ type: 'openSource' }); });
refresh.addEventListener('click', () => {
  beginCapture();
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
window.addEventListener('scroll', () => {
  if (!scrollSave) scrollSave = setTimeout(persist, 200);
}, { passive: true });
new ResizeObserver(() => document.documentElement.style.setProperty('--chrome-obscured', `${toolbar.getBoundingClientRect().height}px`)).observe(toolbar);
window.addEventListener('pagehide', () => { persist(); stopWork(); screen = { kind: 'empty' }; display.reset(); });
update();
vscode.postMessage({ type: 'ready' });
