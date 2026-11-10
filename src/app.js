import './style.css';
import './theme.js';
import { example } from './example.js';
import { createComparisonView } from './view.js';

const $ = (selector) => document.querySelector(selector);
const statusText = {
  empty: 'Ready when you are',
  reading: 'Reading files…',
  working: 'Comparing files…',
  identical: 'Files are identical',
  'rendered-same': 'Same rendered content',
  different: 'Comparison ready',
  'open-error': 'Could not open file',
  'compare-error': 'Comparison stopped',
  editing: 'Edits not compared',
};
const filenameSegments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const state = {
  pair: { before: null, after: null }, view: 'rendered', requestId: 0,
  selectionId: 0, readIds: { before: 0, after: 0 }, worker: null,
  timeout: null, result: null, status: 'empty', selectionNotice: '', editing: false,
};
const comparison = $('#comparison');
const status = $('#status');
const notice = $('#notice');
const editor = $('#editor');
const drafts = { before: $('#editor [data-side=before]'), after: $('#editor [data-side=after]') };
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
    const filename = state.pair[side]?.name || (side === 'before' ? 'Original' : 'Changed');
    const shown = state.pair[side]?.edited ? `${filename} (edited)` : filename;
    if (label.renderedName !== shown) {
      const segments = filenameSegments ? [...filenameSegments.segment(shown)].map(({ segment }) => segment) : [];
      const start = document.createElement('span');
      start.className = 'file-name-start';
      start.textContent = filenameSegments ? segments.slice(0, -20).join('') : shown;
      const end = document.createElement('span');
      end.className = 'file-name-end';
      end.textContent = segments.slice(-20).join('');
      const value = document.createElement('bdi');
      value.className = 'file-name-value';
      value.append(start, end);
      summary.replaceChildren(value);
      name.title = filename;
      label.renderedName = shown;
      name.open = false;
    }
    name.classList.toggle('loaded', !!state.pair[side]);
    $(`.file-download[data-side=${side}]`).hidden = !(state.pair[side]?.edited || (state.editing && state.pair[side]));
  }
  const loaded = !!(state.pair.before || state.pair.after);
  const busy = state.status === 'reading' || state.status === 'working';
  $('.app').classList.toggle('has-files', loaded);
  $('.view-switch').hidden = !loaded;
  $('#swap').hidden = !loaded;
  $('#clear').hidden = !loaded && state.status === 'empty';
  $('#swap').disabled = !loaded;
  $('#clear').disabled = !loaded && !['reading', 'open-error', 'compare-error'].includes(state.status);
  const refocus = !state.editing && editor.contains(document.activeElement);
  comparison.hidden = !loaded || state.editing;
  editor.hidden = !state.editing;
  if (refocus) comparison.focus({ preventScroll: true });
  $('#example').hidden = loaded;
  comparison.tabIndex = state.view === 'source' ? 0 : -1;
  if (state.view === 'source' && loaded) comparison.title = 'Click to edit';
  else comparison.removeAttribute('title');
  comparison.setAttribute('aria-busy', String(busy));
  $('.comparison-summary').classList.toggle('busy', busy);
  const statusLabel = statusText[state.status];
  if (status.textContent !== statusLabel) status.textContent = statusLabel;
  status.classList.toggle('sr-only', state.status === 'empty' || state.status === 'different' || state.status === 'editing' ||
    (state.status === 'rendered-same' && state.view === 'source'));
  $('#stats').hidden = busy || state.editing || !state.result || !$('#stats').textContent;
  $('#compare-edits').hidden = !state.editing;
  $('#compare-edits').disabled = busy;
  $('#rendered-view').setAttribute('aria-pressed', String(state.view === 'rendered'));
  $('#source-view').setAttribute('aria-pressed', String(state.view === 'source'));
  scheduleFilenames();
}
function startComparison() {
  state.editing = false;
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
    message(`${text} Your text is open for editing. Fix it and press Compare, or choose another file.`, true);
    openEditor('after');
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
    $('#stats').innerHTML = [added ? `<span class="stat-add" aria-label="${added} added ${added === 1 ? 'line' : 'lines'}">${added} added</span>` : '',
      removed ? `<span class="stat-remove" aria-label="${removed} removed ${removed === 1 ? 'line' : 'lines'}">${removed} removed</span>` : '',
      changed ? `${changed} changed ${changed === 1 ? 'line' : 'lines'}` : ''].filter(Boolean).join(' <span aria-hidden="true">·</span> ');
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
      if (!/\.(md|markdown|txt|mdx)$/i.test(file.name)) throw new Error('Choose a .md, .markdown, .txt, or .mdx text file.');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error(`${file.name} is not a UTF-8 text file.`); }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text.slice(0, 8000))) throw new Error(`${file.name} looks like a binary file. Choose a UTF-8 text file.`);
      return { name: file.name, text };
    }));
    const accepted = documents.flatMap((document, index) => state.readIds[targets[index]] === selectionId ? [[targets[index], document]] : []);
    if (!accepted.length) return;
    syncDrafts();
    state.pair = { ...state.pair, ...Object.fromEntries(accepted) };
    if (state.editing && chosen.length === 1) {
      for (const [target, { text }] of accepted) drafts[target].value = text;
      state.status = 'editing';
      updateChrome();
      return;
    }
    startComparison();
  } catch (error) {
    if (targets.every((target) => state.readIds[target] !== selectionId)) return;
    state.status = 'open-error';
    message(error.message, true);
    updateChrome();
  }
}
function dropPendingReads() {
  state.selectionId++;
  state.readIds = { before: state.selectionId, after: state.selectionId };
}
function openEditor(side, line = 1) {
  for (const [key, textarea] of Object.entries(drafts)) textarea.value = state.pair[key]?.text ?? '';
  state.editing = true;
  updateChrome();
  window.scrollTo({ top: 0, behavior: 'instant' });
  const textarea = drafts[side];
  const caret = textarea.value.split('\n', line - 1).join('\n').length + (line > 1 ? 1 : 0);
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(caret, caret);
  textarea.scrollTop = (line - 1) * parseFloat(getComputedStyle(textarea).lineHeight) - textarea.clientHeight / 3;
}
function startEditing(side, line) {
  dropPendingReads();
  state.status = 'editing';
  openEditor(side, line);
}
const newName = (side) => side === 'before' ? 'Original.md' : 'Changed.md';
// Textareas turn CRLF into LF, so an untouched side is compared in that form and keeps its original text.
const draftChanged = (side) => drafts[side].value !== (state.pair[side]?.text ?? '').replace(/\r\n?/g, '\n');
function syncDrafts() {
  if (!state.editing) return;
  for (const side of ['before', 'after']) {
    if (draftChanged(side)) state.pair[side] = { name: state.pair[side]?.name || newName(side), text: drafts[side].value, edited: true };
  }
}
function lineAt(cell) {
  for (let row = cell?.closest('.pair-row'); row; row = row.previousElementSibling) {
    const number = row.querySelector(`.source-cell[data-side=${cell.dataset.side}] .source-number`)?.textContent;
    if (number) return Number(number);
  }
  return 1;
}
const canEdit = () => state.view === 'source' && state.status !== 'reading' && state.status !== 'working';
comparison.addEventListener('click', (event) => {
  if (!canEdit() || !getSelection().isCollapsed) return;
  const cell = event.target.closest('.source-cell');
  startEditing(cell?.dataset.side || 'after', lineAt(cell));
});
comparison.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target === comparison && canEdit()) startEditing('after');
});
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); $('#compare-edits').click(); }
});
$('#compare-edits').onclick = () => {
  syncDrafts();
  if (!state.pair.before && !state.pair.after) return;
  startComparison();
  comparison.focus({ preventScroll: true });
};
window.addEventListener('beforeunload', (event) => {
  if (state.pair.before?.edited || state.pair.after?.edited || (state.editing && (draftChanged('before') || draftChanged('after')))) {
    event.preventDefault();
    event.returnValue = true;
  }
});
for (const { side } of filenames) {
  const input = $(`#${side}-input`);
  input.onchange = () => { readFiles(input.files, side); input.value = ''; };
  $(`.file-browse[data-side=${side}]`).onclick = () => input.click();
  $(`.file-download[data-side=${side}]`).onclick = () => {
    syncDrafts();
    updateChrome();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([state.pair[side]?.text ?? ''], { type: 'text/markdown' }));
    link.download = state.pair[side]?.name || newName(side);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href));
  };
}
$('#swap').onclick = () => {
  syncDrafts();
  dropPendingReads();
  state.pair = { before: state.pair.after, after: state.pair.before };
  startComparison();
};
$('#clear').onclick = () => {
  dropPendingReads();
  cancelWorker();
  state.pair = { before: null, after: null };
  state.result = null;
  state.status = 'empty';
  display.reset();
  state.selectionNotice = '';
  $('#stats').textContent = '';
  message('');
  openEditor('before');
};
for (const view of ['rendered', 'source']) $(`#${view}-view`).onclick = () => {
  if (state.view === view && !state.editing) return;
  state.view = view;
  if (state.editing) {
    syncDrafts();
    startComparison();
    return;
  }
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
document.addEventListener('paste', (event) => {
  if (event.target instanceof Element && event.target.closest('#editor')) return;
  const { files } = event.clipboardData;
  const text = event.clipboardData.getData('text/plain');
  if (!files.length && !text) return;
  event.preventDefault();
  const side = document.activeElement?.closest('[data-side]')?.dataset.side || (state.pair.before ? 'after' : 'before');
  readFiles(files.length ? files : [new File([text], 'Pasted text.md')], side);
});

if (location.pathname.replace(/\/$/, '') === `${import.meta.env.BASE_URL}example`) {
  document.title = 'Markdown Diff example';
  state.pair = structuredClone(example);
  startComparison();
} else openEditor('before');
