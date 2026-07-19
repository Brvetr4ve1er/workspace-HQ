'use strict';
// Pure ranking: given a scan, pick the single highest-leverage action to surface.
// Dual-mode: require()'d by the node test AND loaded as a plain <script> in the
// renderer (attaches window.computeOneThing). No build step, no dependencies.

const TIER_BASE = { red: 100, orange: 60, yellow: 30 };
const SEV_BASE = { high: 75, medium: 45, info: 10 };
const IMPACT_BONUS = { high: 15, medium: 8, low: 0 };
const EFFORT_PENALTY = { S: 0, M: -5, L: -10 };
const KIND_ORDER = { quest: 0, git: 1, side_quest: 2 }; // tie-break: quests first

const clamp = (n, max) => (n > max ? max : n < 0 ? 0 : n);

function questCandidates(S) {
  return (S.quests || [])
    .filter((q) => q.status === 'open' || q.status === 'in_progress')
    .map((q) => ({
      kind: 'quest', id: q.id, title: q.title,
      reason: q.insight || `+${q.xp || 0} XP · ${q.age_days || 0}d open`,
      project_id: q.project_id || null, project_name: null,
      weight: (TIER_BASE[q.tier] || 0) + clamp(q.xp || 0, 40) + clamp(q.age_days || 0, 20),
      quest: q,
    }));
}

function gitCandidates(S) {
  const out = [];
  for (const p of S.projects || []) {
    const g = p.metrics && p.metrics.git_safety;
    if (!g || !g.has_git) continue;
    const pushRisk = !!g.unpushed || (g.ahead || 0) > 0;
    const highRisk = g.risk === 'high';
    if (!pushRisk && !highRisk) continue;
    const days = (p.activity && p.activity.days_since_commit) || 0;
    out.push({
      kind: 'git', id: `git-${p.id}`,
      title: pushRisk ? `Push ${p.name}` : `Stabilize ${p.name}`,
      reason: [
        pushRisk ? `${g.ahead || 0} unpushed` : null,
        g.dirty ? `${g.dirty} dirty` : null,
        `${days}d since commit`,
        `risk ${g.risk || 'n/a'}`,
      ].filter(Boolean).join(' · '),
      project_id: p.id, project_name: p.name,
      weight: 70 + (highRisk ? 25 : 0) + clamp(days, 15) + (pushRisk ? 15 : 0),
      quest: null,
    });
  }
  return out;
}

function sideQuestCandidates(S) {
  return (S.side_quests || [])
    .filter((s) => (s.kind === 'risk' || s.kind === 'urgent') && (s.severity === 'high' || s.severity === 'medium'))
    .map((s) => ({
      kind: 'side_quest', id: s.id, title: s.title,
      reason: s.detail || `${s.severity} · ${s.impact || '?'} impact · ${s.effort || '?'} effort`,
      project_id: s.project_id || null, project_name: s.project_name || null,
      weight: (SEV_BASE[s.severity] || 0) + (IMPACT_BONUS[s.impact] || 0)
            + (EFFORT_PENALTY[s.effort] || 0) + (s.kind === 'urgent' ? 10 : 0),
      quest: null,
    }));
}

function computeOneThing(S) {
  if (!S) return null;
  const all = [...questCandidates(S), ...gitCandidates(S), ...sideQuestCandidates(S)];
  if (!all.length) return null;
  all.sort((a, b) =>
    (b.weight - a.weight)
    || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    || String(a.id).localeCompare(String(b.id)));
  return all[0];
}

if (typeof module !== 'undefined' && module.exports) module.exports = { computeOneThing };
if (typeof window !== 'undefined') window.computeOneThing = computeOneThing;
