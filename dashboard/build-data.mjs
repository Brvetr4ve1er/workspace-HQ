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
const OUT = process.env.HQ_DATA_OUT || path.join(__dirname, 'data.js');   // tests point this at a temp file
// Sidecar cache: parsing every sidecar (15+ MB) dominated the bake, and the
// history never changes — only the NEWEST sidecar does (assemble rewrites it on
// every scan). Cache each non-newest file's minified JSON keyed by mtime+size;
// the newest is always parsed fresh and never cached, so a steady-state bake
// re-parses one file and rewrites nothing but data.js. Output stays
// byte-identical to an uncached bake. The cache sits next to data.js; the .js
// extension is load-bearing — the dashboard/_*.js ignore pattern keeps it out
// of the public repo.
const CACHE = path.join(path.dirname(OUT), '_data-cache.js');
const CACHE_VERSION = 1;

let scanJsons = [];   // one minified-JSON string per sidecar, oldest -> newest
let latestScan = null;
let cachedCount = 0;
try {
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((f) => /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  let cache = null;
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (c && c.version === CACHE_VERSION && c.reportsDir === REPORTS_DIR && c.entries && typeof c.entries === 'object' && !Array.isArray(c.entries)) cache = c;
  } catch { /* no / corrupt cache → full parse */ }
  const entries = {};
  let dirty = !cache || Object.keys(cache.entries).length !== Math.max(0, files.length - 1);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const file = path.join(REPORTS_DIR, f);
    if (i === files.length - 1) {   // newest: parse fresh, keep out of the cache
      latestScan = JSON.parse(fs.readFileSync(file, 'utf8'));
      scanJsons.push(JSON.stringify(latestScan));
      continue;
    }
    const st = fs.statSync(file);
    const hit = cache && cache.entries[f] && cache.entries[f].mtimeMs === st.mtimeMs && cache.entries[f].size === st.size;
    const json = hit ? cache.entries[f].json : JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (hit) cachedCount++; else dirty = true;
    entries[f] = { mtimeMs: st.mtimeMs, size: st.size, json };
    scanJsons.push(json);
  }
  if (dirty && files.length > 1) {   // atomic: a killed bake must not leave a torn cache
    const tmp = path.join(path.dirname(OUT), '_data-cache.tmp.js');   // .js suffix: the temp too stays inside the dashboard/_*.js ignore pattern
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, reportsDir: REPORTS_DIR, entries }));
    fs.renameSync(tmp, CACHE);
  }
} catch (e) {
  scanJsons = []; latestScan = null; cachedCount = 0;
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
// spliced, not JSON.stringify({ scans, latest, ... }): the cached history
// strings go in verbatim — same JSON bytes, same key order as the old literal
const tail = JSON.stringify({ projectNotes, weeklyRecap, spellbook, telemetry, actedOn, pcHealth, github, accounts, notebooklm, built_at: new Date().toISOString() });
fs.writeFileSync(OUT, 'window.DATA = {"scans":[' + scanJsons.join(',') + '],"latest":' + (scanJsons.length ? scanJsons[scanJsons.length - 1] : 'null') + ',' + tail.slice(1) + ';\n');
console.log(`[build-data] ${scanJsons.length} scan(s), ${cachedCount} from cache -> ${OUT} (latest: ${latestScan?.scan.id || 'none'})`);
