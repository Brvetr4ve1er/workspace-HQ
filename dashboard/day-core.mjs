// Today ribbon: the day model. PURE: no fs, no clock (the caller passes `now`), no network. dashboard/day-ribbon.js gathers the
// four sources and calls buildDay; the renderer draws what comes back; the MCP tool hq_today and data/today.json carry only `counts`.
//
//   buildDay({ dayKey, tzOffsetMin, claudeBuckets, powerEvents, browserEvents, commitTimes, now })
//     -> { day, isToday, nowMin, tzOffsetMin, lanes, spans, ticks, caption, counts, notes } | { error }
//
//   dayKey         local 'YYYY-MM-DD'.   tzOffsetMin  minutes EAST of UTC for that day (a day is read as 24 h from its local midnight;
//                  on a daylight-saving change day the hour at the end is off by one, which the ribbon does not claim to resolve).
//   claudeBuckets  null (no source) | { error } | { buckets:[{ project_id|projectId, start_ms|startMs, messages }], bucketMin? }  (the Hub op)
//   powerEvents    null (no app log for the day) | [{ t:epochMs, event }]  (parsePowerLines output, three days' logs merged)
//   browserEvents  null (no file) | [{ ts, focus_ms, ...whatever }]  — ONLY ts and focus_ms are read; a domain, host, url or title that
//                  arrives is never copied into anything this module returns
//   commitTimes    null (no repository read) | epochMs[] | { times:epochMs[], capped?, failed?, repos? }
//   now            Date | epochMs | ISO string (the caller's clock)
//
// Every lane says what its source could see: lane.state is 'ok' | 'empty' (the source answered, nothing that day) | 'unavailable' (no
// source; lane.note says why) | 'not-kept' (the browser lane for a day older than 3 days). A source that is missing gives a note and a
// null count, never zeros. Minutes are minutes of the local day (0..1440), at most two decimals.
//
// Claude blocks: a 5-minute block with at least one user or assistant turn; the caption counts BLOCKS and never calls them hours.
// Power: asleep is drawn only between a suspend line and the next resume (or start) line; awake only where the app's own lines
// (start, alive every 15 min, resume, quit…) bracket the time; any other stretch is 'unknown' (the app was not running or died hard).
export const BUCKET_MIN = 5;
export const ALIVE_GAP_MS = 20 * 60000;      // the heartbeat is 15 min; a longer silence is not evidence the app was up
export const BROWSER_KEPT_DAYS = 3;          // data/browser-activity.json is a rolling 3-day window (CONTRACT)
export const MAX_CLAUDE_LANES = 8;           // more projects fold into one "N more projects" lane
export const BROWSER_JOIN_MS = 30000;        // browser focus periods closer than this are one stretch
const DAY_MS = 86400000;
const MIN_MS = 60000;
const LOG_LINES_MAX = 400000;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN);
const r2 = (x) => Math.round(x * 100) / 100;
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

// ---- days ---------------------------------------------------------------------------------------------------------------
export function dayBounds(dayKey, tzOffsetMin = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const utc = Date.UTC(y, mo - 1, d);
  const chk = new Date(utc);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  const tz = Math.max(-840, Math.min(840, Math.trunc(Number(tzOffsetMin) || 0)));
  const startMs = utc - tz * MIN_MS;
  return { startMs, endMs: startMs + DAY_MS, tz };
}
/** The local 'YYYY-MM-DD' of an instant, for a zone offset in minutes east of UTC. */
export function localDayKey(ms, tzOffsetMin = 0) { return new Date(ms + (Number(tzOffsetMin) || 0) * MIN_MS).toISOString().slice(0, 10); }
/** dayKey shifted by whole days (UTC calendar arithmetic on the key: no zone involved). */
export function shiftDayKey(dayKey, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + days * DAY_MS).toISOString().slice(0, 10);
}

function nowToMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  if (typeof now === 'string') return Date.parse(now);
  return NaN;
}

// ---- spans --------------------------------------------------------------------------------------------------------------
/** Sort [a, b] pairs and join those that overlap or lie within gap of each other. Input is not changed. */
export function mergeRanges(list, gap = 0) {
  const s = list.filter((r) => r && r[1] > r[0]).map((r) => [r[0], r[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + gap) { if (r[1] > last[1]) last[1] = r[1]; } else out.push(r);
  }
  return out;
}
const clip = (a, b, lo, hi) => { const x = Math.max(a, lo), y = Math.min(b, hi); return y > x ? [x, y] : null; };
const toMin = (ms, startMs) => r2((ms - startMs) / MIN_MS);

// ---- the app's day log -> power events -----------------------------------------------------------------------------------
const POWER_EVENTS = new Set(['start', 'alive', 'suspend', 'resume', 'shutdown', 'quit', 'exit', 'before-quit', 'will-quit']);
const ALIVE_TYPE = new Set(['start', 'alive', 'resume', 'before-quit', 'will-quit']);
const END_TYPE = new Set(['quit', 'exit', 'shutdown']);

/**
 * Lines of logs/app-YYYY-MM-DD.log (one JSON object per line: ts with the local offset, event, pid) -> [{ t, event }] sorted by time.
 * Lines that are not JSON, have no usable ts, or name another event are skipped. A second launch of the app (its 'start' line says
 * secondary:true) writes its own start and quit lines: every line of that pid is dropped, or its quit would read as the app ending.
 */
export function parsePowerLines(text) {
  const lines = String(text == null ? '' : text).split('\n', LOG_LINES_MAX);
  const rows = [];
  const secondary = new Set();
  for (const line of lines) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    let o; try { o = JSON.parse(s); } catch { continue; }
    if (!isObj(o) || typeof o.ts !== 'string' || typeof o.event !== 'string') continue;
    if (o.event === 'start' && o.secondary === true && o.pid != null) secondary.add(o.pid);
    if (!POWER_EVENTS.has(o.event)) continue;
    const t = Date.parse(o.ts);   // the offset in each line's own ts is honoured by Date.parse
    if (!Number.isFinite(t)) continue;
    rows.push({ t, event: o.event, pid: o.pid });
  }
  return rows.filter((r) => !(r.pid != null && secondary.has(r.pid))).sort((a, b) => a.t - b.t).map(({ t, event }) => ({ t, event }));
}

/**
 * Walk the events (the day's own plus its neighbours) and return the day's power stretches:
 * [{ kind:'awake'|'asleep'|'unknown', a, b }] covering [startMs, limitMs) with no gaps and no overlaps (adjacent equal kinds joined).
 */
export function powerSegments(events, startMs, limitMs) {
  const ev = (Array.isArray(events) ? events : []).filter((e) => isObj(e) && Number.isFinite(e.t) && POWER_EVENTS.has(e.event)).sort((a, b) => a.t - b.t);
  const out = [];
  const push = (kind, a, b) => {
    const c = clip(a, b, startMs, limitMs);
    if (!c) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.b === c[0]) last.b = c[1]; else out.push({ kind, a: c[0], b: c[1] });
  };
  if (!(limitMs > startMs)) return out;
  if (!ev.length) { push('unknown', startMs, limitMs); return out; }
  push('unknown', startMs, ev[0].t);
  for (let i = 0; i < ev.length - 1; i++) {
    const a = ev[i], b = ev[i + 1];
    let kind = 'unknown';
    if (a.event === 'suspend') kind = b.event === 'resume' || b.event === 'start' ? 'asleep' : 'unknown';
    else if (ALIVE_TYPE.has(a.event) && b.event !== 'start' && b.t - a.t <= ALIVE_GAP_MS) kind = 'awake';
    // an end line, a start after a silence (a hard kill), or a gap with no heartbeat: nobody can say
    push(kind, a.t, b.t);
  }
  const last = ev[ev.length - 1];
  push(ALIVE_TYPE.has(last.event) && limitMs - last.t <= ALIVE_GAP_MS ? 'awake' : 'unknown', last.t, limitMs);
  return out;
}

// ---- wording --------------------------------------------------------------------------------------------------------------
/** 150 -> '2 h 30 m', 45 -> '45 m', 120 -> '2 h'. */
export function formatDuration(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? h + ' h ' + r + ' m' : h ? h + ' h' : r + ' m';
}

/**
 * The caption from counts alone (the ribbon, today.json's reader and hq_today all say it the same way). A null count is a source that
 * could not be read and is said so; browser focus is a lane, not part of the caption.
 */
export function captionFromCounts(c) {
  const k = isObj(c) ? c : {};
  const parts = [];
  if (k.claudeBlocks == null) parts.push('Claude blocks unavailable');
  else if (k.claudeBlocks === 0) parts.push('0 five-minute blocks with Claude');
  else parts.push(plural(k.claudeBlocks, 'five-minute block') + ' with Claude ' + (k.claudeProjects === 1 ? 'in 1 project' : 'across ' + plural(k.claudeProjects || 0, 'project')));
  parts.push(k.commits == null ? 'commits unavailable' : plural(k.commits, 'commit'));
  parts.push(k.asleepMinutes == null ? 'PC sleep unknown' : k.asleepMinutes > 0 ? 'PC asleep ' + formatDuration(k.asleepMinutes) : 'no PC sleep seen');
  return parts.join(', ');
}

// ---- the lanes ------------------------------------------------------------------------------------------------------------
const flat = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const last = (key) => (key === '' ? '￿' : key);

function claudeLanes(src, b, limitMs, notes) {
  const bad = (note) => { notes.push(note); return { lanes: [{ id: 'claude', kind: 'claude', ref: null, state: 'unavailable', note }], spans: [], blocks: null, projects: null }; };
  if (src == null) return bad('Claude lane: the Claude Hub is not running');
  if (isObj(src) && typeof src.error === 'string') return bad(/unknown op/i.test(src.error) ? 'Claude lane: update the Hub (this one does not know the day query yet)' : 'Claude lane: ' + (flat(src.error, 120) || 'the Hub gave no answer'));
  if (!isObj(src) || !Array.isArray(src.buckets)) return bad('Claude lane: the Hub answered in a shape this version cannot read');
  const bucketMs = (Number.isInteger(src.bucketMin) && src.bucketMin > 0 ? src.bucketMin : BUCKET_MIN) * MIN_MS;
  const by = new Map();   // project key -> Set of bucket starts
  for (const x of src.buckets) {
    if (!isObj(x)) continue;
    const start = num(x.start_ms ?? x.startMs), n = num(x.messages);
    if (!Number.isFinite(start) || !(n > 0)) continue;
    if (!(start + bucketMs > b.startMs && start < b.endMs && start < limitMs)) continue;   // a bucket belongs to the day it overlaps
    const ref = x.project_id ?? x.projectId ?? null;
    const key = ref == null ? '' : String(ref);
    if (!by.has(key)) by.set(key, new Set());
    by.get(key).add(start);
  }
  if (!by.size) return { lanes: [{ id: 'claude', kind: 'claude', ref: null, state: 'empty', note: 'No Claude turns on this day' }], spans: [], blocks: 0, projects: 0 };
  const rows = [...by.entries()].map(([key, set]) => {
    const starts = [...set].sort((p, q) => p - q);
    return { key, blocks: starts.length, ranges: mergeRanges(starts.map((s) => [s, s + bucketMs])) };
  }).sort((p, q) => q.blocks - p.blocks || (last(p.key) < last(q.key) ? -1 : 1));   // ties by id; the chat with no project goes last
  const keep = rows.slice(0, MAX_CLAUDE_LANES), rest = rows.slice(MAX_CLAUDE_LANES);
  const lanes = [], spans = [];
  const draw = (id, ranges) => { for (const [a, c] of ranges) { const k = clip(a, c, b.startMs, b.endMs); if (k) spans.push({ lane: id, kind: 'block', startMin: toMin(k[0], b.startMs), endMin: toMin(k[1], b.startMs) }); } };
  keep.forEach((r, i) => { const id = 'claude-' + (i + 1); lanes.push({ id, kind: 'claude', ref: r.key === '' ? null : r.key, state: 'ok', blocks: r.blocks }); draw(id, r.ranges); });
  if (rest.length) {
    lanes.push({ id: 'claude-more', kind: 'claude', ref: null, state: 'ok', blocks: rest.reduce((n, r) => n + r.blocks, 0), more: rest.length });
    draw('claude-more', mergeRanges(rest.flatMap((r) => r.ranges)));
  }
  return { lanes, spans, blocks: rows.reduce((n, r) => n + r.blocks, 0), projects: rows.length };
}

function browserLane(events, b, nowMs, limitMs, notes) {
  const keptFrom = nowMs - BROWSER_KEPT_DAYS * DAY_MS;
  const lane = (state, note) => ({ id: 'browser', kind: 'browser', ref: null, state, ...(note ? { note } : {}) });
  if (b.endMs <= keptFrom) { const n = 'browser lane is kept for ' + BROWSER_KEPT_DAYS + ' days'; notes.push(n); return { lane: lane('not-kept', n), spans: [], minutes: null }; }
  if (events == null) { const n = 'Browser lane: no browser focus file yet (the Bridge extension has not sent any)'; notes.push(n); return { lane: lane('unavailable', n), spans: [], minutes: null }; }
  if (!Array.isArray(events)) { const n = 'Browser lane: the browser file could not be read'; notes.push(n); return { lane: lane('unavailable', n), spans: [], minutes: null }; }
  const ranges = [];
  for (const e of events) {
    if (!isObj(e)) continue;
    const ts = num(e.ts), f = num(e.focus_ms);   // the only two fields this module ever reads
    if (!Number.isFinite(ts) || !(f > 0)) continue;
    const k = clip(ts, ts + f, b.startMs, limitMs);
    if (k) ranges.push(k);
  }
  const merged = mergeRanges(ranges, BROWSER_JOIN_MS);
  const spans = merged.map(([a, c]) => ({ lane: 'browser', kind: 'focus', startMin: toMin(a, b.startMs), endMin: toMin(c, b.startMs) }));
  const minutes = Math.round(merged.reduce((n, [a, c]) => n + (c - a), 0) / MIN_MS);
  let note = '';
  if (b.startMs < keptFrom) { note = 'browser lane covers only part of this day (it is kept for ' + BROWSER_KEPT_DAYS + ' days)'; notes.push(note); }
  else if (!spans.length) note = 'No browser focus recorded for this day';
  return { lane: lane(spans.length ? 'ok' : 'empty', note), spans, minutes };
}

function powerLane(events, b, limitMs, notes) {
  const lane = (state, note) => ({ id: 'power', kind: 'power', ref: null, state, ...(note ? { note } : {}) });
  if (events == null) { const n = 'PC lane: no app log for this day (the app was not running, or the log is older than 30 days)'; notes.push(n); return { lane: lane('unavailable', n), spans: [], asleep: null }; }
  if (!Array.isArray(events) || !events.length) { const n = 'PC lane: the app log has nothing for this day'; notes.push(n); return { lane: lane('unavailable', n), spans: [], asleep: null }; }
  const segs = powerSegments(events, b.startMs, limitMs);
  const spans = segs.map((s) => ({ lane: 'power', kind: s.kind, startMin: toMin(s.a, b.startMs), endMin: toMin(s.b, b.startMs) }));
  const known = segs.filter((s) => s.kind !== 'unknown');
  if (!known.length) { const n = 'PC lane: the app was not running (unknown), so nothing is known about the PC on this day'; notes.push(n); return { lane: lane('unavailable', n), spans, asleep: null }; }
  const asleep = Math.round(segs.filter((s) => s.kind === 'asleep').reduce((n, s) => n + (s.b - s.a), 0) / MIN_MS);
  if (segs.some((s) => s.kind === 'unknown')) notes.push('PC lane: stretches with no app log line are shown as unknown, never as asleep');
  return { lane: lane('ok'), spans, asleep };
}

function commitLane(src, b, limitMs, notes) {
  const lane = (state, note) => ({ id: 'commits', kind: 'commits', ref: null, state, ...(note ? { note } : {}) });
  const o = Array.isArray(src) ? { times: src } : isObj(src) ? src : null;
  if (!o || !Array.isArray(o.times)) { const n = 'Commit ticks: no repository could be read'; notes.push(n); return { lane: lane('unavailable', n), ticks: [], commits: null }; }
  const by = new Map();
  for (const t of o.times) {
    const v = num(t);
    if (!Number.isFinite(v) || v < b.startMs || v >= Math.min(b.endMs, limitMs)) continue;
    const m = Math.floor((v - b.startMs) / MIN_MS);
    by.set(m, (by.get(m) || 0) + 1);
  }
  const ticks = [...by.entries()].sort((p, q) => p[0] - q[0]).map(([m, count]) => ({ lane: 'commits', min: m, count }));
  if (o.capped === true) notes.push('Commit ticks may be incomplete: a repository reached the 200-commit cap');
  if (Number(o.failed) > 0) notes.push(plural(Number(o.failed), 'repository', 'repositories') + ' could not be read for commit ticks');
  const total = ticks.reduce((n, t) => n + t.count, 0);
  return { lane: lane(total ? 'ok' : 'empty', total ? '' : 'No commits on this day'), ticks, commits: total };
}

// ---- the day --------------------------------------------------------------------------------------------------------------
export function buildDay({ dayKey, tzOffsetMin = 0, claudeBuckets = null, powerEvents = null, browserEvents = null, commitTimes = null, now } = {}) {
  const b = dayBounds(dayKey, tzOffsetMin);
  if (!b) return { error: 'dayKey must be a real date, YYYY-MM-DD' };
  const t = nowToMs(now);
  const nowMs = Number.isFinite(t) ? t : b.endMs;   // no clock given: the day is read as a finished one
  if (nowMs < b.startMs) return { error: 'that day has not started yet' };
  const isToday = nowMs < b.endMs;
  const limitMs = Math.min(b.endMs, nowMs);
  const notes = [];

  const cl = claudeLanes(claudeBuckets, b, limitMs, notes);
  const br = browserLane(browserEvents, b, nowMs, limitMs, notes);
  const pw = powerLane(powerEvents, b, limitMs, notes);
  const cm = commitLane(commitTimes, b, limitMs, notes);

  const counts = {
    claudeBlocks: cl.blocks, claudeProjects: cl.projects, commits: cm.commits,
    asleepMinutes: pw.asleep, browserMinutes: br.minutes,
  };
  return {
    day: String(dayKey), isToday, nowMin: isToday ? toMin(nowMs, b.startMs) : null, tzOffsetMin: b.tz,
    lanes: [...cl.lanes, br.lane, pw.lane, cm.lane],
    spans: [...cl.spans, ...br.spans, ...pw.spans],
    ticks: cm.ticks,
    caption: captionFromCounts(counts),
    counts,
    notes: [...new Set(notes)],
  };
}

/** The numbers-only copy of a day's counts (data/today.json, hq_today): five known keys, each a finite number or null. */
export function cleanCounts(c) {
  const k = isObj(c) ? c : {};
  const pick = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  return { claudeBlocks: pick(k.claudeBlocks), claudeProjects: pick(k.claudeProjects), commits: pick(k.commits), asleepMinutes: pick(k.asleepMinutes), browserMinutes: pick(k.browserMinutes) };
}
