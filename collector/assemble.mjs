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
import { settle as settleSpellcraft } from './lib/spellcraft.mjs';
import { gitRisk } from './lib/git-risk.mjs';
import { buildProject, deterministicCompletion, buildSideQuests } from './lib/projects.mjs';
import { deriveQuests } from './lib/quests.mjs';
import { levelFor, rollup as gamificationRollup } from './lib/gamification.mjs';

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


// Tiny safe evaluator for auto_complete_when expressions over a fact context.
// ---- build projects (facts + carried soft fields) ----
// project-overrides: archived projects drop out of active counts but stay carried for history
let projOverrides = {};
try { projOverrides = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'project-overrides.json'), 'utf8')); } catch {}
const allProjects = RAW.products.filter((p) => !p.missing)
  .map((rp) => buildProject(rp, { prevProj, enrichProj, config: GCFG }));
allProjects.forEach((p) => { if (projOverrides[p.id]?.status === 'archived') { p.archived = true; p.archived_on = projOverrides[p.id].archived; } });
const projects = allProjects.filter((p) => !p.archived);
const archivedProjects = allProjects.filter((p) => p.archived);
const prodById = new Map(projects.map((p) => [p.id, p]));

// ---- quests: carry forward + auto-close + derive new git/build quests ----
const emptyCount = RAW.discovered.filter((d) => d.classification === 'empty').length;
let { quests, questsCompletedThisScan } = deriveQuests({
  prevQuests: prev?.quests || [], projects, prodById,
  emptyCount, today: TODAY, questXpByTier: GCFG.quest_xp_by_tier,
});

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
const riskCounts = { high: 0, medium: 0, low: 0 };
for (const p of projects) riskCounts[p.metrics.git_safety.risk]++;
const { avgCompletion, buildOk, buildScore, testCovScore, riskScore, gitSafetyScore, healthIndex, scanDays, longest } =
  gamificationRollup({ projects, quests, riskCounts, prev, today: TODAY });

// ---- spellcraft: settle Spellbook cast telemetry into the single XP ledger ----
// Both inputs are OPTIONAL — without spellbook.json / spell-telemetry.json this
// block yields null and the scan is byte-identical to pre-spellbook behavior.
// Grind-proofing by construction: base cast XP pays once per spell per day and is
// capped per day; mastery counts distinct days; each cast settles exactly once
// (watermark carried in account.spellcraft.last_processed_at).
let spellbookCat = null, spellTele = null;
try { spellbookCat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spellbook.json'), 'utf8')); } catch { /* scanner hasn't run */ }
try { spellTele = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'spell-telemetry.json'), 'utf8')); } catch { /* nothing cast yet */ }
const { spellcraft, spellXp, events: spellcraftEvents, spellOfDay } =
  settleSpellcraft({ catalog: spellbookCat, telemetry: spellTele, config: GCFG.spellcraft || {}, prev, today: TODAY });

// account XP: previous account xp + quest completions this scan + streak day + spellcraft
const prevXp = prev?.account?.xp ?? round(projects.reduce((a, p) => a + p.xp, 0));
let xpGain = quests.filter((q) => q.completed === TODAY).reduce((a, q) => a + (q.xp || 0), 0);
xpGain += GCFG.xp_awards.streak_day;
xpGain += spellXp;
const accountXp = prevXp + (prev ? xpGain : 0);
const lv = levelFor(accountXp, GCFG.level_curve.tiers);

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
