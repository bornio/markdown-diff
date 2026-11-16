import { createVSIX } from '@vscode/vsce';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('vscode/package.json', root), 'utf8'));
const built = JSON.parse(await readFile(new URL('artifacts/vscode-build.json', root), 'utf8'));
async function checkBuild() {
  for (const [name, expected] of Object.entries({ ...built.inputs, ...built.outputs })) {
    const actual = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
    assert.equal(actual, expected, `Rebuild the extension after changing ${name}.`);
  }
}
await checkBuild();
await mkdir(new URL('artifacts/', root), { recursive: true });
await createVSIX({
  cwd: fileURLToPath(new URL('vscode/', root)),
  packagePath: fileURLToPath(new URL(`artifacts/${manifest.name}-${manifest.version}.vsix`, root)),
  dependencies: false,
  skipLicense: true,
});
await checkBuild();
