// The Brief's screen-safe projection (spec: "the spine projection"). PURE: no IO, no clock — `now` is passed in.
//
// projectBrief(brief, { now, firstSeen }) → null | {
//   v:1, generatedAt, ageMinutes, stale, counts:{high,med,low},
//   items:[{ ref, rule, severity, sevWord, text, count, isNew, age, nav:{kind,tab,sub} }],
//   overflow:[{ ref, rule, severity, text, count, isNew }], overflowLine, more, errorSources:[source names] }
//
// This is the ONLY text the tray, the toolbar badge and any later phone door may show. It is built from an allowlist:
// wording comes from one fixed table keyed by rule id (never from the item's own text, which names projects, bills and
// quests), `ref` is a one-way hash of the item key, `nav` is {kind, tab, sub} (never a project id), and `why`, names,
// amounts, paths and ids never get in. `count` is the item's additive "and N more" number (0 when none): the wording
// reads "N repos" as count + 1.
import { createHash } from 'node:crypto';

export const STALE_MIN = 30;       // a brief older than this says so
export const NEW_MS = 24 * 3600e3; // "new" = first seen in the last 24 h
export const SEV_WORD = { high: 'urgent', med: 'soon', low: 'when you can' };
export const REF_LEN = 12;
const FALLBACK = 'Something needs you';

// one row per RULES id: text = the row wording, short = the phrase on the "+N more" line. `{n}` is count + 1 when count > 0.
// A row with no `many` reads the same whatever the count.
export const WORDING = {
  'scan-failed': { one: 'The last scan failed', short: 'the last scan failed' },
  secrets: { one: 'A project has secrets in plain sight', many: '{n} projects have secrets in plain sight', short: 'secrets in plain sight', shortMany: 'secrets in {n} projects' },
  'prod-deploy-error': { one: 'A production deploy failed', many: '{n} production deploys failed', short: 'a production deploy failed', shortMany: '{n} production deploys failed' },
  'money-late': { one: 'A bill is late', many: '{n} bills are late', short: 'a bill is late', shortMany: '{n} bills are late' },
  'pc-blood': { one: 'The PC reports something critical', many: 'The PC reports {n} critical things', short: 'the PC is critical', shortMany: '{n} critical PC issues' },
  'quest-red': { one: 'A critical quest is open', many: '{n} critical quests are open', short: 'a critical quest is open', shortMany: '{n} critical quests' },
  'scan-stale': { one: 'Scan data is out of date', short: 'scan data is out of date' },
  unpushed: { one: 'A project has work not pushed', many: '{n} projects have work not pushed', short: 'work not pushed', shortMany: 'work not pushed in {n} projects' },
  'ci-red': { one: 'CI is failing on a repo', many: 'CI is failing on {n} repos', short: 'CI failing on a repo', shortMany: 'CI failing on {n} repos' },
  'session-left-dirty': { one: 'A Claude session left uncommitted work', many: '{n} Claude sessions left uncommitted work', short: 'a session left uncommitted work', shortMany: '{n} sessions left uncommitted work' },
  'money-stale': { one: 'An account needs confirming', many: '{n} accounts need confirming', short: 'an account needs confirming', shortMany: '{n} accounts need confirming' },
  'pc-ember': { one: 'The PC flags something', many: 'The PC flags {n} things', short: 'the PC flags something', shortMany: 'the PC flags {n} things' },
  dirty: { one: 'A project has many uncommitted files', many: '{n} projects have many uncommitted files', short: 'many uncommitted files', shortMany: 'many uncommitted files in {n} projects' },
  'money-backup': { one: 'Money has no recent backup', short: 'no recent Money backup' },
  'review-waiting': { one: 'A pull request is waiting on you', many: '{n} pull requests are waiting on you', short: 'a pull request waiting', shortMany: '{n} pull requests waiting' },
  'reboot-pending': { one: 'This PC is waiting for a restart', short: 'a restart is pending' },
  'money-empty': { one: "Money isn't set up yet", short: 'Money is not set up yet' },
  'claude-sync': { one: "claude.ai chats aren't syncing", short: "claude.ai chats aren't syncing" },
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const nowMs = (n) => (n instanceof Date ? n.getTime() : typeof n === 'number' && Number.isFinite(n) ? n : 0);
const cnt = (c) => (typeof c === 'number' && Number.isInteger(c) && c > 0 && c < 1e6 ? c : 0);
const fill = (s, n) => s.replace('{n}', String(n));

export const refOf = (key) => createHash('sha256').update(String(key)).digest('hex').slice(0, REF_LEN);

function phrase(rule, count, short) {
  const w = own(WORDING, rule) ? WORDING[rule] : null;
  if (!w) return short ? 'something else' : FALLBACK;
  const c = cnt(count);
  if (short) return c > 0 && w.shortMany ? fill(w.shortMany, c + 1) : w.short;
  return c > 0 && w.many ? fill(w.many, c + 1) : w.one;
}

// the only values nav may carry: short lowercase tab / sub names from the app's own routes
const SEG = /^[a-z]{2,16}$/;
function navOf(action) {
  if (!isObj(action)) return { kind: null, tab: null, sub: null };
  if (action.kind === 'scan') return { kind: 'scan', tab: null, sub: null };
  if (action.kind === 'go') return { kind: 'go', tab: typeof action.tab === 'string' && SEG.test(action.tab) ? action.tab : null, sub: typeof action.sub === 'string' && SEG.test(action.sub) ? action.sub : null };
  return { kind: null, tab: null, sub: null };
}
const AGE = /^[A-Za-z0-9.\- ]{1,40}$/;   // 'github.json 3 h ago', 'scan 2 h ago', 'live' — never free text

export function projectBrief(brief, { now, firstSeen } = {}) {
  if (!isObj(brief)) return null;
  const t = nowMs(now);
  const seen = isObj(firstSeen) ? firstSeen : {};
  const isNew = (key) => { const f = isObj(seen[key]) ? msOf(seen[key].first) : null; return f !== null && t - f >= 0 && t - f < NEW_MS; };
  const live = (it) => isObj(it) && typeof it.key === 'string' && typeof it.rule === 'string' && own(SEV_WORD, it.severity);
  const items = arr(brief.items).filter(live).map((it) => ({
    ref: refOf(it.key), rule: own(WORDING, it.rule) ? it.rule : 'unknown', severity: it.severity, sevWord: SEV_WORD[it.severity],
    text: phrase(it.rule, it.count), count: cnt(it.count), isNew: isNew(it.key),
    age: typeof it.age === 'string' && AGE.test(it.age) ? it.age : '', nav: navOf(it.action),
  }));
  const overflow = arr(brief.overflow).filter(live).map((it) => ({
    ref: refOf(it.key), rule: own(WORDING, it.rule) ? it.rule : 'unknown', severity: it.severity,
    text: phrase(it.rule, it.count), count: cnt(it.count), isNew: isNew(it.key),
  }));
  const counts = { high: 0, med: 0, low: 0 };
  for (const it of items.concat(overflow)) counts[it.severity]++;
  const more = Math.max(0, Math.floor(Number(brief.more)) || 0, overflow.length);
  // "+4 more · CI failing on 4 repos · 2 pull requests waiting": at most two rule phrases, in ranked order, projection wording
  const phrases = arr(brief.overflow).filter(live).slice(0, 2).map((it) => phrase(it.rule, it.count, true));
  const overflowLine = more > 0 ? ['+' + more + ' more'].concat(phrases).join(' · ') : '';
  const gen = msOf(brief.generatedAt);
  const ageMinutes = gen === null ? null : Math.max(0, Math.floor((t - gen) / 60e3));
  const sources = [];
  for (const e of arr(brief.errors)) if (isObj(e) && typeof e.source === 'string' && /^[a-z0-9-]{1,24}$/.test(e.source) && !sources.includes(e.source)) sources.push(e.source);
  return { v: 1, generatedAt: gen === null ? null : new Date(gen).toISOString(), ageMinutes, stale: ageMinutes === null || ageMinutes > STALE_MIN, counts, items, overflow, overflowLine, more, errorSources: sources };
}
