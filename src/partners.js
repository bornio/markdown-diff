// Pairs the elements with a tag across the two cells of a row. Elements compareMarkdown changed share
// data-pair (alignment gaps are skipped); identical elements carry none, so those pair in order, outside
// added or removed content, only when both sides have the same number. Errs toward no partner.
export function partners(before, after, tag) {
  const pairs = [];
  const right = new Map([...after.querySelectorAll(`${tag}[data-pair]`)].map((node) => [node.dataset.pair, node]));
  for (const node of before.querySelectorAll(`${tag}[data-pair]`)) {
    const partner = right.get(node.dataset.pair);
    if (partner && !node.hasAttribute('data-gap') && !partner.hasAttribute('data-gap')) pairs.push([node, partner]);
  }
  const unchanged = (cell) => [...cell.querySelectorAll(`${tag}:not([data-pair])`)].filter((node) => {
    const owner = node.parentElement.closest('[data-change],[data-gap]');
    return !owner || !cell.contains(owner);
  });
  const left = unchanged(before);
  const others = unchanged(after);
  if (left.length === others.length) left.forEach((node, i) => pairs.push([node, others[i]]));
  return pairs;
}
