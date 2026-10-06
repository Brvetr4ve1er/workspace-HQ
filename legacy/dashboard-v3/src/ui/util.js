// Shared renderer helpers — el/esc/mdLite/COL are VERBATIM ports from
// legacy/dashboard-v2/app.js (parity requirement: every realm port pulls from here
// instead of re-inlining them). fmt/clock/dur are v3 additions.

export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Minimal markdown for LLM-written text (Weekly Saga). Escapes EVERYTHING first,
// then rebuilds only headings/bold/bullets from the escaped text — raw HTML in the
// input can never reach the DOM as markup.
export const mdLite = (md) => esc(md)
  .split('\n')
  .map((l) => {
    if (/^###?\s+/.test(l)) return `<div class="md-h">${l.replace(/^###?\s+/, '')}</div>`;
    if (/^[-*]\s+/.test(l)) return `<div class="md-li">▸ ${l.replace(/^[-*]\s+/, '')}</div>`;
    return l ? `<div class="md-p">${l}</div>` : '';
  })
  .join('')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

export const DAY_MS = 86400000;

export const COL = { red: '#ff4757', orange: '#ffa502', yellow: '#ffe14d', green: '#3aff6e', blue: '#4d9fff', purple: '#b14aff', cyan: '#00f0ff', pink: '#ff6bcb', gold: '#ffd23f', low: '#3aff6e', medium: '#ffa502', high: '#ff4757' };

// thousands-separated integer: 12345 -> "12,345"
export function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  return Math.round(n).toLocaleString('en-US');
}

// wall-clock stamp for logs/tickers: ms epoch -> "14:07:33"
export function clock(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// duration in ms -> "2h 14m" / "14m" / "42s" (mirrors v2 fmtDur semantics)
export function dur(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
