import './style.css';
import './theme.js';
import { example } from './example.js';
import { createComparisonView } from './view.js';

const $ = (selector) => document.querySelector(selector);
const extensions = ['.md', '.markdown', '.txt', '.mdx'];
const extensionPattern = new RegExp(`(${extensions.join('|').replaceAll('.', '\\.')})$`, 'i');
const statusText = {
  empty: 'Ready when you are',
  reading: 'Reading files…',
  working: 'Comparing files…',
  identical: 'Files are identical',
  'rendered-same': 'Same rendered content',
  different: 'Comparison ready',
  'open-error': 'Could not open file',
  'compare-error': 'Comparison stopped',
};
const filenameSegments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const state = {
  pair: { before: null, after: null }, view: 'rendered', requestId: 0,
  selectionId: 0, readIds: { before: 0, after: 0 }, worker: null,
  timeout: null, result: null, status: 'empty', selectionNotice: '',
};
const comparison = $('#comparison');
const status = $('#status');
const notice = $('#notice');
const display = createComparisonView(comparison, $('#comparison-chrome'));
const filenames = ['before', 'after'].map((side) => ({ side, element: $(`#${side}-name`), renderedName: null }));
let filenameFrame = 0;

function filenameTruncated(name) {
  return [...name.querySelectorAll('.file-name-value > span')].some((part) => part.scrollWidth > part.clientWidth);
}
function scheduleFilenames() {
  if (filenameFrame) return;
  filenameFrame = requestAnimationFrame(() => {
    filenameFrame = 0;
    for (const { side, element: name } of filenames) {
      const expandable = !!state.pair[side] && (name.open || filenameTruncated(name));
      name.classList.toggle('expandable', expandable);
      const summary = name.querySelector('summary');
      summary.tabIndex = expandable ? 0 : -1;
      summary.setAttribute('aria-disabled', String(!expandable));
    }
  });
}
const filenameResize = new ResizeObserver(scheduleFilenames);
for (const { side, element: name } of filenames) {
  filenameResize.observe(name);
  name.addEventListener('toggle', scheduleFilenames);
  name.querySelector('summary').addEventListener('click', (event) => {
    if (!state.pair[side] || (!name.open && !filenameTruncated(name))) event.preventDefault();
  });
}
let keyboard = false;
document.addEventListener('keydown', () => { keyboard = true; }, true);
document.addEventListener('pointerdown', () => { keyboard = false; }, true);

function cancelWorker() {
  state.worker?.terminate();
  state.worker = null;
  clearTimeout(state.timeout);
  state.timeout = null;
  state.requestId++;
}
function message(text, error = false) {
  const combined = [state.selectionNotice, text].filter(Boolean).join(' ');
  notice.textContent = combined;
  notice.hidden = !combined;
  notice.classList.toggle('error', error);
}
function updateChrome() {
  for (const label of filenames) {
    const { side, element: name } = label;
    const summary = name.querySelector('summary');
    const filename = state.pair[side]?.name || 'Empty document';
    if (label.renderedName !== filename) {
      const segments = filenameSegments ? [...filenameSegments.segment(filename)].map(({ segment }) => segment) : [];
      const start = document.createElement('span');
      start.className = 'file-name-start';
      start.textContent = filenameSegments ? segments.slice(0, -20).join('') : filename;
      const end = document.createElement('span');
      end.className = 'file-name-end';
      end.textContent = segments.slice(-20).join('');
      const value = document.createElement('bdi');
      value.className = 'file-name-value';
      value.append(start, end);
      summary.replaceChildren(value);
      name.title = filename;
      label.renderedName = filename;
      name.open = false;
    }
    name.classList.toggle('loaded', !!state.pair[side]);
  }
  const loaded = !!(state.pair.before || state.pair.after);
  const busy = state.status === 'reading' || state.status === 'working';
  $('.app').classList.toggle('has-files', loaded);
  const head = $('.comparison-head');
  const hideHead = !loaded && state.status !== 'reading';
  const restoreFocus = keyboard && hideHead && head.contains(document.activeElement);
  head.hidden = hideHead;
  $('.view-switch').hidden = !loaded;
  $('#swap').hidden = !loaded;
  $('#clear').hidden = !loaded && state.status === 'empty';
  $('#swap').disabled = !loaded;
  $('#clear').disabled = !loaded && !['reading', 'open-error', 'compare-error'].includes(state.status);
  const empty = $('#empty');
  const moveFocus = keyboard && empty.contains(document.activeElement) && (loaded || state.status === 'reading');
  empty.hidden = loaded || state.status === 'reading';
  comparison.hidden = !loaded;
  comparison.setAttribute('aria-busy', String(busy));
  if (moveFocus) (loaded ? comparison : $('.file-browse[data-side=before]')).focus({ preventScroll: true });
  if (restoreFocus) $('.drop-target[data-side=before]').focus({ preventScroll: true });
  $('.comparison-summary').classList.toggle('busy', busy);
  status.textContent = statusText[state.status];
  status.classList.toggle('sr-only', state.status === 'empty' || state.status === 'different' ||
    (state.status === 'rendered-same' && state.view === 'source'));
  $('#stats').hidden = busy || !state.result || !$('#stats').textContent;
  $('#rendered-view').setAttribute('aria-pressed', String(state.view === 'rendered'));
  $('#source-view').setAttribute('aria-pressed', String(state.view === 'source'));
  scheduleFilenames();
}
function startComparison() {
  cancelWorker();
  message('');
  state.result = null;
  state.status = 'working';
  display.reset();
  $('#stats').textContent = '';
  updateChrome();
  const requestId = state.requestId;
  const worker = new Worker(new URL('./compare.worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  const fail = (text) => {
    if (requestId !== state.requestId) return;
    cancelWorker();
    state.status = 'compare-error';
    message(`${text} Your selected files are kept. Choose another file or try swapping the sides.`, true);
    updateChrome();
  };
  worker.onmessage = ({ data }) => {
    if (data.requestId !== state.requestId) return;
    if (data.status === 'error') { fail(data.message); return; }
    worker.terminate();
    state.worker = null;
    clearTimeout(state.timeout);
    state.timeout = null;
    state.result = data.comparison;
    const { added, removed, changed } = state.result.stats;
    state.status = !added && !removed && !changed ? 'identical' : state.result.rows.every((row) => row.kind === 'same') ? 'rendered-same' : 'different';
    const counts = [added ? `<span class="stat-add" aria-label="${added} added ${added === 1 ? 'line' : 'lines'}">+${added}</span>` : '',
      removed ? `<span class="stat-remove" aria-label="${removed} removed ${removed === 1 ? 'line' : 'lines'}">−${removed}</span>` : ''].filter(Boolean).join(' ');
    $('#stats').innerHTML = [counts, changed ? `${changed} changed ${changed === 1 ? 'line' : 'lines'}` : ''].filter(Boolean).join(' <span aria-hidden="true">·</span> ');
    message(state.result.precision.warnings.length ? `Simplified comparison. ${state.result.precision.warnings.join(' ')}` : '');
    updateChrome();
    display.reset(state.result, Object.fromEntries(filenames.map(({ side }) => [side, state.pair[side]?.name || 'Empty document'])));
    display.show(state.view);
  };
  worker.onerror = () => fail('Could not read this Markdown document.');
  state.timeout = setTimeout(() => fail('This comparison exceeded 12 seconds. Split very large or deeply nested documents into smaller files.'), 12000);
  worker.postMessage({ requestId, beforeText: state.pair.before?.text || '', afterText: state.pair.after?.text || '' });
}

async function readFiles(files, side) {
  const chosen = [...files].slice(0, 2);
  if (!chosen.length) return;
  const selectionId = ++state.selectionId;
  const targets = chosen.length === 2 ? ['before', 'after'] : [side || 'after'];
  for (const target of targets) state.readIds[target] = selectionId;
  cancelWorker();
  state.status = 'reading';
  state.selectionNotice = files.length > 2 ? 'Only the first two files were selected. Drop another file on either side to replace it.' : '';
  message('');
  updateChrome();
  try {
    const documents = await Promise.all(chosen.map(async (file) => {
      if (!extensionPattern.test(file.name)) {
        throw new Error(`Choose a ${extensions.slice(0, -1).join(', ')}, or ${extensions.at(-1)} text file.`);
      }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error(`${file.name} is not a UTF-8 text file.`); }
      for (let index = 0; index < text.length && index < 8000; index++) {
        const code = text.charCodeAt(index);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) throw new Error(`${file.name} looks like a binary file. Choose a UTF-8 text file.`);
      }
      return { name: file.name, text };
    }));
    const accepted = documents.flatMap((document, index) => state.readIds[targets[index]] === selectionId ? [[targets[index], document]] : []);
    if (!accepted.length) return;
    state.pair = { ...state.pair, ...Object.fromEntries(accepted) };
    startComparison();
  } catch (error) {
    if (targets.every((target) => state.readIds[target] !== selectionId)) return;
    state.status = 'open-error';
    message(error.message, true);
    updateChrome();
  }
}
for (const { side } of filenames) {
  const input = $(`#${side}-input`);
  input.accept = extensions.join(',');
  input.onchange = () => { readFiles(input.files, side); input.value = ''; };
  $(`.file-browse[data-side=${side}]`).onclick = () => input.click();
  const target = $(`.drop-target[data-side=${side}]`);
  target.onclick = () => input.click();
  target.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } };
}
$('#swap').onclick = () => {
  state.selectionId++;
  state.readIds = { before: state.selectionId, after: state.selectionId };
  state.pair = { before: state.pair.after, after: state.pair.before };
  startComparison();
};
$('#clear').onclick = () => {
  const moveFocus = keyboard && document.activeElement === $('#clear');
  state.selectionId++;
  state.readIds = { before: state.selectionId, after: state.selectionId };
  cancelWorker();
  state.pair = { before: null, after: null };
  state.result = null;
  state.status = 'empty';
  display.reset();
  state.selectionNotice = '';
  $('#stats').textContent = '';
  message('');
  updateChrome();
  if (moveFocus) $('.drop-target[data-side=before]').focus();
};
for (const view of ['rendered', 'source']) $(`#${view}-view`).onclick = () => {
  if (state.view === view) return;
  state.view = view;
  updateChrome();
  display.show(view);
};
let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  $('#drop-overlay').hidden = !!event.target.closest('[data-side]');
});
document.addEventListener('dragleave', () => {
  if (--dragDepth > 0) return;
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
});
document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  const target = event.target.closest('[data-side]');
  document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
  target?.classList.add('drag-over');
  $('#drop-overlay').hidden = !!target;
});
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  document.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
  readFiles(event.dataTransfer.files, event.target.closest('[data-side]')?.dataset.side);
});

if (location.pathname.replace(/\/$/, '') === `${import.meta.env.BASE_URL}example`) {
  document.title = 'Markdown Diff example';
  state.pair = structuredClone(example);
  startComparison();
} else updateChrome();
