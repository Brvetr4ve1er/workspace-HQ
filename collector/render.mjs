#!/usr/bin/env node
// WorkspaceHQ Markdown renderer. Turns a Workspace Status <date>.json sidecar into
// the human-readable Obsidian report. The .md is ALWAYS a pure render of the .json,
// so they never drift. Run after assemble.mjs.
//
// Usage: node render.mjs [--in <json>] [--out <md>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const IN = arg('--in', path.join(__dirname, '..', 'data', 'latest.json'));
const d = JSON.parse(fs.readFileSync(IN, 'utf8'));
const REPORTS_DIR = 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Workspace Status';
const OUT = arg('--out', path.join(REPORTS_DIR, `Workspace Status ${d.scan.id}.md`));

const bar = (pct) => { const f = Math.round(pct / 5); return '█'.repeat(f) + '░'.repeat(20 - f); };
const buildIcon = (b) => ({ green: '🟢', runs: '🟢', red: '🔴', unknown: '❔' }[b] || '❔');
const openQ = d.quests.filter((q) => q.status === 'open' || q.status === 'in_progress');
const L = [];

// frontmatter
L.push('---');
L.push(`title: Workspace Status ${d.scan.id}`);
L.push(`date: ${d.scan.id}`);
L.push('type: workspace-status');
L.push('tags: [workspace, status, dev, automation]');
L.push('generated_by: workspacehq-pipeline');
L.push(`scan_mode: collector+assemble+render`);
L.push('---');
L.push('');

// header + summary
const a = d.account;
L.push(`# 🗂️ Workspace Status — ${d.scan.id}`);
L.push('');
L.push(`> [!info] ${a.title} · Level ${a.level} · ${a.xp} XP (${a.xp_to_next} to next) · Health ${a.health_index}/100 ${a.health_delta >= 0 ? '▲' : '▼'}${Math.abs(a.health_delta)}`);
L.push(`> ${a.totals.products} products · ${a.totals.vaults} vaults · ${a.totals.clones} clones · ${a.totals.open_quests} open quests (${a.totals.red_quests} red) · 🔥 ${a.streak.scan_days}-day scan streak`);
L.push('');

// changes since prev
L.push(`## 🔀 Changes since ${d.scan.previous_scan || '(baseline)'}`);
L.push('');
const pos = d.changes_since_prev.filter((c) => c.impact === 'positive');
const neg = d.changes_since_prev.filter((c) => c.impact !== 'positive');
if (pos.length) { L.push('> [!success] Resolved / improved'); pos.forEach((c) => L.push(`> - ${c.detail}`)); L.push(''); }
if (neg.length) { L.push('> [!warning] Still open / new'); neg.forEach((c) => L.push(`> - ${c.detail}`)); L.push(''); }
if (!d.changes_since_prev.length) { L.push('Nothing moved since the last scan.'); L.push(''); }

// products table + chart
L.push('## Original products (completion %)');
L.push('');
L.push('| Project | % | Stack | Build | Tests | Git safety | Activity |');
L.push('|---|---|---|---|---|---|---|');
const sorted = [...d.projects].sort((x, y) => y.completion.pct - x.completion.pct);
for (const p of sorted) {
  const g = p.metrics.git_safety;
  const gs = !g.has_git ? '⚠ no git' : g.commits === 0 ? '⚠ 0 commits' : !g.has_remote ? '⚠ no remote' : g.dirty > 20 ? `${g.dirty} dirty` : g.unpushed ? `${g.ahead} ahead` : '✅ in sync';
  const t = p.metrics.code_health.tests;
  const ts = t?.passing ? `${t.passing}/${t.count ?? '?'}` : t?.present ? 'present' : 'none';
  L.push(`| ${p.name} | ${p.completion.pct} | ${(p.stack || []).slice(0, 3).join(' · ')} | ${buildIcon(p.metrics.code_health.build)} | ${ts} | ${gs} | ${p.activity.state} |`);
}
L.push('');
L.push('```');
for (const p of sorted) L.push(`${p.name.slice(0, 21).padEnd(22)}${bar(p.completion.pct)}  ${String(p.completion.pct).padStart(3)}%`);
L.push('```');
L.push('');

// cross-cutting insights (computed deterministically from data)
L.push('## Cross-cutting insights');
L.push('');
const noGit = d.projects.filter((p) => !p.metrics.git_safety.has_git).map((p) => p.name);
const highRisk = d.projects.filter((p) => p.metrics.git_safety.risk === 'high').length;
const redBuild = d.projects.filter((p) => p.metrics.code_health.build === 'red').map((p) => p.name);
const withTests = d.projects.filter((p) => p.metrics.code_health.tests?.passing).map((p) => p.name);
let n = 1;
L.push(`${n++}. **Git safety:** ${highRisk}/${d.projects.length} products at high risk.${noGit.length ? ` No version control at all: ${noGit.join(', ')}.` : ''}`);
if (redBuild.length) L.push(`${n++}. **Broken builds:** ${redBuild.join(', ')}.`);
L.push(`${n++}. **Testing:** ${withTests.length ? `only ${withTests.join(', ')} ${withTests.length === 1 ? 'has' : 'have'} a real passing suite` : 'no product has a passing test suite'} across ${d.projects.length} products.`);
if (d.inventory.empty.length) L.push(`${n++}. **Clutter:** ${d.inventory.empty.length} empty/stray folders (${d.inventory.empty.join(', ')}).`);
if (d.inventory.anomalies?.length) d.inventory.anomalies.forEach((an) => L.push(`${n++}. **Anomaly:** ${an.detail}`));
L.push('');

// prioritized TODOs (quests)
L.push('## Prioritized TODOs (quests)');
L.push('');
const tierBlock = (tier, kind, label) => {
  const qs = openQ.filter((q) => q.tier === tier);
  if (!qs.length) return;
  L.push(`> [!${kind}] ${label}`);
  qs.forEach((q) => { const aged = q.age_days > 0 ? ` _(${q.age_days}d)_` : ''; L.push(`> - **${q.title}** (+${q.xp} XP)${aged} — ${q.insight || ''}`); });
  L.push('');
};
tierBlock('red', 'danger', 'RED — loss & breakage risk');
tierBlock('orange', 'warning', 'ORANGE — before production');
tierBlock('yellow', 'note', 'YELLOW — housekeeping');

// done this scan
const doneToday = d.quests.filter((q) => q.completed === d.scan.id);
if (doneToday.length) { L.push('> [!success] Completed this scan'); doneToday.forEach((q) => L.push(`> - ~~${q.title}~~ (+${q.xp} XP) ✅`)); L.push(''); }

// inventory
L.push('## Knowledge vaults');
d.inventory.vaults.forEach((v) => L.push(`- ${v.name === 'VEEMO CORTEX' ? '[[VEEMO CORTEX]]' : v.name} (${v.notes} notes) — ${v.role}`));
L.push('');
L.push('## Reference clones');
d.inventory.clones.forEach((c) => L.push(`- **${c.name}** — ${c.origin}${c.dirty ? ` (${c.dirty} dirty${c.diverged ? ', diverged' : ''})` : ''}`));
L.push('');
if (d.inventory.trivial?.length || d.inventory.empty?.length) {
  L.push('## Trivial / empty');
  const triv = (d.inventory.trivial || []).map((t) => `${t.name} (${t.note})`);
  const empt = (d.inventory.empty || []).map((e) => `${e} (empty)`);
  L.push([...triv, ...empt].join(' · '));
  L.push('');
}

fs.writeFileSync(OUT, L.join('\n'));
console.log(`[render] ${d.scan.id} -> ${OUT} (${L.length} lines)`);

// ---- Phase 2: emit an Obsidian Tasks-plugin quest board ---------------------
// A single living note whose checkboxes are real `Tasks` items, so quests flow
// into the vault's global task queries (priority emojis 🔺/⏫/🔼, #quest/<tier>
// tags, created date ➕, stable 🆔). WorkspaceHQ owns this file — it is fully
// regenerated each scan, so manual edits here are overwritten by design.
const PRIO = { red: '🔺', orange: '⏫', yellow: '🔼' };
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9/_-]+/g, '-').replace(/^-+|-+$/g, '');
const projName = {}; (d.projects || []).forEach((p) => (projName[p.id] = p.name));
function questBoard() {
  const Q = [];
  Q.push('---');
  Q.push('title: WorkspaceHQ Quest Board');
  Q.push(`date: ${d.scan.id}`);
  Q.push('type: quest-board');
  Q.push('tags: [workspace, quests, tasks]');
  Q.push('generated_by: workspacehq-pipeline');
  Q.push('---');
  Q.push('');
  Q.push('# ⚔️ WorkspaceHQ Quest Board');
  Q.push('');
  Q.push(`> [!info] Synced from scan ${d.scan.id}. These checkboxes are real \`Tasks\` items — they show up in your global task queries and group by the \`#quest/<tier>\` tags. WorkspaceHQ regenerates this note each scan, so manual edits are overwritten.`);
  Q.push('');
  const taskLine = (q) => {
    const proj = q.project_id ? ` (${projName[q.project_id] || q.project_id})` : '';
    const tags = `#quest/${q.tier}${q.project_id ? ` #project/${slug(q.project_id)}` : ''}`;
    const created = q.created ? ` ➕ ${q.created}` : '';
    return `- [ ] ${q.title}${proj} — +${q.xp} XP ${PRIO[q.tier] || ''} ${tags}${created} 🆔 ${q.id}`;
  };
  const block = (tier, label) => {
    const qs = openQ.filter((q) => q.tier === tier);
    Q.push(`## ${label}  (${qs.length})`);
    if (!qs.length) Q.push('*Clear.* ✅'); else qs.forEach((q) => Q.push(taskLine(q)));
    Q.push('');
  };
  block('red', '🔴 Red — loss & breakage');
  block('orange', '🟠 Orange — before production');
  block('yellow', '🟡 Yellow — housekeeping');
  const doneToday = d.quests.filter((q) => q.completed === d.scan.id);
  if (doneToday.length) {
    Q.push(`## ✅ Completed this scan  (${doneToday.length})`);
    doneToday.forEach((q) => Q.push(`- [x] ${q.title} — +${q.xp} XP #quest/done ✅ ${d.scan.id}`));
    Q.push('');
  }
  return Q.join('\n');
}
const QB_OUT = path.join(path.dirname(OUT), 'Quest Board.md');
fs.writeFileSync(QB_OUT, questBoard());
console.log(`[render] quest board -> ${QB_OUT} (${openQ.length} open quests)`);
