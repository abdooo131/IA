// Small helpers shared by the landing page and the dashboard.

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('rebh:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('rebh:' + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem('rebh:' + key); } catch { /* storage unavailable */ }
  },
};

export function money(n, currency = 'EGP', { compact = false, sign = false } = {}) {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  let body;
  if (compact && abs >= 1e6) body = (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  else if (compact && abs >= 1e3) body = Math.round(abs / 1e3) + 'k';
  else body = Math.round(abs).toLocaleString('en-US');
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${s}${currency} ${body}`;
}

export const pct = (n, digits = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '–');
export const times = (n) => (Number.isFinite(n) ? `${n.toFixed(1)}x` : '–');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function initTheme(button) {
  const saved = store.get('theme');
  if (saved) document.documentElement.dataset.theme = saved;
  button?.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
  });
}

export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
