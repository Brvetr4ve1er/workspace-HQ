// The app door's pure half (dish brief-mailbox): the file mailbox a Claude session uses to ask the RUNNING app to do one small thing.
// No fs, no network, no clock: every time, every listing and every liveness answer arrives as an argument.
//
// The mailbox, under data/intents/ (every name is announced in CONTRACT):
//   app.json                      the app's heartbeat { v:1, pid, at }, written every 20 s, removed at quit
//   inbox/<id>.json               one request { v:1, verb:'brief.dismiss', ref, at, by:'mcp' }, at most 8 KB, id = 32 hex
//   inbox/<id>.json.tmp           the writer's temp name (renamed into place, so the app never reads a half file)
//   inbox/<id>.taken              a request the app CLAIMED by renaming it; one that is still there at startup is never re-run
//   answers/<id>.answer.json      the app's answer { v:1, ok, outcome:'dismissed' | error:'words', at }
//
// What is here:
//   constants                      the one table of sizes, ages, limits and the exact words an answer may carry
//   validId / validRef / inboxName / takenName / answerName / tmpNameOf / parseName
//   checkFileMeta(meta, now)       before anything is read: regular file, size, age (mtime)
//   validateRequest(text, mtimeMs, now) → { ok:true, req } | { ok:false, code, error }
//   buildRequest({ ref, now, bytes? }) → { id, text } (the door's side: the exact bytes it writes)
//   validateArgs(args)             → { ok:true, ref } | { ok:false, error }   (the MCP argument: ONLY a 12-hex ref, nothing else)
//   capState(entries, now)         → { used, allow }  the 10-an-hour cap, counted from the audit lines 'intent.applied'
//   resolveRef(ref, brief)         → { ok:true, key, item } | { ok:false, code, error }   (the row must be in the top three, exactly once)
//   policy(item)                   → { ok:true } | { ok:false, code, error }   (never a high row, never rule 'secrets')
//   decide({ req, brief, entries, now }) → { apply:true, key } | { apply:false, code, error }
//   answer(ok, text, now)          → the answer object (words only; the text is one of the WORDS, or a short sanitized sentence)
//   heartbeat(text, now, isAlive)  → { open:true, pid } | { open:false, why }   (the door's "is the app there")
//   heartbeatBody(pid, now)        → the heartbeat the app writes
//   readAnswer(text)               → { ok:true, outcome } | { ok:false, error } | null (not an answer yet)
//   isOldAnswer / isOldTmp         the sweeps' age rules
import { refOf, REF_LEN } from './brief-project.mjs';

export const V = 1;
export const VERBS = Object.freeze(['brief.dismiss']);
export const BY = Object.freeze(['mcp']);
export const ID_RE = /^[0-9a-f]{32}$/;
export const REF_RE = /^[0-9a-f]{12}$/;
export const REQUEST_KEYS = Object.freeze(['v', 'verb', 'ref', 'at', 'by']);

export const LIMITS = Object.freeze({
  maxBytes: 8 * 1024,               // a request is a few hundred bytes; more is refused unread
  maxExamine: 10,                   // files examined per pass
  maxAgeMs: 10 * 60e3,              // a request older than this is stale
  maxFutureMs: 60e3,                // a request dated further ahead than this is forged or a bad clock
  mtimeSkewMs: 60e3,                // the file's mtime must agree with its own `at`
  heartbeatStaleMs: 60e3,           // the door treats an older heartbeat as "the app is closed"
  heartbeatMaxBytes: 1024,
  heartbeatEveryMs: 20e3,
  sweepEveryMs: 5e3,
  answerKeepMs: 3600e3,             // answers older than this are swept
  tmpKeepMs: 10 * 60e3,             // an orphaned temp file older than this is swept
  answerMaxBytes: 4 * 1024,
  dismissPerHour: 10,               // applied dismissals from a session, an hour's window
  pollMs: 150,                      // the door's answer polling
  budgetMs: 8000,
  errorMax: 160,
});

export const HOUR_MS = 3600e3;
export const AUDIT_TOOL = 'intent.applied';
export const MAY_HAVE_RUN = 'may have run';   // the audit reason of a request found claimed at startup

// the only sentences an answer carries: words, never an item's text, a key, a ref or a path
export const WORDS = Object.freeze({
  closed: 'the app is closed, nothing was changed',
  noAnswer: 'no answer, check the app',
  movedOn: 'the Brief moved on',
  noBrief: 'the Brief is not ready yet, try again in a moment',
  notTop: 'that row is not in the top three, dismiss it in the app',
  standing: 'that row is in the standing list, dismiss it in the app',
  urgent: 'an urgent row can only be dismissed in the app',
  cap: 'dismissing from a session is limited to 10 an hour, dismiss it in the app or try later',
  badRequest: 'the request was not valid, nothing was changed',
  stale: 'the request was too old, nothing was changed',
  future: 'the request is dated in the future, nothing was changed',
  tooBig: 'the request was too big, nothing was changed',
  unknownVerb: 'that request is not one the app answers, nothing was changed',
  interrupted: 'interrupted, it may have run',
  failed: 'the dismissal did not go through',
  badArg: 'hq_brief_dismiss takes only a ref: the 12-character ref of a row from hq_brief',
  dismissed: 'dismissed',
});

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' && t.length <= 40 ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const num = (v) => (v instanceof Date ? v.getTime() : Number(v));
const iso = (ms) => new Date(ms).toISOString();

export const validId = (id) => typeof id === 'string' && ID_RE.test(id);
export const validRef = (ref) => typeof ref === 'string' && REF_RE.test(ref);
export const inboxName = (id) => id + '.json';
export const takenName = (id) => id + '.taken';
export const answerName = (id) => id + '.answer.json';
export const tmpNameOf = (name) => name + '.tmp';

// a name in the inbox → { kind:'request'|'taken'|'tmp', id } | null (anything else is foreign: ignored and counted, never touched)
export function parseName(name) {
  if (typeof name !== 'string') return null;
  let m = /^([0-9a-f]{32})\.json$/.exec(name);
  if (m) return { kind: 'request', id: m[1] };
  m = /^([0-9a-f]{32})\.taken$/.exec(name);
  if (m) return { kind: 'taken', id: m[1] };
  m = /^([0-9a-f]{32})\.json\.tmp$/.exec(name);
  if (m) return { kind: 'tmp', id: m[1] };
  return null;
}

// answer words are re-cut on the way in and on the way out: control characters off, one line, capped
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.errorMax);

// ---- the inbox side ---------------------------------------------------------------------------------------------------------------------

// meta = { isFile, size, mtimeMs } from an lstat (never a stat: a symlink must show as a symlink). Before anything is read.
export function checkFileMeta(meta, now) {
  const t = num(now);
  if (!isObj(meta) || meta.isFile !== true) return { ok: false, code: 'not-file', error: WORDS.badRequest };
  if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > LIMITS.maxBytes) return { ok: false, code: 'size', error: WORDS.tooBig };
  if (!Number.isFinite(meta.mtimeMs)) return { ok: false, code: 'mtime', error: WORDS.badRequest };
  if (t - meta.mtimeMs > LIMITS.maxAgeMs) return { ok: false, code: 'stale', error: WORDS.stale };
  if (meta.mtimeMs - t > LIMITS.maxFutureMs) return { ok: false, code: 'future', error: WORDS.future };
  return { ok: true };
}

// text = the file's content; mtimeMs = the file's own mtime (it must agree with the request's `at`)
export function validateRequest(text, mtimeMs, now) {
  const t = num(now);
  const bad = (code, error = WORDS.badRequest) => ({ ok: false, code, error });
  if (typeof text !== 'string' || text.length === 0) return bad('empty');
  if (Buffer.byteLength(text, 'utf8') > LIMITS.maxBytes) return bad('size', WORDS.tooBig);
  let j;
  try { j = JSON.parse(text); } catch { return bad('json'); }
  if (!isObj(j)) return bad('shape');
  for (const k of Object.keys(j)) if (!REQUEST_KEYS.includes(k)) return bad('extra-key');   // an unknown field is never carried along
  if (j.v !== V) return bad('version');
  if (typeof j.verb !== 'string' || !VERBS.includes(j.verb)) return bad('verb', WORDS.unknownVerb);
  if (!BY.includes(j.by)) return bad('by');
  if (!validRef(j.ref)) return bad('ref');
  const at = msOf(j.at);
  if (at === null) return bad('at');
  if (t - at > LIMITS.maxAgeMs) return bad('stale', WORDS.stale);
  if (at - t > LIMITS.maxFutureMs) return bad('future', WORDS.future);
  if (!Number.isFinite(mtimeMs) || Math.abs(mtimeMs - at) > LIMITS.mtimeSkewMs) return bad('mtime');   // the file and its own date disagree
  return { ok: true, req: { v: V, verb: j.verb, ref: j.ref, at: iso(at), by: j.by } };
}

// the door's side: the exact bytes it writes for a request. `now` is the door's clock.
export function buildRequest({ ref, now, id }) {
  const body = { v: V, verb: 'brief.dismiss', ref, at: iso(num(now)), by: 'mcp' };
  return { id, name: inboxName(id), text: JSON.stringify(body) };
}

// the MCP argument: an object with exactly one property, `ref`, a 12-hex string. A key, an index, a rule id or free text is refused before any file exists.
export function validateArgs(args) {
  if (!isObj(args)) return { ok: false, error: WORDS.badArg };
  const keys = Object.keys(args);
  if (keys.length !== 1 || keys[0] !== 'ref') return { ok: false, error: WORDS.badArg };
  if (!validRef(args.ref)) return { ok: false, error: WORDS.badArg };
  return { ok: true, ref: args.ref };
}

// ---- the decision -----------------------------------------------------------------------------------------------------------------------

// entries = the shared audit log's entries. Applied dismissals are the lines the APP wrote ('intent.applied', door mcp, tier note) in the last hour:
// an ok line is one that did something, and a 'may have run' line counts too (it may have). The MCP guard's own line for the call is a different
// tool name (hq_brief_dismiss), so the two never double-count.
export function capState(entries, now) {
  const t = num(now);
  let used = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isObj(e) || e.tool !== AUDIT_TOOL || e.door !== 'mcp' || e.tier !== 'note') continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at <= t - HOUR_MS || at > t + 60e3) continue;
    if (e.ok === true || e.reason === MAY_HAVE_RUN) used += 1;
  }
  return { used, allow: used < LIMITS.dismissPerHour };
}

// The ref must hit exactly one row of brief.items (the top three: the same set the app's own dismiss accepts). Overflow and standing rows have their own words.
export function resolveRef(ref, brief) {
  if (!validRef(ref)) return { ok: false, code: 'ref', error: WORDS.badRequest };
  if (!isObj(brief) || !Array.isArray(brief.items)) return { ok: false, code: 'no-brief', error: WORDS.noBrief };
  const hit = (list) => (Array.isArray(list) ? list : []).filter((it) => isObj(it) && typeof it.key === 'string' && refOf(it.key) === ref);
  const inItems = hit(brief.items);
  if (inItems.length === 1) return { ok: true, key: inItems[0].key, item: inItems[0] };
  if (inItems.length > 1) return { ok: false, code: 'ambiguous', error: WORDS.movedOn };
  if (hit(brief.overflow).length) return { ok: false, code: 'overflow', error: WORDS.notTop };
  if (hit(brief.standing).length) return { ok: false, code: 'standing', error: WORDS.standing };
  return { ok: false, code: 'none', error: WORDS.movedOn };
}

// a prompt-injected session must not be able to hide the urgent row: never a high-severity item, never the secrets rule
export function policy(item) {
  if (!isObj(item)) return { ok: false, code: 'item', error: WORDS.movedOn };
  if (item.severity === 'high' || item.rule === 'secrets') return { ok: false, code: 'urgent', error: WORDS.urgent };
  return { ok: true };
}

// the whole table, in the spec's order: (1) the cap, (2) the ref resolves to one top-three row, (3) not urgent
export function decide({ req, brief, entries, now }) {
  if (!isObj(req) || !VERBS.includes(req.verb)) return { apply: false, code: 'verb', error: WORDS.unknownVerb };
  if (!capState(entries, now).allow) return { apply: false, code: 'cap', error: WORDS.cap };
  const r = resolveRef(req.ref, brief);
  if (!r.ok) return { apply: false, code: r.code, error: r.error };
  const p = policy(r.item);
  if (!p.ok) return { apply: false, code: p.code, error: p.error };
  return { apply: true, key: r.key };
}

// ---- answers and the heartbeat ----------------------------------------------------------------------------------------------------------

// `text` is one of WORDS (or a sentence already cut down by clean). ok:true always means 'dismissed'.
export function answer(ok, text, now) {
  const at = iso(num(now));
  if (ok === true) return { v: V, ok: true, outcome: WORDS.dismissed, at };
  return { v: V, ok: false, error: clean(text) || WORDS.failed, at };
}

// the door reads an answer file: null = not (yet) a readable answer. A forged or foreign answer is cut to a short sentence and never carries more.
export function readAnswer(text) {
  if (typeof text !== 'string' || !text || text.length > LIMITS.answerMaxBytes) return null;
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!isObj(j) || j.v !== V) return null;
  if (j.ok === true) return j.outcome === WORDS.dismissed ? { ok: true, outcome: WORDS.dismissed } : null;
  if (j.ok === false) return { ok: false, error: clean(j.error) || WORDS.failed };
  return null;
}

export const heartbeatBody = (pid, now) => ({ v: V, pid, at: iso(num(now)) });

// the door's check. isAlive(pid) is injected (process.kill(pid, 0) in the real door): a hard-killed app, or a laptop just resumed, is answered at once.
export function heartbeat(text, now, isAlive) {
  const t = num(now);
  if (typeof text !== 'string' || !text || text.length > LIMITS.heartbeatMaxBytes) return { open: false, why: 'absent' };
  let j; try { j = JSON.parse(text); } catch { return { open: false, why: 'unreadable' }; }
  if (!isObj(j) || j.v !== V || !Number.isInteger(j.pid) || j.pid <= 0) return { open: false, why: 'shape' };
  const at = msOf(j.at);
  if (at === null) return { open: false, why: 'shape' };
  if (t - at > LIMITS.heartbeatStaleMs || at - t > LIMITS.heartbeatStaleMs) return { open: false, why: 'stale' };
  let alive = false;
  try { alive = typeof isAlive === 'function' ? isAlive(j.pid) === true : false; } catch { alive = false; }
  return alive ? { open: true, pid: j.pid } : { open: false, why: 'dead' };
}

export const isOldAnswer = (mtimeMs, now) => Number.isFinite(mtimeMs) && num(now) - mtimeMs > LIMITS.answerKeepMs;
export const isOldTmp = (mtimeMs, now) => Number.isFinite(mtimeMs) && num(now) - mtimeMs > LIMITS.tmpKeepMs;

export { REF_LEN };
