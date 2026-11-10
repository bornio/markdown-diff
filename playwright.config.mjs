import { defineConfig } from '@playwright/test';
import vite from './vite.config.js';

const baseURL = `http://127.0.0.1:4173${vite.base}`;

export default defineConfig({
  testDir: './test',
  testMatch: 'browser.spec.mjs',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 20000,
  globalTimeout: 120000,
  use: { baseURL, channel: 'chrome', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 10000,
  },
});
