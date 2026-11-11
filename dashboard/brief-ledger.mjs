// Brief ledger engine: what the Brief noticed and how each thing ended (dish brief-history, batch 3). PURE: no IO, no clock
// (`now` is passed in), no LLM. The file it describes is data/brief-ledger.json (written by dashboard/brief-ledger.js).
//
// WHY A LEDGER AND NOT brief-state.json firstSeen: brief.js forgets a key that has been off the brief for an hour, prunes anything not
// live for 7 days and caps at 200, so a resolved item leaves firstSeen within the hour. The ledger is its own small file.
//
// ledger = { v:1,
//   open:   { <ref>: { rule, source, severity, count, first, last, acted? } },       ref = refOf(key) (12 hex, brief-project.mjs): NEVER the raw key
//   closed: [ { rule, severity, count, first, ended, how } ],                         kept 30 days, at most 300
//   busyFrom: ISO | null,            additive: when the list last went from empty to non-empty (the start of the current busy stretch)
//   lastClearShownAt: ISO | null }   when the all-clear card was last acknowledged
// The file holds refs, rule ids, source ids, severities, counts and times. Never a key, a name, a path, an amount or free text: all wording
// comes from brief-project's WORDING table by rule id, at read time.
//
// WHAT A BRIEF CAN AND CANNOT SHOW. brief.json exposes items (3), overflow (rows 4 to 12), standing and a count `more`; a row ranked below 12 is in none of them.
// The key is rule:subject:value, so a changed value or count makes a NEW key: the old key leaves and a new one opens for the same rule. A key leaving the
// live set therefore does NOT mean the fact was fixed.
//
// observe(ledger, brief, { now, dismissedKeys, errors, coldStart }) → { ledger, changed, opened, closed:[{ rule, how }] }
//   every live row (items, overflow AND standing) is opened, or has `last` refreshed. An open ref that is no longer live is decided in this order, first match wins:
//     1 its key is in brief-state.json dismissed                                   -> 'dismissed'
//     2 hidden rows exist (more minus overflow length above 0)                     -> stays OPEN (a row pushed below rank 12 is invisible, not gone); not live for 30 days -> 'silent'
//     3 another live row carries the same rule                                     -> 'changed' (the fact moved on to a new key; never counted as resolved)
//     4 its last-seen row carried acted:{verb,at}                                  -> 'acted'
//     5 its source is not trustworthy this computation                             -> 'silent' (a quiet source cannot be called fixed)
//     6 otherwise                                                                  -> 'resolved'
//   coldStart (the first computation after an app restart): nothing closes; rows only re-open or refresh.
//   Source trust (SOURCE_ALIAS: the item vocabulary and the error vocabulary differ): an error whose source is 'brief' (the file write failed) or is not in the table
//   makes every close 'silent' that computation; an error on a source makes that source's rows 'silent'; scan-sourced rows are also 'silent' while a scan-stale or
//   scan-failed row is live. Residual, stated honestly: a senses row (github, vercel, claude-code) whose data file went old WITHOUT an error is not detectable here.
// summarize(ledger, brief, { now, errors }) → { entries, clearedThisWeek, dismissedThisWeek, allClear }   (the hq:brief-history:read answer, minus notice)
//   allClear: null | { since, resolved:[{ text, after, how, ended }] } — strict, once per clear episode (see allClearOf).
import { WORDING, SEV_WORD, STALE_MIN, REF_LEN, refOf } from './brief-project.mjs';

export { refOf };
export const LEDGER_V = 1;
const DAY = 24 * 3600e3;
export const CLOSED_KEEP_MS = 30 * DAY, CLOSED_MAX = 300, OPEN_SILENT_MS = 30 * DAY, WEEK_MS = 7 * DAY, HISTORY_MS = 14 * DAY;
export const OPEN_MAX = 200, ENTRIES_MAX = 60, ALLCLEAR_MAX = 12;
export const HOWS = Object.freeze(['resolved', 'acted', 'dismissed', 'changed', 'silent']);

/** item source / error source -> the canonical source whose trust it shares. Anything not here is untrusted (a close is 'silent'). */
export const SOURCE_ALIAS = Object.freeze({
  scan: 'scan', 'scan-run': 'scan',
  money: 'money', claude: 'claude', 'pc-health': 'pc-health',
  github: 'brief-senses', vercel: 'brief-senses', 'claude-code': 'brief-senses', 'brief-senses': 'brief-senses',
});

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const nowMs = (n) => (n instanceof Date ? n.getTime() : typeof n === 'number' && Number.isFinite(n) ? n : 0);
const isoOf = (t) => new Date(t).toISOString();
const cnt = (c) => (typeof c === 'number' && Number.isInteger(c) && c > 0 && c < 1e6 ? c : 0);
const REF = new RegExp('^[0-9a-f]{' + REF_LEN + '}$');
const SRC = /^[a-z0-9-]{1,24}$/;
const canon = (source) => (typeof source === 'string' && own(SOURCE_ALIAS, source) ? SOURCE_ALIAS[source] : null);
const ruleOf = (r) => (typeof r === 'string' && own(WORDING, r) ? r : 'unknown');
const sevOf = (s) => (typeof s === 'string' && own(SEV_WORD, s) ? s : 'low');

export const emptyLedger = () => ({ v: LEDGER_V, open: {}, closed: [], busyFrom: null, lastClearShownAt: null });

function trimClosed(list, t) {
  const kept = list.filter((c) => t - msOf(c.ended) < CLOSED_KEEP_MS);
  kept.sort((a, b) => msOf(a.ended) - msOf(b.ended));
  return kept.slice(-CLOSED_MAX);
}

/** A new, sanitized ledger from anything (the file's parsed text, or garbage): unknown fields dropped, caps applied. Never throws. */
export function cleanLedger(x, now) {
  const t = nowMs(now), out = emptyLedger();
  if (!isObj(x)) return out;
  if (isObj(x.open)) {
    const rows = [];
    for (const [ref, e] of Object.entries(x.open)) {
      if (!REF.test(ref) || !isObj(e)) continue;
      const f = msOf(e.first), l = msOf(e.last);
      if (f === null || l === null) continue;
      const row = { rule: ruleOf(e.rule), source: typeof e.source === 'string' && SRC.test(e.source) ? e.source : '', severity: sevOf(e.severity), count: cnt(e.count), first: isoOf(f), last: isoOf(l) };
      const a = msOf(e.acted);
      if (a !== null) row.acted = isoOf(a);
      rows.push([ref, row, l]);
    }
    rows.sort((a, b) => b[2] - a[2]);
    for (const [ref, row] of rows.slice(0, OPEN_MAX)) out.open[ref] = row;
  }
  const closed = [];
  for (const c of arr(x.closed)) {
    if (!isObj(c) || !HOWS.includes(c.how)) continue;
    const f = msOf(c.first), e = msOf(c.ended);
    if (f === null || e === null) continue;
    closed.push({ rule: ruleOf(c.rule), severity: sevOf(c.severity), count: cnt(c.count), first: isoOf(f), ended: isoOf(e), how: c.how });
  }
  out.closed = trimClosed(closed, t);
  const b = msOf(x.busyFrom), s = msOf(x.lastClearShownAt);
  out.busyFrom = b === null ? null : isoOf(b);
  out.lastClearShownAt = s === null ? null : isoOf(s);
  return out;
}

/** Rows hidden below rank 12: in none of items, overflow or standing. */
export const hiddenRows = (brief) => (isObj(brief) ? Math.max(0, (Math.floor(Number(brief.more)) || 0) - arr(brief.overflow).length) : 0);

/** Every live row anywhere on the brief: [{ ref, row }]. A row needs a string key and rule and a known severity. */
export function liveRows(brief) {
  if (!isObj(brief)) return [];
  const out = [], seen = new Set();
  for (const row of arr(brief.items).concat(arr(brief.overflow), arr(brief.standing))) {
    if (!isObj(row) || typeof row.key !== 'string' || !row.key || typeof row.rule !== 'string' || !own(SEV_WORD, row.severity)) continue;
    const ref = refOf(row.key);
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ ref, row });
  }
  return out;
}

const actedAt = (row, fallbackIso) => {
  const a = isObj(row.acted) && typeof row.acted.verb === 'string' ? row.acted : null;
  if (!a) return null;
  const t = msOf(a.at);
  return t === null ? fallbackIso : isoOf(t);
};

/** (source) -> boolean: may a close of a row from this source be called resolved this computation? */
export function trustFn(errors, rows) {
  let all = true;
  const bad = new Set();
  for (const e of arr(errors)) {
    const s = isObj(e) && typeof e.source === 'string' ? e.source : null;
    if (s === null || s === 'brief' || canon(s) === null) { all = false; continue; }
    bad.add(canon(s));
  }
  if (arr(rows).some((r) => r.row.rule === 'scan-stale' || r.row.rule === 'scan-failed')) bad.add('scan');
  return (source) => { if (!all) return false; const c = canon(source); return c !== null && !bad.has(c); };
}

export function observe(ledger, brief, opts) {
  const o = isObj(opts) ? opts : {};
  const t = nowMs(o.now), iso = isoOf(t);
  const base = cleanLedger(ledger, t);
  if (!isObj(brief)) return { ledger: base, changed: false, opened: 0, closed: [], skipped: 'no brief' };
  const open = { ...base.open };
  const closed = base.closed.slice();
  const rows = liveRows(brief);
  const liveRefs = new Set(rows.map((r) => r.ref));
  const liveRules = new Set(rows.map((r) => r.row.rule));
  const wasBusy = Object.keys(base.open).length > 0;
  let opened = 0;
  for (const { ref, row } of rows) {
    const prev = open[ref];
    const e = { rule: ruleOf(row.rule), source: typeof row.source === 'string' && SRC.test(row.source) ? row.source : '', severity: sevOf(row.severity), count: cnt(row.count), first: prev ? prev.first : iso, last: iso };
    const a = actedAt(row, iso);
    if (a) e.acted = a;
    open[ref] = e;
    if (!prev) opened++;
  }
  const ended = [];
  if (!o.coldStart) {
    const hidden = hiddenRows(brief);
    const dismissedRefs = new Set(arr(o.dismissedKeys).filter((k) => typeof k === 'string' && k).map(refOf));
    const trusted = trustFn(o.errors !== undefined ? o.errors : brief.errors, rows);
    for (const [ref, e] of Object.entries(open)) {
      if (liveRefs.has(ref)) continue;
      let how;
      if (dismissedRefs.has(ref)) how = 'dismissed';
      else if (hidden > 0) { if (t - msOf(e.last) >= OPEN_SILENT_MS) how = 'silent'; else continue; }
      else if (liveRules.has(e.rule)) how = 'changed';
      else if (e.acted) how = 'acted';
      else if (!trusted(e.source)) how = 'silent';
      else how = 'resolved';
      closed.push({ rule: e.rule, severity: e.severity, count: e.count, first: e.first, ended: iso, how });
      ended.push({ rule: e.rule, how });
      delete open[ref];
    }
  }
  const next = { v: LEDGER_V, open, closed: trimClosed(closed, t), busyFrom: rows.length > 0 && !wasBusy ? iso : base.busyFrom, lastClearShownAt: base.lastClearShownAt };
  return { ledger: next, changed: JSON.stringify(next) !== JSON.stringify(base), opened, closed: ended };
}

/** The ledger with the all-clear card recorded as shown now. */
export const markShown = (ledger, now) => ({ ...cleanLedger(ledger, now), lastClearShownAt: isoOf(nowMs(now)) });

/** "3 d" | "5 h" | "40 min": the time between two instants in the largest whole unit (at least 1 min). */
export function durationWords(ms) {
  const m = Math.max(1, Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 60e3));
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h < 24 ? h + ' h' : Math.floor(h / 24) + ' d';
}

/** The row wording for a rule, from WORDING only (the short phrase, capitalised); an unknown rule is 'Something else'. */
export function phraseOf(rule, count) {
  const w = own(WORDING, rule) ? WORDING[rule] : null;
  if (!w) return 'Something else';
  const c = cnt(count);
  const s = c > 0 && w.shortMany ? w.shortMany.replace('{n}', String(c + 1)) : w.short;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The all-clear card, or null. Strict: items, overflow AND standing empty, no hidden rows, no source errors, the brief fresh, the ledger holding
 * nothing open, and at least one row closed as resolved or acted during the busy stretch that just ended and not yet shown. A clear that is only
 * silence, change or dismissal never shows it. It is shown once: the ack (markShown) stamps lastClearShownAt, so it cannot come back until the list has had something again.
 */
export function allClearOf(ledger, brief, opts) {
  const o = isObj(opts) ? opts : {}, t = nowMs(o.now);
  if (!isObj(brief)) return null;
  if (arr(brief.items).length || arr(brief.overflow).length || arr(brief.standing).length) return null;
  if (hiddenRows(brief) > 0) return null;
  if (arr(o.errors !== undefined ? o.errors : brief.errors).length) return null;
  const gen = msOf(brief.generatedAt);
  if (gen === null || Math.max(0, Math.floor((t - gen) / 60e3)) > STALE_MIN) return null;
  const L = cleanLedger(ledger, t);
  if (Object.keys(L.open).length) return null;
  const from = msOf(L.busyFrom);
  if (from === null) return null;
  const shown = msOf(L.lastClearShownAt);
  const stretch = L.closed.filter((c) => { const e = msOf(c.ended); return e >= from && (shown === null || e > shown); });
  const done = stretch.filter((c) => c.how === 'resolved' || c.how === 'acted');
  if (!done.length) return null;
  const since = Math.max(...stretch.map((c) => msOf(c.ended)));
  return {
    since: isoOf(since),
    resolved: done.slice(0, ALLCLEAR_MAX).map((c) => ({ text: phraseOf(c.rule, c.count), after: durationWords(msOf(c.ended) - msOf(c.first)), how: c.how, ended: c.ended })),
  };
}

export function summarize(ledger, brief, opts) {
  const o = isObj(opts) ? opts : {}, t = nowMs(o.now);
  const L = cleanLedger(ledger, t);
  const entries = [];
  const openRows = Object.values(L.open).sort((a, b) => msOf(b.first) - msOf(a.first));
  for (const e of openRows) entries.push({ text: phraseOf(e.rule, e.count), rule: e.rule, severity: e.severity, first: e.first, ended: null, how: 'open', after: durationWords(t - msOf(e.first)) });
  const recent = L.closed.filter((c) => t - msOf(c.ended) < HISTORY_MS).sort((a, b) => msOf(b.ended) - msOf(a.ended));
  for (const c of recent) entries.push({ text: phraseOf(c.rule, c.count), rule: c.rule, severity: c.severity, first: c.first, ended: c.ended, how: c.how, after: durationWords(msOf(c.ended) - msOf(c.first)) });
  const week = L.closed.filter((c) => t - msOf(c.ended) < WEEK_MS);
  return {
    entries: entries.slice(0, ENTRIES_MAX),
    clearedThisWeek: week.filter((c) => c.how === 'resolved' || c.how === 'acted').length,
    dismissedThisWeek: week.filter((c) => c.how === 'dismissed').length,
    allClear: allClearOf(L, brief, o),
  };
}
