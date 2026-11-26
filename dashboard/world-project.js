// MAPS HQ projection (CONTRACT "Local bridge routes — the map (/world/*)"). PURE: no IO, no clock of its own.
// What the map may know about the owner's work, built from files main already writes. Nothing here mints XP or
// changes a fact; the map only shows what the scan, the Brief and the delivery lists already say.
//
//   projectWorld({ latest, brief, delivery, pins, now }) → world (shape in CONTRACT; v:1)
//   cleanPins(raw) → pins | null      the owner's hand-set data/world/pins.json, validated field by field
//
// Never in the answer: paths, remotes, branch names, file names, commit subjects, insights, amounts, any Money row,
// any Security-space row, the Brief's raw keys (a 12-hex ref only, the same refOf as brief-project.mjs).
'use strict';
const crypto = require('node:crypto');

const V = 1;
const ID_RE = /^[\w.-]{1,80}$/;
const DISTRICT_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const KINDS = ['client', 'studio', 'atelier'];
// rows that never reach the map: the Money space (bills, accounts) and the Security space (accounts, vault)
const NEVER_RULES = new Set(['plain-export-found', 'vault-conflict', 'accounts-breached', 'passwords-reused', 'footprint-stale', 'email-2fa-first']);
const NEVER_SOURCES = new Set(['money', 'security']);
// a rule about a repo's own files may show, but only in fixed words (the Brief's text can carry counts and names)
const FIXED_TEXT = { secrets: 'Secrets sit in plain text in this repo' };
const MAX = { projects: 200, quests: 300, brief: 12, top3: 3, scope: 20, districts: 24, districtProjects: 60 };

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const int = (x, lo, hi, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
// owner-typed text: one line, a length cap in code points
const line = (s, n) => [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, n).join('').trim();
const idOf = (x) => (typeof x === 'string' && ID_RE.test(x) ? x : null);
const refOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
const lngOk = (x) => typeof x === 'number' && Number.isFinite(x) && x >= -180 && x <= 180;
const latOk = (x) => typeof x === 'number' && Number.isFinite(x) && x >= -85 && x <= 85;

function point(p) {
  if (!isObj(p) || !lngOk(p.lng) || !latOk(p.lat)) return null;
  const out = { lng: Math.round(p.lng * 1e6) / 1e6, lat: Math.round(p.lat * 1e6) / 1e6 };
  const label = line(p.label, 40);
  if (label) out.label = label;
  return out;
}

// data/world/pins.json — written by the owner by hand (P1 has no writer). Unknown fields are dropped.
function cleanPins(raw) {
  if (!isObj(raw) || raw.v !== 1) return null;
  const hq = point(raw.hq);
  const seen = new Set();
  const districts = [];
  for (const d of arr(raw.districts)) {
    if (districts.length >= MAX.districts) break;
    if (!isObj(d) || typeof d.id !== 'string' || !DISTRICT_ID_RE.test(d.id) || seen.has(d.id)) continue;
    const name = line(d.name, 40);
    if (!name) continue;
    seen.add(d.id);
    const out = { id: d.id, name, kind: KINDS.includes(d.kind) ? d.kind : 'client', projects: [] };
    const fixer = point(d.fixer);
    if (fixer) out.fixer = fixer;
    for (const pid of arr(d.projects)) { const id = idOf(pid); if (id && out.projects.length < MAX.districtProjects && !out.projects.includes(id)) out.projects.push(id); }
    districts.push(out);
  }
  return { v: 1, hq, districts };
}

function projectOf(p) {
  const id = idOf(p && p.id);
  if (!id) return null;
  const m = isObj(p.metrics) ? p.metrics : {};
  const g = isObj(m.git_safety) ? m.git_safety : {};
  const ch = isObj(m.code_health) ? m.code_health : {};
  const rs = isObj(m.risk_security) ? m.risk_security : {};
  const act = isObj(p.activity) ? p.activity : {};
  const build = ['green', 'red', 'yellow'].includes(ch.build) ? ch.build : 'unknown';
  return {
    id, name: line(p.name, 60) || id,
    stack: line(Array.isArray(p.stack) ? p.stack.join(', ') : p.stack, 40),
    activity: ['active', 'stale', 'dormant'].includes(act.state) ? act.state : 'unknown',
    daysSinceCommit: act.days_since_commit == null ? null : int(act.days_since_commit, 0, 99999),
    completion: int(isObj(p.completion) ? p.completion.pct : null, 0, 100, 0),
    level: int(p.level, 0, 999, 0),
    build,
    dirty: int(g.dirty, 0, 99999, 0),
    ahead: int(g.ahead, 0, 99999, 0),
    unpushed: g.unpushed === true,
    hasGit: g.has_git === true,
    hasRemote: g.has_remote === true,
    secrets: num(rs.secrets_found) > 0,   // a flag, never a count or a file
  };
}

function questOf(q) {
  const id = idOf(q && q.id);
  if (!id || q.completed === true || (q.status && q.status !== 'open')) return null;
  return {
    id, title: line(q.title, 120) || id,
    tier: ['red', 'orange', 'yellow'].includes(q.tier) ? q.tier : 'yellow',
    projectId: idOf(q.project_id),
    ageDays: int(q.age_days, 0, 99999, 0),
  };
}

function briefRowOf(it, top) {
  if (!isObj(it) || typeof it.key !== 'string') return null;
  if (NEVER_SOURCES.has(it.source) || NEVER_RULES.has(it.rule) || /^money-/.test(String(it.rule))) return null;
  const a = isObj(it.action) ? it.action : {};
  const rule = line(it.rule, 40);
  return {
    ref: refOf(it.key), rule,
    severity: ['high', 'med', 'low'].includes(it.severity) ? it.severity : 'low',
    text: FIXED_TEXT[rule] || line(it.text, 160),
    why: FIXED_TEXT[rule] ? '' : line(it.why, 200),
    projectId: a.kind === 'go' && a.tab === 'projects' ? idOf(a.projectId) : null,
    top,
  };
}

function scopeOf(delivery, projects) {
  const out = [];
  const byId = isObj(delivery) && isObj(delivery.projects) ? delivery.projects : {};
  for (const [pid, d] of Object.entries(byId)) {
    if (!idOf(pid) || !isObj(d) || d.client !== true || !projects.has(pid)) continue;
    const items = arr(d.items).filter(isObj);
    const open = items.filter((x) => x.done !== true);
    out.push({
      projectId: pid,
      done: items.length - open.length,
      total: items.length,
      open: open.slice(0, MAX.scope).map((x) => ({ id: line(x.id, 40), text: line(x.text, 120) })).filter((x) => x.id && x.text),
    });
  }
  return out;
}

function projectWorld({ latest, brief, delivery, pins, now } = {}) {
  const L = isObj(latest) ? latest : {};
  const acc = isObj(L.account) ? L.account : {};
  const projects = arr(L.projects).map(projectOf).filter(Boolean).slice(0, MAX.projects);
  const ids = new Set(projects.map((p) => p.id));
  const quests = arr(L.quests).map(questOf).filter(Boolean).filter((q) => !q.projectId || ids.has(q.projectId)).slice(0, MAX.quests);
  const B = isObj(brief) ? brief : {};
  const briefRows = [...arr(B.items).map((x) => briefRowOf(x, true)), ...arr(B.overflow).map((x) => briefRowOf(x, false))]
    .filter(Boolean).slice(0, MAX.brief);
  const top3 = arr(acc.daily_top3).filter(isObj).slice(0, MAX.top3).map((t) => ({
    kind: line(t.kind, 20), label: line(t.label, 120), reason: line(t.reason, 160),
    projectId: idOf(t.project_id), questId: idOf(t.quest_id),
  })).filter((t) => t.label);
  const scanAt = isObj(L.scan) && typeof L.scan.date === 'string' && Number.isFinite(Date.parse(L.scan.date)) ? L.scan.date.slice(0, 40) : null;
  const streak = isObj(acc.streak) ? acc.streak : {};
  const scanMs = scanAt ? Date.parse(scanAt) : NaN;
  return {
    v: V,
    generatedAt: new Date(num(now, Date.now())).toISOString(),
    scanAt,
    scanAgeHours: Number.isFinite(scanMs) ? Math.max(0, Math.round((num(now, Date.now()) - scanMs) / 3600e3)) : null,
    rank: isObj(L.account) ? {
      level: int(acc.level, 0, 999, 0), title: line(acc.title, 40),
      xp: int(acc.xp, 0, 1e9, 0), xpIntoLevel: int(acc.xp_into_level, 0, 1e9, 0), xpToNext: int(acc.xp_to_next, 0, 1e9, 0),
      streakDays: int(streak.scan_days, 0, 99999, 0),
    } : null,
    pins: pins ? cleanPins(pins) : null,
    projects, quests, brief: briefRows, top3,
    scope: scopeOf(delivery, ids),
  };
}

module.exports = { projectWorld, cleanPins, refOf, NEVER_RULES, NEVER_SOURCES, FIXED_TEXT, V };
