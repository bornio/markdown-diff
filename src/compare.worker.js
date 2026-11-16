import { compareMarkdown } from './compare.js';

self.onmessage = ({ data }) => {
  const { requestId, beforeText, afterText, previewLimits } = data;
  try {
    if (previewLimits && (!Number.isSafeInteger(previewLimits.characters) || previewLimits.characters < 1 || !Number.isSafeInteger(previewLimits.elements) || previewLimits.elements < 1)) {
      throw new Error('Invalid preview limits.');
    }
    const comparison = compareMarkdown(beforeText, afterText);
    if (previewLimits) {
      const check = (row, source = false) => {
        const sides = [row.before, row.after].map(value => source ? value?.html || '' : value || '');
        if (sides.reduce((total, html) => total + html.length, 0) > previewLimits.characters ||
          sides.reduce((total, html) => total + (html.match(/<[a-z][^>]*>/gi)?.length || 0), 0) > previewLimits.elements) {
          throw new Error('A section is too large for the rendered preview. Open the native source comparison, or split long paragraphs, tables, or lines into smaller sections.');
        }
      };
      for (const row of comparison.rows) {
        if (row.pages) for (const page of row.pages) check(page);
        else check(row);
      }
      for (const row of comparison.source.rows) check(row, true);
    }
    self.postMessage({ requestId, status: 'ready', comparison });
  } catch (error) {
    self.postMessage({ requestId, status: 'error', message: error instanceof Error ? error.message : 'Could not compare these files.' });
  }
};
