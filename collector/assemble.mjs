#!/usr/bin/env node
// WorkspaceHQ assembler + gamification engine.
// Input:  raw-metrics.json (deterministic facts) + previous Workspace Status *.json
//         (carries completion%, build/test status, insights, and the quest board) +
//         schema/gamification.config.json (rules).
// Output: a new schema-valid Workspace Status <date>.json sidecar + data/latest.json.
//
// Deterministic: git-risk, XP, levels, streaks, achievements, quest auto-close, diff,
// trends. Soft fields (completion%, insights, suggestions, roadmaps) are CARRIED from
// the previous scan and are the slots an optional LLM enricher overwrites later.
//
// Usage: node assemble.mjs [--date YYYY-MM-DD] [--reports-dir <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'raw-metrics.json'), 'utf8'));
const GCFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'gamification.config.json'), 'utf8'));
const TODAY = arg('--date', new Date().toISOString().slice(0, 10));
const REPORTS_DIR = arg('--reports-dir', 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Workspace Status');

// ---- load previous scan (latest Workspace Status *.json that isn't today) ----
function loadPrevious() {
  let files = [];
  try {
    files = fs.readdirSync(REPORTS_DIR)
      .filter((f) => /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/.test(f))
      .filter((f) => !f.includes(TODAY))
      .sort();
  } catch { /* no dir yet */ }
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, files[files.length - 1]), 'utf8'));
}
const prev = loadPrevious();
const prevProj = new Map((prev?.projects || []).map((p) => [p.id, p]));
const prevQuest = new Map((prev?.quests || []).map((q) => [q.id, q]));

// Optional LLM enrichment: data/enrichment.json overrides the soft fields
// (completion / insights / suggestions / roadmap / build / tests). Absent => carry forward.
let enrichDoc = null;
try { enrichDoc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'enrichment.json'), 'utf8')); } catch { /* no enrichment */ }
const enrichProj = enrichDoc?.projects || {};
// True only when enrichment actually supplied project data this run; drives the
// "estimated / pending enrichment" markers in the UI so stubbed completion/build
// values are never presented as measured.
const enriched = !!enrichDoc && Object.keys(enrichProj).length > 0;
const enricherModel = enriched ? (enrichDoc.model || enrichDoc.engine || 'llm') : null;

// ---- helpers ----
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(n);

function gitRisk(g) {
  const flags = [];
  if (!g.has_git) { flags.push('no-git'); return { risk: 'high', flags }; }
  if (g.commits === 0) flags.push('no-commits');
  if (!g.has_remote) flags.push('no-remote');
  if (g.dirty > 20) flags.push('many-dirty');
  if (g.unpushed) flags.push('unpushed');
  let risk = 'low';
  if (g.commits === 0 || !g.has_remote || g.dirty > 20) risk = 'high';
  else if (g.unpushed || (g.dirty >= 6 && g.dirty <= 20) || g.behind > 0) risk = 'medium';
  return { risk, flags };
}

// Tiny safe evaluator for auto_complete_when expressions over a fact context.
function autoSatisfied(expr, ctx) {
  if (!expr || expr === 'manual') return false;
  try {
    const keys = Object.keys(ctx);
    // allow only comparisons / boolean ops / identifiers / numbers / quoted strings
    if (!/^[\sA-Za-z0-9_'"!=<>&|()."-]*$/.test(expr.replace(/'[^']*'/g, ''))) return false;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `try { return !!(${expr}); } catch { return false; }`);
    return fn(...keys.map((k) => ctx[k]));
  } catch { return false; }
}

function questCtx(q, prodById, emptyCount) {
  const p = q.project_id ? prodById.get(q.project_id) : null;
  if (!p) return { empty_count: emptyCount, registered: false };
  const g = p.metrics.git_safety;
  return {
    has_git: g.has_git, has_remote: g.has_remote, commits: g.commits,
    dirty: g.dirty, ahead: g.ahead, behind: g.behind, unpushed: g.unpushed,
    build: p.metrics.code_health.build,
  };
}

function levelFor(xp) {
  const tiers = GCFG.level_curve.tiers;
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
function deterministicCompletion(rp) {
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
function buildSideQuests(rp, en) {
  const out = [];
  const s = rp.signals || {}, g = rp.git || {}, sec = rp.security || {}, code = rp.code || {};
  const push = (sq) => { if (sq && !out.some((x) => x.id === sq.id)) out.push(sq); };
  const mk = (kind, key, title, detail, extra = {}) => ({
    id: `sq-${rp.id}-${key}`, project_id: rp.id, kind, title, detail, source: 'deterministic',
    effort: extra.effort || 'M', impact: extra.impact || 'medium',
    severity: extra.severity || (kind === 'risk' ? 'medium' : 'info'),
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

// ---- build projects (facts + carried soft fields) ----
const ps = GCFG.project_score;
function buildProject(rp) {
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
  const lv = levelFor(Math.max(0, score));

  return {
    id: rp.id, name: rp.name, kind: 'product', path: rp.path, stack: rp.stack, dev_cmd: rp.dev_cmd, canonical_branch: rp.canonical_branch,
    completion: { pct: completionPct, basis: completionBasis, delta: completionPct - (prevProj.get(rp.id)?.completion?.pct ?? completionPct) },
    level: lv.level, xp: Math.max(0, score), xp_delta: 0, xp_breakdown: breakdown,
    activity: {
      state: rp.activity.state, last_commit: rp.activity.last_commit,
      days_since_commit: rp.activity.days_since_commit, commit_cadence_7d: carried?.activity?.commit_cadence_7d ?? null,
    },
    metrics: {
      code_health: { build, build_note: buildNote, tests, todo_fixme: rp.code.todo_fixme, files: rp.code.files, loc: rp.code.loc, loc_delta: carried?.metrics?.code_health?.loc != null ? rp.code.loc - carried.metrics.code_health.loc : null },
      git_safety: { has_git: g.has_git, has_remote: g.has_remote, remote: g.remote, branch: g.branch, commits: g.commits, dirty: g.dirty, ahead: g.ahead, behind: g.behind, unpushed: g.unpushed, risk, flags },
      activity: { state: rp.activity.state, last_modified: rp.activity.last_modified },
      risk_security: { score: rp.security.secret_count > 0 ? 'medium' : riskSecPrev.score, secrets_found: rp.security.secret_count, stale_deps: riskSecPrev.stale_deps ?? false, flags: riskFlags },
    },
    signals: sig,
    insights: en.insights ?? carried?.insights ?? [],
    suggestions: en.suggestions ?? carried?.suggestions ?? [],
    roadmap: en.roadmap ?? carried?.roadmap ?? [],
    side_quests: buildSideQuests(rp, en),
    quest_ids: carried?.quest_ids || [],
  };
}

const projects = RAW.products.filter((p) => !p.missing).map(buildProject);
const prodById = new Map(projects.map((p) => [p.id, p]));

// ---- quests: carry forward + auto-close + derive new git/build quests ----
const emptyCount = RAW.discovered.filter((d) => d.classification === 'empty').length;
const quests = [];
let questsCompletedThisScan = 0;

// 1) carry previous quests, re-evaluate
for (const q of prev?.quests || []) {
  const nq = { ...q };
  const ctx = questCtx(q, prodById, emptyCount);
  if (nq.status !== 'done' && nq.status !== 'dismissed' && autoSatisfied(q.auto_complete_when, ctx)) {
    nq.status = 'done'; nq.completed = TODAY; questsCompletedThisScan++;
  }
  if (nq.status !== 'done') nq.age_days = q.carried_from ? Math.round((Date.parse(TODAY) - Date.parse(q.carried_from)) / 86400000) : 0;
  quests.push(nq);
}
const haveQuest = new Set(quests.map((q) => q.id));

// 2) derive git/build quests from current facts (dedup against carried quests by "concern")
const occupied = new Map(); // project_id -> Set(concern)
for (const q of quests) {
  if (!q.project_id || (q.status !== 'open' && q.status !== 'in_progress')) continue;
  const text = `${q.auto_complete_when || ''} ${JSON.stringify(q.evidence || {})} ${q.title}`;
  const set = occupied.get(q.project_id) || new Set();
  if (/dirty|commit|remote|ahead|push|git|version control/i.test(text)) set.add('git');
  if (/build|crash/i.test(text)) set.add('build');
  occupied.set(q.project_id, set);
}
const hasConcern = (pid, c) => occupied.get(pid)?.has(c);
function addQuest(q, concern) {
  if (haveQuest.has(q.id)) return;
  if (concern && hasConcern(q.project_id, concern)) return; // a carried quest already covers this
  quests.push(q); haveQuest.add(q.id);
  const set = occupied.get(q.project_id) || new Set();
  if (concern) { set.add(concern); occupied.set(q.project_id, set); }
}
for (const p of projects) {
  const g = p.metrics.git_safety;
  const base = { project_id: p.id, status: 'open', created: TODAY, completed: null, carried_from: TODAY, age_days: 0 };
  if (!g.has_git)
    addQuest({ ...base, id: `q-${p.id}-gitinit`, title: `Put ${p.name} under version control`, tier: 'red', xp: GCFG.quest_xp_by_tier.red, insight: `${p.name} has no git repo — zero rollback safety.`, evidence: { has_git: false }, auto_complete_when: 'has_git && commits>0' }, 'git');
  else if (g.commits === 0)
    addQuest({ ...base, id: `q-${p.id}-commit`, title: `Commit + push ${p.name}`, tier: 'red', xp: GCFG.quest_xp_by_tier.red, insight: `git init done but 0 commits.`, evidence: { commits: 0 }, auto_complete_when: 'commits>0 && has_remote' }, 'git');
  else if (!g.has_remote)
    addQuest({ ...base, id: `q-${p.id}-remote`, title: `Add a remote + push ${p.name}`, tier: 'red', xp: GCFG.quest_xp_by_tier.red, insight: `${g.commits} commits but no remote.`, evidence: { has_remote: false }, auto_complete_when: 'has_remote' }, 'git');
  else if (g.dirty > 20)
    addQuest({ ...base, id: `q-${p.id}-commit-dirty`, title: `Commit ${p.name} working tree (${g.dirty} files)`, tier: 'red', xp: GCFG.quest_xp_by_tier.red, insight: `${g.dirty} uncommitted files at risk.`, evidence: { dirty: g.dirty }, auto_complete_when: 'dirty<=2' }, 'git');
  else if (g.unpushed)
    addQuest({ ...base, id: `q-${p.id}-push`, title: `Push ${p.name} (${g.ahead} ahead)`, tier: 'orange', xp: GCFG.quest_xp_by_tier.orange, insight: `${g.ahead} commits unpushed.`, evidence: { ahead: g.ahead }, auto_complete_when: 'unpushed==false && ahead==0' }, 'git');
  if (p.metrics.code_health.build === 'red')
    addQuest({ ...base, id: `q-${p.id}-build`, title: `Fix ${p.name} build`, tier: 'red', xp: GCFG.quest_xp_by_tier.red, insight: p.metrics.code_health.build_note || 'Build is red.', evidence: {}, auto_complete_when: "build!='red'" }, 'build');
}

// 3) user overrides from the dashboard (e.g. "mark done" clicks): data/quest-overrides.json
let overrides = {};
try { overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'quest-overrides.json'), 'utf8')); } catch { /* none */ }
for (const q of quests) {
  const ov = overrides[q.id];
  if (ov?.status === 'done' && q.status !== 'done') { q.status = 'done'; q.completed = ov.completed || TODAY; questsCompletedThisScan++; }
  if (ov?.status === 'dismissed') q.status = 'dismissed';
}
// same override layer for side-quests (done/dismissed from the dashboard or Obsidian),
// kept off the core XP economy — side-quests are optional propositions, not the quest board.
for (const p of projects) {
  for (const sq of p.side_quests || []) {
    const ov = overrides[sq.id];
    if (ov?.status === 'done') { sq.done = true; sq.completed = ov.completed || TODAY; }
    if (ov?.status === 'dismissed') sq.dismissed = true;
  }
}

const openQ = quests.filter((q) => q.status === 'open' || q.status === 'in_progress');
const tierCount = (t) => openQ.filter((q) => q.tier === t).length;

// ---- gamification rollup ----
const avgCompletion = projects.reduce((a, p) => a + p.completion.pct, 0) / (projects.length || 1);
const riskCounts = { high: 0, medium: 0, low: 0 };
for (const p of projects) riskCounts[p.metrics.git_safety.risk]++;
const buildOk = projects.filter((p) => ['green', 'runs'].includes(p.metrics.code_health.build)).length;
const buildScore = (buildOk / (projects.length || 1)) * 100;
const testCovScore = (projects.filter((p) => p.metrics.code_health.tests?.passing).length / (projects.length || 1)) * 100;
// risk_security.flags are objects {type,severity,...} only when the LLM enricher ran;
// guard against the carried string entries. Crucially, fold in raw DETECTED secrets so
// ~30 found credentials stop scoring 0 risk (the long-standing "frozen health" bug).
const secHigh = projects.reduce((a, p) => a + (p.metrics.risk_security.flags || []).filter((f) => f && f.severity === 'high').length, 0);
const secMed = projects.reduce((a, p) => a + (p.metrics.risk_security.flags || []).filter((f) => f && f.severity === 'medium').length, 0);
const secretsFound = projects.reduce((a, p) => a + (p.metrics.risk_security.secrets_found || 0), 0);
const riskScore = clamp(secHigh * 20 + secMed * 8 + Math.min(secretsFound * 4, 60), 0, 100);
const gitSafetyScore = clamp(100 - (riskCounts.high * 25 + riskCounts.medium * 10), 0, 100);
const healthIndex = round(0.30 * avgCompletion + 0.25 * gitSafetyScore + 0.20 * buildScore + 0.15 * (100 - riskScore) + 0.10 * testCovScore);

// streak
let scanDays = 1, longest = 1;
if (prev?.account?.streak) {
  const prevDate = prev.account.streak.last_scan;
  const gap = (Date.parse(TODAY) - Date.parse(prevDate)) / 86400000;
  if (gap <= 1.5) { scanDays = (prev.account.streak.scan_days || 1) + 1; }
  longest = Math.max(prev.account.streak.longest_scan_days || 1, scanDays);
}

// account XP: previous account xp + quest completions this scan + streak day
const prevXp = prev?.account?.xp ?? round(projects.reduce((a, p) => a + p.xp, 0));
let xpGain = quests.filter((q) => q.completed === TODAY).reduce((a, q) => a + (q.xp || 0), 0);
xpGain += GCFG.xp_awards.streak_day;
const accountXp = prevXp + (prev ? xpGain : 0);
const lv = levelFor(accountXp);

// achievements
const achievements = GCFG.achievements.map((a) => {
  const prevA = (prev?.achievements || []).find((x) => x.id === a.id);
  let unlocked = prevA?.unlocked || false, progress = null, project_id = prevA?.project_id || null;
  switch (a.id) {
    case 'liftoff': { const u = projects.some((p) => p.metrics.git_safety.has_remote && p.metrics.git_safety.commits > 0); unlocked = unlocked || u; break; }
    case 'in_sync': { const have = projects.filter((p) => p.metrics.git_safety.has_git && p.metrics.git_safety.dirty === 0).length; unlocked = unlocked || have > 0; progress = { have, need: 1 }; break; }
    case 'green_machine': { const have = buildOk; unlocked = unlocked || have === projects.length; progress = { have, need: projects.length }; break; }
    case 'version_control': { const have = projects.filter((p) => p.metrics.git_safety.has_git && p.metrics.git_safety.commits > 0).length; unlocked = unlocked || have === projects.length; progress = { have, need: projects.length }; break; }
    case 'quest_streak_5': { const have = quests.filter((q) => q.status === 'done').length; unlocked = unlocked || have >= 5; progress = { have, need: 5 }; break; }
    case 'scan_streak_7': { unlocked = unlocked || scanDays >= 7; progress = { have: scanDays, need: 7 }; break; }
    case 'debt_zero': { const have = tierCount('red'); unlocked = unlocked || have === 0; progress = { have, need: 0 }; break; }
    case 'declutter': { unlocked = unlocked || emptyCount === 0; progress = { have: emptyCount === 0 ? 1 : 0, need: 1 }; break; }
    case 'test_first': { const have = projects.filter((p) => p.metrics.code_health.tests?.passing).length; unlocked = unlocked || have > 0; progress = { have, need: 1 }; break; }
    case 'crash_slayer': { const u = projects.some((p) => { const pp = prevProj.get(p.id); return pp && pp.metrics?.code_health?.build === 'red' && ['green', 'runs'].includes(p.metrics.code_health.build); }); unlocked = unlocked || u; break; }
    case 'secret_free': { const have = projects.filter((p) => (p.metrics.risk_security.secrets_found || 0) === 0).length; unlocked = unlocked || have === projects.length; progress = { have, need: projects.length }; break; }
    case 'documented': { const have = projects.filter((p) => p.signals?.has_readme).length; unlocked = unlocked || have === projects.length; progress = { have, need: projects.length }; break; }
    default: break;
  }
  const out = { id: a.id, unlocked };
  if (unlocked) { out.unlocked_on = prevA?.unlocked_on || TODAY; if (project_id) out.project_id = project_id; }
  else if (progress) out.progress = progress;
  return out;
});

// ---- trends (append today to previous) ----
function appendTrend(arr, point, key = 'd') {
  const a = (arr || []).filter((x) => x[key] !== TODAY);
  a.push(point);
  return a;
}
const trends = {
  health_index: appendTrend(prev?.trends?.health_index, { d: TODAY, v: healthIndex }),
  xp: appendTrend(prev?.trends?.xp, { d: TODAY, v: accountXp }),
  completion_by_project: { ...(prev?.trends?.completion_by_project || {}) },
  open_quests_by_tier: appendTrend(prev?.trends?.open_quests_by_tier, { d: TODAY, red: tierCount('red'), orange: tierCount('orange'), yellow: tierCount('yellow') }),
  git_risk: appendTrend(prev?.trends?.git_risk, { d: TODAY, high: riskCounts.high, medium: riskCounts.medium, low: riskCounts.low }),
};
for (const p of projects) {
  trends.completion_by_project[p.id] = appendTrend(trends.completion_by_project[p.id], { d: TODAY, v: p.completion.pct });
}

// ---- changes since prev ----
const changes = [];
for (const p of projects) {
  const c = prevProj.get(p.id);
  if (!c) { changes.push({ type: 'new_project', project_id: p.id, detail: `${p.name} added.`, impact: 'neutral', notify: false }); continue; }
  const cg = c.metrics?.git_safety || {};
  if (cg.unpushed && !p.metrics.git_safety.unpushed) changes.push({ type: 'git_pushed', project_id: p.id, detail: `${p.name} pushed (was ${cg.ahead} ahead).`, impact: 'positive', notify: true });
  if (!cg.has_remote && p.metrics.git_safety.has_remote) changes.push({ type: 'first_remote', project_id: p.id, detail: `${p.name} gained a remote.`, impact: 'positive', notify: false });
  if (cg.build === 'red' && p.metrics.code_health.build !== 'red') changes.push({ type: 'build_flip', project_id: p.id, detail: `${p.name} build recovered.`, impact: 'positive', notify: true });
}
for (const q of quests) {
  if (q.completed === TODAY) changes.push({ type: 'quest_completed', project_id: q.project_id, quest_id: q.id, detail: q.title, impact: 'positive', notify: q.tier === 'red' });
}
// level-up + freshly-unlocked achievements — the big celebration triggers the dashboard
// takeover animation reads out of changes_since_prev.
if (prev && lv.level > (prev.account?.level ?? lv.level))
  changes.push({ type: 'level_up', level: lv.level, title: lv.title, detail: `Leveled up to ${lv.level} — ${lv.title}`, impact: 'positive', notify: true });
for (const a of achievements) {
  if (!a.unlocked) continue;
  const prevA = (prev?.achievements || []).find((x) => x.id === a.id);
  if (prevA?.unlocked) continue;
  const def = GCFG.achievements.find((d) => d.id === a.id) || {};
  changes.push({ type: 'new_achievement', achievement_id: a.id, name: def.name, icon: def.icon, xp: def.xp, detail: `Unlocked: ${def.name || a.id}`, impact: 'positive', notify: true });
}

// ---- inventory ----
const inventory = {
  vaults: RAW.vaults.map((v) => ({ name: v.name, notes: v.notes, role: v.role, recent7: v.recent7 ?? 0, stale90: v.stale90 ?? 0, kb: v.kb ?? 0 })),
  clones: RAW.clones.map((c) => ({ name: c.name, origin: c.origin || '(none)', dirty: c.dirty, diverged: c.diverged })),
  trivial: (prev?.inventory?.trivial || []),
  empty: RAW.discovered.filter((d) => d.classification === 'empty').map((d) => d.name),
  anomalies: (prev?.inventory?.anomalies || []),
};

// ---- side-quest feed (flattened + globally sorted for the Ideas & Risks surface) ----
const sideQuestFeed = projects
  .flatMap((p) => (p.side_quests || []).map((sq) => ({ ...sq, project_name: p.name })))
  .filter((sq) => !sq.dismissed && !sq.done);
{
  const sevRank = { high: 0, medium: 1, info: 2, low: 3 };
  const kindRank = { risk: 0, urgent: 1, idea: 2, polish: 3 };
  sideQuestFeed.sort((a, b) => (kindRank[a.kind] - kindRank[b.kind]) || (sevRank[a.severity] - sevRank[b.severity]));
}

// ---- final doc ----
const doc = {
  schema_version: '1.0',
  scan: { id: TODAY, date: new Date().toISOString(), mode: 'manual', previous_scan: prev?.scan?.id || null, enriched, engine: { collector: RAW.collector_version, enricher: enricherModel } },
  account: {
    level: lv.level, title: lv.title, xp: accountXp, xp_into_level: lv.xp_into_level, xp_to_next: lv.xp_to_next,
    health_index: healthIndex, health_delta: healthIndex - (prev?.account?.health_index ?? healthIndex),
    streak: { scan_days: scanDays, longest_scan_days: longest, last_scan: TODAY },
    totals: { products: projects.length, vaults: inventory.vaults.length, clones: inventory.clones.length, trivial: inventory.trivial.length, open_quests: openQ.length, red_quests: tierCount('red'), quests_done_total: quests.filter((q) => q.status === 'done').length, achievements_unlocked: achievements.filter((a) => a.unlocked).length, open_side_quests: sideQuestFeed.length },
  },
  achievements,
  projects,
  quests,
  side_quests: sideQuestFeed.slice(0, 40),
  trends,
  changes_since_prev: changes,
  inventory,
};

const outPath = path.join(REPORTS_DIR, `Workspace Status ${TODAY}.json`);
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'latest.json'), JSON.stringify(doc, null, 2));

console.log(`[assemble] L${lv.level} ${lv.title} · ${accountXp}xp (+${prev ? xpGain : 0}) · health=${healthIndex} (${doc.account.health_delta >= 0 ? '+' : ''}${doc.account.health_delta})`);
console.log(`[assemble] quests: ${openQ.length} open (R${tierCount('red')}/O${tierCount('orange')}/Y${tierCount('yellow')}), ${questsCompletedThisScan} auto-closed this scan`);
console.log(`[assemble] side-quests: ${sideQuestFeed.length} open (${sideQuestFeed.filter((s) => s.kind === 'risk' || s.kind === 'urgent').length} urgent/risk) · enriched=${enriched}`);
console.log(`[assemble] -> ${outPath}`);
