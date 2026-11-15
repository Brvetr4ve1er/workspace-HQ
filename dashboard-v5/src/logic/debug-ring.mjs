// The timing ring behind the debug overlay (batch 7, cheat code 'timing'). PURE: no clock of its own (the caller passes the time), no
// timers, no DOM. It exists only while the overlay is on (logic/cheats-host.js creates it then and drops it when the overlay closes).
//   createRing(size = 30) -> { push(ms, atMs?) -> boolean, stats(nowMs?) -> { count, last, p50, p95, perMin }, clear(), size }
// A sample that is not a finite number >= 0 is dropped (push says false); the ring keeps the last `size` durations (older ones fall off),
// and p50 / p95 are nearest-rank over exactly those. perMin counts the renders pushed in the last 60 s of the caller's clock (bounded:
// at most RATE_CAP stamps are kept). An empty ring says null, never 0, so the overlay can show a dash instead of a fake number.

export const RING_SIZE = 30;
export const RATE_WINDOW_MS = 60 * 1000;
export const RATE_CAP = 600;

/** Nearest-rank percentile of an ASCENDING list (p in 0..100). null for an empty list. */
export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || !sorted.length) return null;
  const rank = Math.ceil((Math.max(0, Math.min(100, p)) / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

const validMs = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function createRing(size = RING_SIZE) {
  const cap = Number.isInteger(size) && size > 0 ? size : RING_SIZE;
  const buf = [];      // the last `cap` durations, oldest first
  let stamps = [];     // when each render was pushed (ms on the caller's clock), pruned to the rate window
  let last = null;
  function push(ms, atMs) {
    if (!validMs(ms)) return false;
    buf.push(ms);
    if (buf.length > cap) buf.shift();
    last = ms;
    if (validMs(atMs)) {
      stamps.push(atMs);
      const floor = atMs - RATE_WINDOW_MS;
      if (stamps.length > RATE_CAP || stamps[0] < floor) stamps = stamps.filter((s) => s >= floor).slice(-RATE_CAP);
    }
    return true;
  }
  function stats(nowMs) {
    const sorted = buf.slice().sort((a, b) => a - b);
    const floor = validMs(nowMs) ? nowMs - RATE_WINDOW_MS : null;
    const perMin = floor == null ? stamps.length : stamps.filter((s) => s >= floor).length;
    return { count: buf.length, last, p50: percentile(sorted, 50), p95: percentile(sorted, 95), perMin };
  }
  function clear() { buf.length = 0; stamps = []; last = null; }
  return { push, stats, clear, size: cap };
}

/** Milliseconds as the overlay says them: '–' for none, one decimal under 10, whole above. */
export function fmtMs(n) {
  if (!validMs(n)) return '–';
  return (n < 10 ? n.toFixed(1) : String(Math.round(n))) + ' ms';
}

/** How long ago, as words ('3 s ago', '2 min ago'); null or a future time says 'none yet'. */
export function fmtAge(atMs, nowMs) {
  if (!validMs(atMs) || !validMs(nowMs) || nowMs < atMs) return 'none yet';
  const s = Math.round((nowMs - atMs) / 1000);
  if (s < 90) return s + ' s ago';
  return Math.round(s / 60) + ' min ago';
}
