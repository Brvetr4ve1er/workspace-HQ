// Sessions board render values (Claude › Sessions) and the Home strip. Keys are sbd-prefixed — one shared namespace with every
// other surface. The board arrives finished from main (dashboard/sessions-board.js → hq:sessions-board:*, states and sentences
// from sessions-core.mjs); this module only shapes it. Geometry lives in live/sessions-view.mjs, memoized on generatedAt + width.
//
// renderVals runs every surface on every 2.5 s machine push, so while the owner is on another tab each part returns a frozen
// constant: no board is read, no geometry is built. Honest states: no bridge · loading · error · hub down / starting (the last
// board, read-only, with its time) · no sessions in 24 h · ready.
import { timeline, toneOf } from '../live/sessions-view.mjs';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return ''; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const clip = (s, n) => { const a = [...String(s == null ? '' : s)]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const ageWord = (iso, now) => {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'age unknown';
  const d = Math.max(0, now - t);
  return d < 60e3 ? 'just now' : d < 3600e3 ? Math.round(d / 60e3) + ' min ago' : d < 86400e3 ? Math.round(d / 3600e3) + ' h ago' : Math.floor(d / 86400e3) + ' d ago';
};
const minutesWord = (m) => (m >= 60 ? Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min' : m + ' min');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATE_LABEL = { running: 'running', 'waiting-tool': 'waiting', 'stopped-mid-tool': 'stopped', 'no-reply': 'stopped', limit: 'limit', 'api-error': 'stopped', finished: 'finished', quiet: 'quiet' };
const reduced = (S) => {
  if (S && S.reduceMotion) return true;
  try { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
};

const BOARD_OFF = Object.freeze({
  sbdOffline: false, sbdOfflineText: '', sbdLoading: false, sbdError: false, sbdErrorText: '', sbdNote: false, sbdNoteText: '',
  sbdEmpty: false, sbdEmptyText: '', sbdReady: false, sbdSummary: '', sbdLimitLine: '', sbdHasLimitLine: false,
  sbdSvgViewBox: '0 0 960 40', sbdSvgHeight: 40, sbdSvgWidth: 960, sbdNowX: 0, sbdPlotX: 0, sbdPlotRight: 0, sbdAxisY: 14,
  sbdTicks: [], sbdLanes: [], sbdHasMore: false, sbdMoreText: '', sbdCards: [], sbdAnimate: false,
});
const STRIP_OFF = Object.freeze({ sbdStripShow: false, sbdStripCards: [], sbdStripNote: '', sbdStripHasNote: false });

function boardState(self, LIVE) {
  const B = LIVE.board || {}, board = B.board || null;
  const can = !!(self.hq && self.hq.sessionsBoard);
  return { B, board, can };
}

export function sessionsBoardVals(ctx) {
  const { S, LIVE, live } = ctx;
  const onBoard = S.tab === 'claude' && !S.route && (S.sub || {}).claude === 'sessions';
  const onHome = S.tab === 'home' && !S.route;
  return Object.assign({}, onBoard ? boardVals.call(this, ctx) : BOARD_OFF, onHome && live ? stripVals.call(this, ctx) : STRIP_OFF);
}

function boardVals({ S, LIVE }) {
  const { B, board, can } = boardState(this, LIVE);
  const out = Object.assign({}, BOARD_OFF);
  if (!can) { out.sbdOffline = true; out.sbdOfflineText = 'The sessions board needs the desktop app'; return out; }
  if (!board) {
    if (B.error) { out.sbdError = true; out.sbdErrorText = B.error; } else out.sbdLoading = true;
    return out;
  }
  const now = Date.parse(board.generatedAt) || 0;
  const sessions = Array.isArray(board.sessions) ? board.sessions : [];
  const down = board.state === 'hub-down' || board.state === 'starting';
  const readOnly = down;
  if (B.error && !down) { out.sbdError = true; out.sbdErrorText = B.error; }   // a failed refresh keeps the cards below it
  if (board.state === 'hub-down') { out.sbdNote = true; out.sbdNoteText = 'Claude Hub isn’t running — ' + (sessions.length ? 'showing the board from ' + hhmm(board.generatedAt) : 'nothing yet'); }
  else if (board.state === 'starting') { out.sbdNote = true; out.sbdNoteText = 'Claude Hub is starting — ' + (sessions.length ? 'showing the board from ' + hhmm(board.generatedAt) : 'nothing yet'); }
  const folded = !!((board.nightly && board.nightly.count > 0) || board.codex);
  out.sbdEmpty = sessions.length === 0 && !down;
  out.sbdEmptyText = 'No Claude Code session in the last 24 hours';
  out.sbdReady = sessions.length > 0 || folded;   // the timeline is drawn when there is anything to put on it
  const c = board.counts || {};
  out.sbdSummary = plural(sessions.length, 'session') + ' in the last 24 h'
    + (c.running ? ' · ' + c.running + ' running' : '') + (c.waiting ? ' · ' + c.waiting + ' waiting' : '') + (c.stopped ? ' · ' + c.stopped + ' stopped' : '') + (c.limit ? ' · ' + c.limit + ' at a limit' : '');
  const ls = board.limitStops || { days: 7, count: 0, last: null };
  const lastWord = ls.last ? ({ weekly: 'weekly limit', session: 'session limit', monthly: 'monthly spend limit', limit: 'limit' }[ls.last.kind] || 'limit') : '';
  const lastDay = ls.last && Number.isFinite(Date.parse(ls.last.at)) ? MONTHS[new Date(Date.parse(ls.last.at)).getMonth()] + ' ' + new Date(Date.parse(ls.last.at)).getDate() : '';
  out.sbdLimitLine = 'limit stops in the last ' + (ls.days || 7) + ' days: ' + num(ls.count) + (ls.count && ls.last ? ' (last: ' + lastWord + (lastDay ? ', ' + lastDay : '') + ')' : '');
  out.sbdHasLimitLine = true;

  const T = timeline(board, 960);
  const reduce = reduced(S);
  out.sbdAnimate = !reduce;
  out.sbdSvgViewBox = '0 0 ' + T.width + ' ' + T.height;
  out.sbdSvgHeight = T.height; out.sbdSvgWidth = T.width;
  out.sbdNowX = T.nowX; out.sbdPlotX = T.plotX; out.sbdPlotRight = T.plotX + T.plotW; out.sbdAxisY = 14;
  out.sbdTicks = T.ticks.map((t, i) => ({ key: 't' + i, x: t.x, tx: t.x + 3, label: t.label }));
  out.sbdLanes = T.lanes.map((l) => {
    const cy = l.y + 11;
    return { key: l.key, kind: l.kind, label: l.label, title: l.title, color: l.color, state: l.state,
      rowY: l.y, textY: l.y + 15, barY: l.y + 5, barW: Math.max(0, l.x2 - l.x1), activeW: Math.max(0, l.ax2 - l.x1), x1: l.x1, x2: l.x2,
      isBar: l.kind === 'session', isMarker: l.marker, capShow: !!l.cap, cx: l.cap ? l.cap.cx : 0, cy,
      pulse: !!l.pulse && !reduce, labelColor: l.kind === 'session' ? 'var(--muted)' : 'var(--faint)' };
  });
  out.sbdHasMore = T.moreSessions > 0;
  out.sbdMoreText = '+' + T.moreSessions + ' more session' + (T.moreSessions === 1 ? '' : 's') + ' not drawn · all of them are listed below';

  const busy = new Set(S.sbdBusy || []);
  out.sbdCards = sessions.map((s) => {
    const projNote = s.project.matched === 'auto' ? 'auto-matched' : s.project.matched === 'folder' ? 'not a scanned project' : '';
    const isBusy = busy.has(s.id);
    const can1 = !!s.canResume && !readOnly && !isBusy;
    const why = readOnly ? 'Claude Hub isn’t running — the cards are read-only' : s.why || '';
    const tone = toneOf(s.state);
    return {
      key: s.id, title: clip(s.title, 90), project: s.project.name, projectNote: projNote, hasProjectNote: !!projNote,
      branch: s.branch || '', hasBranch: !!s.branch,
      started: 'started ' + ageWord(s.startedAt, now), lastActive: 'last active ' + ageWord(s.lastAt, now),
      active: minutesWord(s.activeMin) + ' active', activeTitle: 'active time, from gaps under 5 min', hasActive: s.activeMin > 0,
      messages: plural(s.messages, 'message'),
      tokens: compact(num(s.tokens.in)) + ' in · ' + compact(num(s.tokens.out)) + ' out · ' + compact(num(s.tokens.cacheRead)) + ' cache read', tokensLabel: 'whole session',
      stateLabel: STATE_LABEL[s.state] || s.state, stateColor: tone, sentence: s.sentence,
      stateStyle: { color: tone, border: '1px solid ' + tone, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' },
      longRun: !!s.longRun,
      canResume: can1, resumeNote: can1 ? 'opens a new terminal that continues this chat — close the old window first if it’s still open' : why, hasResumeNote: !can1 && !!why,
      resume: () => this.sbdResume(s.id), resumeSay: () => this.sbdResume(s.id, 'continue'),
      copy: () => this.sbdCopyCommand(s.id, s.cwdLabel),
      canOpen: !!s.canOpen && !readOnly, open: () => this.sbdOpenFolder(s.id),
      busy: isBusy,
    };
  });
  return out;
}

function stripVals({ LIVE }) {
  const { board, can } = boardState(this, LIVE);
  if (!can || !board || !Array.isArray(board.sessions)) return STRIP_OFF;
  const now = Date.parse(board.generatedAt) || 0;
  const RANK = { running: 0, 'waiting-tool': 1, 'stopped-mid-tool': 2, limit: 2, 'api-error': 2, 'no-reply': 2 };
  const hot = board.sessions
    .filter((s) => s.state in RANK && now - Date.parse(s.lastAt) <= 2 * 3600e3)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .slice(0, 3);
  if (!hot.length) return STRIP_OFF;
  if (typeof this.useMark === 'function') this.useMark('sessions-strip');   // usage counter: once per arrival on Home, only while the strip can be seen (logic/use-log.js)
  const stale = board.state !== 'ok';
  return {
    sbdStripShow: true,
    sbdStripNote: stale ? 'from the ' + hhmm(board.generatedAt) + ' board — Claude Hub isn’t answering' : '',
    sbdStripHasNote: stale,
    sbdStripCards: hot.map((s) => {
      const tone = toneOf(s.state);
      return { key: s.id, title: clip(s.title, 70), project: s.project.name, sentence: s.sentence, ago: ageWord(s.lastAt, now),
        stateLabel: STATE_LABEL[s.state] || s.state,
        stateStyle: { color: tone, border: '1px solid ' + tone, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--term)', whiteSpace: 'nowrap', lineHeight: '18px' },
        go: () => this.go('claude', 'sessions') };
    }),
  };
}
