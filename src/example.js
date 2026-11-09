import before from './examples/before.md?raw';
import after from './examples/after.md?raw';

const withBase = (text) => text.replaceAll('](/examples/', `](${import.meta.env.BASE_URL}examples/`);

export const example = {
  before: { name: 'handbook.before.md', text: withBase(before) },
  after: { name: 'handbook.after.md', text: withBase(after) },
};
