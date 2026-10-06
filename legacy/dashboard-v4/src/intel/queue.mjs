// queue.mjs — PURE: composes the WORK-surface queue from the scan snapshot.
// Imports only pure siblings (derive.mjs, agency.mjs — themselves import-free).
// No DOM, no Date.now(), no globals (same firewall as the rest of intel/).
//
// buildQueue(selected) -> { items, counts }
//   item = { id, source:'threat'|'task'|'gap'|'idea', title, detail,
//            projectId, projectName, projectPath, severity, verbs:[...] }
//   severity is a CLOSED enum: 'red'|'orange'|'yellow'|'dim' — unknown threat
//   kinds and unknown quest tiers land on 'dim', they never leak through.
//   Order: threats (triage's blast desc) -> tasks (tier: red,orange,yellow,
//   then unknown; stable within a tier) -> gaps -> ideas.
//   counts = per-source totals computed from items (absent source = no key),
//   so null/{}/garbage input yields { items:[], counts:{} } and never throws.
//
// Dispatch contract: 'dispatch' is only ever offered when projectPath resolved
// from selected.projects (never an inert verb — it is DROPPED otherwise, which
// can leave an idea with verbs:[]). Dispatch consumers use item.seedPrompt when
// present (gaps carry agency's seedPrompt; for ideas the title IS the task, so
// seedPrompt === title), else compose from title.
import { triage } from './derive.mjs';
import { agencyProposals } from './agency.mjs';

// warroom's kind -> severity map (dashboard-v3 warroom-model.mjs SEV)
const THREAT_SEV = { security: 'red', uncommitted: 'orange', stale: 'yellow', 'no-tests': 'dim', 'no-ci': 'dim' };
const TIER_SEV = { red: 'red', orange: 'orange', yellow: 'yellow' };
const TIER_RANK = { red: 0, orange: 1, yellow: 2 };
const OPEN = new Set(['open', 'in_progress']);

const dropDispatch = (verbs, path) => (path ? verbs : verbs.filter((v) => v !== 'dispatch'));

export function buildQueue(selected) {
  const sel = (selected && typeof selected === 'object') ? selected : {};
  // project_id -> {name, path} lookup; null (not undefined) when unresolvable
  const byId = new Map();
  for (const p of (Array.isArray(sel.projects) ? sel.projects : [])) {
    if (p && p.id != null) byId.set(p.id, { name: p.name ?? null, path: p.path ?? null });
  }
  const proj = (id) => byId.get(id) || { name: null, path: null };
  const items = [];

  // threats — triage() rows arrive blast-sorted desc; keep that order
  for (const r of triage(sel)) {
    const { name, path } = proj(r.projectId);
    items.push({
      id: `threat:${r.projectId}:${r.kind}`,
      source: 'threat',
      title: r.detail,               // triage's human phrase ("2 exposed secrets")
      detail: r.kind,
      projectId: r.projectId,
      projectName: name ?? r.name ?? null,
      projectPath: path,
      severity: THREAT_SEV[r.kind] || 'dim',
      verbs: dropDispatch(['dispatch', 'open'], path),
    });
  }

  // tasks — open/in_progress quests, sorted by tier (stable within a tier)
  const quests = (Array.isArray(sel.quests) ? sel.quests : []).filter((q) => q && OPEN.has(q.status));
  quests
    .map((q, i) => ({ q, i }))
    .sort((a, b) => ((TIER_RANK[a.q.tier] ?? 9) - (TIER_RANK[b.q.tier] ?? 9)) || (a.i - b.i))
    .forEach(({ q }) => {
      const { name, path } = proj(q.project_id);
      items.push({
        id: `task:${q.id}`,
        source: 'task',
        title: q.title ?? '',
        detail: q.insight ?? '',
        projectId: q.project_id ?? null,
        projectName: name,
        projectPath: path,
        severity: TIER_SEV[q.tier] || 'dim',
        verbs: dropDispatch(['done', 'dispatch', 'open'], path),
      });
    });

  // gaps — agencyProposals() already path-gates, so dispatch is always live
  for (const g of agencyProposals(sel)) {
    items.push({
      id: `gap:${g.projectId}:${g.gap}`,
      source: 'gap',
      title: g.label,
      detail: g.captureText,
      projectId: g.projectId,
      projectName: g.projectName ?? null,
      projectPath: g.projectPath,
      severity: 'dim',
      verbs: dropDispatch(['dispatch', 'note'], g.projectPath),
      seedPrompt: g.seedPrompt,
    });
  }

  // ideas — side_quests with kind==='idea'; the title IS the dispatch task
  for (const sq of (Array.isArray(sel.side_quests) ? sel.side_quests : [])) {
    if (!sq || sq.kind !== 'idea') continue;
    const { name, path } = proj(sq.project_id);
    items.push({
      id: `idea:${sq.id}`,
      source: 'idea',
      title: sq.title ?? '',
      detail: sq.detail ?? '',
      projectId: sq.project_id ?? null,
      projectName: name ?? sq.project_name ?? null,
      projectPath: path,
      severity: 'dim',
      verbs: dropDispatch(['dispatch'], path),   // may leave [] — never an inert verb
      seedPrompt: sq.title ?? '',
    });
  }

  const counts = {};
  for (const it of items) counts[it.source] = (counts[it.source] || 0) + 1;
  return { items, counts };
}
