#!/usr/bin/env node
// Bundles every "Workspace Status <date>.json" sidecar into dashboard/data.js as
// `window.DATA = { scans: [...oldest->newest], latest: <newest> }`. Loading data
// via a <script> tag (not fetch) sidesteps file:// CORS in Electron/browser.
// Re-run after each scan (the Electron main process calls this on launch).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = process.argv[2] || 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Workspace Status';

let scans = [];
try {
  scans = fs.readdirSync(REPORTS_DIR)
    .filter((f) => /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8')));
} catch (e) {
  console.error('[build-data] could not read reports dir:', e.message);
}

let projectNotes = {};
try {
  projectNotes = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/project-notes.json'), 'utf8'));
} catch (e) {
  // no notes file yet
}

let weeklyRecap = null;
try {
  weeklyRecap = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/weekly-recap.json'), 'utf8'));
} catch (e) {
  // narrator hasn't run yet — Weekly Saga card stays hidden
}

let spellbook = null;
try {
  spellbook = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/spellbook.json'), 'utf8'));
} catch (e) {
  // scanner hasn't run yet — Spellbook tab shows its empty state
}

let telemetry = null;
try {
  telemetry = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/spell-telemetry.json'), 'utf8'));
} catch (e) {
  // nothing cast yet
}

let actedOn = null;
try {
  actedOn = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/acted-on.json'), 'utf8'));
} catch { /* no ledger yet */ }

// Optional sidecars for the v3 realms — additive, null/[] until their
// producers exist (pc-health: struct M2; notebooklm: tendril M4). The canvas bake went with
// Claude › Canvas (2026-10-28 cleanup); data/canvas/ stays on disk, unread.
const optionalJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8')); } catch { return null; } };
const pcHealth = optionalJson('../data/pc-health.json');
const github = optionalJson('../data/github.json');   // GitHub account snapshot (collector/github.mjs; CONTRACT 2026-10-26)
const accounts = optionalJson('../data/accounts.json');   // Vercel + Supabase snapshot (collector/accounts.mjs; CONTRACT 2026-10-26)
const notebooklm = optionalJson('../data/notebooklm.json');
const data = { scans, latest: scans[scans.length - 1] || null, projectNotes, weeklyRecap, spellbook, telemetry, actedOn, pcHealth, github, accounts, notebooklm, built_at: new Date().toISOString() };
const out = path.join(__dirname, 'data.js');
fs.writeFileSync(out, 'window.DATA = ' + JSON.stringify(data) + ';\n');
console.log(`[build-data] ${scans.length} scan(s) -> ${out} (latest: ${data.latest?.scan.id || 'none'})`);
