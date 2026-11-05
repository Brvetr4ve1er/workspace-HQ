// Operator Brief engine (spec docs/superpowers/specs/2026-11-05-operator-design.md). PURE: no IO, no clock, no LLM —
// the same inputs and `now` always give the same brief, so it's explainable and works with every model down.
//
// computeBrief(inputs, { now, dismissed }) → { v:1, generatedAt, items:[≤ 3], more, errors }
//   inputs = { scan: latest.json, liveScan: {state, endedAt, code}, pc: pc-health.json, money: the money view,
//              moneyMeta: {lastExportAt}, hub: {webCount, lastSyncAt}, errors: [{source, error}] } — any may be null
//   an item = { key, rule, severity, text, why, source, age, action }; key = rule:subject:value, so a changed
//   value is a new key and a dismissal only holds while the fact it hid is unchanged.
// shouldToast(brief, state, now) → { toast: item | null, state } — P2's change-only toast decision.

export const RULES = ['scan-failed', 'secrets', 'money-late', 'pc-blood', 'quest-red', 'scan-stale', 'unpushed', 'money-stale', 'pc-ember', 'dirty', 'money-backup', 'claude-sync'];
export const SEV_RANK = { high: 0, med: 1, low: 2 };
const CAP = 3;
const H = 3600e3, D = 24 * H;
const SCAN_STALE_MS = 36 * H, DIRTY_MIN = 10, BACKUP_MS = 30 * D, SYNC_STALE_MS = 3 * D;
const QUIET_FROM = 23, QUIET_TO = 8, TOAST_EVERY_MS = 24 * H;

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
// owner-typed names reach the copy: one line, at most 60 code points (the template binds text only — this is about length)
const name = (s, fallback) => { const t = [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, 60).join('').trim(); return t || fallback; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const andMore = (n, what) => (n > 0 ? ' and ' + plural(n, 'more ' + what, 'more ' + what + 's') : '');
function ago(t, now) {
  const ms = msOf(t); if (ms === null) return 'age unknown';
  const d = Math.max(0, now - ms);
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < D ? Math.round(d / H) + ' h ago' : Math.floor(d / D) + ' d ago';
}
// the worst of several matches, and how many others matched
function worst(list, score) {
  const hits = list.filter((x) => score(x) > 0);
  if (!hits.length) return null;
  const top = hits.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { top, others: hits.length - 1 };
}
const goProject = (p) => ({ kind: 'go', tab: 'projects', projectId: String(p.id) });
const gitOf = (p) => (isObj(p) && isObj(p.metrics) && isObj(p.metrics.git_safety) ? p.metrics.git_safety : {});
const riskOf = (p) => (isObj(p) && isObj(p.metrics) && isObj(p.metrics.risk_security) ? p.metrics.risk_security : {});

// one function per rule, in RULES order: (ctx) → item fields | null
const RULE_FNS = {
  'scan-failed': ({ liveScan, now }) => (isObj(liveScan) && liveScan.state === 'failed'
    ? { key: 'scan-failed:' + (liveScan.endedAt || 'unknown'), severity: 'high', text: 'The last scan failed' + (liveScan.code != null ? ' (exit ' + liveScan.code + ')' : ''),
      why: 'Everything below may be out of date until a scan succeeds.', source: 'scan-run', age: 'scan run ' + ago(liveScan.endedAt, now), action: { kind: 'scan' } } : null),

  secrets: ({ projects, scanAge }) => {
    const w = worst(projects, (p) => num(riskOf(p).secrets_found)); if (!w) return null;
    const n = num(riskOf(w.top).secrets_found);
    return { key: 'secrets:' + w.top.id + ':' + n, severity: 'high', text: name(w.top.name, w.top.id) + ' has ' + plural(n, 'secret') + ' in plain sight' + andMore(w.others, 'project'),
      why: 'Anyone who can read the repo can read them — rotate, then remove.', source: 'scan', age: scanAge, action: goProject(w.top) };
  },

  'money-late': ({ money }) => {
    const late = arr(isObj(money) && money.obligations).filter((o) => isObj(o) && o.status === 'late');
    if (!late.length) return null;
    const o = late[0];
    return { key: 'money-late:' + o.id + ':' + (o.due || ''), severity: 'high', text: name(o.name, 'A bill') + ' is ' + (o.dueLabel || 'late') + andMore(late.length - 1, 'late bill'),
      why: 'It still counts against your breathing room until it is paid.', source: 'money', age: 'live', action: { kind: 'go', tab: 'money', sub: 'runway' } };
  },

  'pc-blood': ({ organs, pcAge }) => organRule(organs, 'blood', 'high', pcAge, 'PC health marks it critical.'),

  'quest-red': ({ quests, scanAge }) => {
    const red = quests.filter((q) => isObj(q) && q.tier === 'red' && q.status !== 'done');
    if (!red.length) return null;
    return { key: 'quest-red:' + red[0].id, severity: 'high', text: name(red[0].title, 'A critical quest') + andMore(red.length - 1, 'critical quest'),
      why: 'The scan marks it critical.', source: 'scan', age: scanAge, action: { kind: 'go', tab: 'tasks' } };
  },

  'scan-stale': ({ scanMs, scanDay, now }) => {
    if (scanMs === null || now - scanMs <= SCAN_STALE_MS) return null;
    const days = Math.floor((now - scanMs) / D);
    return { key: 'scan-stale:' + scanDay, severity: 'med', text: 'Scan data is ' + (days >= 1 ? plural(days, 'day') + ' old' : 'more than a day old'),
      why: 'Projects, quests and risks are as of ' + scanDay + '.', source: 'scan', age: 'scan ' + ago(new Date(scanMs).toISOString(), now), action: { kind: 'scan' } };
  },

  unpushed: ({ projects, scanAge }) => {
    const w = worst(projects, (p) => { const g = gitOf(p); return num(g.ahead) || (g.unpushed ? 1 : 0); }); if (!w) return null;
    const n = num(gitOf(w.top).ahead);
    return { key: 'unpushed:' + w.top.id + ':' + n, severity: 'med', text: name(w.top.name, w.top.id) + ' has ' + (n ? plural(n, 'commit') : 'work') + ' not pushed' + andMore(w.others, 'project'),
      why: 'Until it is pushed it lives on this disk only.', source: 'scan', age: scanAge, action: goProject(w.top) };
  },

  'money-stale': ({ money }) => {
    const stale = arr(isObj(money) && money.accounts).filter((a) => isObj(a) && a.stale === true);
    if (!stale.length) return null;
    const a = stale[0];
    return { key: 'money-stale:' + a.id + ':' + (a.anchorAt || ''), severity: 'med', text: 'Confirm ' + name(a.name, 'an account') + ' — last confirmed ' + (a.confirmed || 'a while ago') + andMore(stale.length - 1, 'account'),
      why: 'Breathing room uses an estimate until you do.', source: 'money', age: 'live', action: { kind: 'go', tab: 'money', sub: 'today' } };
  },

  'pc-ember': ({ organs, pcAge }) => organRule(organs, 'ember', 'med', pcAge, 'PC health flags it.'),

  dirty: ({ projects, scanAge }) => {
    const w = worst(projects, (p) => { const n = num(gitOf(p).dirty); return n >= DIRTY_MIN ? n : 0; }); if (!w) return null;
    const n = num(gitOf(w.top).dirty);
    return { key: 'dirty:' + w.top.id + ':' + n, severity: 'low', text: name(w.top.name, w.top.id) + ' has ' + n + ' uncommitted files' + andMore(w.others, 'project'),
      why: 'Commit or stash them before they grow.', source: 'scan', age: scanAge, action: goProject(w.top) };
  },

  'money-backup': ({ money, moneyMeta, now }) => {
    if (!isObj(money) || money.hasAccounts !== true) return null;
    const last = isObj(moneyMeta) ? msOf(moneyMeta.lastExportAt) : null;
    if (last !== null && now - last <= BACKUP_MS) return null;
    return { key: 'money-backup:' + (last === null ? 'never' : new Date(last).toISOString().slice(0, 10)), severity: 'low',
      text: last === null ? 'Money has never been exported' : 'Money has no backup in 30 days',
      why: 'It lives only on this PC — Export writes a copy you can keep.', source: 'money', age: last === null ? 'never exported' : 'exported ' + ago(new Date(last).toISOString(), now), action: { kind: 'go', tab: 'money', sub: 'today' } };
  },

  'claude-sync': ({ hub, now }) => {
    if (!isObj(hub) || typeof hub.webCount !== 'number') return null;   // the Hub didn't answer: can't tell, so say nothing
    const last = msOf(hub.lastSyncAt);
    if (hub.webCount > 0 && last !== null && now - last <= SYNC_STALE_MS) return null;
    if (hub.webCount > 0 && last === null) return null;   // chats are indexed but the time is unknown: no claim
    return { key: 'claude-sync:' + hub.webCount + ':' + (last === null ? 'never' : new Date(last).toISOString().slice(0, 10)), severity: 'low',
      text: "claude.ai chats aren't syncing",
      why: hub.webCount === 0 ? 'None are indexed yet — turn on Sync claude.ai in the browser extension.' : 'The last sync was ' + ago(hub.lastSyncAt, now) + '; keep a claude.ai tab open.',
      source: 'claude', age: last === null ? 'never synced' : 'synced ' + ago(hub.lastSyncAt, now), action: { kind: 'go', tab: 'claude', sub: 'chats' } };
  },
};

function organRule(organs, status, severity, pcAge, why) {
  const hit = organs.filter((o) => isObj(o) && o.status === status);
  if (!hit.length) return null;
  const o = hit[0];
  return { key: 'pc-' + status + ':' + o.id, severity, text: name(o.label, 'PC') + ': ' + name(o.diagnosis, 'needs a look') + andMore(hit.length - 1, 'issue'),
    why, source: 'pc-health', age: pcAge, action: { kind: 'go', tab: 'system', sub: 'machine' } };
}

export function computeBrief(inputs, opts) {
  const i = isObj(inputs) ? inputs : {};
  const o = isObj(opts) ? opts : {};
  const nowD = o.now instanceof Date ? o.now : new Date(0);
  const now = nowD.getTime();
  const dismissed = new Set(arr(o.dismissed).map(String));
  const scan = isObj(i.scan) ? i.scan : null;
  const scanMs = scan && isObj(scan.scan) ? msOf(scan.scan.date) : null;
  const ctx = {
    now, liveScan: i.liveScan, money: i.money, moneyMeta: i.moneyMeta, hub: i.hub,
    projects: arr(scan && scan.projects).filter(isObj), quests: arr(scan && scan.quests),
    organs: arr(isObj(i.pc) && i.pc.organs), scanMs, scanDay: scanMs === null ? '' : new Date(scanMs).toISOString().slice(0, 10),
    scanAge: scanMs === null ? 'scan age unknown' : 'scan ' + ago(new Date(scanMs).toISOString(), now),
    pcAge: isObj(i.pc) ? 'pc-health ' + ago(i.pc.scanned_at, now) : 'pc-health age unknown',
  };
  const all = [];
  for (const rule of RULES) {
    let it = null;
    try { it = RULE_FNS[rule](ctx); } catch { it = null; }   // a malformed input skips its rule, never the brief
    if (it && !dismissed.has(it.key)) all.push({ key: it.key, rule, severity: it.severity, text: it.text, why: it.why, source: it.source, age: it.age, action: it.action });
  }
  // stable: severity first, rule order within a severity (all[] is already in rule order)
  all.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const errors = arr(i.errors).filter((e) => isObj(e) && typeof e.source === 'string' && typeof e.error === 'string').map((e) => ({ source: e.source, error: e.error }));
  return { v: 1, generatedAt: nowD.toISOString(), items: all.slice(0, CAP), more: Math.max(0, all.length - CAP), errors };
}

export function shouldToast(brief, state, now) {
  const t = now instanceof Date ? now.getTime() : 0;
  const prev = isObj(state) && isObj(state.toasted) ? state.toasted : {};
  const toasted = {};
  for (const [k, v] of Object.entries(prev)) { const ms = msOf(v); if (ms !== null && t - ms < TOAST_EVERY_MS) toasted[k] = v; }
  const prevTop = isObj(state) && typeof state.lastTop === 'string' ? state.lastTop : null;
  const next = { dismissed: arr(isObj(state) && state.dismissed), toasted, lastTop: prevTop };
  const top = isObj(brief) ? arr(brief.items)[0] : null;
  const hour = now.getHours();
  // quiet hours: nothing, and nothing recorded — a high item that appears at 23:30 is still "new" at 08:00
  if (hour >= QUIET_FROM || hour < QUIET_TO) return { toast: null, state: next };
  next.lastTop = isObj(top) ? top.key : null;
  if (!isObj(top) || top.severity !== 'high') return { toast: null, state: next };
  // change-only: the same thing staying on top never re-toasts (no daily nag); a flapping pair toasts once each per 24 h
  if (top.key === prevTop || toasted[top.key]) return { toast: null, state: next };
  toasted[top.key] = now.toISOString();
  return { toast: top, state: next };
}
