// Sessions board engine (Claude › Sessions, Home strip, MCP hq_sessions). PURE: no IO, no clock, no LLM. The same rows,
// turns and `now` always give the same board, so the sentences are explainable and work with every model down.
//
// Inputs are what the Claude Hub already serves (dashboard/claude-hub/store.mjs):
//   conv    = a listConversations row   { id, native_id, project_id, title, started_at, last_at, message_count, cwd, git_branch,
//                                          tokens_in, tokens_out, tokens_cache_read, active_ms, project_name, hq_project_id }
//   turns   = getConversation(...).messages, oldest first, the last few  { role, at, tool_name, is_sidechain, text }
//   project = a listProjects row (id 'code:<folder>')  { link_state, hq_project_id, name }
// Sentences carry tool names and ages only, never prompt text. Text is read only to spot the usage-limit notices.
//
//   classify(conv, turns, now)                → { state, sentence, lastTool?, limitKind?, resetsAt?, longRun, turnsThisHour }
//   parseLimitNotice(text, atMs)              → { kind:'session'|'limit'|'weekly'|'monthly', resetsAt:iso|null, resetLabel } | null
//   buildBoard({rows, details, projects, now, windowMs, weekMs, codex, state, error}) → the board (see IPC-CONTRACT sessions board)
//   boardSignature(board)                     → string, ignores generatedAt (push only when it changes)
//   homeStrip(board, now)                     → ≤ 3 cards: running, waiting or stopped in the last 2 h
//   limitLine(limitStops)                     → 'limit stops in the last 7 days: N (last: weekly limit, Oct 30)'
// Local-time formatting (reset labels, day names) uses the machine's zone, which is the zone the notices were written in.

export const RUNNING_MS = 120e3;        // a turn this recent = working now
export const WAITING_MAX_MS = 2 * 3600e3; // a tool call without a result stays "waiting" for 2 h, then it is "stopped mid-tool"
export const NO_REPLY_MS = 3 * 60e3;    // the owner's prompt unanswered for this long
export const QUIET_MS = 6 * 3600e3;     // finished + idle this long = quiet
export const LONG_RUN_MIN = 120;        // active minutes that raise the long-run flag
export const RESUME_QUIET_MS = 30 * 60e3;
export const HOME_RECENT_MS = 2 * 3600e3;
export const MAX_LANES = 12;
export const DAY_MS = 24 * 3600e3;
export const WEEK_MS = 7 * DAY_MS;
export const TURN_LIMIT = 8;            // getConversation({ id, limit: TURN_LIMIT })
export const NIGHTLY_CWD = 'c:/windows/system32';
export const STATES = ['running', 'waiting-tool', 'stopped-mid-tool', 'no-reply', 'limit', 'api-error', 'finished', 'quiet'];
export const LIMIT_KINDS = ['session', 'limit', 'weekly', 'monthly'];

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const str = (x) => (typeof x === 'string' ? x : '');
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : typeof t === 'number' ? t : NaN; return Number.isFinite(n) ? n : null; };
const iso = (ms) => new Date(ms).toISOString();
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "14 min ago", "2 h ago", "3 d ago" — the same ladder the Brief uses. */
export function ago(thenMs, now) {
  if (!Number.isFinite(thenMs)) return 'age unknown';
  const d = Math.max(0, now - thenMs);
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return Math.max(1, Math.round(d / 60e3)) + ' min ago';
  if (d < DAY_MS) return Math.round(d / 3600e3) + ' h ago';
  return Math.floor(d / DAY_MS) + ' d ago';
}
const clock = (h24, mi) => { const h = h24 % 12 || 12; return h + (mi ? ':' + String(mi).padStart(2, '0') : '') + ' ' + (h24 < 12 ? 'am' : 'pm'); };
const dayLabel = (ms) => { const d = new Date(ms); return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate(); };

// ---------------------------------------------------------------- usage-limit notices
// Claude Code writes the stop as an assistant text turn. Four shapes (plus the older wordings):
//   session limit   "You've hit your session limit · resets 4:30pm (Europe/Paris)"   time-only reset, optional zone suffix
//   plain limit     "You've hit your limit · resets 9am"                              time-only reset
//   weekly limit    "You've hit your weekly limit · resets Aug 3, 5pm"                date-form reset
//   monthly spend   "You've hit your monthly spend limit"                             no reset time
const HIT = /^\s*(?:you(?:['’]ve| have) hit your|your)\s+((?:session|weekly|monthly spend|opus weekly|sonnet weekly|5-hour|five-hour)\s+)?limit\b/i;
const OLD = /^\s*(?:(5-hour|five-hour|weekly|session|opus weekly|sonnet weekly)\s+limit reached|claude (?:ai )?usage limit reached)\b/i;
const RESET_TAIL = /\bresets?(?:\s+at)?\s+(.+?)\s*$/i;
const TIME_ONLY = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i;
const DATE_FORM = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i;

function hour24(h, ap) { if (h < 1 || h > 12) return null; return (h % 12) + (/^p/i.test(ap) ? 12 : 0); }

function kindOf(word) {
  const w = String(word || '').toLowerCase();
  if (w.includes('weekly')) return 'weekly';
  if (w.includes('monthly')) return 'monthly';
  if (w.includes('session') || w.includes('hour')) return 'session';
  return 'limit';
}

export function parseLimitNotice(text, atMs) {
  const t = str(text).trim();
  if (!t || t.length > 400) return null;
  let m = HIT.exec(t), kind;
  if (m) kind = kindOf(m[1]);
  else if ((m = OLD.exec(t))) kind = kindOf(m[1]);
  else return null;
  if (kind === 'monthly') return { kind, resetsAt: null, resetLabel: '' };
  const at = Number.isFinite(atMs) ? atMs : Date.now();
  const tail = RESET_TAIL.exec(t.replace(/\s*\([^)]*\)\s*$/, ''));   // drop a "(Europe/Paris)" zone suffix
  let resetsAt = null, resetLabel = '';
  if (tail) {
    const when = tail[1].replace(/[.\s]+$/, '');
    let tm, dm;
    if ((tm = TIME_ONLY.exec(when))) {
      const h = hour24(Number(tm[1]), tm[3]), mi = tm[2] ? Number(tm[2]) : 0;
      if (h !== null && mi < 60) {
        const d = new Date(at); d.setHours(h, mi, 0, 0);
        if (d.getTime() <= at) d.setDate(d.getDate() + 1);   // a time of day names the NEXT such time
        resetsAt = iso(d.getTime()); resetLabel = clock(h, mi);
      }
    } else if ((dm = DATE_FORM.exec(when))) {
      const mo = MONTHS.indexOf(dm[1].slice(0, 3).toLowerCase()), day = Number(dm[2]);
      const h = hour24(Number(dm[3]), dm[5]), mi = dm[4] ? Number(dm[4]) : 0;
      if (mo >= 0 && day >= 1 && day <= 31 && h !== null && mi < 60) {
        const y = new Date(at).getFullYear();
        let d = new Date(y, mo, day, h, mi, 0, 0);
        if (d.getTime() < at - DAY_MS) d = new Date(y + 1, mo, day, h, mi, 0, 0);   // "Jan 2" written in December
        resetsAt = iso(d.getTime()); resetLabel = DAY_NAMES[d.getDay()] + ' ' + clock(h, mi);
      }
    }
  }
  return { kind, resetsAt, resetLabel };
}

const KIND_WORD = { session: 'session limit', limit: 'usage limit', weekly: 'weekly limit', monthly: 'monthly spend limit' };
export const limitKindWord = (kind) => KIND_WORD[kind] || 'limit';

// ---------------------------------------------------------------- classification
const realTurns = (turns) => (Array.isArray(turns) ? turns.filter((t) => t && typeof t === 'object') : []);
// subagent turns are not the session's own conversation; system turns (compaction, command echoes) are not either
const mainline = (turns) => turns.filter((t) => !t.is_sidechain && t.role !== 'system');

/**
 * state + sentence for one session. `turns` oldest first. Deterministic for a fixed `now` (ms).
 * running counts ANY turn in the window (a subagent working is the session working); everything else reads the main line.
 */
export function classify(conv, turns, now) {
  const all = realTurns(turns);
  const main = mainline(all);
  const lastAtMs = msOf(conv && conv.last_at);
  const lastTurnMs = all.reduce((m, t) => Math.max(m, msOf(t.at) ?? -Infinity), -Infinity);
  const lastMs = Math.max(lastAtMs ?? -Infinity, lastTurnMs);
  const longRun = num(conv && conv.active_ms) >= LONG_RUN_MIN * 60e3;
  const hourAgo = now - 3600e3;
  const turnsThisHour = all.filter((t) => { const x = msOf(t.at); return x !== null && x >= hourAgo && x <= now; }).length;
  const out = (state, sentence, extra) => ({ state, sentence, longRun, turnsThisHour, ...extra });
  const last = main.length ? main[main.length - 1] : null;
  const lastText = last && last.role === 'assistant' && !last.tool_name ? str(last.text) : '';
  const lim = lastText ? parseLimitNotice(lastText, msOf(last.at)) : null;

  // the notice is the last thing the session said: nothing can be running after it
  if (lim) {
    const fut = lim.resetsAt && Date.parse(lim.resetsAt) > now;
    const word = KIND_WORD[lim.kind];
    const tail = lim.resetLabel ? (fut ? ' · resets ' : ' · reset ') + lim.resetLabel : '';
    return out('limit', 'stopped at your ' + word + tail, { limitKind: lim.kind, resetsAt: lim.resetsAt, limitAt: iso(msOf(last.at) ?? lastMs) });
  }
  if (Number.isFinite(lastMs) && now - lastMs <= RUNNING_MS && now >= lastMs - RUNNING_MS) {
    return out('running', 'working now · ' + turnsThisHour + (turnsThisHour >= TURN_LIMIT ? '+' : '') + ' turn' + (turnsThisHour === 1 ? '' : 's') + ' this hour');
  }
  if (!last) {
    return out(Number.isFinite(lastMs) && now - lastMs >= QUIET_MS ? 'quiet' : 'finished', Number.isFinite(lastMs) ? 'quiet for ' + ago(lastMs, now).replace(' ago', '') : 'no turns indexed yet');
  }
  const lastMainMs = msOf(last.at);
  const age = lastMainMs === null ? 0 : Math.max(0, now - lastMainMs);
  if (last.role === 'assistant' && last.tool_name) {
    const tool = str(last.tool_name);
    if (age < WAITING_MAX_MS) return out('waiting-tool', 'asked to run ' + tool + ' ' + ago(lastMainMs, now) + ' — no result since (a permission prompt, or a long tool)', { lastTool: tool });
    return out('stopped-mid-tool', 'stopped mid-tool: asked to run ' + tool + ' ' + ago(lastMainMs, now) + ', no result came back', { lastTool: tool });
  }
  if (last.role === 'user' && age > NO_REPLY_MS) return out('no-reply', 'your last prompt has no reply');
  if (last.role === 'assistant' && /^\s*API Error:/i.test(str(last.text))) return out('api-error', 'stopped on a connection error');
  if (last.role === 'assistant' || last.role === 'tool') {
    if (Number.isFinite(lastMs) && now - lastMs >= QUIET_MS) return out('quiet', 'quiet — no activity ' + ago(lastMs, now));
    return out('finished', 'finished its turn ' + ago(lastMainMs, now));
  }
  // a fresh owner prompt (under NO_REPLY_MS) that the running window did not catch, or a tool result with nothing after it
  return out('running', 'working now · ' + turnsThisHour + ' turn' + (turnsThisHour === 1 ? '' : 's') + ' this hour');
}

// ---------------------------------------------------------------- grouping, labels, resume rule
export const normCwd = (cwd) => str(cwd).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/** Pipeline runs launch claude in the Windows system folder; they fold into one lane and never offer Resume. */
export const isNightly = (cwd) => normCwd(cwd) === NIGHTLY_CWD;
const baseName = (cwd) => { const p = str(cwd).replace(/\\/g, '/').replace(/\/+$/, ''); return p.slice(p.lastIndexOf('/') + 1); };

/** Project label precedence: confirmed → name · auto → name + auto-matched · otherwise the folder, "not a scanned project". */
export function projectLabel(conv, project) {
  const link = project && project.link_state;
  const hq = project && project.hq_project_id ? String(project.hq_project_id) : null;
  const name = str(project && project.name) || str(conv && conv.project_name);
  if (hq && link === 'confirmed') return { id: hq, name: name || baseName(conv && conv.cwd) || hq, matched: 'confirmed' };
  if (hq && link === 'auto') return { id: hq, name: name || baseName(conv && conv.cwd) || hq, matched: 'auto' };
  return { id: null, name: baseName(conv && conv.cwd) || str(conv && conv.project_name) || 'unknown folder', matched: 'folder' };
}

/** Resume is offered only for a settled session: not running, not waiting, quiet ≥ 30 min, not a nightly run, with a folder. */
export function resumeRule(state, lastMs, now, { nightly = false, hasCwd = true } = {}) {
  if (nightly) return { canResume: false, why: 'nightly scan runs are not resumable' };
  if (!hasCwd) return { canResume: false, why: 'this session has no recorded folder' };
  if (state === 'running') return { canResume: false, why: 'it is working right now' };
  if (state === 'waiting-tool') return { canResume: false, why: 'it is waiting on a tool or a permission prompt — answer it in its own window' };
  if (!Number.isFinite(lastMs) || now - lastMs < RESUME_QUIET_MS) return { canResume: false, why: 'wait until it has been quiet for 30 minutes' };
  return { canResume: true };
}

// ---------------------------------------------------------------- the board
function card(conv, turns, project, now) {
  const c = classify(conv, turns, now);
  const lastMs = msOf(conv.last_at) ?? now, startMs = msOf(conv.started_at) ?? lastMs;
  const cwd = str(conv.cwd);
  const rr = resumeRule(c.state, lastMs, now, { nightly: false, hasCwd: !!cwd });
  const o = {
    id: str(conv.native_id) || str(conv.id).replace(/^code:/, ''),
    title: str(conv.title) || '(untitled session)',
    project: projectLabel(conv, project),
    branch: str(conv.git_branch) || null,
    cwdLabel: baseName(cwd) || null,
    startedAt: iso(startMs), lastAt: iso(lastMs),
    activeMin: Math.round(num(conv.active_ms) / 60e3),
    messages: num(conv.message_count),
    tokens: { in: num(conv.tokens_in), out: num(conv.tokens_out), cacheRead: num(conv.tokens_cache_read) },
    state: c.state, sentence: c.sentence, longRun: c.longRun,
    canResume: rr.canResume, canOpen: !!cwd,
  };
  if (rr.why) o.why = rr.why;
  if (c.lastTool) o.lastTool = c.lastTool;
  if (c.limitKind) { o.limitKind = c.limitKind; o.resetsAt = c.resetsAt; }
  return o;
}

/**
 * rows: listConversations rows (last 7 d). details: { [row.id]: turns[] }. projects: { [project_id]: listProjects row }.
 * The timeline and cards show the last `windowMs` (24 h); the limit line counts every row inside `weekMs`.
 * codex: { count, lastAt, recent? } | null — folded in as-is.
 */
export function buildBoard({ rows = [], details = {}, projects = {}, now, windowMs = DAY_MS, weekMs = WEEK_MS, codex = null, state = 'ok', error } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && msOf(r.last_at) !== null);
  list.sort((a, b) => (msOf(b.last_at) - msOf(a.last_at)) || (a.id < b.id ? 1 : -1));
  const sessions = [];
  let nightlyCount = 0, nightlyLast = null, week = 0, stopsCount = 0, stopLast = null;
  for (const r of list) {
    const lastMs = msOf(r.last_at);
    if (now - lastMs > weekMs) continue;
    week++;
    const turns = details[r.id] || [];
    const nightly = isNightly(r.cwd);
    if (!nightly) {
      const lim = lastLimit(turns);
      if (lim) { stopsCount++; if (!stopLast || Date.parse(lim.at) > Date.parse(stopLast.at)) stopLast = { kind: lim.kind, at: lim.at }; }
    }
    if (now - lastMs > windowMs) continue;
    if (nightly) { nightlyCount++; if (nightlyLast === null || lastMs > nightlyLast) nightlyLast = lastMs; continue; }
    sessions.push(card(r, turns, projects[r.project_id], now));
  }
  const counts = { total: sessions.length, week, running: 0, waiting: 0, stopped: 0, limit: 0, finished: 0, quiet: 0 };
  for (const s of sessions) {
    if (s.state === 'running') counts.running++;
    else if (s.state === 'waiting-tool') counts.waiting++;
    else if (s.state === 'stopped-mid-tool' || s.state === 'no-reply' || s.state === 'api-error') counts.stopped++;
    else if (s.state === 'limit') counts.limit++;
    else if (s.state === 'finished') counts.finished++;
    else counts.quiet++;
  }
  const board = {
    v: 1, generatedAt: iso(now), state,
    sessions,
    nightly: { count: nightlyCount, lastAt: nightlyLast === null ? null : iso(nightlyLast) },
    codex: codex && codex.count > 0 ? codex : null,
    limitStops: { days: 7, count: stopsCount, last: stopLast },
    counts,
  };
  if (error) board.error = String(error).slice(0, 300);
  return board;
}

/** The limit notice in a session's last turns (main line, last assistant text), or null. */
function lastLimit(turns) {
  const main = mainline(realTurns(turns));
  const last = main.length ? main[main.length - 1] : null;
  if (!last || last.role !== 'assistant' || last.tool_name) return null;
  const at = msOf(last.at);
  const lim = parseLimitNotice(str(last.text), at);
  return lim && at !== null ? { kind: lim.kind, at: iso(at) } : null;
}

export function boardSignature(board) {
  if (!board || typeof board !== 'object') return '';
  const { generatedAt, ...rest } = board;
  return JSON.stringify(rest);
}

const STRIP_RANK = { running: 0, 'waiting-tool': 1, 'stopped-mid-tool': 2, limit: 2, 'api-error': 2, 'no-reply': 2 };
/** Home: up to 3 sessions running, waiting or stopped in the last 2 h, most urgent first (running, waiting, stopped), newest first inside a rank. */
export function homeStrip(board, now) {
  const ss = board && Array.isArray(board.sessions) ? board.sessions : [];
  return ss
    .filter((s) => s && s.state in STRIP_RANK && now - Date.parse(s.lastAt) <= HOME_RECENT_MS)
    .sort((a, b) => (STRIP_RANK[a.state] - STRIP_RANK[b.state]) || (Date.parse(b.lastAt) - Date.parse(a.lastAt)))
    .slice(0, 3);
}

export function limitLine(ls) {
  const days = ls && ls.days ? ls.days : 7, n = ls ? num(ls.count) : 0;
  const head = 'limit stops in the last ' + days + ' days: ' + n;
  if (!n || !ls.last) return head;
  const at = msOf(ls.last.at);
  const word = ls.last.kind === 'limit' ? 'limit' : KIND_WORD[ls.last.kind] || 'limit';
  return head + ' (last: ' + word + (at === null ? '' : ', ' + dayLabel(at)) + ')';
}
