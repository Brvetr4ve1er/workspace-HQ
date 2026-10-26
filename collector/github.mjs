// GITHUB runner — reads the owner's GitHub account through their own `gh` login (no stored
// token), shapes it with lib/github.mjs and writes data/github.json (gitignored: it holds
// private repo names). Read-only: only `gh api graphql` queries and `git remote get-url`.
//   run:  node collector/github.mjs [--max-age=<seconds>]
// A snapshot younger than --max-age (default 600) is kept as is, so a scan or a spammed
// Refresh cannot burn the search budget. Two GraphQL calls per real refresh.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shape, failed, searchQuery, REPOS_QUERY, MAX_AGE_MS } from './lib/github.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'github.json');

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeAtomic = (f, data) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };

// gh.exe on PATH, else the installer's default folder (the app may start with a thinner PATH)
function ghBin() {
  const tryRun = (bin) => { const r = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }); return r.status === 0 ? bin : null; };
  return tryRun('gh') || tryRun(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'));
}

function graphql(gh, query) {
  const r = spawnSync(gh, ['api', 'graphql', '-f', 'query=' + query], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'gh api failed').trim().split('\n')[0].slice(0, 200));
  const j = JSON.parse(r.stdout);
  if (!j.data) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'no data');
  return j.data;
}

// git folders worth matching to a repo: every scanned project, plus git folders up to three
// levels under Documents and Desktop (where the owner clones things). Never descends into a
// repo, node_modules or a dot-folder; bounded by CLONE_SCAN_MAX folders visited. Read-only.
const CLONE_DEPTH = 3, CLONE_SCAN_MAX = 3000;
function clones() {
  const dirs = new Set();
  const latest = readJson(path.join(DATA, 'latest.json'), null);
  for (const p of (latest && Array.isArray(latest.projects) ? latest.projects : [])) if (p && typeof p.path === 'string') dirs.add(p.path);
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > CLONE_DEPTH || visited >= CLONE_SCAN_MAX) return;
    let kids = [];
    try { kids = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const k of kids) {
      if (!k.isDirectory() || k.name.startsWith('.') || k.name === 'node_modules' || ++visited > CLONE_SCAN_MAX) continue;
      const d = path.join(dir, k.name);
      if (fs.existsSync(path.join(d, '.git'))) dirs.add(d); else walk(d, depth + 1);
    }
  };
  for (const root of [path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop')]) walk(root, 1);
  const out = [];
  for (const d of [...dirs].slice(0, 200)) {
    const r = spawnSync('git', ['-C', d, 'remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (r.status === 0 && r.stdout.trim()) out.push({ path: d, remote: r.stdout.trim() });
  }
  return out;
}

function main() {
  const nowMs = Date.now();
  const arg = process.argv.find((a) => a.startsWith('--max-age='));
  const maxAgeMs = arg ? Math.max(0, Number(arg.slice(10)) * 1000 || 0) : MAX_AGE_MS;
  const prev = readJson(OUT, null);
  fs.mkdirSync(DATA, { recursive: true });
  if (prev && prev.state === 'ok' && !prev.stale && Date.parse(prev.at) > nowMs - maxAgeMs) {
    console.log(`[github] snapshot from ${prev.at} is fresh — kept`);
    return;
  }
  const done = (report, line) => { writeAtomic(OUT, JSON.stringify(report, null, 2)); console.log(line + ' → ' + path.relative(ROOT, OUT)); };

  const gh = ghBin();
  if (!gh) return done(failed('no-gh', 'GitHub CLI (gh) is not installed', nowMs, prev), '[github] gh not found');
  const auth = spawnSync(gh, ['auth', 'status', '--hostname', 'github.com'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (auth.status !== 0) return done(failed('signed-out', 'Not signed in to GitHub — run: gh auth login', nowMs, prev), '[github] not signed in');

  let viewer;
  try { viewer = graphql(gh, REPOS_QUERY).viewer; }
  catch (e) { return done(failed('error', 'repos: ' + e.message, nowMs, prev), '[github] repo list failed'); }
  let search = null; const errors = [];
  try { search = graphql(gh, searchQuery(viewer.login)); } catch (e) { errors.push('pull requests: ' + e.message); }
  const report = shape({ viewer, search, clones: clones(), nowMs, errors });
  const t = report.totals;
  done(report, `[github] ${t.repos} repos (${t.private} private, ${t.cloned} cloned here) · ${t.waiting ?? '?'} PRs waiting · ${t.ciFailing} failing CI${report.partial ? ' · partial' : ''}`);
}

main();
