import { clamp, round } from './util.mjs';
import { gitRisk } from './git-risk.mjs';

// Local level lookup for project scores. Task 4 coupling note: this takes `tiers`
// explicitly to avoid a forward dependency on gamification.mjs. Task 6 will extract
// the canonical levelFor into gamification.mjs and switch this import over.
// Moved from assemble.mjs (GCFG.level_curve.tiers -> tiers param).
function levelFor(xp, tiers) {
  let cur = tiers[0];
  for (const t of tiers) if (xp >= t.min_xp) cur = t;
  const next = tiers.find((t) => t.min_xp > cur.min_xp) || null;
  return {
    level: cur.level, title: cur.title,
    xp_into_level: xp - cur.min_xp,
    xp_to_next: next ? next.min_xp - xp : 0,
  };
}

// Deterministic completion estimate (0-100) from hard signals only — a "maturity"
// proxy used when no LLM enrichment is available, so completion stops being a flat 50.
export function deterministicCompletion(rp) {
  const g = rp.git || {};
  const s = rp.signals || {};
  let pct = 0;
  if (g.has_git) pct += 8;
  if (g.commits > 0) pct += 12;
  if (g.has_remote) pct += 10;
  if (g.commits >= 10) pct += 8;
  if (!(g.dirty > 20)) pct += 4;                  // not a giant uncommitted mess
  if (rp.activity?.state === 'active') pct += 14;
  else if (rp.activity?.state === 'stale') pct += 7;
  if ((rp.code?.files || 0) > 0) pct += 8;
  if ((rp.code?.loc || 0) > 500) pct += 6;
  if (s.has_readme) pct += 8;
  if (s.has_tests) pct += 9;
  if (s.has_ci) pct += 4;
  if (s.has_build_config) pct += 4;
  if (s.has_license) pct += 2;
  return clamp(Math.round(pct), 3, 95);
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Per-project "smart propositions": urgent/risky actions + creative ideas you might
// have forgotten. Deterministic generators from facts (always available), plus a
// passthrough of any LLM suggestions / risk_flags / roadmap when enrichment ran.
export function buildSideQuests(rp, en) {
  const out = [];
  const s = rp.signals || {}, g = rp.git || {}, sec = rp.security || {}, code = rp.code || {};
  const push = (sq) => { if (sq && !out.some((x) => x.id === sq.id)) out.push(sq); };
  const mk = (kind, key, title, detail, extra = {}) => ({
    id: `sq-${rp.id}-${key}`, project_id: rp.id, kind, title, detail, source: 'deterministic',
    effort: extra.effort || 'M', impact: extra.impact || 'medium',
    severity: extra.severity || (kind === 'risk' ? 'medium' : 'info'),
    ...(extra.data || {}),
  });

  // --- urgent / risk (act soon) ---
  if ((sec.secret_count || 0) > 0) {
    const pats = [...new Set((sec.secrets || []).map((x) => x.pattern))].join(', ');
    push(mk('risk', 'secrets', `Rotate ${sec.secret_count} exposed secret${sec.secret_count > 1 ? 's' : ''}`,
      `Scanner hit ${pats || 'credential-like strings'}. Rotate keys, purge from history, move to env.`,
      { severity: 'high', effort: 'M', impact: 'high' }));
  }
  if (g.dirty > 20) push(mk('urgent', 'dirty', `Commit the working tree (${g.dirty} files)`,
    `${g.dirty} uncommitted files — one bad command from gone.`, { severity: 'high', effort: 'S', impact: 'high' }));
  if ((code.todo_fixme || 0) >= 15) push(mk('urgent', 'todos', `Burn down ${code.todo_fixme} TODO/FIXME`,
    `${code.todo_fixme} loose ends flagged in code.`, { effort: 'M', impact: 'medium' }));
  const rec = rp.disk?.reclaimable_bytes || 0;
  if (rec > 100 * 1024 * 1024) {  // > 100 MB of regenerable cruft
    const human = rec >= 1073741824 ? (rec / 1073741824).toFixed(1) + ' GB' : Math.round(rec / 1048576) + ' MB';
    const top = (rp.disk.fat_dirs || []).slice(0, 2).map((d) => d.name).join(', ');
    push(mk('idea', 'reclaim', `Reclaim ${human} of disk`, `Regenerable caches (${top}) — safe to purge; rebuild restores them.`,
      { effort: 'S', impact: 'low', data: { reclaim_bytes: rec, fat_dirs: rp.disk.fat_dirs } }));
  }

  // --- ideas / polish (cool things to do next) ---
  if (g.has_git && !s.has_readme) push(mk('idea', 'readme', 'Write a README',
    'No README — capture what this is and how to run it.', { effort: 'S', impact: 'medium' }));
  if (g.has_git && g.commits > 0 && !s.has_tests) push(mk('idea', 'tests', 'Add a first test',
    'No tests detected — even one smoke test is a safety net.', { effort: 'M', impact: 'medium' }));
  if (g.has_remote && !s.has_ci) push(mk('idea', 'ci', 'Add CI',
    'Has a remote but no CI workflow — automate the checks.', { effort: 'M', impact: 'medium' }));
  if (g.has_remote && !s.has_license) push(mk('idea', 'license', 'Add a LICENSE',
    'Shared repo with no license — clarify usage rights.', { effort: 'S', impact: 'low' }));
  if (g.has_git && g.commits > 0 && rp.activity?.state === 'dormant') push(mk('idea', 'revive',
    `Revisit — dormant ${rp.activity?.days_since_commit ?? '?'}d`,
    'No commits in a while; ship the next step or archive it.', { effort: 'S', impact: 'low' }));

  // --- LLM passthrough (only present when enrichment ran) ---
  for (const f of en.risk_flags || []) push({
    id: `sq-${rp.id}-llm-${slugify(f.type || f.detail || 'risk')}`, project_id: rp.id, kind: 'risk',
    title: f.detail || f.type || 'Security risk', detail: f.location ? `at ${f.location}` : '',
    severity: f.severity || 'medium', effort: 'M', impact: 'high', source: 'llm',
  });
  (en.suggestions || []).forEach((sg, i) => push({
    id: `sq-${rp.id}-llm-sug-${i}-${slugify(sg.text || '')}`, project_id: rp.id,
    kind: sg.kind === 'urgent' ? 'urgent' : 'idea', title: sg.text || 'Suggestion', detail: '',
    effort: sg.effort || 'M', impact: sg.impact || 'medium', severity: 'info', source: 'llm',
  }));
  for (const r of en.roadmap || []) if (r.status !== 'done') push({
    id: `sq-${rp.id}-llm-rm-${slugify(r.milestone || '')}`, project_id: rp.id, kind: 'idea',
    title: r.milestone || 'Roadmap item', detail: (r.items || []).slice(0, 3).join('; '),
    effort: 'L', impact: 'medium', severity: 'info', source: 'llm',
  });

  const sevRank = { high: 0, medium: 1, info: 2, low: 3 };
  const kindRank = { risk: 0, urgent: 1, idea: 2, polish: 3 };
  out.sort((a, b) => (kindRank[a.kind] - kindRank[b.kind]) || (sevRank[a.severity] - sevRank[b.severity]));
  return out.slice(0, 8);
}

// ---- build one project (facts + carried soft fields) ----
// The three former module globals (prevProj, enrichProj, GCFG) are now an explicit
// deps object. `ps` is config.project_score.
export function buildProject(rp, { prevProj, enrichProj, config }) {
  const ps = config.project_score;
  const carried = prevProj.get(rp.id);
  const g = rp.git;
  const { risk, flags } = gitRisk(g);
  const on_canonical = g.branch === rp.canonical_branch;
  if (!on_canonical && g.has_git) flags.push('non-canonical-branch');

  // soft fields: enrichment.json wins, else carry from previous scan, else default
  const en = enrichProj[rp.id] || {};
  const codeHealthPrev = carried?.metrics?.code_health || {};
  const sig = rp.signals || {};
  const build = en.build || codeHealthPrev.build || 'unknown';
  const buildNote = en.build_note ?? codeHealthPrev.build_note ?? '';
  // tests: LLM judgment wins; else deterministic PRESENCE — we know test files exist,
  // not that they pass, so `passing` stays null until an LLM or a real run confirms it.
  const tests = en.tests || (sig.has_tests
    ? { present: true, count: sig.test_files || null, passing: null, status: 'present (unverified)' }
    : codeHealthPrev.tests || { present: false, status: 'none' });
  // completion: LLM > a prior REAL (non-stub) value > deterministic maturity heuristic.
  // The old flat-50 stub is gone; a stale "pending enrichment"/"heuristic" carry is ignored.
  const carriedComp = carried?.completion;
  const carriedIsReal = carriedComp && !/pending enrichment|heuristic/i.test(carriedComp.basis || '');
  const completionPct = en.completion?.pct ?? (carriedIsReal ? carriedComp.pct : deterministicCompletion(rp));
  const completionBasis = en.completion?.basis ?? (carriedIsReal ? carriedComp.basis : 'heuristic — git/activity/tests/docs (no LLM)');
  const riskSecPrev = carried?.metrics?.risk_security || { score: 'low', flags: [] };
  const riskFlags = en.risk_flags ?? riskSecPrev.flags ?? [];

  // project score (snapshot)
  const breakdown = {};
  breakdown.completion = completionPct * ps.completion_weight;
  breakdown.git = g.in_sync = (!g.unpushed && g.has_remote && g.commits > 0)
    ? ps.git_safety.in_sync
    : g.has_remote ? ps.git_safety.has_remote_dirty
    : g.has_git ? ps.git_safety.git_no_remote
    : ps.git_safety.no_git;
  breakdown.build = ps.build[build] ?? 0;
  breakdown.tests = tests.passing ? ps.tests.passing : tests.present ? ps.tests.present : ps.tests.none;
  breakdown.activity = ps.activity[rp.activity.state] ?? 0;
  breakdown.dirty_penalty = Math.max(ps.dirty_penalty_cap, g.dirty * ps.dirty_penalty_per_file);
  const score = round(Object.values(breakdown).reduce((a, b) => a + b, 0));
  const lv = levelFor(Math.max(0, score), config.level_curve.tiers);

  return {
    id: rp.id, name: rp.name, kind: 'product', path: rp.path, stack: rp.stack, dev_cmd: rp.dev_cmd, canonical_branch: rp.canonical_branch,
    completion: { pct: completionPct, basis: completionBasis, delta: completionPct - (prevProj.get(rp.id)?.completion?.pct ?? completionPct) },
    level: lv.level, xp: Math.max(0, score), xp_delta: 0, xp_breakdown: breakdown,
    activity: {
      state: rp.activity.state, last_commit: rp.activity.last_commit,
      days_since_commit: rp.activity.days_since_commit, commit_cadence_7d: carried?.activity?.commit_cadence_7d ?? null,
    },
    metrics: {
      code_health: { build, build_note: buildNote, tests, todo_fixme: rp.code.todo_fixme, files: rp.code.files, loc: rp.code.loc, loc_delta: carried?.metrics?.code_health?.loc != null ? rp.code.loc - carried.metrics.code_health.loc : null, recent_files: rp.code.recent_files || [] },
      git_safety: { has_git: g.has_git, has_remote: g.has_remote, remote: g.remote, branch: g.branch, commits: g.commits, dirty: g.dirty, ahead: g.ahead, behind: g.behind, unpushed: g.unpushed, risk, flags, last_commit_subject: g.last_commit_subject || null },
      activity: { state: rp.activity.state, last_modified: rp.activity.last_modified },
      risk_security: { score: rp.security.secret_count > 0 ? 'medium' : riskSecPrev.score, secrets_found: rp.security.secret_count, stale_deps: riskSecPrev.stale_deps ?? false, flags: riskFlags },
    },
    signals: sig,
    disk: rp.disk || { reclaimable_bytes: 0, fat_dirs: [] },
    insights: en.insights ?? carried?.insights ?? [],
    suggestions: en.suggestions ?? carried?.suggestions ?? [],
    roadmap: en.roadmap ?? carried?.roadmap ?? [],
    side_quests: buildSideQuests(rp, en),
    quest_ids: carried?.quest_ids || [],
  };
}
