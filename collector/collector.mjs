#!/usr/bin/env node
// WorkspaceHQ deterministic collector.
// Gathers HARD FACTS only (git, file/LOC counts, TODO/FIXME, secrets, activity,
// folder classification). No XP, no insights, no completion% — those are added by
// the enricher (LLM) and the gamification engine downstream. Fast: prunes dep dirs
// before descending. Emits raw-metrics.json.
//
// Usage: node collector.mjs [--config <path>] [--out <path>]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COLLECTOR_VERSION = '1.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args ----
const args = process.argv.slice(2);
const argOf = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const CONFIG_PATH = argOf('--config', path.join(__dirname, 'collector.config.json'));
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const ROOT = cfg.root;
const OUT_PATH = argOf('--out', path.join(__dirname, '..', 'data', 'raw-metrics.json'));

const PRUNE = new Set(cfg.prune_dirs);
const PRUNE_PAT = (cfg.prune_dir_patterns || []).map((p) => new RegExp(p, 'i'));
const SRC_EXT = new Set(cfg.source_ext);
const SECRET_RES = (cfg.secret_patterns || []).map((s) => {
  // Support a leading (?i) inline flag (not valid in JS) by hoisting it to the flags arg.
  let src = s.re, flags = '';
  if (src.startsWith('(?i)')) { src = src.slice(4); flags = 'i'; }
  return { name: s.name, re: new RegExp(src, flags) };
});
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/;
// Deterministic test-presence signals: a filename like foo.test.ts / bar.spec.jsx,
// or any source file living under a conventional test directory.
const TEST_FILE_RE = /(^|[._-])(test|spec)\.[mc]?[jt]sx?$/i;
const TEST_DIRS = new Set(['__tests__', '__test__', 'test', 'tests', 'spec', 'specs']);

// ---- helpers ----
function git(absPath, gitArgs) {
  try {
    return execFileSync('git', ['-C', absPath, ...gitArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitFacts(absPath) {
  const hasGit = fs.existsSync(path.join(absPath, '.git'));
  if (!hasGit) {
    return { has_git: false, has_remote: false, remote: null, branch: null, commits: 0, dirty: 0, ahead: 0, behind: 0, unpushed: false, last_commit_date: null };
  }
  const remote = git(absPath, ['config', '--get', 'remote.origin.url']);
  const branch = git(absPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commitsRaw = git(absPath, ['rev-list', '--count', 'HEAD']);
  const commits = commitsRaw ? parseInt(commitsRaw, 10) : 0;
  const porcelain = git(absPath, ['status', '--porcelain']);
  const dirty = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
  const lastDate = git(absPath, ['log', '-1', '--format=%cI']);
  const lastSubject = git(absPath, ['log', '-1', '--format=%s']);
  // ahead/behind from status -sb header
  let ahead = 0, behind = 0, unpushed = false;
  const sb = git(absPath, ['status', '-sb']);
  if (sb) {
    const head = sb.split('\n')[0] || '';
    const am = head.match(/ahead (\d+)/);
    const bm = head.match(/behind (\d+)/);
    if (am) ahead = parseInt(am[1], 10);
    if (bm) behind = parseInt(bm[1], 10);
    unpushed = ahead > 0;
  }
  return {
    has_git: true,
    has_remote: !!remote,
    remote: remote ? remote.replace(/\.git$/, '').replace(/^https?:\/\//, '') : null,
    branch,
    commits,
    dirty,
    ahead,
    behind,
    unpushed,
    last_commit_date: lastDate || null,
    last_commit_subject: lastSubject || null,
  };
}

function shouldPrune(name) {
  if (PRUNE.has(name)) return true;
  return PRUNE_PAT.some((re) => re.test(name));
}

// Single pruned pass: file count, LOC, TODO/FIXME, secrets, newest mtime.
function walkSource(absPath) {
  let files = 0, loc = 0, todo = 0, newest = 0, test_files = 0;
  const newest3 = [];   // 3 most-recently-modified source files (for the re-entry ramp)
  const secrets = [];
  const stack = [absPath];
  while (stack.length) {
    const dir = stack.pop();
    const inTestDir = TEST_DIRS.has(path.basename(dir).toLowerCase());
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || shouldPrune(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!SRC_EXT.has(ext)) continue;
        files++;
        if (inTestDir || TEST_FILE_RE.test(e.name)) test_files++;
        let content;
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs > newest) newest = st.mtimeMs;
          const rel = path.relative(absPath, full).replace(/\\/g, '/');
          if (newest3.length < 3) { newest3.push({ p: rel, m: st.mtimeMs }); newest3.sort((a, b) => a.m - b.m); }
          else if (st.mtimeMs > newest3[0].m) { newest3[0] = { p: rel, m: st.mtimeMs }; newest3.sort((a, b) => a.m - b.m); }
          if (st.size > 2_000_000) continue; // skip giant/minified bundles for line+secret work
          content = fs.readFileSync(full, 'utf8');
        } catch { continue; }
        loc += content.length ? content.split('\n').length : 0;
        if (TODO_RE.test(content)) {
          const m = content.match(new RegExp(TODO_RE, 'g'));
          todo += m ? m.length : 0;
        }
        if (secrets.length < 25) {
          for (const s of SECRET_RES) {
            if (s.re.test(content)) {
              secrets.push({ pattern: s.name, file: path.relative(ROOT, full).replace(/\\/g, '/') });
              break;
            }
          }
        }
      }
    }
  }
  return { files, loc, todo_fixme: todo, test_files, recent_files: newest3.sort((a, b) => b.m - a.m).map((x) => x.p), secrets, newest_mtime: newest };
}

// Deterministic "maturity" signals from cheap existence checks at the project root.
// These are facts (a file exists / a script is defined), never judgments — they give
// the assembler an honest floor for completion/tests/build without an LLM, and seed
// the per-project side-quest generator (no README, no tests, no CI, …).
function projectSignals(absPath) {
  const has = (rel) => fs.existsSync(path.join(absPath, rel));
  let root = [];
  try { root = fs.readdirSync(absPath); } catch { /* unreadable */ }
  const hasReadme = root.some((f) => /^readme(\.|$)/i.test(f));
  const hasLicense = root.some((f) => /^licen[sc]e(\.|$)/i.test(f));
  const hasDockerfile = root.some((f) => /^dockerfile/i.test(f) || /^docker-compose/i.test(f));
  const hasCI = has('.github/workflows') || has('.gitlab-ci.yml') || has('.circleci') || has('azure-pipelines.yml');
  let has_package_json = false, build_script = null, test_script = null, dep_count = 0;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(absPath, 'package.json'), 'utf8'));
    has_package_json = true;
    const scripts = pj.scripts || {};
    build_script = scripts.build || null;
    // npm's default placeholder ("Error: no test specified") doesn't count as a test setup.
    test_script = scripts.test && !/no test specified/i.test(scripts.test) ? scripts.test : null;
    dep_count = Object.keys(pj.dependencies || {}).length + Object.keys(pj.devDependencies || {}).length;
  } catch { /* no/invalid package.json */ }
  const BUILD_CONFIGS = [
    'vite.config.js', 'vite.config.ts', 'webpack.config.js', 'next.config.js', 'next.config.mjs',
    'rollup.config.js', 'tsconfig.json', 'Makefile', 'Cargo.toml', 'pyproject.toml', 'setup.py',
    'pom.xml', 'build.gradle', 'go.mod', 'CMakeLists.txt',
  ];
  const has_build_config = !!build_script || BUILD_CONFIGS.some((c) => has(c));
  return {
    has_readme: hasReadme, has_license: hasLicense, has_dockerfile: hasDockerfile, has_ci: !!hasCI,
    has_package_json, build_script, test_script, dep_count, has_build_config,
  };
}

// Vault knowledge stats (Phase 4): note count plus cheap fs.stat-derived signals
// — notes touched in the last 7 days (active), notes untouched ≥90 days (stale),
// and total size in KB as a volume proxy. No file contents are read, so this stays
// fast enough for the unattended nightly scan.
function vaultStats(absPath) {
  const now = Date.now();
  const DAY = 86400000;
  let notes = 0, recent7 = 0, stale90 = 0, bytes = 0;
  const stack = [absPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === '.obsidian' || e.name === '.git' || shouldPrune(e.name)) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        notes++;
        try {
          const st = fs.statSync(path.join(dir, e.name));
          bytes += st.size;
          const ageDays = (now - st.mtimeMs) / DAY;
          if (ageDays <= 7) recent7++; else if (ageDays >= 90) stale90++;
        } catch { /* unreadable file — still counted */ }
      }
    }
  }
  return { notes, recent7, stale90, kb: Math.round(bytes / 1024) };
}

function resolveGlob(relPath) {
  if (!relPath.includes('*')) {
    const abs = path.join(ROOT, relPath);
    return fs.existsSync(abs) ? [abs] : [];
  }
  const parts = relPath.split('/');
  const starIdx = parts.findIndex((p) => p.includes('*'));
  const base = path.join(ROOT, ...parts.slice(0, starIdx));
  const pat = parts[starIdx];
  const rest = parts.slice(starIdx + 1);
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  let matches = [];
  try {
    matches = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && re.test(e.name))
      .map((e) => path.join(base, e.name, ...rest))
      .filter((p) => fs.existsSync(p));
  } catch { /* base missing */ }
  return matches;
}

function daysSince(ms) {
  if (!ms) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}

function activityState(days) {
  const t = cfg.activity_thresholds_days;
  if (days === null) return 'dormant';
  if (days <= t.active_within) return 'active';
  if (days <= t.stale_within) return 'stale';
  return 'dormant';
}

function dirIsEmptyish(absPath) {
  // true if no real files outside prune dirs (depth-limited)
  const stack = [[absPath, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (shouldPrune(e.name) || e.name === '.git') continue;
        if (depth < 4) stack.push([path.join(dir, e.name), depth + 1]);
      } else if (e.isFile()) {
        return false;
      }
    }
  }
  return true;
}

// Heavy, regenerable dirs the user can safely reclaim (npm install / rebuild restores them).
const RECLAIMABLE_DIRS = ['node_modules', '.next', '.nuxt', 'dist', 'build', 'out', '.output', 'target', '.venv', 'venv', '__pycache__', '.cache', '.parcel-cache', 'coverage', '.turbo'];
// Recursive byte sum (stat only, no content reads), capped so a pathological tree can't hang the scan.
function dirSizeBytes(absPath) {
  let bytes = 0, count = 0;
  const stack = [absPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) { try { bytes += fs.statSync(full).size; } catch { /* skip */ } if (++count > 300000) return bytes; }
    }
  }
  return bytes;
}
function reclaimable(absPath) {
  const fat_dirs = [];
  for (const name of RECLAIMABLE_DIRS) {
    const dp = path.join(absPath, name);
    try { if (fs.statSync(dp).isDirectory()) fat_dirs.push({ name, bytes: dirSizeBytes(dp) }); } catch { /* absent */ }
  }
  fat_dirs.sort((a, b) => b.bytes - a.bytes);
  return { reclaimable_bytes: fat_dirs.reduce((a, d) => a + d.bytes, 0), fat_dirs };
}

// ---- main ----
function collectProduct(p) {
  const resolved = resolveGlob(p.path);
  const abs = resolved[0] || path.join(ROOT, p.path);
  const exists = fs.existsSync(abs);
  if (!exists) return { id: p.id, name: p.name, path: p.path, missing: true };
  const g = gitFacts(abs);
  const code = walkSource(abs);
  const sig = projectSignals(abs);
  const disk = reclaimable(abs);
  const newest = Math.max(code.newest_mtime, g.last_commit_date ? Date.parse(g.last_commit_date) : 0);
  const dsm = daysSince(newest || code.newest_mtime);
  const dscommit = daysSince(g.last_commit_date ? Date.parse(g.last_commit_date) : 0);
  return {
    id: p.id,
    name: p.name,
    path: path.relative(ROOT, abs).replace(/\\/g, '/'),
    stack: p.stack || [],
    dev_cmd: p.dev_cmd || null,
    canonical_branch: p.canonical_branch || 'main',
    git: g,
    code: { files: code.files, loc: code.loc, todo_fixme: code.todo_fixme, recent_files: code.recent_files },
    signals: {
      has_tests: code.test_files > 0 || !!sig.test_script,
      test_files: code.test_files,
      has_build_config: sig.has_build_config,
      build_script: sig.build_script,
      has_readme: sig.has_readme,
      has_license: sig.has_license,
      has_ci: sig.has_ci,
      has_dockerfile: sig.has_dockerfile,
      has_package_json: sig.has_package_json,
      dep_count: sig.dep_count,
    },
    security: { secret_count: code.secrets.length, secrets: code.secrets },
    disk,
    activity: {
      last_commit: g.last_commit_date ? g.last_commit_date.slice(0, 10) : null,
      days_since_commit: dscommit,
      last_modified: newest ? new Date(newest).toISOString().slice(0, 10) : null,
      days_since_modified: dsm,
      state: activityState(dsm),
    },
  };
}

function main() {
  const started = Date.now();
  const out = {
    collected_at: new Date().toISOString(),
    collector_version: COLLECTOR_VERSION,
    root: ROOT,
    products: [],
    vaults: [],
    clones: [],
    discovered: [],
  };

  for (const p of cfg.products) out.products.push(collectProduct(p));

  for (const v of cfg.vaults) {
    const abs = path.join(ROOT, v.path);
    if (!fs.existsSync(abs)) continue;
    out.vaults.push({ name: v.name, role: v.role, ...vaultStats(abs) });
  }

  const cloneAbsSet = new Set();
  for (const c of cfg.clones) {
    for (const abs of resolveGlob(c.path)) {
      cloneAbsSet.add(abs);
      const g = gitFacts(abs);
      out.clones.push({
        name: path.relative(ROOT, abs).replace(/\\/g, '/'),
        origin: g.remote,
        dirty: g.dirty,
        diverged: g.dirty > 0,
        has_git: g.has_git,
      });
    }
  }

  // discover unknown top-level dirs
  const known = new Set([
    ...cfg.ignore,
    ...cfg.products.map((p) => p.path.split('/')[0]),
    ...cfg.vaults.map((v) => v.path.split('/')[0]),
    ...cfg.clones.map((c) => c.path.split('/')[0]),
  ]);
  let topEntries = [];
  try { topEntries = fs.readdirSync(ROOT, { withFileTypes: true }); } catch {}
  for (const e of topEntries) {
    if (!e.isDirectory() || known.has(e.name) || e.name.startsWith('.')) continue;
    const abs = path.join(ROOT, e.name);
    const empty = dirIsEmptyish(abs);
    const hasObsidian = fs.existsSync(path.join(abs, '.obsidian'));
    out.discovered.push({
      name: e.name,
      classification: empty ? 'empty' : hasObsidian ? 'vault?' : 'unclassified',
    });
  }

  out.duration_ms = Date.now() - started;
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  const okGit = out.products.filter((p) => p.git && p.git.has_git).length;
  console.log(`[collector] ${out.products.length} products, ${out.vaults.length} vaults, ${out.clones.length} clones, ${out.discovered.length} discovered`);
  console.log(`[collector] ${okGit}/${out.products.length} products under git · ${out.duration_ms}ms · -> ${path.relative(ROOT, OUT_PATH).replace(/\\/g, '/')}`);
}

main();
