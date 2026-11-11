/** @typedef {'before' | 'after'} Side */
/** @typedef {'rendered' | 'source' | 'edit'} Mode */
/** @typedef {{ name: string, text: string, edited?: boolean }} Doc */
/**
 * Everything the header shows, built once per state change. Committed docs only.
 * @typedef {{
 *   mode: Mode,
 *   docs: { before: Doc | null, after: Doc | null },
 *   status: string,
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
 * }} ChromeActions
 */

/**
 * The comparison chrome: the header with its view switch, filenames and status, and the touch file sheet.
 * Layout facts come from CSS custom properties on the header, never from matchMedia.
 *
 * @param {HTMLElement} header  #comparison-chrome
 * @param {HTMLElement} sheet  #file-sheet
 * @param {ChromeActions} actions
 * @returns {{ render(model: ChromeModel): void, scrollTo(target: number | Element): void }}
 */
export function createComparisonChrome(header, sheet, actions) {
  /** @type {Mode | null} */
  let shownMode = null;
  const collapse = createCollapse(header, () => sheet.hasAttribute('data-open'));
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
  new ResizeObserver(() => collapse.sync()).observe(header);
  addEventListener('resize', () => collapse.sync());

  /** @param {ChromeModel} model */
  function render(model) {
    for (const [mode, button] of Object.entries(modes)) button.setAttribute('aria-pressed', String(model.mode === mode));
    modes.edit.disabled = model.busy && model.mode !== 'edit';
    clear.hidden = !model.loaded && model.status === 'empty';
    clear.disabled = !model.loaded && !['reading', 'open-error', 'compare-error'].includes(model.status);
    swap.disabled = !model.loaded;
    // Native apps bring their bars back when you change screens, so a mode change shows the filename row.
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

// While reading on a phone, the filename row slides up under the controls. It tracks the scroll 1:1, comes back
// as soon as the scroll reverses, and settles fully shown or hidden once scrolling stops.
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
  // Never hides more than has scrolled, so the row can't cover the top of the document.
  function setHidden(px) {
    const range = title.offsetHeight;
    hidden = readLayout(header).collapse ? Math.min(Math.max(px, 0), range, Math.max(scrollY, 0)) : 0;
    header.style.setProperty('--title-hidden', `${hidden}px`);
    header.style.setProperty('--title-progress', range ? (hidden / range).toFixed(3) : '0');
    return hidden;
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
