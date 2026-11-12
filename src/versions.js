import { parseGitHubUrl, fetchHistory, fetchText, knownText } from './github.js';

const SCAN_LIMIT = 20;
const KEYS = ['gh', 'file', 'a', 'b'];

export const baseName = (path) => path.split('/').pop();
export function formatDate(iso, { time = true } = {}) {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
  return time ? `${day}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day;
}

function writeUrl(values, push) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url);
}
const readUrl = () => Object.fromEntries(KEYS.map((key) => [key, new URLSearchParams(location.search).get(key)]));

/**
 * @typedef {{ sha: string, date: string, author: string, message?: string, additions?: number, deletions?: number,
 *   index: number, absent: boolean, changed: boolean }} Version
 * @typedef {{ name: string, text: string, version?: { sha: string, date: string, absent: boolean } }} RemoteDoc
 */

/**
 * Two versions of one GitHub file. The page URL holds the whole choice (?gh=…&file=…&a=…&b=…), so a link reopens it.
 * The app owns comparing and showing; this calls back with the docs to compare.
 *
 * @param {{
 *   busy(status: 'github-history' | 'github-scan' | 'github-content'): void,
 *   show(docs: { before: RemoteDoc | null, after: RemoteDoc | null }, note: string): void,
 *   fail(error: import('./github.js').GitHubError, retry: () => void): void,
 *   changed(): void,
 *   keepEdits(): boolean,
 * }} host
 */
export function createVersions(host) {
  let state = null;
  let run = 0;

  /** Repo history only lists commits that touch the file. A gist revision can leave it alone, which shows once its text is known. */
  function mark(entries) {
    return entries.map((entry, index) => {
      if (state.source.kind === 'repo') return { ...entry, index, absent: false, changed: true };
      const text = knownText(state.source, state.file, entry.sha);
      if (text === undefined) return { ...entry, index, absent: false, changed: true };
      const older = entries[index + 1] && knownText(state.source, state.file, entries[index + 1].sha);
      return { ...entry, index, absent: text === null, changed: text !== null && text !== older };
    });
  }
  const remark = () => { state.history = mark(state.history); };
  const entry = (sha) => state?.history.find((e) => e.sha === sha) ?? null;
  const text = (sha) => fetchText(state.source, state.file, sha);

  /** The two newest versions with different text, each labeled with the version that introduced it. */
  async function latestPair(token) {
    if (state.source.kind === 'repo') return [state.history[1]?.sha ?? null, state.history[0]?.sha ?? null];
    const total = Math.min(state.history.length, SCAN_LIMIT);
    let distinct = 0;
    let previous;
    // Read until a third distinct text, so the older side's text is known back to the version that introduced it.
    for (let i = 0; i < total && distinct < 3; i++) {
      host.busy('github-scan');
      const current = await text(state.history[i].sha);
      if (token !== run) return null;
      if (i === 0 || current !== previous) distinct++;
      previous = current;
    }
    remark();
    const introduced = (from) => state.history.slice(from).find((e) => e.changed && !e.absent)?.sha ?? null;
    const b = introduced(0);
    return [distinct > 1 && b ? introduced(entry(b).index + 1) : null, b];
  }

  /** Read the rest of the loaded gist history in the background, so the menu can mark versions that leave the file alone. */
  async function scan(token) {
    if (state.source.kind !== 'gist') return;
    const queue = state.history.filter((e) => knownText(state.source, state.file, e.sha) === undefined);
    if (!queue.length) return;
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length && token === run) await text(queue.shift().sha).catch(() => {});
    }));
    if (token !== run) return;
    remark();
    host.changed();
  }

  async function load(a, b, token, push) {
    host.busy('github-content');
    try {
      const [before, after] = await Promise.all([a ? text(a) : '', b ? text(b) : '']);
      if (token !== run) return;
      state.a = a;
      state.b = b;
      writeUrl({ gh: state.url, file: state.source.kind === 'gist' ? state.file : null, a, b }, push);
      const name = baseName(state.file);
      const doc = (sha, content) => sha
        ? { name, text: content ?? '', version: { sha, date: entry(sha)?.date ?? null, absent: content == null } }
        : null;
      const docs = { before: doc(a, before), after: doc(b, after) };
      const absent = [docs.before, docs.after].find((d) => d?.version.absent);
      const note = absent ? `${name} isn't in the ${formatDate(absent.version.date)} version, so that side is empty.`
        : !a && b ? `${name} has only one version, so everything shows as added.` : '';
      host.show(docs, note);
      scan(token);
    } catch (error) {
      if (token === run) host.fail(error, () => load(a, b, ++run, false));
    }
  }

  /** Starts loading a link's history and returns at once; false when the link isn't a GitHub file or gist. */
  function open(input, options = {}) {
    const source = parseGitHubUrl(input);
    if (!source) return false;
    start(source, options);
    return true;
  }

  async function start(source, { a = null, b = null, file = null, push = true }) {
    const token = ++run;
    state = { source, url: source.url, files: [], file: null, history: [], hasMore: false, page: 0, a: null, b: null };
    writeUrl({ gh: source.url, file, a, b }, push);
    host.busy('github-history');
    try {
      const { entries, hasMore, files } = await fetchHistory(source);
      if (token !== run) return;
      const hinted = source.fileHint && files.find((f) => f.replace(/[^a-z0-9]+/gi, '-').toLowerCase() === source.fileHint);
      state.url = source.url;
      state.files = files;
      state.file = files.includes(file) ? file : hinted || files[0];
      state.hasMore = hasMore;
      state.history = mark(entries);
      const pair = a || b ? [a, b] : await latestPair(token);
      if (pair && token === run) await load(pair[0], pair[1], token, false);
    } catch (error) {
      if (token === run) host.fail(error, () => open(source.url, { a, b, file, push: false }));
    }
  }

  return {
    get state() { return state; },
    entry,
    open,
    /** Put one version on one side; the other side stays. */
    pick(side, sha) {
      if (!host.keepEdits()) return;
      load(side === 'before' ? sha : state.a, side === 'after' ? sha : state.b, ++run, true);
    },
    setFile(file) {
      if (file === state.file || !host.keepEdits()) return;
      const token = ++run;
      state.file = file;
      remark();
      latestPair(token).then((pair) => pair && token === run && load(pair[0], pair[1], token, true));
    },
    async loadOlder() {
      const token = run;
      try {
        const { entries, hasMore } = await fetchHistory(state.source, state.page + 1);
        if (token !== run) return;
        state.page++;
        state.hasMore = hasMore;
        state.history = mark([...state.history, ...entries]);
        host.changed();
        scan(token);
      } catch (error) {
        if (token === run) host.fail(error, () => this.loadOlder());
      }
    },
    swap() {
      if (!state) return;
      [state.a, state.b] = [state.b, state.a];
      writeUrl({ a: state.a, b: state.b }, false);
    },
    /** Reload both sides from GitHub, dropping edits. */
    reload() { load(state.a, state.b, ++run, false); },
    clear(push = true) {
      run++;
      state = null;
      writeUrl(Object.fromEntries(KEYS.map((key) => [key, null])), push);
    },
    /** Opens whatever the URL names, for a cold link or Back and Forward. False when the URL names nothing. */
    syncFromUrl() {
      const { gh, file, a, b } = readUrl();
      if (!gh) {
        if (!state) return false;
        run++;
        state = null;
        return false;
      }
      const sameFile = state && gh === state.url && (state.source.kind !== 'gist' || !file || file === state.file);
      if (!sameFile) return open(gh, { a, b, file, push: false });
      if (a !== state.a || b !== state.b) {
        if (!host.keepEdits()) { writeUrl({ a: state.a, b: state.b }, true); return true; }
        load(a, b, ++run, false);
      }
      return true;
    },
  };
}
