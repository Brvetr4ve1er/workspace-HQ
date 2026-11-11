// The Brief's six Security rules (spec: the Security space, "the Brief gets counts-only senses"). PURE: no IO, no clock (ctx.now is passed in).
//
//   BRIEF_SECURITY_FNS = { 'plain-export-found': fn, 'vault-conflict': fn, 'accounts-breached': fn, 'passwords-reused': fn,
//                          'footprint-stale': fn, 'email-2fa-first': fn }     same contract as SESSION_WAITING_FN / SENSE_FNS:
//     brief-core.mjs Object.assigns it into RULE_FNS beside them, and lists the six ids in RULES (placeSecurityRules(RULES) is the placement).
//   securityInput(doc) -> the numbers-only reduction of data/security/status.json (or null): what brief-sources.js hands the Brief as
//     out.security, so the rules never see a field the status file might grow later.
//   SECURITY_WORDING   the six brief-project.mjs WORDING rows (counts only: nothing off the main window ever names a site).
//   SECURITY_STANDING_EXEMPT  the two ids that join STANDING_EXEMPT (a plain export or a sync conflict left on disk must not step
//     aside after 72 h, like 'secrets').
//
// ctx.security is data/security/status.json: { v, at, refreshedAt, breachCheckedAt, counts:{ weak, reused, breached, no2fa, old,
// notInVault, accounts, identities }, exportsFound, conflicts, email2faDone, walkthroughStarted }, numbers, booleans and timestamps ONLY.
// These rules read nothing else: not map.json, not owner.json, not a file name. WHAT IS KNOWN IS SAID, NO MORE:
//   * a file the scan found is a NAME MATCH (never opened), so the copy says "may be";
//   * 'breached' means a password was found in a public breach list, not that a site was hacked;
//   * 'footprint-stale' is silent until a refresh has happened once (refreshedAt is null before: nothing to be stale about).
// No file name, site name, host or account title can reach the text: none is read in this file.
//
// Keys are built here, not in brief-act-core.mjs KEYS (no verb acts on these rows, and that file is not this dish's): a key changes with
// the number it was raised for, so a dismissed row speaks again when the count moves, like 'secrets:<id>:<n>'.
const H = 3600e3, D = 24 * H;
export const STALE_MS = 30 * D;

export const SECURITY_RULES = Object.freeze(['plain-export-found', 'vault-conflict', 'accounts-breached', 'passwords-reused', 'footprint-stale', 'email-2fa-first']);
export const SECURITY_STANDING_EXEMPT = Object.freeze(['plain-export-found', 'vault-conflict']);
// where each rule sits in brief-core.mjs RULES (the loop is in RULES order, and within a severity RULES order breaks ties)
export const SECURITY_PLACEMENT = Object.freeze({
  after: Object.freeze({ secrets: Object.freeze(['plain-export-found', 'vault-conflict']), 'quest-red': Object.freeze(['accounts-breached']) }),
  before: Object.freeze({ 'claude-sync': Object.freeze(['passwords-reused', 'footprint-stale', 'email-2fa-first']) }),
});
/** base RULES (with or without the six) -> RULES with the six in their places. Idempotent: placeSecurityRules(placeSecurityRules(x)) equals the first. */
export function placeSecurityRules(base) {
  const out = [];
  for (const r of (Array.isArray(base) ? base : []).filter((id) => !SECURITY_RULES.includes(id))) {
    if (SECURITY_PLACEMENT.before[r]) out.push(...SECURITY_PLACEMENT.before[r]);
    out.push(r);
    if (SECURITY_PLACEMENT.after[r]) out.push(...SECURITY_PLACEMENT.after[r]);
  }
  return out;
}

// one row per rule id for brief-project.mjs WORDING; `{n}` is count + 1 where count is the item's "others" number
export const SECURITY_WORDING = Object.freeze({
  'plain-export-found': { one: 'A file that may be a plain password export is sitting in a folder', many: '{n} files that may be plain password exports are sitting in folders', short: 'a possible plain password export', shortMany: '{n} possible plain password exports' },
  'vault-conflict': { one: 'The password vault has a sync conflict copy', many: 'The password vault has {n} sync conflict copies', short: 'a vault sync conflict', shortMany: '{n} vault sync conflicts' },
  'accounts-breached': { one: 'A saved password appears in a public breach list', many: '{n} saved passwords appear in public breach lists', short: 'a password in a breach list', shortMany: '{n} passwords in breach lists' },
  'passwords-reused': { one: 'An account shares its password with another', many: '{n} accounts share a password with another account', short: 'a reused password', shortMany: '{n} accounts with a reused password' },
  'footprint-stale': { one: 'The Security map is out of date', short: 'the Security map is out of date' },
  'email-2fa-first': { one: 'Your main email still needs two-step sign-in', short: 'main email needs two-step sign-in' },
});

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const iso = (t) => { const ms = msOf(t); return ms === null ? null : new Date(ms).toISOString(); };
// a count: a whole number from 0 to 999 999; anything else (negative, fractional, text, NaN) is 0
const cnt = (x) => (typeof x === 'number' && Number.isInteger(x) && x > 0 && x < 1e6 ? x : 0);
const bool = (x) => (x === true ? true : x === false ? false : null);
const plural = (n, one, many) => (n === 1 ? one : many);

function ago(t, now) {
  const ms = msOf(t); if (ms === null) return 'age unknown';
  const d = Math.max(0, now - ms);
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < D ? Math.round(d / H) + ' h ago' : Math.floor(d / D) + ' d ago';
}

/** status.json -> { at, refreshedAt, breachCheckedAt, counts:{ breached, reused }, exportsFound, conflicts, email2faDone, walkthroughStarted } | null.
 *  Absent, unreadable or non-object input is null (silence). Counts may sit flat in `counts` or under `counts.flags`; anything
 *  else the file carries is dropped here. A missing `at` is simply an unknown age: it never makes an error. */
export function securityInput(doc) {
  if (!isObj(doc)) return null;
  const c = isObj(doc.counts) ? doc.counts : {};
  const f = isObj(c.flags) ? c.flags : {};
  const pick = (k) => cnt(c[k] !== undefined ? c[k] : f[k]);
  return {
    at: iso(doc.at), refreshedAt: iso(doc.refreshedAt), breachCheckedAt: iso(doc.breachCheckedAt),
    counts: { breached: pick('breached'), reused: pick('reused') },
    exportsFound: cnt(doc.exportsFound), conflicts: cnt(doc.conflicts),
    email2faDone: bool(doc.email2faDone), walkthroughStarted: bool(doc.walkthroughStarted),
  };
}

const GO_HEALTH = { kind: 'go', tab: 'security', sub: 'health' };
const sec = (ctx) => securityInput(ctx && ctx.security);
const nowOf = (ctx) => (ctx && typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : 0);

export const BRIEF_SECURITY_FNS = {
  'plain-export-found': (ctx) => {
    const s = sec(ctx); if (!s || s.exportsFound < 1) return null;
    const n = s.exportsFound;
    return {
      key: 'plain-export-found:' + n, severity: 'high',
      text: n === 1 ? 'A file that may be a plain password export is sitting in a folder' : n + ' files that may be plain password exports are sitting in folders',
      why: 'Only the file name matched, so this may be a guess (it is never opened). If it is an export, anyone who can read that folder can read every password in it: check it, then move it to the Recycle Bin.',
      source: 'security', age: 'security ' + ago(s.at, nowOf(ctx)), action: GO_HEALTH, others: n - 1,
    };
  },

  'vault-conflict': (ctx) => {
    const s = sec(ctx); if (!s || s.conflicts < 1) return null;
    const n = s.conflicts;
    return {
      key: 'vault-conflict:' + n, severity: 'high',
      text: n === 1 ? 'The password vault has a sync conflict copy' : 'The password vault has ' + n + ' sync conflict copies',
      why: 'Two devices changed the vault at once. Open both copies in KeePassXC and merge them (Database > Merge) before either is lost.',
      source: 'security', age: 'security ' + ago(s.at, nowOf(ctx)), action: GO_HEALTH, others: n - 1,
    };
  },

  'accounts-breached': (ctx) => {
    const s = sec(ctx); if (!s || s.counts.breached < 1) return null;
    const n = s.counts.breached;
    return {
      key: 'accounts-breached:' + n, severity: 'med',
      text: n === 1 ? 'A saved password appears in a public breach list' : n + ' saved passwords appear in public breach lists',
      why: 'It does not mean the site was hacked: the same password was seen in a leak somewhere. Change it, then refresh Security.',
      source: 'security', age: 'security ' + ago(s.at, nowOf(ctx)), action: GO_HEALTH, others: n - 1,
    };
  },

  'passwords-reused': (ctx) => {
    const s = sec(ctx); if (!s || s.counts.reused < 1) return null;
    const n = s.counts.reused;
    return {
      key: 'passwords-reused:' + n, severity: 'low',
      text: n === 1 ? 'An account shares its password with another' : n + ' accounts share a password with another account',
      why: 'One leak then opens every account that shares it. Give each its own password from KeePassXC.',
      source: 'security', age: 'security ' + ago(s.at, nowOf(ctx)), action: GO_HEALTH, others: n - 1,
    };
  },

  'footprint-stale': (ctx) => {
    const s = sec(ctx); if (!s) return null;
    const r = msOf(s.refreshedAt);
    if (r === null) return null;   // never refreshed: nothing to call out of date
    const now = nowOf(ctx);
    if (now - r <= STALE_MS) return null;
    const days = Math.floor((now - r) / D);
    return {
      key: 'footprint-stale:' + s.refreshedAt, severity: 'low',
      text: 'The Security map was last refreshed ' + days + ' ' + plural(days, 'day', 'days') + ' ago',
      why: 'New accounts and changed passwords are not counted until you press Refresh in Security.',
      source: 'security', age: 'security map ' + ago(s.refreshedAt, now), action: { kind: 'go', tab: 'security' }, others: 0,
    };
  },

  'email-2fa-first': (ctx) => {
    const s = sec(ctx); if (!s || s.walkthroughStarted !== true || s.email2faDone !== false) return null;
    return {
      key: 'email-2fa-first:main-email', severity: 'low',
      text: 'Your main email still needs two-step sign-in',
      why: 'Every other account recovers through your email, so it is the one to protect first (Security > Setup).',
      source: 'security', age: 'security ' + ago(s.at, nowOf(ctx)), action: { kind: 'go', tab: 'security', sub: 'setup' }, others: 0,
    };
  },
};
