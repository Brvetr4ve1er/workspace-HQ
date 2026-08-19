// projects/core.mjs — PURE helpers behind the PROJECTS surface (v4.1 S1).
// No DOM, no globals, no clocks (same firewall as intel/derive.mjs). Ported
// from dashboard-v3/src/realms/forge/view.js: gitText / riskScore / the
// filter+sort pipeline / the re-entry "next" heuristic — made pure so they run
// under node --test (core.test.mjs) without a renderer.
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// Completion % clamped to [0,100] — this value is interpolated into a style
// attribute (meter width), so it must be a bounded number, never raw scan data.
export const pctOf = (p) => Math.max(0, Math.min(100, num(p?.completion?.pct)));

// One-phrase git standing (v3 forge gitText; the two `dirty` branches produced
// the same string, collapsed here — output-identical).
export function gitText(g) {
  g = g || {};
  if (!g.has_git) return 'no git';
  if (g.commits === 0) return '0 commits';
  if (!g.has_remote) return 'no remote';
  if (num(g.dirty) > 0) return `${g.dirty} dirty`;
  if (g.unpushed) return `${g.ahead} ahead`;
  return 'in sync';
}

// Composite "how much this needs attention" — deterministic, no RNG (v3 forge).
const RISK_RANK = { high: 3, medium: 1, low: 0 };
export function riskScore(p) {
  const m = p?.metrics || {};
  const g = m.git_safety || {}, ch = m.code_health || {}, rs = m.risk_security || {};
  let s = RISK_RANK[g.risk] ?? 0;
  if (ch.build === 'red') s += 2;
  s += RISK_RANK[rs.score] ?? 0;
  if (num(g.dirty) > 20) s += 1;
  return s;
}

export const recentKey = (p) => p?.activity?.days_since_commit ?? Infinity; // 0 = today, nulls last

export const isAtRisk = (p) =>
  p?.metrics?.git_safety?.risk === 'high' ||
  p?.metrics?.code_health?.build === 'red' ||
  p?.metrics?.risk_security?.score === 'high';

// The toolbar pipeline: search (name + stack) -> filter seg -> sort seg.
// Returns a NEW array; the input list is never reordered in place.
export function applyView(projects, { search = '', filter = 'all', sort = 'completion' } = {}) {
  let list = [...(projects || [])];
  const q = String(search).trim().toLowerCase();
  if (q) {
    list = list.filter((p) =>
      String(p?.name || '').toLowerCase().includes(q) ||
      (p?.stack || []).join(' ').toLowerCase().includes(q));
  }
  if (filter === 'risk') list = list.filter(isAtRisk);
  else if (filter === 'active') list = list.filter((p) => p?.activity?.state === 'active');
  else if (filter === 'cold') list = list.filter((p) => p?.activity?.state === 'dormant');
  if (sort === 'risk') list.sort((a, b) => riskScore(b) - riskScore(a) || pctOf(a) - pctOf(b));
  else if (sort === 'recent') list.sort((a, b) => recentKey(a) - recentKey(b) || pctOf(b) - pctOf(a));
  else list.sort((a, b) => pctOf(b) - pctOf(a));
  return list;
}

// Previous-scan lookup for completion deltas (v3 deriveScanContext's prevProj).
export function prevProjectMap(prevScan) {
  const out = Object.create(null);
  for (const p of (prevScan?.projects || [])) if (p && p.id != null) out[p.id] = p;
  return out;
}

export const completionDelta = (p, prevP) => (prevP ? pctOf(p) - pctOf(prevP) : 0);

// Open work attached to a project, worst tier first (v3 openTasksFor).
const TIER_RANK = { red: 0, orange: 1, yellow: 2 };
export function openTasksFor(quests, projectId) {
  return (quests || [])
    .filter((q) => q && (q.status === 'open' || q.status === 'in_progress') && q.project_id === projectId)
    .sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3));
}

// The re-entry briefing's "next" line (v3 drawer nextAction heuristic).
export function nextActionFor(p, quests) {
  const top = openTasksFor(quests, p?.id)[0];
  if (top) return top.title;
  const dirty = num(p?.metrics?.git_safety?.dirty);
  if (dirty > 0) return `Commit ${dirty} dirty file${dirty > 1 ? 's' : ''}`;
  return 'Open it and look around';
}

// Browser dwell attributed to a project in this scan (v3 dwellFor).
export const dwellFor = (browser, projectId) =>
  ((browser && browser.by_project) || []).find((x) => x && x.project_id === projectId) || null;

// Tests standing as one phrase (v3 forge testsTxt).
export function testsText(tests) {
  if (tests?.passing) return `${tests.passing}/${tests.count ?? '?'}`;
  return tests?.present ? 'present' : 'none';
}

// days_since_commit -> display phrase (v3 commitTxt).
export function commitAgoText(days) {
  if (days == null) return '—';
  if (days === 0) return 'today';
  return `${days}d ago`;
}
