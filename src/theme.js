const root = document.documentElement;
const toggle = document.querySelector('#theme-toggle');

function apply(theme) {
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'light' ? '#ffffff' : '#151618';
  const current = theme === 'light' ? 'Light' : 'Dark';
  const next = theme === 'light' ? 'dark' : 'light';
  toggle.setAttribute('aria-label', `${current} theme. Switch to ${next} theme`);
  toggle.title = `Switch to ${next} theme`;
}

apply(root.dataset.theme === 'light' ? 'light' : 'dark');
toggle.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  apply(next);
  try { localStorage.setItem('markdown-diff-theme', next); } catch { return; }
});
