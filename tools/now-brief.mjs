#!/usr/bin/env node
// "Now Brief" — Claude-on-tap context assembler.
//
// Fuses three live signals into one artifact Claude (or you) can read in a
// glance: what you're focused on in the BROWSER right now, the GIT state of the
// projects you've been in, and the open QUESTS on them. Ends with one suggested
// next action so "resume where I left off" is a single move.
//
// Inputs (all best-effort — the brief degrades, never crashes):
//   data/latest.json            — projects (git_safety, completion), quests
//   data/browser-activity.json  — live active-tab focus from the bridge extension
// Output:
//   data/now-brief.md           — human + Claude readable
//   --json                      — also print the structured object to stdout
//
// Usage: node tools/now-brief.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildBrowser } from '../collector/lib/browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const latest = readJson(path.join(DATA, 'latest.json')) || { projects: [], quests: [] };
const activity = readJson(path.join(DATA, 'browser-activity.json'));
const projects = latest.projects || [];
const projById = new Map(projects.map((p) => [p.id, p]));

// Fresh browser aggregation (same correlation the dashboard uses).
const browser = buildBrowser(activity, projects);

// Live git for a project (accurate "right now"), falling back to the last scan.
function liveGit(p) {
  const g = p.metrics?.git_safety || {};
  const out = { branch: g.branch || p.canonical_branch || '?', dirty: g.dirty ?? null, ahead: g.ahead ?? 0, behind: g.behind ?? 0, last: g.last_commit_subject || '', risk: g.risk || null, flags: g.flags || [], canonical: p.canonical_branch };
  const cwd = p.path;
  if (cwd && fs.existsSync(path.join(cwd, '.git'))) {
    const git = (args) => { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 4000, windowsHide: true }); return r.status === 0 ? r.stdout.trim() : null; };
    const br = git(['rev-parse', '--abbrev-ref', 'HEAD']); if (br) out.branch = br;
    const st = git(['status', '--porcelain']); if (st !== null) out.dirty = st ? st.split('\n').length : 0;
    const sub = git(['log', '-1', '--pretty=%s']); if (sub) out.last = sub;
    out.live = true;
  }
  return out;
}

const openQuestsFor = (id) => (latest.quests || [])
  .filter((q) => q.project_id === id && (q.status === 'open' || q.status === 'in_progress'))
  .sort((a, b) => ({ red: 0, orange: 1, yellow: 2 }[a.tier] - { red: 0, orange: 1, yellow: 2 }[b.tier]) || (b.xp || 0) - (a.xp || 0));

// Active = projects you've been in (browser), then any dirty / red-quest project.
const active = [];
const seen = new Set();
for (const bp of browser.by_project) { if (projById.has(bp.project_id)) { active.push(bp.project_id); seen.add(bp.project_id); } }
for (const p of projects) {
  if (seen.size >= 5) break;
  if (seen.has(p.id)) continue;
  const g = p.metrics?.git_safety || {};
  const hasRed = openQuestsFor(p.id).some((q) => q.tier === 'red');
  if ((g.dirty || 0) > 0 || hasRed) { active.push(p.id); seen.add(p.id); }
}

const cards = active.slice(0, 5).map((id) => {
  const p = projById.get(id);
  const g = liveGit(p);
  const bp = browser.by_project.find((x) => x.project_id === id);
  return { p, g, focus_ms: bp?.focus_ms || 0, quests: openQuestsFor(id) };
});

// ---- next-action heuristic -------------------------------------------------
function nextAction() {
  const top = cards[0];
  if (!top) return 'Run a scan (Ctrl+R in WorkspaceHQ) — no active project signal yet.';
  const red = top.quests.find((q) => q.tier === 'red');
  if (red) return `Clear the red quest on **${top.p.name}**: ${red.title}${red.insight ? ` — ${red.insight}` : ''}`;
  if ((top.g.dirty || 0) > 8 || ((top.g.dirty || 0) > 0 && (top.g.flags || []).includes('non-canonical-branch')))
    return `Commit/stash **${top.g.dirty} uncommitted changes** on ${top.p.name} (branch \`${top.g.branch}\`) before you lose the thread.`;
  const anyQuest = cards.flatMap((c) => c.quests.map((q) => ({ q, name: c.p.name })))[0];
  if (anyQuest) return `Pick up **${anyQuest.name}**: ${anyQuest.q.title} (${anyQuest.q.tier}, +${anyQuest.q.xp} XP)`;
  return `Keep momentum on **${top.p.name}** — ${top.p.completion?.pct ?? '?'}% complete.`;
}

// ---- render ----------------------------------------------------------------
const fmtDur = (ms) => { const m = Math.round((ms || 0) / 60000); return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`; };
const L = [];
L.push(`# Now — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`);
L.push('');

if (browser.captured && browser.current) {
  const c = browser.current;
  const proj = c.project_id ? projById.get(c.project_id)?.name || c.project_id : 'unmapped';
  L.push(`**Focused right now:** \`${c.host || c.domain}\`${c.live ? ' (live)' : ''} → _${proj}_${c.title ? `\n> ${c.title}` : ''}`);
  L.push('');
  const top = browser.by_domain.slice(0, 5).map((d) => `${d.domain} ${fmtDur(d.focus_ms)}`).join(' · ');
  if (top) L.push(`**Today in the browser:** ${top}`);
  L.push('');
} else {
  L.push('_No live browser signal yet — load/enable the WorkspaceHQ Bridge extension and make sure the desktop app is running so the ingest endpoint is up._');
  L.push('');
}

L.push('## Active projects');
if (!cards.length) L.push('_None detected. Run a scan._');
for (const c of cards) {
  const g = c.g;
  const branchWarn = g.canonical && g.branch !== g.canonical ? ` ⚠ off \`${g.canonical}\`` : '';
  const dirty = g.dirty == null ? '' : `, ${g.dirty} dirty`;
  const sync = (g.ahead || g.behind) ? `, ${g.ahead ? `↑${g.ahead}` : ''}${g.behind ? `↓${g.behind}` : ''}` : '';
  L.push('');
  L.push(`### ${c.p.name}${c.focus_ms ? ` · ${fmtDur(c.focus_ms)} today` : ''}`);
  L.push(`- git: \`${g.branch}\`${branchWarn}${dirty}${sync}${g.risk ? ` (risk: ${g.risk})` : ''}`);
  if (g.last) L.push(`- last commit: _${g.last}_`);
  L.push(`- completion: ${c.p.completion?.pct ?? '?'}%`);
  if (c.quests.length) {
    L.push(`- open quests (${c.quests.length}):`);
    for (const q of c.quests.slice(0, 3)) L.push(`  - **[${q.tier}]** ${q.title}${q.xp ? ` (+${q.xp} XP)` : ''}`);
  } else L.push('- open quests: none');
}
L.push('');
L.push('## → Next action');
L.push(nextAction());
L.push('');

const md = L.join('\n');
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'now-brief.md'), md);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ browser: { captured: browser.captured, current: browser.current, by_domain: browser.by_domain }, cards: cards.map((c) => ({ id: c.p.id, name: c.p.name, focus_ms: c.focus_ms, git: c.g, quests: c.quests })), next_action: nextAction() }, null, 2));
} else {
  console.log(`[now-brief] wrote data/now-brief.md · ${cards.length} active project(s)${browser.captured ? ' · browser live' : ''}`);
}
