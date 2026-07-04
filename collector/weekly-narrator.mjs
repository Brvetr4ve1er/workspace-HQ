#!/usr/bin/env node
// Weekly narrator: read the last 7 scans, hand the changes_since_prev feeds to Claude,
// write a hype recap to the vault AND data/weekly-recap.json for the dashboard's
// Weekly Saga card. Degrades to a static stats recap if `claude` CLI missing/failing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const argIdx = process.argv.indexOf('--reports-dir');
const REPORTS_DIR = argIdx > -1 ? process.argv[argIdx + 1] : 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Workspace Status';

function findClaude() {
  const cands = ['C:/Users/ROG STRIX/AppData/Roaming/npm/claude.cmd', 'claude'];
  for (const c of cands) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch {} }
  return null;
}

const files = fs.readdirSync(REPORTS_DIR)
  .filter((f) => /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort().slice(-7);
if (!files.length) { console.log('[narrator] no scans'); process.exit(0); }

const scans = files.map((f) => JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8')));
const week = {
  start: scans[0].scan.id, end: scans[scans.length - 1].scan.id,
  level_start: scans[0].account.level, level_end: scans[scans.length - 1].account.level,
  xp_gain: scans[scans.length - 1].account.xp - scans[0].account.xp,
  health_delta: scans[scans.length - 1].account.health_index - scans[0].account.health_index,
  completed_quests: scans.flatMap((s) => (s.quests || []).filter((q) => q.completed === s.scan.id).map((q) => ({ scan: s.scan.id, title: q.title, xp: q.xp, project_id: q.project_id }))),
  changes: scans.flatMap((s) => (s.changes_since_prev || []).map((c) => ({ ...c, scan: s.scan.id }))),
  achievements: scans[scans.length - 1].achievements.filter((a) => a.unlocked && (!scans[0].achievements.find((x) => x.id === a.id)?.unlocked)),
};

// Spellcraft weekly stats slot: filled once the Spellbook economy lands (Phase 6);
// null keeps the JSON shape stable for the dashboard in the meantime.
week.spellcraft = null;

const staticRecap = `## Week recap — ${week.start} → ${week.end}\n\n- Level: ${week.level_start} → ${week.level_end} (+${week.xp_gain} XP)\n- Health Δ: ${week.health_delta >= 0 ? '+' : ''}${week.health_delta}\n- Quests completed: ${week.completed_quests.length}\n- New achievements: ${week.achievements.length}\n\n_(No claude CLI — install for an AI-written narrative.)_`;

const claude = findClaude();
let narrative = staticRecap;
let ai = false;
if (claude) {
  const prompt = `You're the hype-narrator for a gamified workspace dashboard. Read this week's data and write a SHORT, ENERGETIC weekly recap (markdown, ~150 words). Lead with the biggest win, name specific projects, use 2-3 emojis, end with a "next week" line. No filler.\n\n${JSON.stringify(week, null, 2)}`;
  const r = spawnSync(claude, ['-p'], { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90000 });
  if (r.status === 0 && (r.stdout || '').trim()) { narrative = r.stdout.trim(); ai = true; }
  else console.log('[narrator] claude failed, using static recap');
}

const dest = path.join(REPORTS_DIR, `Weekly Recap ${week.end}.md`);
fs.writeFileSync(dest, `---\ntitle: Weekly Recap ${week.end}\ntype: weekly-recap\ntags: [workspace, recap]\ngenerated_by: workspacehq-narrator\n---\n\n# 📰 Week of ${week.start} → ${week.end}\n\n${narrative}\n\n---\n\n**Stats**: L${week.level_start} → L${week.level_end} · +${week.xp_gain} XP · health ${week.health_delta >= 0 ? '+' : ''}${week.health_delta} · ${week.completed_quests.length} quests done · ${week.achievements.length} new trophies\n`);
console.log(`[narrator] -> ${dest}`);

// Dashboard sidecar (bundled by build-data.mjs into window.DATA.weeklyRecap).
const recap = {
  week_start: week.start,
  week_end: week.end,
  generated_at: new Date().toISOString(),
  ai_narrative: ai,
  narrative_md: narrative,
  stats: {
    xp_gain: week.xp_gain,
    level_start: week.level_start,
    level_end: week.level_end,
    health_delta: week.health_delta,
    quests_completed: week.completed_quests.length,
    achievements_unlocked: week.achievements.length,
  },
  spellcraft: week.spellcraft,
};
fs.writeFileSync(path.join(DATA_DIR, 'weekly-recap.json'), JSON.stringify(recap, null, 2));
console.log(`[narrator] -> data/weekly-recap.json`);
