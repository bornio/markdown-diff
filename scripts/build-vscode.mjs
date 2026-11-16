import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
async function sources(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory() && name !== path.join('vscode', 'dist')) files.push(...await sources(name));
    else if (entry.isFile() && /\.(js|cjs|css|json)$/.test(name)) files.push(name);
  }
  return files;
}
const inputFiles = [...new Set([...await sources('src'), ...await sources('vscode'), 'package.json', 'package-lock.json', 'vscode/README.md', 'scripts/build-vscode.mjs'])].sort();
const digest = async name => createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
const inputs = Object.fromEntries(await Promise.all(inputFiles.map(async name => [name, await digest(name)])));
await build({
  configFile: false,
  root,
  base: './',
  worker: { format: 'iife' },
  build: {
    outDir: 'vscode/dist',
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'vscode/webview.js',
      output: { entryFileNames: 'webview.js', assetFileNames: 'webview.[ext]' },
    },
  },
});
for (const [name, hash] of Object.entries(inputs)) assert.equal(await digest(name), hash, `Build input changed during bundling: ${name}`);
const outputs = Object.fromEntries(await Promise.all(['vscode/extension.cjs', 'vscode/dist/webview.js', 'vscode/dist/webview.css'].map(async name => [name, await digest(name)])));
await mkdir(path.join(root, 'artifacts'), { recursive: true });
await writeFile(path.join(root, 'artifacts/vscode-build.json'), JSON.stringify({ builtAt: new Date().toISOString(), nodeVersion: process.version, inputs, outputs }, null, 2));
