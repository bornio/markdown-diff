import './style.css';
import './theme.js';
import { example } from './example.js';
import { createComparisonChrome } from './chrome.js';
import { createComparisonView } from './view.js';
import { parseGitHubUrl } from './github.js';
import { createVersions } from './versions.js';
import { createVersionMenu } from './version-menu.js';

const $ = (selector) => document.querySelector(selector);
const state = {
  pair: { before: null, after: null }, view: 'rendered', requestId: 0,
  selectionId: 0, readIds: { before: 0, after: 0 }, worker: null,
  timeout: null, result: null, status: 'empty', selectionNotice: '', versionNote: '', editing: false,
};
const GITHUB_BUSY = ['github-history', 'github-scan', 'github-content'];
const SIDES = ['before', 'after'];
const comparison = $('#comparison');
const notice = $('#notice');
const editor = $('#editor');
const drafts = { before: $('#editor [data-side=before]'), after: $('#editor [data-side=after]') };
const githubForm = $('#github-form');
const githubUrl = $('#github-url');
const chrome = createComparisonChrome($('#comparison-chrome'), $('#file-sheet'), {
  mode: setMode, clear, swap, readFiles, currentDoc,
  paste: pasteFromClipboard,
  save: (side) => saveCopy(currentDoc(side)),
  versions: (side, anchor, sheet) => menu.open(side, anchor, sheet),
});
const versions = createVersions({
  busy(status) {
    dropPendingReads();
    cancelWorker();
    state.editing = false;
    state.status = status;
    state.selectionNotice = '';
    message('');
    render();
  },
  show(docs, note) {
    state.pair = docs;
    state.versionNote = note;
    startComparison();
  },
  fail(error, retry) {
    menu.refresh();
    state.status = 'github-error';
    const empty = !state.pair.before && !state.pair.after;
    if (empty) {
      for (const textarea of Object.values(drafts)) textarea.value = '';
      state.editing = true;
    }
    // Only a network failure can pass on a retry; GitHub's answer won't change for a missing file or a spent limit.
    message(error.message, true, error.kind === 'network' && { label: 'Try again', run: retry });
    render();
    if (empty) githubUrl.focus();
  },
  changed: () => menu.refresh(),
  keepEdits,
});
const menu = createVersionMenu(versions, { swap });
const display = createComparisonView(comparison, chrome);

function cancelWorker() {
  state.worker?.terminate();
  state.worker = null;
  clearTimeout(state.timeout);
  state.timeout = null;
  state.requestId++;
}
function message(text, error = false, action = null) {
  const combined = [state.selectionNotice, text].filter(Boolean).join(' ');
  notice.replaceChildren(combined);
  if (combined && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notice-action';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    notice.append(' ', button);
  }
  notice.hidden = !combined;
  notice.classList.toggle('error', error);
}
function render() {
  const loaded = !!(state.pair.before || state.pair.after);
  const fetching = GITHUB_BUSY.includes(state.status);
  const busy = state.status === 'reading' || state.status === 'working' || fetching;
  chrome.render({
    mode: state.editing ? 'edit' : state.view, docs: { ...state.pair },
    status: state.status, stats: state.result?.stats ?? null, loaded, busy,
    versions: !!versions.state?.history.length,
  });
  githubForm.hidden = loaded || !state.editing;
  if (!githubForm.hidden && versions.state && document.activeElement !== githubUrl) githubUrl.value = versions.state.url;
  $('#loading').hidden = loaded || !fetching;
  const refocus = !state.editing && editor.contains(document.activeElement);
  comparison.hidden = !loaded || state.editing;
  editor.hidden = !state.editing;
  if (refocus) comparison.focus({ preventScroll: true });
  $('#example').hidden = loaded || fetching;
  comparison.tabIndex = state.view === 'source' ? 0 : -1;
  if (state.view === 'source' && loaded) comparison.title = 'Click to edit';
  else comparison.removeAttribute('title');
  comparison.setAttribute('aria-busy', String(busy));
}
/** While the page shows GitHub versions, note what the page link leaves out; once neither side is from GitHub, drop the link. */
function syncVersions() {
  if (!versions.state) return;
  if (!SIDES.some((side) => state.pair[side]?.version)) {
    versions.clear(false);
    state.versionNote = '';
    return;
  }
  const changed = SIDES.some((side) => state.pair[side] && (!state.pair[side].version || state.pair[side].edited));
  state.selectionNotice = changed ? "The page link opens the GitHub versions, without your changes." : state.versionNote;
}
function startComparison() {
  state.editing = false;
  syncVersions();
  cancelWorker();
  message('');
  state.result = null;
  state.status = 'working';
  display.reset();
  render();
  const requestId = state.requestId;
  const worker = new Worker(new URL('./compare.worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  const fail = (text) => {
    if (requestId !== state.requestId) return;
    cancelWorker();
    state.status = 'compare-error';
    message(`${text} Your text is open for editing. Fix it and choose Rendered or Source, or drop another file.`, true);
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
    const { before, after } = state.pair;
    state.status = before?.version && before.version.sha === after?.version?.sha && !before.edited && !after.edited ? 'same-version'
      : !added && !removed && !changed ? 'identical' : state.result.rows.every((row) => row.kind === 'same') ? 'rendered-same' : 'different';
    message(state.result.precision.warnings.length ? `Simplified comparison. ${state.result.precision.warnings.join(' ')}` : '');
    render();
    display.reset(state.result, Object.fromEntries(SIDES.map((side) => [side, state.pair[side]?.name || 'Empty document'])));
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
  render();
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
      render();
      return;
    }
    startComparison();
  } catch (error) {
    if (targets.every((target) => state.readIds[target] !== selectionId)) return;
    state.status = 'open-error';
    message(error.message, true);
    render();
  }
}
function dropPendingReads() {
  state.selectionId++;
  state.readIds = { before: state.selectionId, after: state.selectionId };
}
function openEditor(side, line = 1) {
  for (const [key, textarea] of Object.entries(drafts)) textarea.value = state.pair[key]?.text ?? '';
  state.editing = true;
  render();
  chrome.scrollTo(0);
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
function currentDoc(side) {
  return state.editing && draftChanged(side)
    ? { ...state.pair[side], name: state.pair[side]?.name || newName(side), text: drafts[side].value, edited: true }
    : state.pair[side];
}
function syncDrafts() {
  for (const side of SIDES) state.pair[side] = currentDoc(side);
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
function compareEdits() {
  syncDrafts();
  if (!state.pair.before && !state.pair.after) return;
  startComparison();
  comparison.focus({ preventScroll: true });
}
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); compareEdits(); }
});
const hasEdits = () => SIDES.some((side) => state.pair[side]?.edited || (state.editing && draftChanged(side)));
function keepEdits() {
  return !hasEdits() || confirm('Discard your edits and load from GitHub?');
}
window.addEventListener('beforeunload', (event) => {
  if (hasEdits()) {
    event.preventDefault();
    event.returnValue = true;
  }
});
function swap() {
  syncDrafts();
  dropPendingReads();
  state.pair = { before: state.pair.after, after: state.pair.before };
  versions.swap();
  startComparison();
}
function clear() {
  if (versions.state) versions.clear();
  state.versionNote = '';
  dropPendingReads();
  cancelWorker();
  state.pair = { before: null, after: null };
  state.result = null;
  state.status = 'empty';
  display.reset();
  state.selectionNotice = '';
  message('');
  openEditor('before');
}
function setMode(mode) {
  if (mode === 'edit') {
    if (!state.editing) startEditing('after');
    return;
  }
  if (state.view === mode && !state.editing) return;
  state.view = mode;
  if (state.editing) {
    compareEdits();
    render();
    return;
  }
  render();
  display.show(mode);
}
const pastedFile = (text) => new File([text], 'Pasted text.md');
async function pasteFromClipboard(side) {
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch { message('This browser blocked clipboard access. Choose Edit, then touch and hold in a box to paste.', true); return; }
  if (text) readFiles([pastedFile(text)], side);
}
async function saveCopy({ name, text }) {
  const file = new File([text], name, { type: 'text/markdown' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch {}
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}
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
/** Opens a GitHub link; false when the text isn't one. */
function openGitHub(text) {
  if (!parseGitHubUrl(text)) return false;
  if (keepEdits()) versions.open(text);
  return true;
}
githubForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const valid = openGitHub(githubUrl.value);
  githubUrl.setAttribute('aria-invalid', String(!valid));
  $('#github-url-error').hidden = valid;
});
githubUrl.addEventListener('input', () => {
  githubUrl.setAttribute('aria-invalid', 'false');
  $('#github-url-error').hidden = true;
});
addEventListener('popstate', () => {
  menu.close();
  if (!versions.syncFromUrl() && SIDES.some((side) => state.pair[side]?.version)) clear();
});

document.addEventListener('paste', (event) => {
  const { files } = event.clipboardData;
  const text = event.clipboardData.getData('text/plain');
  // A GitHub link pasted outside a text field, or into an empty editor box, opens that file's versions.
  const field = event.target instanceof Element ? event.target.closest('input, textarea') : null;
  if (!files.length && (!field || (field.closest('#editor') && !field.value)) && openGitHub(text.trim())) {
    event.preventDefault();
    return;
  }
  if (event.target instanceof Element && event.target.closest('#editor, #github-form')) return;
  if (!files.length && !text) return;
  event.preventDefault();
  const side = document.activeElement?.closest('[data-side]')?.dataset.side || (state.pair.before ? 'after' : 'before');
  readFiles(files.length ? files : [pastedFile(text)], side);
});

if (location.pathname.replace(/\/$/, '') === `${import.meta.env.BASE_URL}example`) {
  document.title = 'Markdown Diff example';
  state.pair = structuredClone(example);
  startComparison();
} else if (!versions.syncFromUrl()) openEditor('before');
