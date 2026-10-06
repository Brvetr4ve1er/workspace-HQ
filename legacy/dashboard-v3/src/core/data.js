// Read-only view over v2's data bundle + Memory-of-Grace selection state.
// build-data.mjs is never touched pre-swap (program invariant 1); realms get
// this object via ctx and re-render on 'data:select'.
import { bus } from './bus.js';

const D = window.DATA || { scans: [], latest: null, built_at: null };

// ---- ingress boundary (design finding I1) --------------------------------
// Every scan a realm sees is normalized to a guaranteed STRUCTURAL shape, so a
// partial / old / drifted scan (a project missing its metrics sub-object, an
// absent trends block, a pre-field snapshot in the time-machine) degrades to
// empty cards instead of a mid-render TypeError. Realms no longer each have to
// remember the guard — the one place that can forget is here.
//
// We fill ONLY the load-bearing CONTAINERS the contract guarantees
// (docs/sync/CONTRACT.md): required arrays -> [], required nested objects -> {}.
// Everything else is spread through untouched, so OPTIONAL, feature-detected
// fields (browser, obsidian, spellcraft, notebooklm) are preserved-if-present and
// NEVER fabricated — fabricating them would flip a realm's feature detection on.
// Scalars stay each realm's own `|| 0` business. Healthy data is byte-unchanged;
// nested refs are shared (only wrapper objects are new), so this is ~free.
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

function normAccount(a) {
  a = obj(a);
  return { ...a, totals: obj(a.totals), streak: obj(a.streak), daily_top3: arr(a.daily_top3) };
}
function normProject(p) {
  p = obj(p);
  const m = obj(p.metrics);
  return {
    ...p,
    completion: obj(p.completion),
    activity: obj(p.activity),
    signals: obj(p.signals),
    metrics: { ...m, git_safety: obj(m.git_safety), code_health: obj(m.code_health), risk_security: obj(m.risk_security) },
    insights: arr(p.insights),
    suggestions: arr(p.suggestions),
    roadmap: arr(p.roadmap),
    side_quests: arr(p.side_quests),
  };
}
function normInventory(inv) {
  inv = obj(inv);
  return {
    ...inv,
    vaults: arr(inv.vaults), clones: arr(inv.clones), anomalies: arr(inv.anomalies),
    duplicates: arr(inv.duplicates), empty: arr(inv.empty), trivial: arr(inv.trivial),
  };
}

// A missing/malformed scan stays null — the empty-bundle case realms already
// guard with `if (!ctx.data.selected) return`. A present scan is filled in place
// of the raw one; window.DATA itself is never mutated.
export function normalizeScan(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return {
    ...s,
    account: normAccount(s.account),
    projects: arr(s.projects).map(normProject),
    quests: arr(s.quests),
    side_quests: arr(s.side_quests),
    achievements: arr(s.achievements),
    changes_since_prev: arr(s.changes_since_prev),
    archived_projects: arr(s.archived_projects),
    recent_learnings: arr(s.recent_learnings),
    trends: obj(s.trends),
    inventory: normInventory(s.inventory),
  };
}

const SCANS = arr(D.scans).map(normalizeScan);   // normalized once at boot; time-machine + selected share these
const LATEST = normalizeScan(D.latest);
let idx = SCANS.length - 1;

export const data = {
  get bundle() { return D; },          // raw bundle: .spellbook .telemetry .weeklyRecap .actedOn (sidecars, not scans)
  get scans() { return SCANS; },       // normalized scans (see normalizeScan)
  get latest() { return LATEST; },     // normalized latest scan
  get selected() { return SCANS[idx] || null; },
  get selectedIndex() { return idx; },
  get isLatest() { return idx === SCANS.length - 1; },
  select(i) {
    const next = Math.max(0, Math.min(SCANS.length - 1, i));
    if (next === idx) return;
    idx = next;
    try { sessionStorage.setItem('hq-scan-idx', String(idx)); } catch {}   // survive win.reload()
    bus.emit('data:select', { index: idx, scan: SCANS[idx], isLatest: this.isLatest });
  },
};
