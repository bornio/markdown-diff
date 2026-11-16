import { createVSIX } from '@vscode/vsce';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('vscode/package.json', root), 'utf8'));
await mkdir(new URL('artifacts/', root), { recursive: true });
await createVSIX({
  cwd: fileURLToPath(new URL('vscode/', root)),
  packagePath: fileURLToPath(new URL(`artifacts/${manifest.name}-${manifest.version}.vsix`, root)),
  dependencies: false,
  skipLicense: true,
});
