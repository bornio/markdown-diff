import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';

const totals = { main: 0, worker: 0, css: 0 };
for (const file of await readdir(new URL('../dist/assets/', import.meta.url), { recursive: true })) {
  const group = file.endsWith('.css') ? 'css' : file.endsWith('.js') ? file.startsWith('compare.worker-') ? 'worker' : 'main' : null;
  if (group) totals[group] += (await stat(new URL(`../dist/assets/${file}`, import.meta.url))).size;
}
for (const [group, limit] of Object.entries({ main: 26000, worker: 320000, css: 22000 })) {
  assert.ok(totals[group] > 0, `Missing ${group} production assets`);
  assert.ok(totals[group] <= limit, `${group}: ${totals[group]} bytes exceeds ${limit}`);
}
console.log('Production bytes', totals);
