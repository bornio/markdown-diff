/** @typedef {'before' | 'after'} Side */
/** @typedef {'rendered' | 'source' | 'edit'} Mode */
/** @typedef {{ name: string, text: string, edited?: boolean }} Doc */
/**
 * Everything the header shows, built once per state change. Committed docs only.
 * @typedef {{
 *   mode: Mode,
 *   docs: { before: Doc | null, after: Doc | null },
 *   status: keyof typeof STATUS_TEXT,
 *   stats: { added: number, removed: number, changed: number } | null,
 *   loaded: boolean,
 *   busy: boolean,
 * }} ChromeModel
 */
/**
 * Intents, plus `currentDoc`, a pure draft-aware read. The chrome never writes app state.
 * @typedef {{
 *   mode(mode: Mode): void,
 *   clear(): void,
 *   swap(): void,
 *   readFiles(files: FileList, side: Side): void,
 *   paste(side: Side): void,
 *   save(side: Side): void,
 *   currentDoc(side: Side): Doc | null,
 * }} ChromeActions
 */

const STATUS_TEXT = {
  empty: 'Ready when you are',
  reading: 'Reading files…',
  working: 'Comparing files…',
  identical: 'Files are identical',
  'rendered-same': 'Same rendered content',
  different: 'Comparison ready',
  'open-error': 'Could not open file',
  'compare-error': 'Comparison stopped',
  editing: 'Choose Rendered or Source to compare',
};
const SIDE_LABEL = { before: 'Original', after: 'Changed' };

/**
 * The comparison chrome: the header with its view switch, filenames and status, and the touch file sheet.
 * Layout facts come from CSS custom properties on the header, never from matchMedia.
 *
 * @param {HTMLElement} header  #comparison-chrome
 * @param {HTMLDialogElement} sheet  #file-sheet
 * @param {ChromeActions} actions
 * @returns {{ render(model: ChromeModel): void, scrollTo(target: number | Element): void }}
 */
export function createComparisonChrome(header, sheet, actions) {
  let shownMode = null;
  let last = null;
  const collapse = createCollapse(header, () => sheet.open);
  const fileSheet = createFileSheet(sheet, header, actions);
  const filenames = createFilenames(header, (side) => fileSheet.open(side, last));
  const renderStatus = createStatus(header);
  const modes = {
    rendered: header.querySelector('#rendered-view'),
    source: header.querySelector('#source-view'),
    edit: header.querySelector('#edit-view'),
  };
  const clear = header.querySelector('#clear');
  const swap = header.querySelector('#swap');

  for (const [mode, button] of Object.entries(modes)) button.addEventListener('click', () => actions.mode(mode));
  clear.addEventListener('click', () => actions.clear());
  swap.addEventListener('click', () => actions.swap());
  header.querySelector('.comparison-title').addEventListener('focusin', () => collapse.reveal());
  const resync = () => {
    collapse.sync();
    filenames.schedule();
  };
  new ResizeObserver(resync).observe(header);
  addEventListener('resize', resync);

  /** @param {ChromeModel} model */
  function render(model) {
    last = model;
    for (const [mode, button] of Object.entries(modes)) button.setAttribute('aria-pressed', String(model.mode === mode));
    modes.edit.disabled = model.busy && model.mode !== 'edit';
    clear.hidden = !model.loaded && model.status === 'empty';
    clear.disabled = !model.loaded && !['reading', 'open-error', 'compare-error'].includes(model.status);
    swap.disabled = !model.loaded;
    renderStatus(model);
    filenames.render(model.docs);
    if (model.mode !== shownMode) {
      shownMode = model.mode;
      collapse.reveal();
    }
  }

  /** @param {number | Element} target  a document offset, or an element to place just below the visible chrome */
  function scrollTo(target) {
    const top = typeof target === 'number' ? target : scrollY + target.getBoundingClientRect().top - collapse.obscured() - 8;
    collapse.jump(Math.max(0, top));
  }

  return { render, scrollTo };
}

function readLayout(header) {
  const style = getComputedStyle(header);
  return {
    fileMenu: style.getPropertyValue('--file-menu').trim() === 'sheet',
    collapse: style.getPropertyValue('--title-collapse').trim() === 'scroll',
    pinned: style.position === 'sticky',
  };
}

function createCollapse(header, paused) {
  const controls = header.querySelector('.toolbar-controls');
  const title = header.querySelector('.comparison-title');
  let hidden = 0;
  let lastY = Math.max(scrollY, 0);
  let snapTimer = 0;
  let published = '';

  function obscured() {
    const { pinned, collapse } = readLayout(header);
    if (!pinned) return 0;
    if (!collapse) return header.offsetHeight;
    return controls.offsetHeight + title.offsetHeight - hidden;
  }
  function setHidden(px) {
    const range = title.offsetHeight;
    const coverable = Math.min(range, Math.max(scrollY, 0));
    hidden = readLayout(header).collapse ? Math.min(Math.max(px, 0), coverable) : 0;
    header.style.setProperty('--title-hidden', `${hidden}px`);
    header.style.setProperty('--title-progress', range ? (hidden / range).toFixed(3) : '0');
  }
  // A custom property rather than html scroll-padding-top: Chrome treats controls inside a sticky header as hidden
  // behind the scroll padding, so focusing one would scroll the page.
  function rest() {
    const value = `${obscured()}px`;
    if (value === published) return;
    published = value;
    document.documentElement.style.setProperty('--chrome-obscured', value);
  }
  function settle(px) {
    header.setAttribute('data-settling', '');
    setHidden(px);
    rest();
  }

  addEventListener('scroll', () => {
    const y = Math.max(scrollY, 0);
    const delta = y - lastY;
    lastY = y;
    if (!delta || paused() || !readLayout(header).collapse) return;
    header.removeAttribute('data-settling');
    setHidden(hidden + delta);
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const range = title.offsetHeight;
      if (hidden > 0 && hidden < range) settle(hidden >= range / 2 && scrollY >= range ? range : 0);
      else rest();
    }, 140);
  }, { passive: true });

  return {
    obscured,
    reveal() {
      if (hidden) settle(0);
      else rest();
    },
    jump(top) {
      window.scrollTo({ top, behavior: 'instant' });
      lastY = Math.max(scrollY, 0);
      setHidden(hidden);
      rest();
    },
    sync() {
      setHidden(hidden);
      rest();
    },
  };
}

function createFilenames(header, openSheet) {
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const labels = {
    before: { element: header.querySelector('#before-name'), shown: null, loaded: false },
    after: { element: header.querySelector('#after-name'), shown: null, loaded: false },
  };
  let frame = 0;

  function affordance({ element, loaded }) {
    if (readLayout(header).fileMenu) return 'sheet';
    const truncated = [...element.querySelectorAll('.file-name-value > span')].some((part) => part.scrollWidth > part.clientWidth);
    return loaded && (element.open || truncated) ? 'expand' : 'none';
  }
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const label of Object.values(labels)) {
        const kind = affordance(label);
        const summary = label.element.querySelector('summary');
        label.element.classList.toggle('expandable', kind === 'expand');
        summary.tabIndex = kind === 'none' ? -1 : 0;
        summary.setAttribute('aria-disabled', String(kind === 'none'));
        if (kind === 'sheet') summary.setAttribute('aria-haspopup', 'dialog');
        else summary.removeAttribute('aria-haspopup');
      }
    });
  }

  const resized = new ResizeObserver(schedule);
  for (const [side, label] of Object.entries(labels)) {
    resized.observe(label.element);
    label.element.addEventListener('toggle', schedule);
    label.element.querySelector('summary').addEventListener('click', (event) => {
      const kind = affordance(label);
      if (kind === 'expand') return;
      event.preventDefault();
      if (kind === 'sheet') openSheet(side);
    });
  }

  function render(docs) {
    for (const [side, label] of Object.entries(labels)) {
      const doc = docs[side];
      const name = doc?.name || SIDE_LABEL[side];
      const shown = doc?.edited ? `${name} (edited)` : name;
      if (label.shown !== shown) {
        const segments = segmenter ? [...segmenter.segment(shown)].map(({ segment }) => segment) : [];
        const start = document.createElement('span');
        start.className = 'file-name-start';
        start.textContent = segmenter ? segments.slice(0, -20).join('') : shown;
        const end = document.createElement('span');
        end.className = 'file-name-end';
        end.textContent = segments.slice(-20).join('');
        const value = document.createElement('bdi');
        value.className = 'file-name-value';
        value.append(start, end);
        label.element.querySelector('summary').replaceChildren(value);
        label.element.title = name;
        label.shown = shown;
        label.element.open = false;
      }
      label.loaded = !!doc;
      label.element.classList.toggle('loaded', label.loaded);
    }
    schedule();
  }

  return { render, schedule };
}

function createFileSheet(sheet, header, actions) {
  const input = sheet.querySelector('#file-input');
  const label = sheet.querySelector('#file-sheet-label');
  const name = sheet.querySelector('#file-sheet-name');
  const save = sheet.querySelector('[data-sheet-action=save]');
  const swap = sheet.querySelector('[data-sheet-action=swap]');
  let side = 'after';
  let pickSide = 'after';
  const run = {
    open: (target) => {
      pickSide = target;
      input.click();
    },
    paste: (target) => actions.paste(target),
    save: (target) => actions.save(target),
    swap: () => actions.swap(),
  };

  // Each action runs inside the tap's click handler: the file picker, clipboard and share sheet need its activation.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) {
      sheet.close();
      return;
    }
    const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
    if (!action) return;
    sheet.close();
    run[action](side);
  });
  input.addEventListener('change', () => {
    actions.readFiles(input.files, pickSide);
    input.value = '';
  });
  // Safari doesn't focus a tapped button or summary, so the dialog may have no opener to return focus to.
  sheet.addEventListener('close', () => header.querySelector(`#${side}-name summary`).focus({ preventScroll: true }));

  return {
    open(target, model) {
      if (!model || sheet.open) return;
      side = target;
      const doc = actions.currentDoc(target);
      label.textContent = SIDE_LABEL[target];
      name.textContent = doc?.name || 'No file yet';
      save.hidden = !doc;
      swap.hidden = !model.loaded;
      sheet.showModal();
    },
  };
}

const lineCount = (count) => count === 1 ? 'line' : 'lines';

function createStatus(header) {
  const status = header.querySelector('#status');
  const stats = header.querySelector('#stats');
  const summary = header.querySelector('.comparison-summary');
  let statsMarkup = '';

  return (model) => {
    const text = STATUS_TEXT[model.status];
    if (status.textContent !== text) status.textContent = text;
    status.classList.toggle('sr-only', model.status === 'empty' || model.status === 'different' ||
      (model.status === 'rendered-same' && model.mode === 'source'));
    summary.classList.toggle('busy', model.busy);
    const { added = 0, removed = 0, changed = 0 } = model.stats ?? {};
    const markup = [
      added ? `<span class="stat-add" aria-label="${added} added ${lineCount(added)}">${added} added</span>` : '',
      removed ? `<span class="stat-remove" aria-label="${removed} removed ${lineCount(removed)}">${removed} removed</span>` : '',
      changed ? `${changed} changed ${lineCount(changed)}` : '',
    ].filter(Boolean).join(' <span aria-hidden="true">·</span> ');
    if (markup !== statsMarkup) {
      stats.innerHTML = markup;
      statsMarkup = markup;
    }
    stats.hidden = model.busy || model.mode === 'edit' || !markup;
  };
}
