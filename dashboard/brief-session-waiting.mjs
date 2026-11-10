// The Brief's 'session-waiting' rule: a Claude session has waited on a tool for a while. PURE: no IO, no clock (ctx.now is passed in).
//
//   SESSION_WAITING_FN = { 'session-waiting': (ctx) => item fields | null }   same contract as SENSE_FNS in brief-senses.mjs;
//     brief-core.mjs Object.assigns it into RULE_FNS beside SENSE_FNS and lists 'session-waiting' in RULES after 'session-left-dirty'.
//   waitingCards(board, now) → the board's cards this rule may speak about (state 'waiting-tool', waited 15 min to 2 h), longest wait first.
//     brief.js hands the same list to brief-act.js as sources().waitingSessions, so the act path and the rule can never disagree.
//
// ctx.sessionBoard is the sessions board main already builds (sessions-core.mjs buildBoard): { state, error?, sessions:[card] } with
// card = { id, project:{name}, state, lastAt, lastTool?, title, ... }. WHAT IS KNOWN IS SAID, NO MORE: sessions-core.mjs words a
// waiting-tool card as "a permission prompt, or a long tool", and a build or a test run in an auto-mode session looks identical, so
// the copy says "may be". The chat title, the tool name and its arguments never reach the text (they are read nowhere in this file).
// Silent when the board is absent, not 'ok', carries an error, or the card is any other state (an Esc stop is 'no-reply' /
// 'stopped-mid-tool' — sessions-core.classify already separates it; after 2 h a waiting card becomes 'stopped-mid-tool' there too).
import { KEYS } from './brief-act-core.mjs';
import { WAITING_MAX_MS } from './sessions-core.mjs';

export const WAIT_MIN_MS = 15 * 60e3;
export { WAITING_MAX_MS };

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
// owner-typed names reach the copy: one line, at most 60 code points (the template binds text only — this is about length)
const name = (s, fallback) => { const t = [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, 60).join('').trim(); return t || fallback; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const andMore = (n, what) => (n > 0 ? ' and ' + plural(n, 'more ' + what, 'more ' + what + 's') : '');
function span(ms) {
  const m = Math.max(1, Math.floor(ms / 60e3));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + ' h' + (r ? ' ' + r + ' min' : '');
}

/** The board's waiting cards that have waited 15 min to 2 h, the longest wait first (ties by id, so the pick is stable). */
export function waitingCards(board, now) {
  const t = num(now);
  if (!isObj(board) || board.state !== 'ok' || board.error) return [];
  return arr(board.sessions)
    .filter((c) => isObj(c) && c.state === 'waiting-tool' && typeof c.id === 'string' && c.id)
    .map((c) => ({ c, at: msOf(c.lastAt) }))
    .filter((x) => x.at !== null && t - x.at >= WAIT_MIN_MS && t - x.at <= WAITING_MAX_MS)
    .sort((a, b) => (a.at - b.at) || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0))
    .map((x) => x.c);
}

export const SESSION_WAITING_FN = {
  'session-waiting': (ctx) => {
    const now = num(ctx && ctx.now);
    const hits = waitingCards(ctx && ctx.sessionBoard, now);
    if (!hits.length) return null;
    const top = hits[0];
    const waited = span(now - msOf(top.lastAt));
    const proj = isObj(top.project) ? name(top.project.name, '') : '';
    return {
      key: KEYS.sessionWaiting(top.id, top.lastAt),
      severity: 'med',
      text: (proj ? proj + ': a Claude session' : 'A Claude session') + ' has waited on a tool for ' + waited + andMore(hits.length - 1, 'session'),
      why: 'It may be a long-running tool or a permission prompt. Check its own terminal window.',
      source: 'claude-code',
      age: 'sessions board',
      action: { kind: 'go', tab: 'claude', sub: 'sessions' },
      others: hits.length - 1,
    };
  },
};
