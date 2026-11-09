import { compareMarkdown } from './compare.js';
self.onmessage = ({ data }) => {
  const { requestId, beforeText, afterText } = data;
  try {
    self.postMessage({ requestId, status: 'ready', comparison: compareMarkdown(beforeText, afterText) });
  } catch (error) {
    self.postMessage({ requestId, status: 'error', message: error instanceof Error ? error.message : 'Could not compare these files.' });
  }
};
