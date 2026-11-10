// Decides which element of a compared pair carries the formatting cue, and its kind. The only writer of
// data-format-change and data-format-target (bare = ordinary, "checkbox", "replaced"). Worker side, no DOM.
const tag = (node) => node?.tagName || node?.type;
const elements = (node) => (node.children || []).filter((child) => child.type === 'element');
const sameProperties = (x, y) => JSON.stringify(x.properties) === JSON.stringify(y.properties);
const shape = (node) => node.type === 'text' ? '' : [tag(node), node.properties, (node.children || []).map(shape)];
const tagSequence = (nodes) => nodes.map(tag).join(' ');

function specialKind(x, y) {
  if (tag(x) === 'img' && x.properties.src !== y.properties.src) return 'replaced';
  if (tag(x) === 'input' && x.properties.type === 'checkbox' && y.properties.type === 'checkbox' &&
      Boolean(x.properties.checked) !== Boolean(y.properties.checked)) return 'checkbox';
}

// A special pair is never the ordinary target, even where the position guard forbids marking it,
// so a shifted image or a restructured task item stays uncued instead of getting a neutral outline.
function planTargets(a, b) {
  const special = new Map();
  let ordinary;
  let sawSpecial = false;
  const visit = (x, y, aligned) => {
    const kind = specialKind(x, y);
    if (kind) {
      sawSpecial = true;
      if (aligned) { special.set(x, kind); special.set(y, kind); }
    } else if (!ordinary && !sameProperties(x, y)) ordinary = [x, y];
    const xs = elements(x);
    const ys = elements(y);
    const childAligned = aligned && tagSequence(xs) === tagSequence(ys);
    if (ordinary && !childAligned) return;
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const p = xs[i];
      const q = ys[i];
      if (p && q && tag(p) === tag(q)) visit(p, q, childAligned);
      else if (!ordinary) ordinary = [p || x, q || y];
    }
  };
  visit(a, b, true);
  if (!ordinary && !sawSpecial) ordinary = [a, b];
  return { special, ordinary };
}

const writeTarget = (node, kind) => { node.properties['data-format-target'] = kind === 'ordinary' ? true : kind; };

export function markInlineFormat(a, b, edits) {
  if (JSON.stringify(shape(a)) === JSON.stringify(shape(b))) return;
  a.properties['data-format-change'] = true;
  b.properties['data-format-change'] = true;
  if (!edits) return;
  const { special, ordinary } = planTargets(a, b);
  const marks = new Map(special);
  if (ordinary && !edits.some((change) => change.added || change.removed)) {
    for (const node of ordinary) if (!marks.has(node)) marks.set(node, 'ordinary');
  }
  for (const [node, kind] of marks) writeTarget(node, kind);
}

export function markOwnFormat(a, b) {
  if (sameProperties(a, b)) return;
  a.properties['data-format-change'] = true;
  b.properties['data-format-change'] = true;
  const kind = specialKind(a, b) || 'ordinary';
  writeTarget(a, kind);
  writeTarget(b, kind);
}
