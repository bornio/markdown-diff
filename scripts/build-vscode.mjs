import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
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
