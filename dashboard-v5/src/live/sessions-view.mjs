// Sessions board geometry (Claude › Sessions): the 24-hour lane timeline as plain numbers and strings the template binds.
// PURE: no DOM, no clock — the window is [board.generatedAt − 24 h, board.generatedAt], so the same board and width always give
// the same picture. Memoized on generatedAt + width: renderVals runs every surface on every 2.5 s machine push, and the board
// only changes every 30 s.
//
//   timeline(board, width = 960) → { key, width, height, plotX, plotW, nowX, ticks:[{x,label}], lanes:[lane], moreSessions }
//   lane = { key, kind:'session'|'nightly'|'codex', label, title, y, x1, x2, ax2, marker, state, color, cap:{cx,cy}|null, pulse }
//     - at most MAX_LANES session lanes, newest first, then the folded nightly lane and the folded Codex lane when there are any
//     - x1..x2 is the bar start → last activity, clamped to the window and at least MIN_BAR wide; ax2 ends the lit active part
//       (active time ÷ the session's whole span, at most 1 of the bar)
//     - cap is the end-cap on a session working right now (a pulsing ring in the template, static with Reduce motion on)
//     - marker lanes (nightly, Codex) have no bar: one tick at their last run, or none when it is outside the window
//   toneOf(state) → a CSS token reference only (no raw colours)
export const WINDOW_MS = 24 * 3600e3;
export const MAX_LANES = 12;
export const LANE_H = 22;
export const TOP = 22;
export const MIN_BAR = 4;
export const LABEL_W = 150;
export const RIGHT_PAD = 10;

const TONE = {
  running: 'var(--gold)', 'waiting-tool': 'var(--orange)',
  'stopped-mid-tool': 'var(--red)', 'no-reply': 'var(--red)', limit: 'var(--red)', 'api-error': 'var(--red)',
  finished: 'var(--green)', quiet: 'var(--muted)',
};
export const toneOf = (state) => TONE[state] || 'var(--muted)';

const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const clip = (s, n) => { const a = [...String(s == null ? '' : s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const r1 = (x) => Math.round(x * 10) / 10;
const pad = (n) => String(n).padStart(2, '0');
const agoWord = (ms, now) => { const d = Math.max(0, now - ms); return d < 3600e3 ? Math.max(1, Math.round(d / 60e3)) + ' min' : d < 86400e3 ? Math.round(d / 3600e3) + ' h' : Math.floor(d / 86400e3) + ' d'; };

export const memoKey = (board, width) => (board && board.generatedAt ? board.generatedAt : '') + '|' + width;

let memo = null;
export function timeline(board, width = 960) {
  const w = Math.max(320, Math.min(1600, Math.floor(Number(width)) || 960));
  const key = memoKey(board, w);
  if (memo && memo.key === key) return memo.value;
  const value = build(board, w, key);
  memo = { key, value };
  return value;
}
export function resetMemo() { memo = null; }

function build(board, width, key) {
  const gen = board && msOf(board.generatedAt);
  const sessions = board && Array.isArray(board.sessions) ? board.sessions : [];
  const plotX = width < 520 ? 96 : LABEL_W, plotW = width - plotX - RIGHT_PAD;
  const t0 = (gen === null ? 0 : gen) - WINDOW_MS;
  const X = (ms) => r1(plotX + Math.max(0, Math.min(1, (ms - t0) / WINDOW_MS)) * plotW);
  const lanes = [];
  let y = TOP;
  const shown = [...sessions].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)).slice(0, MAX_LANES);
  for (const s of shown) {
    const start = msOf(s.startedAt), last = msOf(s.lastAt);
    if (start === null || last === null || gen === null) continue;
    const x1 = X(start);
    let x2 = X(last);
    if (x2 - x1 < MIN_BAR) x2 = Math.min(plotX + plotW, x1 + MIN_BAR);
    const span = Math.max(1, last - start);
    const frac = Math.max(0, Math.min(1, (Number(s.activeMin) || 0) * 60e3 / span));
    const running = s.state === 'running';
    lanes.push({
      key: s.id, kind: 'session', label: clip((s.project && s.project.name) || s.title, 22), title: clip(s.title, 80) + ' — ' + s.sentence,
      y, x1, x2, ax2: r1(x1 + (x2 - x1) * frac), marker: false, state: s.state, color: toneOf(s.state),
      cap: running ? { cx: x2, cy: y + LANE_H / 2 } : null, pulse: running,
    });
    y += LANE_H;
  }
  const nightly = board && board.nightly;
  if (nightly && nightly.count > 0) {
    const at = msOf(nightly.lastAt);
    lanes.push({ key: 'nightly', kind: 'nightly', label: 'nightly scan runs (' + nightly.count + ')', title: 'Pipeline runs in the system folder — never resumable',
      y, x1: at === null ? plotX : X(at), x2: at === null ? plotX : X(at), ax2: at === null ? plotX : X(at), marker: at !== null && at >= t0, state: 'quiet', color: 'var(--faint)', cap: null, pulse: false });
    y += LANE_H;
  }
  const codex = board && board.codex;
  if (codex && codex.count > 0) {
    const at = msOf(codex.lastAt);
    const when = at === null || gen === null ? '' : ' · last ' + agoWord(at, gen) + ' ago';
    lanes.push({ key: 'codex', kind: 'codex', label: 'Codex (' + codex.count + ' thread' + (codex.count === 1 ? '' : 's') + when + ')', title: 'Codex threads — titles and times only, no Resume',
      y, x1: at === null ? plotX : X(at), x2: at === null ? plotX : X(at), ax2: at === null ? plotX : X(at), marker: at !== null && at >= t0, state: 'quiet', color: 'var(--faint)', cap: null, pulse: false });
    y += LANE_H;
  }
  // gridlines every 6 h on the local clock (00, 06, 12, 18)
  const ticks = [];
  if (gen !== null) {
    const d = new Date(t0); d.setMinutes(0, 0, 0);
    while (d.getTime() <= gen + 1) {
      if (d.getTime() >= t0 && d.getHours() % 6 === 0) ticks.push({ x: X(d.getTime()), label: pad(d.getHours()) + ':00' });
      d.setHours(d.getHours() + 1);
    }
  }
  return {
    key, width, height: Math.max(TOP + LANE_H, y) + 6, plotX, plotW,
    nowX: gen === null ? plotX + plotW : r1(plotX + plotW),
    ticks, lanes, moreSessions: Math.max(0, sessions.length - shown.length),
  };
}
