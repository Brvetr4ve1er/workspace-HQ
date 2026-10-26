// window.DATA (real scans + sidecars) → the shapes the Claude Design screen was
// drawn against (hq-data.js: P0, T0, IDEAS, AUTOS, VITALS…). Pure functions,
// no DOM, so adapter.test.mjs runs them in Node on synthetic fixtures.
//
// Honesty rules carried over from the v3 brief (§6):
//  - measured vs estimated stays visible: completion %, build status and
//    "AI" side-quests keep their estimate flags; nothing is invented.
//  - an absent block (older scans have no browser/spellcraft) maps to empty,
//    never to placeholder values.
import { MON, MILESTONES, SCHOOL } from './catalog.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

export function fmtBytes(b) {
  b = num(b);
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  if (b >= 1e3) return Math.round(b / 1e3) + ' KB';
  return b + ' B';
}
// scan ids are local calendar days ("2026-10-03"); build the Date at local noon
// so DST and timezone offsets can never shift the label by a day
export function dayOf(id) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(id || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}
export const fmtD = (d) => (d ? MON[d.getMonth()] + ' ' + d.getDate() : '—');
// How old the live data is (data overhaul Front A2). The nightly scan should keep it under a day;
// two days or more means scans stopped landing. Estimates are older when enrichment was skipped.
export const STALE_DAYS = 2;
export function freshness(scanAt, enrichAge, now = Date.now()) {
  const t = Date.parse(scanAt || '');
  const days = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400e3)) : null;
  const est = Number.isInteger(enrichAge) && enrichAge > 0 ? enrichAge : 0;
  const plural = (n) => n + (n === 1 ? ' day' : ' days');
  return {
    days, stale: days != null && days >= STALE_DAYS, estAge: est,
    badge: days != null && days >= STALE_DAYS ? plural(days) + ' old' : '',
    note: [days == null ? 'No scan date in the data' : days === 0 ? 'Data from today’s scan' : 'Data from a scan ' + plural(days) + ' ago',
      est ? 'completion %, insights and roadmap are estimates from ' + plural(est) + ' before that scan' : ''].filter(Boolean).join(' · '),
  };
}
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

// ---- projects ----------------------------------------------------------------
// the last 4–5 digit number in a dev command is its port ("vite --port 5173",
// "python -m http.server 5500"); no number → unknown
export function devPort(cmd) {
  const m = String(cmd || '').match(/(?:^|[^\d])(\d{4,5})(?!.*\d{4,5})/);
  return m ? +m[1] : null;
}
// git_safety.flags are bare slugs; say them in words, unknown slugs fall back to the slug itself
// (collector/lib/git-risk.mjs + 'non-canonical-branch' from projects.mjs)
const GIT_FLAG = { 'no-git': 'Not under git', 'no-commits': 'No commits yet', 'no-remote': 'No remote, so nothing is backed up', 'many-dirty': 'Many uncommitted files', unpushed: 'Commits not pushed yet', 'non-canonical-branch': 'Not on the canonical branch', 'detached-head': 'Detached HEAD (not on a branch)' };
export function riskFlags(m) {
  m = obj(m);
  const sec = arr(obj(m.risk_security).flags).map(obj).filter((f) => f.type || f.detail).map((f) => ({ type: String(f.type || 'risk'), severity: String(f.severity || 'info'), detail: String(f.detail || ''), location: String(f.location || '') }));
  const git = arr(obj(m.git_safety).flags).filter((f) => typeof f === 'string' && f).map((f) => ({ type: f, severity: 'info', detail: GIT_FLAG[f] || f.replace(/[-_]/g, ' '), location: '' }));
  return sec.concat(git);
}
export function toProject(p) {
  p = obj(p);
  const m = obj(p.metrics), g = obj(m.git_safety), ch = obj(m.code_health), rs = obj(m.risk_security), t = obj(ch.tests), act = obj(p.activity);
  const hasGit = !!g.has_git;
  const secretFlag = arr(rs.flags).find((f) => /secret/i.test(String(f && f.type)));
  const id = String(p.id || ''), name = String(p.name || p.id || '');
  return {
    id, name, path: String(p.path || ''),
    stack: arr(p.stack).map(String),
    dirty: hasGit ? num(g.dirty) : null, ahead: num(g.ahead), behind: num(g.behind),
    secrets: num(rs.secrets_found), secretWhere: secretFlag ? String(secretFlag.location || secretFlag.detail || '') : '',
    hasGit, commits: num(g.commits), branch: hasGit ? String(g.branch || '—') : '—', canonical: String(p.canonical_branch || 'main'),
    remote: g.has_remote ? String(g.remote || 'origin') : 'none',
    lastCommit: g.last_commit_subject ? String(g.last_commit_subject) : null,
    tests: t.present ? (num(t.count) ? num(t.count) + ' test file' + (num(t.count) === 1 ? '' : 's') + ' (not run)' : 'present (not run)') : 'none',
    build: String(ch.build || 'unknown'), pct: num(obj(p.completion).pct), pctBasis: String(obj(p.completion).basis || ''),
    activity: ['active', 'stale', 'dormant'].includes(act.state) ? act.state : 'dormant',
    lastDays: typeof act.days_since_commit === 'number' ? act.days_since_commit : null,
    loc: num(ch.loc), files: num(ch.files), todo: num(ch.todo_fixme),
    dev: p.dev_cmd ? String(p.dev_cmd) : null, port: devPort(p.dev_cmd),
    recent: arr(ch.recent_files).map((f) => String(f)),
    level: num(p.level, 1), pxp: num(p.xp),
    reclaim: num(obj(p.disk).reclaimable_bytes), fatDirs: arr(obj(p.disk).fat_dirs).map((d) => String(obj(d).name || d)),
    insights: arr(p.insights).map((i) => ({ text: String(obj(i).text || ''), severity: String(obj(i).severity || 'info') })).filter((i) => i.text),
    roadmap: arr(p.roadmap).map((r) => ({ milestone: String(obj(r).milestone || ''), status: String(obj(r).status || ''), pct: num(obj(r).progress_pct, null), items: arr(obj(r).items).map(String) })).filter((r) => r.milestone),
    // scan suggestions (kind is optional in the schema: '' = uncategorised)
    suggestions: arr(p.suggestions).map(obj).filter((s) => s.text).map((s) => ({ kind: String(s.kind || ''), text: String(s.text), effort: String(s.effort || '?'), impact: String(s.impact || '?') })),
    // every security flag (not just the first secret) + git hygiene flags as 'info'
    riskFlags: riskFlags(m),
    // this project's own side quests; done/dismissed drop out exactly like the global
    // IDEAS feed (toIdea carries no done flag, so a finished one would read as open)
    sideQuests: arr(p.side_quests).filter((s) => !obj(s).done && !obj(s).dismissed).map((s) => toIdea({ ...obj(s), project_id: obj(s).project_id || id, project_name: obj(s).project_name || name })),
    // titles of the side quests already done or dismissed: the project page uses them
    // so a scan suggestion the collector copied into one doesn't come back as new
    closedSideQuests: arr(p.side_quests).filter((s) => obj(s).done || obj(s).dismissed).map((s) => String(obj(s).title || '')).filter(Boolean),
    gitRisk: ['low', 'medium', 'high'].includes(g.risk) ? g.risk : null,
    // the scan's file checks (has_tests, has_ci, has_readme, has_license…); only an
    // explicit false is a gap — a missing key means the scanner didn't determine it
    signals: signalsOf(p.signals),
  };
}
function signalsOf(s) {
  const out = {};
  for (const [k, v] of Object.entries(obj(s))) if (v === null || ['boolean', 'number', 'string'].includes(typeof v)) out[k] = v;
  return out;
}
// The "missing basics" the project page offers to add to the Ideas feed (v3's
// agencyProposals): one row per signal that is explicitly false, in this order.
// `quest` is the id suffix of the collector's own side quest for the same gap
// (projects.mjs: sq-<project>-readme…), `text` is v3's capture text.
export const GAPS = [
  { flag: 'has_tests', label: 'No tests', capture: 'add a test suite', quest: 'tests' },
  { flag: 'has_ci', label: 'No CI', capture: 'set up CI', quest: 'ci' },
  { flag: 'has_readme', label: 'No README', capture: 'write a README', quest: 'readme' },
  { flag: 'has_license', label: 'No license', capture: 'add a LICENSE', quest: 'license' },
];
export function gapsOf(p) {
  p = obj(p);
  const sig = obj(p.signals), name = String(p.name || p.id || '');
  return GAPS.filter((g) => sig[g.flag] === false).map((g) => ({ flag: g.flag, label: g.label, text: name + ': ' + g.capture, quest: 'sq-' + String(p.id || '') + '-' + g.quest }));
}

// ---- tasks & ideas -------------------------------------------------------------
export function toTask(q) {
  q = obj(q);
  const id = String(q.id || '');
  return {
    id, tier: ['red', 'orange', 'yellow'].includes(q.tier) ? q.tier : 'yellow', title: String(q.title || id),
    why: String(q.insight || ''), proj: q.project_id ? String(q.project_id) : null,
    age: num(q.age_days), xp: num(q.xp), commitTask: /-(commit|commit-dirty|dirty)$/.test(id),
    inProgress: q.status === 'in_progress',
  };
}
// a quest is still on the board while open or in progress (schema status enum)
const OPEN = new Set(['open', 'in_progress']);
export function toIdea(s, projects) {
  s = obj(s);
  const proj = s.project_id ? String(s.project_id) : null;
  return {
    id: String(s.id || ''), kind: ['risk', 'urgent', 'idea', 'polish'].includes(s.kind) ? s.kind : 'idea',
    title: String(s.title || ''), detail: String(s.detail || ''), proj,
    projName: String(s.project_name || (arr(projects).find((p) => p.id === proj) || {}).name || 'Inbox'),
    ai: s.source === 'llm', capture: s.source === 'capture',
    effort: String(s.effort || '?'), impact: String(s.impact || '?'),
    purge: num(s.reclaim_bytes) > 0 ? fmtBytes(s.reclaim_bytes) : null,
    fatDirs: arr(s.fat_dirs).map((d) => String(obj(d).name || d)),
  };
}

// ---- milestones ------------------------------------------------------------------
export function toMilestones(achievements) {
  const byId = new Map(arr(achievements).map((a) => [obj(a).id, obj(a)]));
  return MILESTONES.map((m) => {
    const a = byId.get(m.id) || {}, pr = obj(a.progress);
    return { ...m, unlocked: !!a.unlocked, on: a.unlocked_on || null, have: pr.need ? num(pr.have) : undefined, need: pr.need ? num(pr.need) : undefined };
  });
}

// ---- what changed ------------------------------------------------------------------
const CHANGE = {
  quest_completed: ['✓', 'var(--green)'], git_pushed: ['⇧', 'var(--green)'], first_remote: ['⇧', 'var(--green)'],
  new_project: ['＋', 'var(--blue)'], level_up: ['⭐', 'var(--accent-text)'], new_achievement: ['★', 'var(--accent-text)'],
  spell_learned: ['▶', 'var(--blue)'], spell_mastery_up: ['▶', 'var(--accent-text)'], spell_of_day_cast: ['▶', 'var(--accent-text)'], spellcraft_xp: ['▶', 'var(--accent-text)'],
};
export function toChange(c) {
  c = obj(c);
  const [g, col] = CHANGE[c.type] || (c.type === 'build_flip' ? [c.impact === 'negative' ? '✗' : '✓', c.impact === 'negative' ? 'var(--red)' : 'var(--green)'] : c.impact === 'negative' ? ['！', 'var(--orange)'] : c.impact === 'positive' ? ['✓', 'var(--green)'] : ['·', 'var(--muted)']);
  const text = c.detail || (c.type === 'level_up' ? 'Level ' + c.level + (c.title ? ' · ' + c.title : '') : c.type === 'new_achievement' ? 'Milestone · ' + (c.name || c.achievement_id) : String(c.type || 'change').replace(/_/g, ' '));
  return { g, t: String(text), c: col, proj: c.project_id ? String(c.project_id) : null, type: String(c.type || '') };
}

// ---- one snapshot -----------------------------------------------------------------
export function snapshot(scan) {
  scan = obj(scan);
  const P0 = arr(scan.projects).map(toProject);
  const archived = arr(scan.archived_projects).map((p) => ({ ...toProject(p), archivedOn: obj(p).archived_on || null }));
  const all = P0.concat(archived);
  const acct = obj(scan.account);
  return {
    id: String(obj(scan.scan).id || ''), day: dayOf(obj(scan.scan).id), at: obj(scan.scan).date || null,
    // days the soft fields (completion %, insights, roadmap) were carried forward from the last enrichment; null = unknown
    enrichAge: Number.isInteger(obj(scan.scan).enrichment_age_days) && obj(scan.scan).enrichment_age_days >= 0 ? obj(scan.scan).enrichment_age_days : null,
    P0, archived,
    T0: arr(scan.quests).filter((q) => OPEN.has(obj(q).status)).map(toTask),
    doneTasks: arr(scan.quests).filter((q) => obj(q).status === 'done').map((q) => ({ ...toTask(q), completed: obj(q).completed || null })),
    IDEAS: arr(scan.side_quests).filter((s) => !obj(s).done && !obj(s).dismissed).map((s) => toIdea(s, all)),
    ACH: toMilestones(scan.achievements),
    changes: arr(scan.changes_since_prev).map(toChange),
    account: { level: num(acct.level, 1), title: String(acct.title || ''), xp: num(acct.xp), health: num(acct.health_index), streak: num(obj(acct.streak).scan_days), top3: arr(acct.daily_top3) },
    browser: scan.browser ? obj(scan.browser) : null,
    inventory: obj(scan.inventory),
    learnings: arr(scan.recent_learnings).map((l) => ({ text: String(obj(l).text || ''), proj: obj(l).project_id || null, at: obj(l).ts || null })).filter((l) => l.text),
  };
}

// metric value for one snapshot; `prev` lets "commits" be a per-scan delta
export function metric(snap, name, prev) {
  const sum = (f) => snap.P0.reduce((a, p) => a + (f(p) || 0), 0);
  if (name === 'unc') return sum((p) => p.dirty);
  if (name === 'tasks') return snap.T0.length;
  if (name === 'xp') return snap.account.xp;
  if (name === 'secrets') return sum((p) => p.secrets);
  if (name === 'commits') {
    if (!prev) return 0;
    const before = new Map(prev.P0.map((p) => [p.id, p.commits]));
    return snap.P0.reduce((a, p) => a + (before.has(p.id) ? Math.max(0, p.commits - before.get(p.id)) : 0), 0);
  }
  return 0;
}

// ---- History › Timeline: changes grouped by Monday-start week, newest first ------
export function weeks(snaps, limit = 8) {
  const out = [];
  for (const s of snaps) {
    if (!s.day) continue;
    const mon = new Date(s.day); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const key = mon.toDateString();
    let w = out.find((x) => x.key === key);
    if (!w) { w = { key, start: mon, ev: [], quiet: 0, xp0: s.account.xp, xp1: s.account.xp, tasks: 0, miles: 0 }; out.push(w); }
    w.xp0 = Math.min(w.xp0, s.account.xp); w.xp1 = Math.max(w.xp1, s.account.xp);
    if (!s.changes.length) w.quiet++;
    for (const c of s.changes) {
      w.ev.push([c.g, c.t, fmtD(s.day), c.proj, c.c]);
      if (c.type === 'quest_completed') w.tasks++;
      if (c.type === 'new_achievement') w.miles++;
    }
  }
  return out.sort((a, b) => b.start - a.start).slice(0, limit).map((w) => {
    const end = new Date(w.start); end.setDate(end.getDate() + 6);
    const label = w.start.getMonth() === end.getMonth() ? fmtD(w.start) + ' – ' + end.getDate() : fmtD(w.start) + ' – ' + fmtD(end);
    const bits = ['+' + (w.xp1 - w.xp0) + ' xp', w.tasks + ' task' + (w.tasks === 1 ? '' : 's')];
    if (w.miles) bits.push(w.miles + ' milestone' + (w.miles === 1 ? '' : 's'));
    return { w: label, stats: bits.join(' · '), ev: w.ev.reverse().slice(0, 12), quiet: w.quiet };
  });
}

// ---- Automations (spellbook + telemetry) ----------------------------------------------
const RUNNABLE = new Set(['castable', 'chain']);
const SOURCE_ORDER = ['grimoire', 'script', 'npm', 'task'];
// A failed cast's exit code as people read it. Main records null for a timeout and for a
// chain (its member's cast carries the code), and older telemetry has none at all: that
// reads "exit code unknown", never "exit ?" / "exit null" / "exit undefined". The store's
// live casts (store.js onCastDone) use it too.
export const exitLabel = (code) => (typeof code === 'number' && Number.isFinite(code) ? 'exit ' + code : 'exit code unknown');
const bySourceThenName = (a, b) => (SOURCE_ORDER.indexOf(a.source) + 9) % 9 - (SOURCE_ORDER.indexOf(b.source) + 9) % 9 || a.name.localeCompare(b.name);
export function automations(spellbook, telemetry, now = Date.now()) {
  const sb = obj(spellbook), tel = obj(telemetry), spells = arr(sb.spells);
  const lastCast = new Map();
  for (const c of arr(tel.casts)) { const k = obj(c).spell_id; if (k) lastCast.set(k, c); }   // casts are oldest → newest
  const favs = new Set(arr(tel.favorites));
  const AUTOS = spells.filter((s) => RUNNABLE.has(obj(s).kind) && !obj(s).invalid).map((s) => {
    const c = lastCast.get(s.id), chain = arr(s.chain);
    return {
      id: String(s.id), icon: String(s.icon || '▶'), name: String(s.name || s.id), source: String(s.source || ''),
      kind: s.kind === 'chain' ? 'chain' : String(s.source || 'script'), mode: 'bg',
      cmd: [s.command].concat(arr(s.args)).filter(Boolean).join(' '), dir: String(s.cwd || ''),
      last: c ? { ok: c.outcome === 'resolved', ago: ago(Date.parse(c.started_at), now), err: c.outcome === 'resolved' ? '' : exitLabel(c.exit_code) } : null,
      desc: String(s.description || ''), cat: SCHOOL[s.school] || 'Other',
      steps: chain.length ? chain.map((x) => String(obj(x).name || obj(x).id || x)) : undefined,
      destructive: !!s.confirm, hash: String(s.content_hash || ''), favorite: favs.has(s.id),
    };
  }).sort(bySourceThenName);
  // channeled spells (Claude skills/commands/agents, npm dev/start/serve) open an
  // interactive terminal instead of running in the background — a separate list
  // so AUTOS (and every screen built on it) stays exactly as it was. A channeled
  // cast is logged with outcome 'channeled': the terminal opened, and no exit code
  // ever comes back, so `last.opened` says that and nothing claims it finished
  // (rendered "↗ terminal …", like the quick-run palette's cast.js lastRun()).
  const INTERACTIVE = spells.filter((s) => obj(s).kind === 'channeled' && !obj(s).invalid).map((s) => {
    const c = lastCast.get(s.id), failed = c && c.outcome === 'fizzled';
    return {
      id: String(s.id), icon: String(s.icon || '›_'), name: String(s.name || s.id), source: String(s.source || ''),
      kind: 'interactive', mode: 'terminal',
      cmd: [s.command].concat(arr(s.args)).filter(Boolean).join(' '), dir: String(s.cwd || ''),
      last: c ? { ok: !failed, opened: c.outcome === 'channeled', ago: ago(Date.parse(c.started_at), now), err: failed ? exitLabel(c.exit_code) : '' } : null,
      desc: String(s.description || ''), cat: SCHOOL[s.school] || 'Other', hash: String(s.content_hash || ''),
    };
  }).sort(bySourceThenName);
  const bySource = {};
  for (const r of AUTOS) (bySource[r.source] = bySource[r.source] || { runnable: 0, interactive: 0 }).runnable++;
  for (const r of INTERACTIVE) (bySource[r.source] = bySource[r.source] || { runnable: 0, interactive: 0 }).interactive++;
  const autoCounts = { runnable: AUTOS.length, interactive: INTERACTIVE.length, bySource };
  const counts = obj(obj(sb.counts).by_source);
  const runnableBy = {}; for (const s of spells) if (RUNNABLE.has(obj(s).kind) && !obj(s).invalid) runnableBy[s.source] = (runnableBy[s.source] || 0) + 1;
  const LIB = [['Claude skills', 'skill'], ['Claude commands', 'command'], ['Plugins', 'plugin'], ['Scheduled tasks', 'task'], ['npm scripts', 'npm'], ['Scripts', 'script'], ['WorkspaceHQ', 'grimoire']];
  const LIBRARY = LIB.map(([label, k]) => [label, num(counts[k]), runnableBy[k] || 0]).filter((r) => r[1] > 0);
  const familiars = num(obj(sb.counts).familiars);
  if (familiars) LIBRARY.push(['MCP servers', familiars, 0]);
  const SCHEDULED = spells.filter((s) => obj(s).schedule).map((s) => {
    const sc = obj(s.schedule), ok = sc.last_result === '0' || sc.last_result === 0;
    return { name: String(s.name), when: String(sc.state || 'scheduled'), next: sc.next_run ? String(sc.next_run) : '—', last: sc.last_run ? String(sc.last_run) + (sc.last_result == null ? '' : ok ? ' · ok' : ' · code ' + sc.last_result) : 'never' };
  });
  const total = num(obj(sb.counts).total, spells.length);
  const RUNS = arr(tel.casts).slice(-12).reverse().map((c) => {
    const s = spells.find((x) => x.id === c.spell_id);
    // "<duration> · exit <code>", either part left out when unknown (never a dangling " · ")
    const meta = [c.outcome === 'channeled' ? 'Opened in a terminal' : c.duration_ms != null ? Math.round(c.duration_ms / 1000) + 's' : '', c.outcome === 'fizzled' ? exitLabel(c.exit_code) : ''].filter(Boolean).join(' · ');
    return { id: String(c.cast_id), name: s ? String(s.name) : String(c.spell_id), kind: 'auto', status: c.outcome === 'resolved' ? 'ok' : c.outcome === 'channeled' ? 'opened' : 'failed', meta, started: fmtD(new Date(Date.parse(c.started_at))), out: [] };
  });
  return { AUTOS, INTERACTIVE, counts: autoCounts, LIBRARY, SCHEDULED, RUNS, total };
}

// ---- System (pc-health sidecar + inventory) -------------------------------------------------
const ORGAN = { grace: 'ok', ember: 'warn', blood: 'bad' };
export function machine(pcHealth) {
  // junk entries are skipped, not fatal: ISSUES/VITALS are store getters read on every render, and a
  // refreshMachine() payload with a null organ must not fail every render after it
  const ph = obj(pcHealth), organs = arr(ph.organs).filter((o) => o && typeof o === 'object');
  const VITALS = organs.map((o) => [String(o.label || o.id), o.value == null ? '—' : String(o.value) + (o.unit ? ' ' + o.unit : ''), ORGAN[o.status] || 'off']);
  const ISSUES = organs.filter((o) => o.status === 'ember' || o.status === 'blood').map((o) => {
    const f = obj(arr(o.fixes)[0]);
    return { id: 'organ-' + o.id, sev: o.status === 'blood' ? 'red' : 'orange', title: String(o.diagnosis || o.label), why: String(o.teaching || ''), fix: String(f.title || 'No automatic fix'), cmd: String(f.command || ''), safe: f.danger === 'safe' };
  });
  return { VITALS, ISSUES, scannedAt: ph.scanned_at || null, host: obj(ph.host), DETAIL: machineDetail(ph) };
}

// System › Machine panels from the pc-health `detail` + `trends` blocks (collector/lib/pc-health.mjs).
// Pure and defensive: an older sidecar without them yields empty panels, which the screen hides.
const fnum = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const gbOf = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB');
// bar width as a % of the biggest row, never below a visible sliver
const bars = (rows, key) => { const max = Math.max(0, ...rows.map((r) => r[key])); return rows.map((r) => ({ ...r, w: max > 0 ? Math.max(2, Math.round((r[key] / max) * 100)) + '%' : '0%' })); };
export function machineDetail(pcHealth) {
  const ph = obj(pcHealth), d = obj(ph.detail);
  const ram = bars(arr(d.topRam).map(obj).filter((p) => p.name && fnum(p.mb) != null)
    .map((p) => ({ name: String(p.name), val: gbOf(p.mb), sub: num(p.count, 1) > 1 ? num(p.count, 1) + ' processes' : '1 process', n: p.mb })), 'n');
  const cpu = bars(arr(d.topCpu).map(obj).filter((p) => p.name && fnum(p.pct) != null && p.pct > 0)
    .map((p) => ({ name: String(p.name), val: p.pct + '%', sub: 'of the whole CPU', n: p.pct })), 'n');
  const hog = obj(d.hogs);
  const disk = bars(arr(hog.items).map(obj).filter((h) => h.path && fnum(h.gb) != null)
    .map((h) => ({ name: String(h.label || h.path), path: String(h.path), val: h.gb + ' GB', n: h.gb })), 'n');
  const gpus = arr(d.gpus).map(obj).filter((g) => g.name).map((g, i) => ({
    name: String(g.name), val: fnum(g.vramGB) != null ? g.vramGB + ' GB' : '—',
    sub: ['VRAM' + (g.vramSource === 'wmi' ? ' (Windows’ 4 GB-capped figure)' : ''), g.driverDate ? 'driver ' + g.driverDate + (fnum(g.driverDays) != null ? ' · ' + g.driverDays + ' days old' : '') : ''].filter(Boolean).join(' · '),
    first: i === 0,
  }));
  const L = obj(d.gpuLive), live = [];
  if (fnum(L.tempC) != null) live.push({ k: 'Temp', v: L.tempC + ' °C', warn: L.tempC >= 85 });
  if (fnum(L.loadPct) != null) live.push({ k: 'Load', v: L.loadPct + '%', warn: false });
  if (fnum(L.memTotalMB) != null) live.push({ k: 'VRAM in use', v: gbOf(num(L.memUsedMB)) + ' of ' + gbOf(L.memTotalMB), warn: false });
  if (fnum(L.powerW) != null) live.push({ k: 'Power', v: Math.round(L.powerW * 10) / 10 + ' W' + (fnum(L.powerLimitW) != null ? ' of ' + Math.round(L.powerLimitW) + ' W' : ''), warn: false });
  if (fnum(L.clockMHz) != null) live.push({ k: 'Clock', v: L.clockMHz + ' MHz', warn: false });
  if (L.pstate) live.push({ k: 'State', v: String(L.pstate) + (String(L.pstate) === 'P8' ? ' (idle)' : String(L.pstate) === 'P0' ? ' (full power)' : ''), warn: false });
  const facts = [];
  const bat = obj(d.battery);
  if (fnum(bat.pct) != null) facts.push({ k: 'Battery', v: bat.pct + '% · ' + (bat.plugged ? 'plugged in' : 'on battery' + (fnum(bat.runtimeMin) ? ' · ~' + (bat.runtimeMin >= 60 ? Math.floor(bat.runtimeMin / 60) + ' h ' : '') + (bat.runtimeMin % 60) + ' min left' : '')), warn: !bat.plugged && bat.pct <= 20 });
  if (obj(d.power).plan) facts.push({ k: 'Power plan', v: String(d.power.plan), warn: false });
  for (const s of arr(d.displays).map(obj)) if (fnum(s.width) && fnum(s.height)) facts.push({ k: 'Display', v: s.width + '×' + s.height + (fnum(s.hz) ? ' · ' + s.hz + ' Hz' : ''), warn: false });
  const net = obj(d.network);
  if (net.adapter || fnum(net.linkMbps) != null) facts.push({ k: 'Network', v: (net.wireless ? 'Wi-Fi' : 'Wired') + (fnum(net.linkMbps) != null ? ' · ' + net.linkMbps + ' Mbps link' : ''), warn: false });
  if (fnum(d.uptimeHrs) != null) facts.push({ k: 'Up for', v: d.uptimeHrs >= 48 ? Math.round(d.uptimeHrs / 24) + ' days' : Math.round(d.uptimeHrs) + ' h', warn: d.uptimeHrs >= 24 * 14 });
  if (d.rebootPending === true) facts.push({ k: 'Restart', v: 'pending — finishes an update', warn: true });
  const storage = arr(d.storage).map(obj).filter((s) => s.name).map((s) => ({
    name: String(s.name), sub: [s.media, s.bus, fnum(s.sizeGB) != null ? s.sizeGB + ' GB' : ''].filter(Boolean).join(' · '),
    health: String(s.health || 'Unknown'), ok: String(s.health) === 'Healthy',
  }));
  const trends = arr(ph.trends).map(obj).filter((t) => t.text).map((t) => ({ text: String(t.text), arrow: t.dir === 'down' ? '↓' : t.dir === 'up' ? '↑' : '→', bad: !!t.bad }));
  const startup = arr(d.startupApps).map(String).filter(Boolean);
  return {
    ram, cpu, disk, diskAt: hog.at || null, diskPartial: !!hog.partial, recycleGB: fnum(d.recycleGB),
    gpus, live, facts, storage, trends, startup, unreadable: arr(d.unreadable).map(String),
  };
}
// One row per clutter item, labelled the way v3 named them (derive.mjs anomalies):
// a clone by its name, a duplicate by its detail, an empty folder by itself, a
// trivial folder by its name (+ the scanner's note). Unlabelled entries drop.
const itemLabel = (x, ...keys) => (typeof x === 'string' ? x : String(keys.map((k) => obj(x)[k]).find((v) => typeof v === 'string' && v.trim()) || '')).trim();
function clutterRows(group, items, keys, noteOf) {
  return items.map((x, i) => ({ id: group + ':' + i, label: itemLabel(x, ...keys), note: noteOf ? noteOf(obj(x)) : '' })).filter((r) => r.label);
}
// facts the collector gathered about a folder it does not score, as one short line
function folderNote(f) {
  const bits = [String(f.kind || 'other')];
  if (arr(f.stack).length) bits.push(arr(f.stack).join('+'));
  if (f.has_git) bits.push('git' + (num(f.dirty) ? ' · ' + num(f.dirty) + ' dirty' : '') + (f.unpushed ? ' · unpushed' : '') + (f.remote ? '' : ' · no remote'));
  bits.push(num(f.files) + ' files');
  if (f.days_since_modified != null) bits.push(f.days_since_modified + 'd ago');
  return bits.join(' · ');
}
export function clutter(inventory) {
  const inv = obj(inventory), out = [];
  const dup = arr(inv.duplicates), empty = arr(inv.empty), clones = arr(inv.clones), triv = arr(inv.trivial);
  if (dup.length) out.push({ id: 'dup', title: 'Duplicate folders', detail: dup.slice(0, 3).map((d) => String(obj(d).detail || d)).join(' · ') + (dup.length > 3 ? ' · +' + (dup.length - 3) + ' more' : ''), verb: 'Review', danger: false, items: dup, rows: clutterRows('dup', dup, ['detail', 'name']) });
  if (empty.length) out.push({ id: 'empty', title: 'Empty folders', detail: empty.length + ' empty folder' + (empty.length === 1 ? '' : 's') + ' · ' + empty.slice(0, 3).map((e) => itemLabel(e, 'name') || '?').join(', '), verb: 'Review', danger: false, items: empty, rows: clutterRows('empty', empty, ['name']) });
  if (clones.length) out.push({ id: 'clones', title: 'Reference clones', detail: clones.length + ' third-party repos · ' + clones.filter((c) => obj(c).diverged).length + ' diverged', verb: 'Review', danger: false, items: clones, rows: clutterRows('clones', clones, ['name', 'origin'], (c) => (c.diverged ? 'diverged from upstream' : '')) });
  if (triv.length) out.push({ id: 'trivial', title: 'Trivial folders', detail: triv.length + ' folder' + (triv.length === 1 ? '' : 's') + ' with almost nothing in them', verb: 'Review', danger: false, items: triv, rows: clutterRows('trivial', triv, ['name'], (t) => (typeof t.note === 'string' ? t.note : '')) });
  // "see everything" groups (collector discovery): folders the scan does not score, plus anything
  // that needs a human eye. Listed with facts so a fix can be aimed at the right project.
  const anom = arr(inv.anomalies), unc = arr(inv.unclassified), ign = arr(inv.ignored), loose = arr(inv.loose_files);
  if (anom.length) out.push({ id: 'anomalies', title: 'Needs a look', detail: anom.slice(0, 2).map((a) => String(obj(a).detail || '')).filter(Boolean).join(' · ') + (anom.length > 2 ? ' · +' + (anom.length - 2) + ' more' : ''), verb: 'Review', danger: false, items: anom, rows: clutterRows('anomalies', anom, ['detail']) });
  if (unc.length) out.push({ id: 'unclassified', title: 'Untracked folders', detail: unc.length + ' folder' + (unc.length === 1 ? '' : 's') + ' in Documents the scan does not score · ' + unc.filter((u) => obj(u).kind === 'project-like').length + ' look like projects', verb: 'Review', danger: false, items: unc, rows: clutterRows('unclassified', unc, ['name'], folderNote) });
  if (ign.length) out.push({ id: 'ignored', title: 'Ignored folders', detail: ign.length + ' folder' + (ign.length === 1 ? '' : 's') + ' the scan config skips · ' + ign.slice(0, 3).map((i) => itemLabel(i, 'name')).join(', '), verb: 'Review', danger: false, items: ign, rows: clutterRows('ignored', ign, ['name'], folderNote) });
  if (loose.length) out.push({ id: 'loose', title: 'Loose files in Documents', detail: loose.length + ' file' + (loose.length === 1 ? '' : 's') + ' · ' + fmtBytes(loose.reduce((a, l) => a + num(obj(l).bytes), 0)) + ' total', verb: 'Review', danger: false, items: loose, rows: clutterRows('loose', loose, ['name'], (l) => fmtBytes(num(l.bytes)) + (l.days_since_modified != null ? ' · ' + l.days_since_modified + 'd old' : '')) });
  return out;
}
export function vaults(inventory) {
  return arr(obj(inventory).vaults).map((v) => ({ name: String(v.name), active: num(v.recent7), stale: num(v.stale90), total: num(v.notes), sync: String(v.role || '') + (v.embedded_in ? ' · inside ' + v.embedded_in : '') }));
}

// ---- Life › Screen time (browser block; absent on older scans) ---------------------------------
export function sites(browser) {
  const b = obj(browser);
  const projDomains = new Set(arr(b.by_project).flatMap((p) => arr(obj(p).domains)));
  return arr(b.by_domain).map((d) => [String(d.domain), Math.round(num(d.focus_ms) / 60000), projDomains.has(d.domain) ? 'Project' : 'Other']).filter((s) => s[1] > 0);
}

// ---- Claude › Canvas: JSON Canvas boards → note/list widgets ------------------------------
// main sends the boards as an array (hq:canvas-read, the hq:canvas push); a
// { boards } wrapper is accepted too. Anything else is not a board list → null.
export function boardList(payload) {
  const list = Array.isArray(payload) ? payload : payload && typeof payload === 'object' && Array.isArray(payload.boards) ? payload.boards : null;
  return list ? list.filter((b) => b && typeof b === 'object' && !Array.isArray(b)) : null;
}
// The raw boards for the Canvas "＋ Note" board picker: name + nodes as the file
// holds them (id/type/text/x/y normalised, the rest — width, height, file, url,
// color — kept). A board without a name can't be written to (hq.canvasAdd takes
// the name), so it drops.
export function canvasBoards(payload) {
  return arr(boardList(payload)).map((b) => ({
    name: typeof b.name === 'string' ? b.name : '',
    nodes: arr(b.nodes).filter((n) => n && typeof n === 'object' && !Array.isArray(n)).map((n) => ({ ...n, id: String(n.id ?? ''), type: String(n.type || ''), text: typeof n.text === 'string' ? n.text : '', x: num(n.x), y: num(n.y) })),
    edges: arr(b.edges),
  })).filter((b) => b.name);
}
export function canvasWidgets(boards) {
  const out = [];
  for (const b of arr(boardList(boards))) for (const n of arr(obj(b).nodes)) {
    const text = String(obj(n).text || obj(n).file || obj(n).url || '').trim();
    if (!text) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines[0].replace(/^#+\s*|\*\*/g, '').slice(0, 80);
    const rest = lines.slice(1);
    const bullets = rest.filter((l) => /^[-*]\s/.test(l));
    out.push(bullets.length >= 2
      ? { id: String(n.id), board: String(b.name), type: 'list', title, items: bullets.map((l) => l.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')).slice(0, 6), tone: 'gold', wide: false }
      : { id: String(n.id), board: String(b.name), type: 'note', title, body: rest.join(' ').replace(/\*\*/g, '').slice(0, 400), tone: 'blue', wide: rest.join(' ').length > 160 });
  }
  return out.slice(0, 24);
}

// ---- live reads ----------------------------------------------------------------------------
export function captures(rows, now = new Date()) {
  const today = now.toDateString(), y = new Date(now); y.setDate(y.getDate() - 1);
  return arr(rows).map((r) => {
    const d = new Date(num(r.mtimeMs));
    const day = d.toDateString() === today ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : fmtD(d);
    // recovered: a recording rebuilt from chunks after a crash (studio library-list)
    // durationMs: a recording's length from main's sidecar (library-list, 2026-10-07); null when
    // unknown — a snip, an older main, a recording without a sidecar, or anything not a finite ms count
    const isRec = r.kind === 'rec';
    const durationMs = isRec && typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) && r.durationMs >= 0 ? r.durationMs : null;
    return { id: String(r.path), path: String(r.path), kind: isRec ? 'rec' : 'snip', recovered: r.recovered === true, name: String(r.name || ''), day, time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), size: fmtBytes(r.size), thumb: typeof r.thumbDataUrl === 'string' && r.thumbDataUrl.startsWith('data:image/') ? r.thumbDataUrl : null, mtime: num(r.mtimeMs), durationMs };
  }).sort((a, b) => b.mtime - a.mtime);
}
// Windows paths compare case-insensitively with either slash; trailing slash dropped
export const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isAbsPath = (n) => /^[a-z]:(\/|$)/.test(n) || n.startsWith('/');
// where a relative root sits in cwd as whole segments ('…/root' or '…/root/…'), else -1
function segmentAt(c, root) {
  for (let i = c.indexOf(root); i >= 0; i = c.indexOf(root, i + 1)) {
    const end = i + root.length;
    if ((i === 0 || c[i - 1] === '/') && (end === c.length || c[end] === '/')) return i;
  }
  return -1;
}
// The project whose folder is cwd or contains it. Session cwds are absolute, but
// newer scans store project paths relative to the scan root ("project-a"), and
// the renderer doesn't know that root: a relative path matches where its whole
// segments appear in cwd ('…/project-a' or '…/project-a/…'), so a same-named
// folder outside the scan root would match too. Absolute matches beat relative
// ones; among relative matches the one closest to the drive wins
// (…/project-b/vendor/project-a is project-b); then the deepest root wins (nested projects).
export function projectForCwd(cwd, projects) {
  const c = normPath(cwd);
  if (!c) return null;
  let best = null, rank = null;
  for (const p of arr(projects)) {
    const root = normPath(obj(p).path).replace(/^(\.\/)+/, '');
    if (!root || root === '.' || root === '..' || root.startsWith('../')) continue;
    let at;
    if (isAbsPath(root)) at = c === root || c.startsWith(root + '/') ? 0 : -1;
    else at = segmentAt(c, root);
    if (at < 0) continue;
    const r = [isAbsPath(root) ? 0 : 1, at, -root.length];   // lower is better, compared in order
    if (!rank || (r[0] - rank[0] || r[1] - rank[1] || r[2] - rank[2]) < 0) { best = String(p.id); rank = r; }
  }
  return best;
}
// `projects` (the snapshot's P0 + archived) maps an entry's cwd to a project
// id; an explicit projectId still wins, and without projects nothing is mapped
export function sessions(list, projects) {
  return arr(list).map((s) => {
    const st = s.status === 'running' ? 'running' : (s.exitCode === 0 || s.status === 'done') ? 'done' : 'failed';
    const t = new Date(num(s.startedAt) || Date.parse(s.startedAt) || 0);
    const proj = s.projectId ? String(s.projectId) : projectForCwd(s.cwd, projects);
    return { id: String(s.jobId), title: String(s.label || 'Claude session'), proj, cwd: s.cwd ? String(s.cwd) : null, status: st, started: String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'), tail: String(s.tail || '').split('\n').filter(Boolean).slice(-40) };
  });
}

// absolute path → file:// URL for <img>/<video> src: each segment
// percent-encoded (spaces, #, ?, %), drive letter kept raw ("C:" not "C%3A"),
// UNC \\host\share → file://host/share. A relative path has no file URL → ''.
export function fileUrl(absPath) {
  const p = String(absPath || '').replace(/\\/g, '/');
  const enc = (segs) => segs.filter(Boolean).map(encodeURIComponent).join('/');
  if (/^\/\/[^/]/.test(p)) { const [host, ...rest] = p.slice(2).split('/'); return 'file://' + encodeURIComponent(host) + '/' + enc(rest); }
  const drive = /^([A-Za-z]:)(\/|$)/.exec(p);
  if (drive) return 'file:///' + drive[1] + '/' + enc(p.slice(2).split('/'));
  if (p.startsWith('/')) return 'file:///' + enc(p.split('/'));
  return '';
}
export function social(payload) {
  const p = obj(payload), accounts = arr(obj(p.accounts).accounts);
  const handle = (pl) => { const a = accounts.find((x) => x.platform === pl); return a ? '@' + String(a.handle).replace(/^@/, '') : pl; };
  const POSTS = arr(obj(p.outbox).actions).filter((a) => a.status === 'staged').map((a) => ({ id: String(a.id), handle: handle(a.platform), text: String(a.text || ''), where: String(a.platform), staged: a.staged_at ? fmtD(new Date(Date.parse(a.staged_at))) : '' }));
  const MENTIONS = arr(obj(p.inbox).events).filter((e) => e.kind === 'mention').slice(-12).reverse().map((e) => ({ who: String(e.author || '?'), text: String(e.text || ''), when: e.ts ? ago(Date.parse(e.ts)) : '', reply: true, url: e.url ? String(e.url) : null }));
  return { POSTS, MENTIONS, connected: accounts.length > 0 };
}

// ---- Claude Hub library (spec 2026-10-13 §9). Hub rows arrive snake_case, exactly as the Hub returns them.
export function snippetParts(s) {
  const out = []; let hit = false, buf = '';
  const push = () => { if (!buf) return; const last = out[out.length - 1]; if (last && last.hit === hit) last.text += buf; else out.push({ text: buf, hit }); buf = ''; };
  for (const ch of String(s == null ? '' : s)) {
    if (ch === '\u0002') { if (!hit) { push(); hit = true; } }
    else if (ch === '\u0003') { if (hit) { push(); hit = false; } }
    else buf += ch;
  }
  push();
  return out;
}
export function fmtTokens(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : String(Math.round(v));
}
const tokSum = (r) => { const ks = ['tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write']; return ks.every((k) => r[k] == null) ? null : ks.reduce((n, k) => n + num(r[k], 0), 0); };
const at2ms = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
const whenOf = (s, now) => { const t = at2ms(s); return t === null ? '' : ago(t, now); };
const hhmmOf = (s) => { const t = at2ms(s); if (t === null) return ''; const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const msgDay = (s) => { const t = at2ms(s); if (t === null) return ''; const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const TOOL_LINE = /^\[tool: /;
export const SOURCE_LABEL = { code: 'Code', web: 'claude.ai', chatgpt: 'ChatGPT' };
export function hubConv(row, now = Date.now()) {
  const r = obj(row);
  return { id: String(r.id || ''), title: r.title ? String(r.title) : 'Untitled chat', project: String(r.project_name || ''), projectId: String(r.project_id || ''),
    hqProjectId: r.hq_project_id ? String(r.hq_project_id) : null, source: String(r.source || 'code'), sourceLabel: SOURCE_LABEL[r.source] || 'Code',
    when: whenOf(r.last_at, now), count: num(r.message_count, 0), tokens: fmtTokens(tokSum(r)), cursor: { before: r.last_at || null, beforeId: String(r.id || '') } };
}
export function hubThread(res, now = Date.now()) {
  if (!res || typeof res !== 'object' || !res.conversation) return null;
  const c = obj(res.conversation), ms = arr(res.messages);
  const messages = ms.map((m) => { const tool = m.role === 'tool' || TOOL_LINE.test(String(m.text || ''));
    return { id: String(m.id), role: String(m.role || ''), who: m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Claude' : m.role === 'tool' ? 'Tool output' : 'System',
      time: hhmmOf(m.at), day: msgDay(m.at), text: String(m.text || ''), tool, toolName: m.tool_name ? String(m.tool_name) : null, collapsed: tool }; });
  const mins = Math.round(num(c.active_ms, 0) / 60000);
  return { id: String(c.id || ''), title: c.title ? String(c.title) : 'Untitled chat', project: String(c.project_name || ''), model: c.model || null, branch: c.git_branch || null,
    tokens: fmtTokens(tokSum(c)), activeEst: '~' + mins + ' min (estimate)', messages, hasMore: !!res.hasMore,
    cursor: ms.length ? { before: ms[0].at || null, beforeId: String(ms[0].id) } : null };
}
export function hubProject(row, now = Date.now()) {
  const r = obj(row);
  return { id: String(r.id || ''), name: String(r.name || r.key || ''), path: String(r.path || ''), count: num(r.conversations, 0), when: whenOf(r.last_at, now),
    hqProjectId: r.hq_project_id ? String(r.hq_project_id) : null, linkState: ['auto', 'confirmed', 'rejected'].includes(r.link_state) ? r.link_state : 'none' };
}
export function hubHit(h, now = Date.now()) {
  const r = obj(h);
  return { conversationId: String(r.conversationId || ''), messageId: String(r.messageId || ''), title: r.title ? String(r.title) : 'Untitled chat', when: whenOf(r.at, now), parts: snippetParts(r.snippet) };
}
// ---- Archive H6: document hits (memory notes, CLAUDE.md, vault prompts, history) and the in-place document view
export const DOC_BADGE = { memory: 'memory', 'claude-md': 'CLAUDE.md', prompt: 'prompt', history: 'history' };
const docBadge = (r) => (DOC_BADGE[r.source] || 'document') + (r.origin === 'chatgpt' ? ' (ChatGPT)' : '');
const docWhen = (ms, now) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? whenOf(new Date(Number(ms)).toISOString(), now) : '');
export function hubDocHit(h, now = Date.now()) {
  const r = obj(h);
  return { id: String(r.id || ''), badge: docBadge(r), title: r.title ? String(r.title) : 'Untitled document', when: docWhen(r.mtime_ms, now), parts: snippetParts(r.snippet), origin: r.origin || null };
}
export function hubDocument(res, now = Date.now()) {
  if (!res || typeof res !== 'object' || res.error || !res.id) return null;
  const r = obj(res), text = String(r.text || '');
  return { id: String(r.id), badge: docBadge(r), title: r.title ? String(r.title) : 'Untitled document', project: String(r.project_path || ''),
    when: docWhen(r.mtime_ms, now), text, lines: text.split('\n').map((t, i) => ({ key: 'l' + i, text: t })) };
}
const KIND_LABEL = { chatgpt: 'ChatGPT', claude: 'claude.ai' };
export function dropCards(imp) {
  return arr(obj(imp).found).map((f) => ({ dropId: String(f.dropId || ''), kind: f.kind === 'chatgpt' ? 'chatgpt' : 'claude',
    text: `Import ${KIND_LABEL[f.kind] || 'claude.ai'} export (${String(f.file || 'export.zip')}, ${fmtBytes(num(f.bytes, 0))})?`,
    sub: 'Found in your WorkspaceHQ Imports folder. It is read on this PC only; nothing is uploaded, and the file is left where it is.' }));
}
export function hubStats(res) {
  const r = obj(res), t = obj(r.totals);
  return { days: arr(r.days).map((d) => ({ day: String(d.day), chats: num(d.chats, 0), activeMin: Math.round(num(d.active_ms, 0) / 60000) })),
    projects: arr(r.projects).map((p) => ({ id: String(p.project_id), name: String(p.name || p.project_id), chats: num(p.chats, 0), tokens: fmtTokens(tokSum(p)) })),
    totals: { chats: num(t.chats, 0), activeMin: Math.round(num(t.active_ms, 0) / 60000), tokens: fmtTokens(tokSum(t)) } };
}

// ---- Claude Hub H3: in-app chat turns (spec §8). Pure; text is bound as text, never HTML.
export const CHAT_TEXT_MAX = 200000;
export function chatTurnNew({ turnId, convId = null, projectId = null, prompt = '', mode = 'read-only', sessionId = null, seeded = null, now = Date.now() } = {}) {
  return { turnId, convId, projectId, prompt: String(prompt), mode, status: 'starting', items: [], sessionId, usage: null, error: null, seeded: seeded || null, startedAt: now, endedAt: null };
}
const ENDED = new Set(['done', 'stopped', 'error']);
// A turn seeded from a claude.ai chat starts a NEW Code chat: the real conversation is 'code:<new session>';
// the claude.ai id is kept as originConvId. Unseeded turns keep a given convId (resumed Code chat).
function refile(t, sid) {
  if (t.seeded && !t.originConvId && t.convId && t.convId !== 'code:' + sid) t.originConvId = t.convId;
  if (t.seeded || !t.convId) t.convId = 'code:' + sid;
}
export function chatReduce(turn, ev, now = Date.now()) {
  if (!turn || !ev || ENDED.has(turn.status)) return turn;
  const t = { ...turn, items: turn.items.slice() };
  if (ev.kind === 'session' && typeof ev.sessionId === 'string') {
    t.sessionId = ev.sessionId; refile(t, ev.sessionId); t.status = 'running';
  } else if (ev.kind === 'delta' && typeof ev.text === 'string') {
    const last = t.items[t.items.length - 1];
    const text = ((last && last.type === 'text' ? last.text : '') + ev.text).slice(-CHAT_TEXT_MAX);
    if (last && last.type === 'text') t.items[t.items.length - 1] = { type: 'text', text }; else t.items.push({ type: 'text', text });
    t.status = 'running';
  } else if (ev.kind === 'tool') {
    t.items.push({ type: 'tool', name: String(ev.name || 'tool'), hint: String(ev.hint || '') });
    if (t.items.length > 200) t.items.splice(0, t.items.length - 200);
    t.status = 'running';
  } else if (ev.kind === 'done') {
    t.status = ev.stopped ? 'stopped' : ev.isError ? 'error' : 'done';
    if (ev.isError && !ev.stopped) t.error = ev.result || ev.subtype || 'Claude Code reported an error';
    t.usage = ev.usage && typeof ev.usage === 'object' ? ev.usage : null;
    if (typeof ev.sessionId === 'string' && ev.sessionId) { t.sessionId = ev.sessionId; refile(t, ev.sessionId); }
    t.endedAt = now;
  } else if (ev.kind === 'error') {
    t.status = 'error'; t.error = String(ev.error || 'Claude Code failed'); t.endedAt = now;
  } else return turn;
  return t;
}
const TURN_STATUS = { starting: 'Starting Claude Code…', running: 'Claude is replying…', done: 'Done', stopped: 'Stopped — the partial answer is kept', error: 'Failed' };
export function chatTurnView(turn) {
  const u = turn.usage;
  const tokens = u ? fmtTokens((Number(u.in) || 0) + (Number(u.out) || 0)) : null;
  const s = turn.seeded;
  return {
    id: turn.turnId, status: turn.status, running: !ENDED.has(turn.status), statusText: TURN_STATUS[turn.status] || turn.status,
    modeText: turn.mode === 'edits' ? 'Allow edits' : 'Read-only', prompt: turn.prompt,
    items: turn.items.map((it, i) => ({ key: turn.turnId + ':' + i, text: it.type === 'text' ? it.text : '', tool: it.type === 'tool', name: it.name || '', hint: it.hint || '' })),
    tokens, hasTokens: tokens != null, error: turn.error || '',
    seededNote: !s ? '' : s.trimmed ? `Copied the last ${s.chars} characters of the claude.ai chat (trimmed)` : `Copied the claude.ai chat (${s.chars} characters)`,
  };
}
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function liveTurns(turns, convId, thread) {
  const msgs = thread && Array.isArray(thread.messages) ? thread.messages : [];
  return (Array.isArray(turns) ? turns : []).filter((t) => t && t.convId === convId).filter((t) => {
    if (!ENDED.has(t.status)) return true;
    const head = squash(t.prompt).slice(0, 40);
    // a seeded turn's indexed user message is "Context: ... --- <prompt>": match the prompt as the suffix too
    return !msgs.some((m) => {
      if (!m || m.role !== 'user' || !(Date.parse(m.at) >= t.startedAt - 60000)) return false;
      const full = String(m.text || '');
      const cut = full.lastIndexOf('\n---\n\n');
      return squash(full).startsWith(head) || (t.seeded && cut >= 0 && squash(full.slice(cut + 6)).startsWith(head));
    });
  });
}

// ---- Claude Hub H4: claude.ai export import (counts only — the report never holds chat text)
export function importReportLines(r) {
  if (!r || typeof r !== 'object') return [];
  const c = obj(r.conversations), m = obj(r.messages), p = obj(r.projects);
  const lines = [
    `Chats: ${num(c.imported, 0)} imported · ${num(c.unchanged, 0)} unchanged · ${num(c.forgotten, 0)} forgotten · ${num(c.skipped, 0)} skipped`,
    `Messages: ${num(m.imported, 0)} imported · ${num(m.skipped, 0)} skipped · ${num(m.empty, 0)} empty`,
  ];
  if (r.source === 'chatgpt') {
    const br = obj(r.branches), mem = obj(r.memory), other = arr(obj(r.files).other).map(String);
    if (num(br.skipped, 0) > 0) lines.push(`Other branches of edited chats: ${num(br.skipped, 0)} (not imported — the version you last saw is)`);
    if (num(mem.imported, 0) > 0) lines.push(`Memory: ${num(mem.imported, 0)} saved as memory documents`);
    else if (mem.found) lines.push('Memory file found but not recognized — nothing imported');
    if (other.length) lines.push('Not imported (counted): ' + other.join(', '));
  } else lines.push(`Projects: ${num(p.imported, 0)} imported · ${num(p.unchanged, 0)} unchanged · ${num(p.skipped, 0)} skipped`);
  const u = Object.entries(obj(r.unknownFields)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (u.length) lines.push('Not understood (counted, not imported): ' + u.slice(0, 5).map(([k, n]) => `${k} ×${n}`).join(', ') + (u.length > 5 ? `, +${u.length - 5} more` : ''));
  if (r.truncated) lines.push('The export file ended early — what came before the cut was imported.');
  return lines;
}

const IMPORT_PHASE = { unzip: 'Unpacking the export…', projects: 'Reading claude.ai Projects…', conversations: 'Reading chats…' };
export function importView(imp, hub, { hasBridge, canWrite, writeReason } = {}) {
  const cur = imp && imp.kind === 'import' ? imp : null;
  const ended = !!cur && (cur.phase === 'done' || cur.phase === 'failed');
  const running = (!!cur && !ended) || (!!hub && !!hub.importing && !ended);
  const why = !hasBridge ? 'Importing needs the WorkspaceHQ app — this preview has no app bridge.'
    : !hub || ['no-node', 'down', 'starting'].includes(hub.state) ? 'The Claude Hub is not running — import is unavailable.'
      : hub.role === 'reader' ? 'Another WorkspaceHQ window owns the Claude index — import from that one.'
        : !canWrite ? (writeReason || 'Read-only right now')
          : running ? 'An import is running.' : '';
  let text = '', tone = 'muted', report = [];
  if (running) {
    text = (cur && IMPORT_PHASE[cur.phase]) || 'Importing…';
    if (cur && cur.phase === 'conversations' && num(cur.done, 0)) text += ` ${num(cur.done, 0)} read`;
  } else if (cur && cur.phase === 'failed') { text = 'Import failed: ' + String(cur.error || 'unknown error'); tone = 'error'; }
  else {
    const last = cur && cur.phase === 'done' ? { ok: true, report: cur.report, at: null } : hub && hub.lastImport ? hub.lastImport : null;
    if (last && last.ok) {
      const c = obj(obj(last.report).conversations), day = last.at ? ` (${String(last.at).slice(0, 10)})` : '';
      const n = num(c.imported, 0), u = num(c.unchanged, 0), gpt = obj(last.report).source === 'chatgpt' ? 'ChatGPT ' : '';
      text = n ? `Imported ${n} ${gpt}chat${n === 1 ? '' : 's'}${day}` : u ? `Nothing new — ${u} ${gpt}chat${u === 1 ? ' was' : 's were'} already imported${day}` : `No ${gpt}chats found in that export`;
      tone = 'ok'; report = importReportLines(last.report);
    } else if (last) { text = 'Last import failed: ' + String(last.error || 'unknown error'); tone = 'error'; }
  }
  return { canImport: !why, why, running, text, tone, report, hasReport: report.length > 0 };
}

// Prompt library P1 (spec 2026-10-15 §6.3): Library rows from the Hub's prompt documents + prompt_use stats.
// Counts are the Hub's; nothing here estimates. Text is bound as text by the template runtime, never HTML.
const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
const baseName = (p) => String(p || '').split(/[\\/]/).pop();
export function promptRow(row, statsById, now = Date.now()) {
  const r = obj(row), meta = obj(r.meta), s = obj(obj(statsById)[r.id]);
  const tags = strList(meta.tags).map((t) => t.replace(/^#/, '')).slice(0, 12);
  const vars = arr(r.variables).filter((v) => typeof v === 'string');
  const uses = num(s.uses, 0);
  return { id: String(r.id || ''), title: r.title ? String(r.title) : 'Untitled prompt', name: baseName(r.path),
    tags, tagText: tags.map((t) => '#' + t).join(' '), hasTags: tags.length > 0, vars, varText: vars.map((v) => '{{' + v + '}}').join(' '), hasVars: vars.length > 0,
    uses, usesText: uses > 0 ? `used ${uses}×` : 'not run yet', lastUsed: uses > 0 && s.last_at ? 'last used ' + whenOf(s.last_at, now) : '',
    usesProject: vars.includes('project') || vars.includes('cwd') };
}
export function promptsView(P, { hasBridge = true, q = null, forProject = null, now = Date.now() } = {}) {
  const p = obj(P), st = obj(p.status), folder = obj(st.folder), vault = st.vault || 'your vault';
  const where = `${vault}/40_Resources/Prompts`;
  const out = (state, text, rows = []) => ({ state, text, rows, count: rows.length, statsNote: '' });
  if (!hasBridge) return out('nobridge', 'The prompt library needs the WorkspaceHQ app — this preview has no bridge to the Claude Hub.');
  if (p.error) return out('error', `${p.error} — your prompt notes cannot be listed until the Claude Hub answers.`);
  if (!Array.isArray(p.rows)) return out('loading', 'Reading your prompt notes…');
  const statsById = Object.fromEntries(arr(p.stats).map((s) => [s.prompt_id, s]));
  if (p.rows.length === 0) {
    if (folder.error) return out('folder-error', `${where}: ${folder.error}`);
    if (p.status && folder.exists === false) return out('nofolder', `No prompts folder yet — create ${where} and add notes there, or promote a candidate (Promote creates the folder); edits you make in Obsidian show up here.`);
    return out('empty', `${where} has no prompt notes yet — add a .md note there in Obsidian (top level of the folder).`);
  }
  const term = String(q == null ? p.q || '' : q).trim().toLowerCase();
  let rows = p.rows.map((r) => promptRow(r, statsById, now));
  if (term) {
    const hit = new Set(arr(p.hits).map((h) => h && h.id));
    rows = rows.filter((r) => hit.has(r.id) || r.title.toLowerCase().includes(term) || r.tags.some((t) => t.toLowerCase().includes(term)));
    if (!rows.length) return out('nohits', `No prompt note matches “${String(q == null ? p.q : q).trim()}”.`);
  }
  if (forProject) rows = rows.slice().sort((a, b) => Number(b.usesProject) - Number(a.usesProject));
  const v = out('list', '', rows);
  v.statsNote = p.statsErr ? 'Usage unknown — ' + p.statsErr : arr(p.stats).length === 0 ? 'Usage is counted from the Run step on — nothing has run yet.' : '';
  return v;
}

// ---- P2 harvest candidates (spec 2026-10-15 §6.2/§6.3). Scores are shown as their terms; the wording states counts only.
export const CAND_TITLE_MAX = 60;
export const ORIGIN_LABEL = { code: 'Claude Code', web: 'claude.ai', chatgpt: 'ChatGPT', history: 'Claude Code prompt history' };
export function candidateTitle(text) {
  const one = (String(text == null ? '' : text).split('\n').map((l) => l.trim()).find(Boolean) || '').replace(/\s+/g, ' ');
  const cps = [...one];
  if (!cps.length) return 'Untitled prompt';
  if (cps.length <= CAND_TITLE_MAX) return one;
  const cut = cps.slice(0, CAND_TITLE_MAX).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '') || 'Untitled prompt';
}
export const reasonText = (r) => { const p = num(obj(r).points); return `${obj(r).text || ''} ${p < 0 ? '−' + Math.abs(p) : '+' + p}`; };
export function candidateRow(c, { selected = [], now = Date.now() } = {}) {
  const x = obj(c), src = arr(x.sources).map(obj), first = src[0] || {};
  const reasons = arr(x.reasons).map((r) => ({ key: obj(r).key, text: reasonText(r) }));
  const when = whenOf(first.at, now);
  const origin = [ORIGIN_LABEL[first.kind] || 'unknown source', first.project || '', when].filter(Boolean).join(' · ');
  const n = src.length - 1;
  return {
    key: x.key, text: String(x.text || ''), title: candidateTitle(x.text), score: num(x.score), scoreText: `score ${num(x.score)}`,
    reasons, why: reasons.map((r) => r.text).join(' · '), origin, more: n > 0 ? `+${n} more place${n === 1 ? '' : 's'}` : '',
    sessions: num(x.sessions), selected: arr(selected).includes(x.key), inLibrary: arr(x.reasons).some((r) => obj(r).key === 'library'),
    source: first.kind ? { kind: first.kind, conversation: first.conversationId || first.documentId || '', at: first.at || '' } : null,
  };
}
export function candidatesView(C, { hasBridge = true, selected = [], now = Date.now() } = {}) {
  const c = obj(C), pooled = obj(c.pooled), capped = obj(c.capped);
  const out = (state, text, rows = []) => ({ state, text, rows, count: rows.length, poolNote: '' });
  if (!hasBridge) return out('nobridge', 'Prompt candidates need the WorkspaceHQ app — this preview has no bridge to the Claude Hub.');
  if (c.error) return out('error', `${c.error} — candidates cannot be scored until the Claude Hub answers.`);
  if (!Array.isArray(c.rows)) return out('loading', 'Scoring your prompts…');
  const m = num(pooled.messages), h = num(pooled.history);
  if (!c.rows.length) {
    if (m + h === 0) return out('empty', 'No prompts to look at yet — the Claude Hub has no user message or history line of 120+ characters.');
    return out('empty', `None of the ${m + h} prompts looked at qualify (each is under 120 characters, a slash command, a paste, holds a masked secret, or was hidden).`);
  }
  const v = out('list', '', c.rows.map((r) => candidateRow(r, { selected, now })));
  const cap = [capped.messages ? 'chat messages' : '', capped.history ? 'prompt-history lines' : ''].filter(Boolean);
  v.poolNote = `Looked at ${m} chat message${m === 1 ? '' : 's'} and ${h} prompt-history line${h === 1 ? '' : 's'}`
    + (cap.length ? ` (the newest 20 000 ${cap.join(' and ')} only — older ones were not looked at)` : '')
    + (num(c.hidden) ? ` · ${num(c.hidden)} hidden` : '') + ' · scores are counts, not a rating.';
  return v;
}

// ---- Prompt library P3: run modal + pack confirm (pure). Quota is said on every Claude target; counts are real.
export const RUN_TARGETS_UI = [
  { id: 'chat', label: 'Chat', quota: true, note: 'Runs in Claude › Chats (read-only unless you allow edits) — uses your Claude quota' },
  { id: 'terminal', label: 'Terminal', quota: true, note: 'Opens Claude Code in a terminal in the project folder (one line, up to 500 characters) — uses your Claude quota' },
  { id: 'claude.ai', label: 'Copy for claude.ai', quota: false, note: 'Copies the prompt and opens claude.ai/new — sending it there uses your Claude quota' },
  { id: 'chatgpt', label: 'Copy for ChatGPT', quota: false, note: 'Copies the prompt and opens chatgpt.com' },
];
const RUN_GO = { chat: 'Run in Chat · uses your Claude quota', terminal: 'Open a Terminal · uses your Claude quota', 'claude.ai': 'Copy + open claude.ai', chatgpt: 'Copy + open ChatGPT' };
const RUN_DONE = { chat: 'Started in Claude › Chats', terminal: 'Terminal opened', 'claude.ai': 'Copied — paste it in the claude.ai tab that opened', chatgpt: 'Copied — paste it in the ChatGPT tab that opened' };
const RESERVED = ['project', 'cwd'];

export function runView(run, { prompt = null, projects = [], hasBridge = true } = {}) {
  const R = obj(run);
  const target = RUN_TARGETS_UI.some((t) => t.id === R.target) ? R.target : 'chat';
  const vars = obj(R.vars), missing = arr(R.missing);
  const all = prompt && Array.isArray(prompt.variables) ? prompt.variables : [];
  const fields = all.filter((n) => !RESERVED.includes(n)).map((name) => ({ name, value: typeof vars[name] === 'string' ? vars[name] : '', missing: missing.includes(name) }));
  const usesProject = all.some((n) => RESERVED.includes(n));
  const projectNeeded = usesProject || target === 'chat' || target === 'terminal';
  const busy = R.phase === 'running';
  const filled = fields.every((f) => f.value.trim());
  let status = null;
  if (R.phase === 'error' && R.error) status = { tone: 'error', text: String(R.error) };
  if (R.phase === 'done' && R.result) {
    const u = String(R.result.usage || '');
    const counted = u === 'recorded' ? 'counted in the Library' : u ? u.replace(/^not recorded/, 'not counted') : 'not counted';
    status = { tone: u === 'recorded' ? 'success' : 'info', text: RUN_DONE[target] + ' · ' + counted + (R.result.dry ? ' · dry run — nothing was opened' : '') };
  }
  return {
    title: prompt ? String(prompt.title || 'Untitled prompt') : 'Prompt not found',
    fields, usesProject, projectNeeded,
    projects: arr(projects).map((p) => ({ id: p.id, name: String(p.name || p.id), selected: p.id === R.projectId })),
    targets: RUN_TARGETS_UI.map((t) => ({ ...t, selected: t.id === target })),
    note: RUN_TARGETS_UI.find((t) => t.id === target).note,
    goLabel: RUN_GO[target], busy, status,
    canGo: !!prompt && hasBridge && !busy && filled && (!projectNeeded || !!R.projectId),
    showMode: target === 'chat', modeEdits: R.mode === 'edits',
  };
}

const SKIP_TEXT = [['notMd', 'not a .md file'], ['tooBig', 'over 200 KB'], ['tooMany', 'over the 200-note limit'], ['duplicate', 'duplicate name'], ['unreadable', 'unreadable']];
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

export function packView(pack) {
  if (!pack || typeof pack !== 'object') return { phase: 'closed', title: '', rows: [], newCount: 0, existCount: 0, skippedText: '', canConfirm: false, confirmLabel: '', doneText: '', error: null };
  const plan = obj(pack.plan), notes = arr(plan.notes), sk = obj(plan.skipped);
  const newCount = notes.filter((n) => !n.exists).length, existCount = notes.length - newCount;
  const parts = SKIP_TEXT.filter(([k]) => num(sk[k]) > 0).map(([k, t]) => num(sk[k]) + ' ' + t);
  const res = obj(pack.result), rs = obj(res.skipped);
  const done = pack.phase === 'done' ? [num(res.imported) === 1 ? 'Imported 1 note' : 'Imported ' + num(res.imported) + ' notes',
    num(rs.exists) ? num(rs.exists) + ' already there (kept)' : '', num(rs.failed) ? num(rs.failed) + ' not written' : '',
    num(res.masked) ? plural(num(res.masked), 'secret masked', 'secrets masked') : ''].filter(Boolean).join(' · ') : '';
  return {
    phase: String(pack.phase || 'plan'),
    title: newCount ? `Import ${plural(newCount, 'new prompt note', 'new prompt notes')} from ${plan.source || 'the pack'}?` : `Nothing new to import from ${plan.source || 'the pack'}`,
    rows: notes.map((n) => ({ name: String(n.name), title: String(n.title || n.name), exists: !!n.exists, tag: n.exists ? 'already there — kept' : 'new' })),
    newCount, existCount,
    skippedText: parts.length ? 'Skipped: ' + parts.join(' · ') : '',
    canConfirm: pack.phase === 'plan' && newCount > 0,
    confirmLabel: newCount ? `Copy ${plural(newCount, 'note', 'notes')} into Prompts` : '',
    doneText: done, error: pack.phase === 'error' ? String(pack.error || 'the pack could not be read') : null,
  };
}

// ---- GitHub (data/github.json, CONTRACT 2026-10-26) ---------------------------------------
// Pure view of the GitHub sidecar for Projects › GitHub. Defensive: an older bake (no
// DATA.github) or junk reads as state 'none'. Counts come from the sidecar, never invented.
const GH_CI = {
  success: { label: 'CI passing', tone: 'var(--green)' }, failure: { label: 'CI failing', tone: 'var(--red)' },
  error: { label: 'CI error', tone: 'var(--red)' }, pending: { label: 'CI running', tone: 'var(--blue)' },
};
const GH_KIND = { review: 'review requested', assigned: 'assigned to you', 'on-your-repo': 'on your repo', mine: 'yours' };
const ghStr = (v) => (typeof v === 'string' ? v : '');
const ghNum = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const ghWhen = (s, now) => { const t = at2ms(s); return t === null ? '' : ago(t, now); };
export function github(raw, now = Date.now()) {
  const g = obj(raw);
  const state = ['ok', 'signed-out', 'no-gh', 'error'].includes(g.state) ? g.state : 'none';
  const pr = (p) => {
    const c = GH_CI[p.ci] || null;
    return { title: ghStr(p.title), url: ghStr(p.url), repo: ghStr(p.repo), num: '#' + ghNum(p.number), kind: GH_KIND[p.kind] || '',
      who: ghStr(p.author), when: ghWhen(p.updatedAt, now), draft: !!p.draft, ci: c ? c.label : '', ciTone: c ? c.tone : 'var(--faint)' };
  };
  const repos = arr(g.repos).filter((r) => r && typeof r === 'object' && ghStr(r.url)).map((r) => {
    const c = GH_CI[r.ci] || null, local = ghStr(r.local);
    return { name: ghStr(r.name) || ghStr(r.full), full: ghStr(r.full), url: ghStr(r.url), desc: ghStr(r.desc), lang: ghStr(r.lang),
      private: !!r.private, archived: !!r.archived, fork: !!r.fork, stars: ghNum(r.stars), prs: ghNum(r.openPrs), issues: ghNum(r.openIssues),
      ci: c ? c.label : 'no CI', ciTone: c ? c.tone : 'var(--faint)', ciBad: r.ci === 'failure' || r.ci === 'error',
      pushed: ghWhen(r.pushedAt, now), commit: ghStr(obj(r.lastCommit).title), local, cloned: !!local };
  });
  const t = obj(g.totals);
  return {
    state, login: ghStr(g.login), at: ghStr(g.at), when: ghWhen(g.at, now), error: ghStr(g.error),
    stale: !!g.stale, staleReason: ghStr(g.staleReason), partial: !!g.partial,
    totals: { repos: ghNum(t.repos) || repos.length, private: ghNum(t.private), archived: ghNum(t.archived), stars: ghNum(t.stars),
      openPrs: ghNum(t.openPrs), openIssues: ghNum(t.openIssues), ciFailing: ghNum(t.ciFailing), cloned: ghNum(t.cloned),
      waiting: Number.isInteger(t.waiting) ? t.waiting : null },
    repos,
    waiting: arr(g.waiting).filter((p) => p && typeof p === 'object' && ghStr(p.url)).map(pr),
    mine: arr(g.mine).filter((p) => p && typeof p === 'object' && ghStr(p.url)).map(pr),
    issues: arr(g.issues).filter((p) => p && typeof p === 'object' && ghStr(p.url)).map((p) => ({ ...pr(p), kind: 'issue' })),
  };
}
