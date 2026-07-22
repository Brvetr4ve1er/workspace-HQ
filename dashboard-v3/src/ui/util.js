// Shared formatters — realm ports pull from here instead of re-inlining
// the v2 helpers scattered through dashboard/app.js.

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
