import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: 'vscode-webview.spec.mjs',
  outputDir: 'test-results/vscode-webview',
  use: { channel: 'chrome', viewport: { width: 1280, height: 800 } },
});
