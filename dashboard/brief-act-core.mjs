// Act in place from a Brief row — the pure core (spec: docs/audits/2026-11-10-batch2-rest-plan.json, dish brief-act-waiting).
// PURE: no IO, no clock (`now` is passed in), no LLM. brief-act.js owns the effects; this file decides what is allowed.
//
//   KEYS                    the one place a brief key is BUILT. brief-core.mjs re-exports it and its rule functions call it
//                           (the strings are byte-identical to what they emitted before). Keys are never PARSED: money-stale ends in an
//                           ISO anchorAt full of colons, quest ids can be 'wq:<id>', session-waiting ends in an ISO lastAt.
//   VERBS / RULE_VERBS      the closed table of what a row may do. Four verbs; none leaves the machine (no push, no send, no post).
//   planAct(req, ctx)       → { ok:true, rule, item, plan } | { error }. req = { key, verb, value? }; ctx = { brief, sources, acted?, now }.
//                           The record a key stands for is found by REBUILDING keys from the live source records and comparing for
//                           equality; its id is read from that record, never from the key string. A forged key, a verb of another rule,
//                           an expired key, a value on a verb that takes none and a bad balance are all refused here.
//   decorate(brief, acted, now)  → a NEW brief whose items / overflow / standing carry an additive acted:{verb,at} for keys the owner
//                           acted on. Never mutates its input. Any `acted` already on an item that the map does not back is dropped.
//   prune(acted, brief, now)     → a NEW acted map: keys still on the brief and younger than ACTED_TTL_MS only.
//   markActed(acted, key, verb, now) → a NEW map with that key marked.
//   checkBalance(value)     → { ok:true, value } | { error }  (a pre-check; the money engine's own balanceAmount stays the authority)
//
//   sources = { redQuests:[{id}], staleAccounts:[{id, anchorAt}], waitingSessions:[{id, lastAt}] }  — the live records the three
//   record-backed rules were built from (main hands them over through brief-act.js's sources() seam).
//
// An `acted` map is { [key]: { verb, at: ISO } }. Only verbs that CHANGE something (quest-done, confirm-balance) are marked; Commit hands
// over to the existing overlay and Open its folder changes nothing, so neither would honestly read "done … clears when the next scan confirms".

export const KEYS = Object.freeze({
  questRed: (id) => 'quest-red:' + id,
  moneyStale: (id, anchorAt) => 'money-stale:' + id + ':' + (anchorAt || ''),
  sessionWaiting: (id, lastAt) => 'session-waiting:' + id + ':' + (lastAt || ''),
});

const deep = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze({ ...v, rules: Object.freeze([...v.rules]) })])));
export const VERBS = deep({
  'quest-done': { rules: ['quest-red'], label: 'Mark done', takesValue: false, marks: true },
  'confirm-balance': { rules: ['money-stale'], label: 'Confirm balance', takesValue: true, marks: true },
  commit: { rules: ['dirty', 'session-left-dirty'], label: 'Commit…', takesValue: false, marks: false },
  'open-folder': { rules: ['session-waiting'], label: 'Open its folder', takesValue: false, marks: false },
});
export const RULE_VERBS = Object.freeze(Object.fromEntries(
  [...new Set(Object.values(VERBS).flatMap((v) => v.rules))].map((r) => [r, Object.freeze(Object.keys(VERBS).filter((k) => VERBS[k].rules.includes(r)))]),
));

export const ACTED_TTL_MS = 24 * 3600e3;
export const KEY_MAX = 200;
const BALANCE_MAX_DIGITS = 12;   // a billion with cents; the money engine holds the exact bound (>= 1e9 refused)

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const nowMs = (n) => (n instanceof Date ? n.getTime() : typeof n === 'number' && Number.isFinite(n) ? n : 0);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const idStr = (x) => (typeof x === 'string' && x.length > 0 && x.length <= 200 ? x : null);

/** Every item the owner can see a row for: the top items and the "+N more" overflow. Standing items have no verb. */
export function visibleItems(brief) {
  return isObj(brief) ? arr(brief.items).concat(arr(brief.overflow)).filter(isObj) : [];
}
export function findItem(brief, key) {
  return visibleItems(brief).find((i) => i.key === key) || null;
}
/** Keys on the brief anywhere (items, overflow, standing) — what an acted marker is kept for. */
export function briefKeys(brief) {
  const out = new Set();
  if (!isObj(brief)) return out;
  for (const i of arr(brief.items).concat(arr(brief.overflow), arr(brief.standing))) if (isObj(i) && typeof i.key === 'string') out.add(i.key);
  return out;
}

export function checkBalance(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: 'type a balance as a number.' };
    if (value < 0) return { error: 'a balance cannot be negative.' };
    if (value >= 1e9) return { error: 'that balance is too large.' };
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t || t.length > 40) return { error: 'type the balance you see in the account.' };
    // digits and the usual separators only ("2 500", "1.200,00", "0,00"); a sign, a letter or an exponent is refused here
    if (!/^[0-9\s., ]+$/.test(t) || !/[0-9]/.test(t)) return { error: 'type a balance as a number.' };
    if (t.replace(/[^0-9]/g, '').length > BALANCE_MAX_DIGITS) return { error: 'that balance is too large.' };
    return { ok: true, value: t };
  }
  return { error: 'type the balance you see in the account.' };
}

// the one record whose rebuilt key equals `key`; 'ambiguous' when two records rebuild to the same string (never guess between them)
function resolve(list, build, key) {
  const hits = arr(list).filter((r) => { if (!isObj(r)) return false; try { return build(r) === key; } catch { return false; } });
  return hits.length === 1 ? hits[0] : hits.length ? 'ambiguous' : null;
}
const GONE = 'that item no longer matches anything live — wait for the next scan.';
const AMBIGUOUS = 'two live records share that item’s key — nothing was done.';

export function planAct(req, ctx) {
  const c = isObj(ctx) ? ctx : {};
  if (!isObj(req)) return { error: 'unknown action.' };
  const { key, verb, value } = req;
  if (typeof key !== 'string' || !key || key.length > KEY_MAX) return { error: 'unknown item.' };
  if (typeof verb !== 'string' || !own(VERBS, verb)) return { error: 'unknown action.' };
  const item = findItem(c.brief, key);
  if (!item) return { error: 'that item is not on the brief any more.' };
  const v = VERBS[verb];
  if (!v.rules.includes(item.rule)) return { error: 'that action is not offered for this item.' };
  // a repeated state-changing verb is refused while its marker is live (the row already says it is done)
  if (v.marks && isObj(c.acted) && isObj(c.acted[key])) {
    const at = msOf(c.acted[key].at);
    if (at !== null && nowMs(c.now) - at < ACTED_TTL_MS) return { error: 'already done — the row clears when the next scan confirms.' };
  }
  let balance;
  if (v.takesValue) {
    const b = checkBalance(value);
    if (b.error) return { error: b.error };
    balance = b.value;
  } else if (value !== undefined && value !== null) return { error: 'that action takes no value.' };

  const src = isObj(c.sources) ? c.sources : null;
  if (verb === 'commit') {
    // the project comes from the item's own action field, never from the key
    const a = item.action;
    const projectId = isObj(a) && a.kind === 'go' && a.tab === 'projects' ? idStr(a.projectId) : null;
    if (!projectId) return { error: 'this item does not name a project to commit.' };
    return { ok: true, rule: item.rule, item, plan: { kind: 'commit', projectId } };
  }
  if (!src) return { error: 'the live records could not be read — try again after the next scan.' };
  if (verb === 'quest-done') {
    const r = resolve(src.redQuests, (q) => KEYS.questRed(q.id), key);
    if (r === 'ambiguous') return { error: AMBIGUOUS };
    const id = r && idStr(r.id);
    return id ? { ok: true, rule: item.rule, item, plan: { kind: 'quest-done', id } } : { error: GONE };
  }
  if (verb === 'confirm-balance') {
    const r = resolve(src.staleAccounts, (a) => KEYS.moneyStale(a.id, a.anchorAt), key);
    if (r === 'ambiguous') return { error: AMBIGUOUS };
    const id = r && idStr(r.id);
    return id ? { ok: true, rule: item.rule, item, plan: { kind: 'confirm-balance', id, balance } } : { error: GONE };
  }
  // open-folder
  const r = resolve(src.waitingSessions, (s) => KEYS.sessionWaiting(s.id, s.lastAt), key);
  if (r === 'ambiguous') return { error: AMBIGUOUS };
  const sessionId = r && idStr(r.id);
  return sessionId ? { ok: true, rule: item.rule, item, plan: { kind: 'open-folder', sessionId } } : { error: GONE };
}

const liveEntry = (e, now) => {
  if (!isObj(e) || typeof e.verb !== 'string' || !own(VERBS, e.verb)) return null;
  const at = msOf(e.at);
  return at !== null && nowMs(now) - at < ACTED_TTL_MS ? { verb: e.verb, at: new Date(at).toISOString() } : null;
};

export function markActed(acted, key, verb, now) {
  const out = {};
  for (const [k, e] of Object.entries(isObj(acted) ? acted : {})) { const l = liveEntry(e, now); if (l) out[k] = l; }
  out[key] = { verb, at: new Date(nowMs(now)).toISOString() };
  return out;
}

export function prune(acted, brief, now) {
  const keys = briefKeys(brief), out = {};
  for (const [k, e] of Object.entries(isObj(acted) ? acted : {})) {
    if (!keys.has(k)) continue;
    const l = liveEntry(e, now);
    if (l) out[k] = l;
  }
  return out;
}

export function decorate(brief, acted, now) {
  if (!isObj(brief)) return brief;
  const map = isObj(acted) ? acted : {};
  const mark = (it) => {
    if (!isObj(it)) return it;
    const { acted: _drop, ...rest } = it;
    const l = typeof it.key === 'string' && own(map, it.key) ? liveEntry(map[it.key], now) : null;
    return l ? { ...rest, acted: l } : rest;
  };
  const out = { ...brief };
  for (const f of ['items', 'overflow', 'standing']) if (Array.isArray(brief[f])) out[f] = brief[f].map(mark);
  return out;
}
