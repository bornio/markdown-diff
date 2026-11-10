import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { linterOptions: { noInlineConfig: true } },
  { files: ['src/app.js', 'src/tables.js', 'src/theme.js', 'src/view.js'], languageOptions: { globals: globals.browser } },
  { files: ['src/compare.worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['test/**', 'scripts/**', '*config.*'], languageOptions: { globals: globals.node } },
];
