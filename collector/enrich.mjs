#!/usr/bin/env node
// Optional LLM enrichment step. Feeds raw-metrics.json + the previous scan into
// `claude -p` using ../scan-prompt.md, parses the JSON the model returns, and writes
// data/enrichment.json (which assemble.mjs merges over carried-forward soft fields).
//
// Opt-in: the pipeline only runs this with -Enrich. If `claude` isn't on PATH it
// no-ops cleanly (exit 0) so the deterministic pipeline is never blocked.
//
// Usage: node enrich.mjs [--model claude-sonnet-4-6] [--reports-dir <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'sonnet'); // a CLI alias: always the current Sonnet, never a retired id
const REPORTS_DIR = arg('--reports-dir', 'C:/Users/ROG STRIX/Documents/VEEMO CORTEX/30_Areas/Workspace Status');
const DATA = path.join(__dirname, '..', 'data');

// Node 20.12+/22+ refuse to spawn a .cmd/.bat without a shell (EINVAL), which made every
// scan since then log "claude CLI not found" and carry the August enrichment forward.
// Prefer the real binary behind the npm shim; fall back to the shim through a shell.
function findClaude() {
  const npm = process.env.HQ_CLAUDE_NPM_DIR || path.join(process.env.APPDATA || 'C:/Users/ROG STRIX/AppData/Roaming', 'npm');
  const cands = [
    { cmd: path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), shell: false },
    { cmd: path.join(npm, 'claude.cmd'), shell: true },
    { cmd: 'claude', shell: true },
  ];
  for (const c of cands) {
    if (!c.shell && !fs.existsSync(c.cmd)) continue;
    try { execFileSync(c.shell ? JSON.stringify(c.cmd) : c.cmd, ['--version'], { stdio: 'ignore', shell: c.shell, timeout: 20_000 }); return c; }
    catch { /* next */ }
  }
  return null;
}

function previousScan() {
  try {
    const f = fs.readdirSync(REPORTS_DIR).filter((x) => /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop();
    return f ? fs.readFileSync(path.join(REPORTS_DIR, f), 'utf8') : '{}';
  } catch { return '{}'; }
}

const claude = findClaude();
if (!claude) { console.log('[enrich] claude CLI not found — skipping enrichment (deterministic fields carry forward).'); process.exit(0); }

const raw = fs.readFileSync(path.join(DATA, 'raw-metrics.json'), 'utf8');
const prompt = fs.readFileSync(path.join(__dirname, '..', 'scan-prompt.md'), 'utf8')
  .replace('{{RAW_METRICS}}', raw)
  .replace('{{PREVIOUS_SCAN}}', previousScan());

console.log(`[enrich] calling ${MODEL} via ${claude.cmd} …`);
// Hard cap: an interactive auth prompt / network stall in `claude -p` must never
// freeze the pipeline (a hung spawnSync here is exactly what left latest.json stale).
const r = spawnSync(claude.shell ? JSON.stringify(claude.cmd) : claude.cmd, ['-p', '--model', MODEL], { input: prompt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 480_000, killSignal: 'SIGKILL', shell: claude.shell });
if (r.error && r.error.code === 'ETIMEDOUT') { console.error('[enrich] claude timed out after 8min — skipping enrichment (deterministic fields carry forward).'); process.exit(0); }
if (r.status !== 0) { console.error('[enrich] claude failed:', (r.stderr || '').slice(0, 400)); process.exit(0); }

// Extract the JSON object from the model output (tolerate stray text/fences).
const out = r.stdout || '';
const s = out.indexOf('{'), e = out.lastIndexOf('}');
if (s < 0 || e <= s) { console.error('[enrich] no JSON found in model output — skipping.'); process.exit(0); }
let parsed;
try { parsed = JSON.parse(out.slice(s, e + 1)); } catch (err) { console.error('[enrich] JSON parse failed:', err.message); process.exit(0); }

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'enrichment.json'), JSON.stringify(parsed, null, 2));
const n = Object.keys(parsed.projects || {}).length;
console.log(`[enrich] wrote enrichment.json for ${n} project(s).`);
