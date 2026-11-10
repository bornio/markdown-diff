import assert from 'node:assert/strict';
import { isMainThread, Worker, parentPort } from 'node:worker_threads';

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  let watchdog;
  try {
    const counts = await new Promise((resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('Comparison workloads exceeded 10 seconds')), 10000);
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`Workload worker exited before reporting, code ${code}`)));
    });
    console.log('Verified comparison work', counts);
  } finally {
    clearTimeout(watchdog);
    await worker.terminate();
  }
} else {
  const { compareMarkdown } = await import('../src/compare.js');
  const { fromHtml } = await import('hast-util-from-html');
  const nodes = (node, tag) => [...(node.tagName === tag ? [node] : []), ...(node.children || []).flatMap((child) => nodes(child, tag))];
  const text = (node) => node.type === 'text' ? node.value : (node.children || []).map(text).join('');
  const count = (node) => 1 + (node.children || []).reduce((total, child) => total + count(child), 0);
  const table = '| Key | State |\n|---|---|\n' + Array.from({ length: 2000 }, (_, i) => `| Row ${i} | State ${i} |`).join('\n');
  const code = Array.from({ length: 5000 }, (_, i) => `line ${i} keep old value 😀`).join('\n');
  const workloads = [
    { name: 'table', before: table, after: table.replace('State 999', 'Changed 999'), limit: 1000000 },
    { name: 'code', before: `\`\`\`txt\n${code}\n\`\`\``, after: `\`\`\`txt\n${code.replace('line 2499 keep old', 'line 2499 keep new')}\n\`\`\``, limit: 2000000 },
  ];
  const counts = [];
  for (const work of workloads) {
    const result = compareMarkdown(work.before, work.after);
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.ok(row.pages.length > 1);
    assert.equal(Object.hasOwn(row, 'before'), false);
    assert.equal(Object.hasOwn(row, 'after'), false);
    let units = 0;
    for (const side of ['before', 'after']) {
      assert.equal(result.source.rows.map((source) => source[side]?.text || '').join(''), work[side]);
      const trees = row.pages.map((page) => fromHtml(page[side], { fragment: true }));
      if (work.name === 'table') {
        const bodies = trees.map((tree) => nodes(tree, 'tbody')[0]);
        assert.ok(bodies.every((body) => body.children.length <= 100));
        const cells = bodies.flatMap((body) => nodes(body, 'td')).map(text);
        const expected = Array.from({ length: 2000 }, (_, i) => [`Row ${i}`, `${side === 'after' && i === 999 ? 'Changed' : 'State'} ${i}`]).flat();
        assert.deepEqual(cells, expected);
        units += bodies.reduce((sum, body) => sum + body.children.length, 0);
      } else {
        const blocks = trees.map((tree) => nodes(tree, 'pre')[0]);
        assert.ok(blocks.every((block) => count(block) <= 256 && (text(block).match(/\n/g) || []).length <= 100 && text(block).length <= 16000));
        assert.equal(blocks.map(text).join(''), work[side].slice(7, -3));
        units += blocks.reduce((sum, block) => sum + (text(block).match(/\n/g) || []).length, 0);
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(result));
    assert.ok(bytes > 0 && bytes <= work.limit, `${work.name} payload ${bytes} exceeds ${work.limit}`);
    assert.ok(result.stats.changed > 0, `${work.name} localized edit was not compared`);
    counts.push({ workload: work.name, unitsAcrossBothSides: units, pages: row.pages.length, sourceRows: result.source.rows.length, bytes });
  }
  parentPort.postMessage(counts);
}
