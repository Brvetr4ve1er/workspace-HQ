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

const data = { scans, latest: scans[scans.length - 1] || null, projectNotes, built_at: new Date().toISOString() };
const out = path.join(__dirname, 'data.js');
fs.writeFileSync(out, 'window.DATA = ' + JSON.stringify(data) + ';\n');
console.log(`[build-data] ${scans.length} scan(s) -> ${out} (latest: ${data.latest?.scan.id || 'none'})`);
