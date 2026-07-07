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
import { clamp, round } from './lib/util.mjs';

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

// project-overrides: archived projects drop out of active counts but stay carried for history
let projOverrides = {};
try { projOverrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'project-overrides.json'), 'utf8')); } catch {}
const allProjects = RAW.products.filter((p) => !p.missing).map(buildProject);
allProjects.forEach((p) => { if (projOverrides[p.id]?.status === 'archived') { p.archived = true; p.archived_on = projOverrides[p.id].archived; } });
const projects = allProjects.filter((p) => !p.archived);
const archivedProjects = allProjects.filter((p) => p.archived);
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

// ---- spellcraft: settle Spellbook cast telemetry into the single XP ledger ----
// Both inputs are OPTIONAL — without spellbook.json / spell-telemetry.json this
// block yields null and the scan is byte-identical to pre-spellbook behavior.
// Grind-proofing by construction: base cast XP pays once per spell per day and is
// capped per day; mastery counts distinct days; each cast settles exactly once
// (watermark carried in account.spellcraft.last_processed_at).
let spellbookCat = null, spellTele = null;
try { spellbookCat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spellbook.json'), 'utf8')); } catch { /* scanner hasn't run */ }
try { spellTele = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spell-telemetry.json'), 'utf8')); } catch { /* nothing cast yet */ }
const SC = GCFG.spellcraft || {};
const scTiers = SC.mastery_tiers || [];
const scRankOf = (days) => { let r = null; for (const t of scTiers) if (days >= t.days) r = t.rank; return r; };
const scRankIdx = (rank) => scTiers.findIndex((t) => t.rank === rank);

let spellcraft = null, spellXp = 0, spellOfDay = null;
const spellcraftEvents = [];   // pushed into changes_since_prev further down
if (spellbookCat) {
  const catById = new Map(spellbookCat.spells.map((s) => [s.id, s]));
  const prevSC = prev?.account?.spellcraft || null;
  const rollup = spellTele?.rollup || {};
  const casts = spellTele?.casts || [];
  const watermark = prevSC?.last_processed_at || '';
  const fresh = casts.filter((c) => c.started_at > watermark && (c.outcome === 'resolved' || c.outcome === 'channeled'));

  // base cast XP: dedup per spell per day, then cap the day's total
  const perDay = {};
  for (const c of fresh) (perDay[c.started_at.slice(0, 10)] ??= new Set()).add(c.spell_id);
  for (const ids of Object.values(perDay)) spellXp += Math.min(ids.size * (SC.cast_xp ?? 5), SC.cast_xp_daily_cap_total ?? 25);

  // mastery (from rollup distinct-days) + first-cast / rank-up bonuses vs prev scan
  const mastery = {};
  for (const [id, r] of Object.entries(rollup)) {
    if (!catById.has(id)) continue;   // orphaned telemetry (spell removed) earns nothing
    const days = (r.distinct_days || []).length;
    const rank = scRankOf(days);
    if (rank) mastery[id] = { rank, distinct_days: days };
  }
  const prevMastery = prevSC?.mastery || {};
  let newSpellsCast = 0;
  for (const [id, m] of Object.entries(mastery)) {
    const name = catById.get(id)?.name || id;
    if (!prevMastery[id]) { spellXp += SC.first_cast_bonus ?? 15; newSpellsCast++; }
    else if (scRankIdx(m.rank) > scRankIdx(prevMastery[id].rank)) {
      spellXp += SC.mastery_rank_up_xp ?? 20;
      spellcraftEvents.push({ type: 'spell_mastery_up', detail: `🏅 ${name} mastery → ${m.rank} (${m.distinct_days} days)`, impact: 'positive', notify: false });
    }
  }

  // spell-of-the-day bonus: cast yesterday's pick since the last settlement
  let sotdCasts = prevSC?.sotd_casts || 0;
  const prevPick = prevSC?.spell_of_day?.id;
  if (prevPick && fresh.some((c) => c.spell_id === prevPick)) {
    spellXp += SC.spell_of_day_bonus ?? 10;
    sotdCasts++;
    spellcraftEvents.push({ type: 'spell_of_day_cast', detail: `🃏 Spell of the Day cast (+${SC.spell_of_day_bonus ?? 10} bonus XP)`, impact: 'positive', notify: false });
  }

  // today's pick (deterministic): date-hash over a rarity-weighted pool of spells
  // not cast in the last 7 days — the game nudges you toward the unused arsenal.
  const rarityIdx = (r) => Math.max(0, (SC.rarity_order || []).indexOf(r));
  const cutoff = new Date(Date.parse(TODAY) - 7 * 86400000).toISOString();
  const pool = spellbookCat.spells.filter((s) => !s.invalid && (s.kind === 'castable' || s.kind === 'channeled')
    && (!rollup[s.id]?.last_cast || rollup[s.id].last_cast < cutoff));
  if (pool.length) {
    const weighted = pool.flatMap((s) => Array(rarityIdx(s.rarity) + 1).fill(s));
    let h = 0; for (const ch of TODAY) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = weighted[h % weighted.length];
    spellOfDay = { id: pick.id, name: pick.name, icon: pick.icon, school: pick.school, rarity: pick.rarity, bonus_xp: SC.spell_of_day_bonus ?? 10 };
  }

  // collection meters
  const everCastIds = Object.keys(mastery).filter((id) => catById.has(id));
  const perSchool = {};
  for (const s of spellbookCat.spells) {
    const ps = (perSchool[s.school] ??= { known: 0, cast: 0, pct: 0 });
    ps.known++;
  }
  for (const id of everCastIds) {
    const ps = perSchool[catById.get(id).school];
    if (ps) ps.cast++;
  }
  for (const ps of Object.values(perSchool)) ps.pct = ps.known ? round((ps.cast / ps.known) * 100) : 0;
  const lifetimeCasts = Object.values(rollup).reduce((a, r) => a + (r.lifetime_casts || 0), 0);

  const maxWatermark = fresh.reduce((a, c) => (c.started_at > a ? c.started_at : a), watermark);
  spellcraft = {
    spells_known: spellbookCat.counts.total,
    familiars_bound: (spellbookCat.familiars || []).length,
    ever_cast: everCastIds.length,
    ever_cast_pct: spellbookCat.counts.total ? round((everCastIds.length / spellbookCat.counts.total) * 100) : 0,
    per_school: perSchool,
    lifetime_casts: lifetimeCasts,
    mastery,
    sotd_casts: sotdCasts,
    spell_of_day: spellOfDay,
    last_processed_at: maxWatermark,
    xp_settled_this_scan: prev ? spellXp : 0,
  };
  if (newSpellsCast) spellcraftEvents.push({ type: 'spell_learned', detail: `🪄 ${newSpellsCast} spell(s) cast for the first time (+${newSpellsCast * (SC.first_cast_bonus ?? 15)} XP)`, impact: 'positive', notify: false });
  if (prevSC && spellbookCat.counts.total > prevSC.spells_known) {
    spellcraftEvents.push({ type: 'spell_learned', detail: `✨ Arsenal grew: ${prevSC.spells_known} → ${spellbookCat.counts.total} spells known`, impact: 'positive', notify: false });
  }
}

// account XP: previous account xp + quest completions this scan + streak day + spellcraft
const prevXp = prev?.account?.xp ?? round(projects.reduce((a, p) => a + p.xp, 0));
let xpGain = quests.filter((q) => q.completed === TODAY).reduce((a, q) => a + (q.xp || 0), 0);
xpGain += GCFG.xp_awards.streak_day;
xpGain += spellXp;
const accountXp = prevXp + (prev ? xpGain : 0);
const lv = levelFor(accountXp);

// achievements
// ---- learnings (Wave 5): Knowledge XP track + projects-with-vault-note count ----
let learnings = [];
try { learnings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'learnings.json'), 'utf8')); } catch {}
const knowledgeXp = learnings.length * 15;
const projectsWithNote = projects.filter((p) => {
  try { return fs.existsSync(path.join('C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Projects', String(p.name).replace(/[\\/:*?"<>|]/g, '-').trim() + '.md')); } catch { return false; }
}).length;

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
    case 'scribe': { unlocked = unlocked || learnings.length >= 30; progress = { have: learnings.length, need: 30 }; break; }
    case 'cartographer': { unlocked = unlocked || projectsWithNote === projects.length; progress = { have: projectsWithNote, need: projects.length }; break; }
    // ---- spellcraft achievements (all no-op locked when spellbook data is absent) ----
    case 'first_cast': { unlocked = unlocked || (spellcraft?.ever_cast ?? 0) >= 1; break; }
    case 'arcanist_50': { const have = spellcraft?.spells_known ?? 0; unlocked = unlocked || have >= 50; progress = { have, need: 50 }; break; }
    case 'battle_mage_100': { const have = spellcraft?.lifetime_casts ?? 0; unlocked = unlocked || have >= 100; progress = { have, need: 100 }; break; }
    case 'polymath': {
      const schools = Object.values(spellcraft?.per_school || {});
      const have = schools.filter((s) => s.cast > 0).length;
      unlocked = unlocked || (schools.length >= 8 && have === schools.length);
      progress = { have, need: Math.max(schools.length, 8) }; break;
    }
    case 'familiar_bond': { const have = spellcraft?.familiars_bound ?? 0; unlocked = unlocked || have >= 5; progress = { have, need: 5 }; break; }
    case 'spell_master': {
      const have = Object.values(spellcraft?.mastery || {}).reduce((a, m) => Math.max(a, m.distinct_days), 0);
      unlocked = unlocked || have >= 40; progress = { have, need: 40 }; break;
    }
    case 'daily_ritualist': { const have = spellcraft?.sotd_casts ?? 0; unlocked = unlocked || have >= 7; progress = { have, need: 7 }; break; }
    case 'chain_caster': {
      // Phase 9 chains record a summary telemetry entry whose cast_id === chain_id.
      const u = (spellTele?.casts || []).some((c) => c.chain_id && c.chain_id === c.cast_id && c.outcome === 'resolved');
      unlocked = unlocked || u; break;
    }
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
const castsToday = (spellTele?.casts || []).filter((c) => c.started_at.slice(0, 10) === TODAY).length;
const trends = {
  health_index: appendTrend(prev?.trends?.health_index, { d: TODAY, v: healthIndex }),
  xp: appendTrend(prev?.trends?.xp, { d: TODAY, v: accountXp }),
  knowledge_xp: appendTrend(prev?.trends?.knowledge_xp, { d: TODAY, v: knowledgeXp }),
  casts_per_day: spellbookCat ? appendTrend(prev?.trends?.casts_per_day, { d: TODAY, v: castsToday }) : (prev?.trends?.casts_per_day || []),
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
// spellcraft events (mastery-ups, first casts, arsenal growth, spell-of-day bonus)
changes.push(...spellcraftEvents);
if (prev && spellXp > 0) changes.push({ type: 'spellcraft_xp', detail: `⚡ Spellcraft settled: +${spellXp} XP`, impact: 'positive', notify: false });
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

// ---- duplicate / twin-project detection ----
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const duplicates = [];
const prodKeys = projects.map((p) => ({ name: p.name, key: normName(p.name) }));
for (const dsc of RAW.discovered || []) {
  const k = normName(dsc.name);
  if (k.length < 4) continue;
  const hit = prodKeys.find((p) => p.key === k || p.key.includes(k) || k.includes(p.key));
  if (hit) duplicates.push({ type: 'twin', detail: `Folder "${dsc.name}" mirrors product "${hit.name}"`, severity: 'warning' });
}
const byRemote = {};
for (const p of projects) { const r = p.metrics.git_safety.remote; if (r) (byRemote[r] = byRemote[r] || []).push(p.name); }
for (const [r, names] of Object.entries(byRemote)) if (names.length > 1) duplicates.push({ type: 'shared_remote', detail: `${names.join(' = ')} share remote ${r}`, severity: 'warning' });

// ---- inventory ----
const inventory = {
  vaults: RAW.vaults.map((v) => ({ name: v.name, notes: v.notes, role: v.role, recent7: v.recent7 ?? 0, stale90: v.stale90 ?? 0, kb: v.kb ?? 0 })),
  clones: RAW.clones.map((c) => ({ name: c.name, origin: c.origin || '(none)', dirty: c.dirty, diverged: c.diverged })),
  trivial: (prev?.inventory?.trivial || []),
  empty: RAW.discovered.filter((d) => d.classification === 'empty').map((d) => d.name),
  anomalies: (prev?.inventory?.anomalies || []),
  duplicates,
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

// ---- captured brain-dumps (Wave 4): route to a project by name, else Inbox ----
let dumps = [];
try { dumps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'brain-dump.json'), 'utf8')); } catch { /* none */ }
const captured = dumps.map((dp) => {
  const k = normName(dp.text);
  const hit = projects.find((p) => normName(p.name).length > 3 && k.includes(normName(p.name)));
  const id = `sq-capture-${dp.id}`;
  const ov = overrides[id];
  return { id, project_id: hit?.id || null, project_name: hit?.name || 'Inbox', kind: 'idea', title: dp.text, detail: 'captured', source: 'capture', severity: 'info', effort: 'S', impact: 'medium', done: ov?.status === 'done', dismissed: ov?.status === 'dismissed' };
}).filter((c) => !c.done && !c.dismissed);
sideQuestFeed.unshift(...captured);   // fresh thoughts on top of the Ideas feed

// ---- daily top-3 (deterministic): quick-win / momentum / rescue — beats the blank page ----
const dailyTop3 = (() => {
  const open = quests.filter((q) => q.status === 'open' || q.status === 'in_progress');
  const tierRank = { red: 0, orange: 1, yellow: 2 };
  const out = [], seen = new Set();
  // quick win: prefer a low-tier (yellow) quest, oldest first
  const qw = [...open].sort((a, b) => ((tierRank[b.tier] ?? 1) - (tierRank[a.tier] ?? 1)) || (b.age_days - a.age_days))[0];
  if (qw) { out.push({ kind: 'quick_win', label: qw.title, project_id: qw.project_id, quest_id: qw.id, reason: '5-min win — clear something small' }); seen.add(qw.project_id); }
  // momentum: most-recently-active non-dormant project with an open quest
  const mom = projects
    .filter((p) => p.activity.state !== 'dormant' && !seen.has(p.id) && open.some((q) => q.project_id === p.id))
    .sort((a, b) => (a.activity.days_since_commit ?? 999) - (b.activity.days_since_commit ?? 999))[0];
  if (mom) { const q = open.find((x) => x.project_id === mom.id); out.push({ kind: 'momentum', label: `Pick up ${mom.name}`, project_id: mom.id, quest_id: q?.id, reason: `last touched ${mom.activity.days_since_commit ?? '?'}d ago — keep momentum` }); seen.add(mom.id); }
  // rescue: a dormant project with an open quest, longest neglected
  const res = projects
    .filter((p) => p.activity.state === 'dormant' && !seen.has(p.id) && open.some((q) => q.project_id === p.id))
    .sort((a, b) => (b.activity.days_since_commit ?? 0) - (a.activity.days_since_commit ?? 0))[0];
  if (res) { const q = open.find((x) => x.project_id === res.id); out.push({ kind: 'rescue', label: `Rescue ${res.name}`, project_id: res.id, quest_id: q?.id, reason: `dormant ${res.activity.days_since_commit ?? '?'}d — one action saves it` }); }
  return out;
})();

// ---- final doc ----
const doc = {
  schema_version: '1.0',
  scan: { id: TODAY, date: new Date().toISOString(), mode: 'manual', previous_scan: prev?.scan?.id || null, enriched, engine: { collector: RAW.collector_version, enricher: enricherModel } },
  account: {
    level: lv.level, title: lv.title, xp: accountXp, xp_into_level: lv.xp_into_level, xp_to_next: lv.xp_to_next,
    health_index: healthIndex, health_delta: healthIndex - (prev?.account?.health_index ?? healthIndex),
    streak: { scan_days: scanDays, longest_scan_days: longest, last_scan: TODAY },
    totals: { products: projects.length, vaults: inventory.vaults.length, clones: inventory.clones.length, trivial: inventory.trivial.length, open_quests: openQ.length, red_quests: tierCount('red'), quests_done_total: quests.filter((q) => q.status === 'done').length, achievements_unlocked: achievements.filter((a) => a.unlocked).length, open_side_quests: sideQuestFeed.length, archived: archivedProjects.length, learnings: learnings.length, knowledge_xp: knowledgeXp },
    daily_top3: dailyTop3,
    ...(spellcraft ? { spellcraft } : {}),
  },
  achievements,
  projects,
  archived_projects: archivedProjects,
  recent_learnings: learnings.slice(-10).reverse(),
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

// ---- Daily-note injection (Wave 5): write a collapsible WorkspaceHQ block into today's daily note ----
try {
  const VAULT = 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX';
  const dailyDir = path.join(VAULT, '10_Daily');
  const dailyFile = path.join(dailyDir, `${TODAY}.md`);
  const top = (doc.account.daily_top3 || []).slice(0, 3);
  const recentDone = quests.filter((q) => q.completed === TODAY).slice(0, 5);
  const block = [
    '%% workspacehq:start %%',
    '> [!summary]+ 🎮 WorkspaceHQ — ' + TODAY,
    `> L${lv.level} ${lv.title} · ${accountXp} XP · health ${healthIndex} (${doc.account.health_delta >= 0 ? '+' : ''}${doc.account.health_delta}) · ${openQ.length} open quests`,
    '> ',
    '> **Top 3 today:**',
    ...top.map((t) => `> - [ ] wq:${t.quest_id || t.id || 'n/a'} ${t.title || t.detail || ''}${t.project_name ? ` _(${t.project_name})_` : ''}`),
    ...(recentDone.length ? ['> ', '> **Completed today:**', ...recentDone.map((q) => `> - ✅ ${q.title} +${q.xp} XP`)] : []),
    '%% workspacehq:end %%',
    '',
  ].join('\n');
  if (fs.existsSync(dailyFile)) {
    let cur = fs.readFileSync(dailyFile, 'utf8');
    if (/%% workspacehq:start %%[\s\S]*?%% workspacehq:end %%/.test(cur)) cur = cur.replace(/%% workspacehq:start %%[\s\S]*?%% workspacehq:end %%\n?/, block);
    else cur = cur.trimEnd() + '\n\n' + block;
    fs.writeFileSync(dailyFile, cur);
  } else if (fs.existsSync(dailyDir)) {
    fs.writeFileSync(dailyFile, `---\ndate: ${TODAY}\ntags: [daily]\n---\n\n# ${TODAY}\n\n${block}`);
  }
} catch (e) { console.error('[assemble] daily-note injection failed:', e.message); }
