// GitHub history and file text, read straight from GitHub without an account.
// History uses the REST API (60 requests an hour per network); file text comes from the raw hosts, which aren't limited.

const MARKDOWN = /\.(md|markdown|mdx|txt)$/i;
const PAGE = 100;

export class GitHubError extends Error {
  /** @param {'not-found' | 'rate-limit' | 'network'} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * A repo file or gist link, or null for anything else.
 * A repo branch may contain slashes, so `segments` keeps everything after blob/ until the history request settles it.
 */
export function parseGitHubUrl(input) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); } catch { return null; }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'gist.github.com') {
    const [owner, id] = parts.length === 1 ? [null, parts[0]] : parts;
    if (!/^[0-9a-f]{20,40}$/i.test(id ?? '')) return null;
    return {
      kind: 'gist', owner, id,
      fileHint: url.hash.startsWith('#file-') ? url.hash.slice(6).toLowerCase() : null,
      url: `https://gist.github.com/${owner ? `${owner}/` : ''}${id}`,
    };
  }
  const repo = host === 'github.com' && parts[2] === 'blob' ? parts.slice(3)
    : host === 'raw.githubusercontent.com' ? parts.slice(2) : null;
  if (!repo || repo.length < 2 || !MARKDOWN.test(repo.at(-1))) return null;
  const [owner, name] = parts;
  return {
    kind: 'repo', owner, repo: name, segments: repo, ref: repo[0], path: repo.slice(1).join('/'),
    url: `https://github.com/${owner}/${name}/blob/${repo.map(encodeURIComponent).join('/')}`,
  };
}

const time = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function get(url, { raw = false } = {}) {
  let response;
  try { response = await fetch(url); }
  catch { throw new GitHubError('network', "Couldn't reach GitHub. Check your connection and try again."); }
  if (response.ok) return raw ? response.text() : response;
  if (raw && response.status === 404) return null;
  if (response.status === 404) throw new GitHubError('not-found', "GitHub couldn't find that. Private repos can't be loaded.");
  if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(response.headers.get('x-ratelimit-reset')) * 1000);
    throw new GitHubError('rate-limit', `GitHub's hourly limit for your network is used up. Try again after ${time(reset)}.`);
  }
  throw new GitHubError('network', `GitHub answered with an error (${response.status}). Try again.`);
}

const hasNext = (response) => /rel="next"/.test(response.headers.get('link') ?? '');
const repoPath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function repoCommits(source, page) {
  const query = `path=${encodeURIComponent(source.path)}&sha=${encodeURIComponent(source.ref)}&per_page=${PAGE}&page=${page + 1}`;
  const response = await get(`https://api.github.com/repos/${source.owner}/${source.repo}/commits?${query}`);
  return { commits: await response.json(), hasMore: hasNext(response) };
}

/**
 * One page of history, newest first. A page-0 repo request also settles which part of the link is the branch:
 * it tries the shortest branch name first and moves one segment over when GitHub knows no such branch or file.
 * Gist entries carry no message, only the whole gist's line counts.
 */
export async function fetchHistory(source, page = 0) {
  if (source.kind === 'repo') {
    let found;
    for (let split = 1; split < source.segments.length; split++) {
      if (page === 0) Object.assign(source, { ref: source.segments.slice(0, split).join('/'), path: source.segments.slice(split).join('/') });
      try { found = await repoCommits(source, page); }
      catch (error) {
        if (page === 0 && error.kind === 'not-found' && split < source.segments.length - 1) continue;
        throw error;
      }
      if (page > 0 || found.commits.length || split === source.segments.length - 1) break;
    }
    if (!found.commits.length && page === 0) throw new GitHubError('not-found', `GitHub has no history for ${source.path} on ${source.ref}.`);
    return {
      entries: found.commits.map((c) => ({
        sha: c.sha, date: c.commit.committer?.date ?? c.commit.author.date,
        author: c.author?.login ?? c.commit.author.name, message: c.commit.message.split('\n')[0],
      })),
      hasMore: found.hasMore,
      files: [source.path],
    };
  }
  const [files, response] = await Promise.all([
    page === 0 ? get(`https://api.github.com/gists/${source.id}`).then((r) => r.json()) : null,
    get(`https://api.github.com/gists/${source.id}/commits?per_page=${PAGE}&page=${page + 1}`),
  ]);
  if (files) {
    source.owner = files.owner?.login ?? source.owner;
    source.files = Object.keys(files.files).filter((file) => MARKDOWN.test(file));
    if (!source.files.length) throw new GitHubError('not-found', 'That gist has no Markdown files.');
  }
  const revisions = await response.json();
  return {
    entries: revisions.map((r) => ({
      sha: r.version, date: r.committed_at, author: r.user?.login ?? source.owner,
      additions: r.change_status?.additions ?? 0, deletions: r.change_status?.deletions ?? 0,
    })),
    hasMore: hasNext(response),
    files: source.files,
  };
}

const texts = new Map();
const textKey = (source, file, sha) => `${source.kind === 'repo' ? `${source.owner}/${source.repo}` : source.id}|${file}|${sha}`;

/** A file's text at one version, or null when the file isn't in that version. Each version is fetched once. */
export function fetchText(source, file, sha) {
  const key = textKey(source, file, sha);
  if (!texts.has(key)) {
    const url = source.kind === 'repo'
      ? `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${sha}/${repoPath(file)}`
      : `https://gist.githubusercontent.com/${source.owner}/${source.id}/raw/${sha}/${encodeURIComponent(file)}`;
    const request = get(url, { raw: true });
    texts.set(key, request);
    request.then((text) => texts.set(key, text), () => texts.delete(key));
  }
  return Promise.resolve(texts.get(key));
}

/** The text already fetched for a version: a string, null when the file isn't there, or undefined when not yet known. */
export function knownText(source, file, sha) {
  const value = texts.get(textKey(source, file, sha));
  return value instanceof Promise ? undefined : value;
}
