import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/example/', import.meta.url), { recursive: true });
await copyFile(new URL('../dist/index.html', import.meta.url), new URL('../dist/example/index.html', import.meta.url));
