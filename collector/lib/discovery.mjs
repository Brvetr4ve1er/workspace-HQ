// Folder discovery — "see everything, tell the truth".
//
// The collector's hand-kept lists (products / vaults / clones / ignore) decide what is
// SCORED. This module makes sure nothing else is invisible: every top-level folder and
// loose file under the scan root, every Obsidian vault Obsidian itself knows about, and
// every configured path that no longer exists gets reported with cheap, factual signals.
// Pure over its inputs (fs paths + injected git/prune helpers) so it is unit-testable.

import fs from 'node:fs';
import path from 'node:path';

const DAY = 86_400_000;
const SHALLOW_DEPTH = 3;
const FILE_CAP = 3000;

const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const rel = (root, abs) => path.relative(root, abs).replace(/\\/g, '/');

function readJson(abs) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } }

// Cheap stack guess from marker files — facts, not judgments.
export function stackMarkers(abs) {
  const has = (f) => fs.existsSync(path.join(abs, f));
  const stack = [];
  const pkg = readJson(path.join(abs, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    stack.push('Node');
    if (deps.next) stack.push('Next.js');
    else if (deps.vite) stack.push('Vite');
    if (deps.react) stack.push('React');
    if (deps.electron) stack.push('Electron');
  }
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) stack.push('Python');
  if (has('go.mod')) stack.push('Go');
  if (has('Cargo.toml')) stack.push('Rust');
  if (has('index.html')) stack.push('Static HTML');
  return stack;
}

// Bounded shallow walk: file count + newest mtime + markdown count. No content reads.
function shallowStats(abs, shouldPrune) {
  let files = 0, md = 0, newest = 0, truncated = false;
  const stack = [[abs, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === '.obsidian' || shouldPrune(e.name)) continue;
        if (depth < SHALLOW_DEPTH) stack.push([path.join(dir, e.name), depth + 1]);
      } else if (e.isFile()) {
        files++;
        if (e.name.toLowerCase().endsWith('.md')) md++;
        try { const m = fs.statSync(path.join(dir, e.name)).mtimeMs; if (m > newest) newest = m; } catch { /* skip */ }
        if (files >= FILE_CAP) { truncated = true; stack.length = 0; break; }
      }
    }
  }
  return { files, md, newest, truncated };
}

// Folder kind, in priority order. `empty` and `vault` keep the legacy classification names.
export function kindOf({ files, has_obsidian, has_git, stack }) {
  if (files === 0) return 'empty';
  if (has_obsidian) return 'vault';
  if (has_git || stack.length) return 'project-like';
  return 'other';
}

// Facts for one folder. `gitFacts(abs)` and `shouldPrune(name)` come from the collector.
export function describeFolder(abs, { root, gitFacts, shouldPrune, now = Date.now() }) {
  const st = shallowStats(abs, shouldPrune);
  const has_obsidian = fs.existsSync(path.join(abs, '.obsidian'));
  const g = gitFacts(abs);
  const stack = stackMarkers(abs);
  const lastCommit = g.last_commit_date ? Date.parse(g.last_commit_date) : 0;
  const newest = Math.max(st.newest, lastCommit);
  return {
    name: path.basename(abs),
    path: rel(root, abs),
    kind: kindOf({ files: st.files, has_obsidian, has_git: g.has_git, stack }),
    has_git: g.has_git,
    remote: g.remote || null,
    branch: g.branch || null,
    commits: g.commits || 0,
    dirty: g.dirty || 0,
    unpushed: !!g.unpushed,
    has_obsidian,
    stack,
    files: st.files,
    md_files: st.md,
    files_truncated: st.truncated,
    last_modified: newest ? new Date(newest).toISOString().slice(0, 10) : null,
    days_since_modified: newest ? Math.floor((now - newest) / DAY) : null,
  };
}

// Top-level files sitting loose in the root (zips, bundles, stray notes) — name/size/age only.
export function looseFiles(root, now = Date.now()) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { /* unreadable root */ }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || e.name.toLowerCase() === 'desktop.ini') continue;
    try {
      const s = fs.statSync(path.join(root, e.name));
      out.push({ name: e.name, bytes: s.size, days_since_modified: Math.floor((now - s.mtimeMs) / DAY), ext: path.extname(e.name).toLowerCase() });
    } catch { /* vanished */ }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

// Vault paths Obsidian itself has registered (obsidian.json), plus `.obsidian` folders found
// at the root, its immediate children, and one level below (a vault nested in a project).
export function detectVaultPaths(root, { registryFile, shouldPrune }) {
  const found = new Map();   // norm path -> { abs, source }
  const add = (abs, source) => { const k = norm(abs); if (!found.has(k) && fs.existsSync(abs)) found.set(k, { abs, source }); };

  const reg = readJson(registryFile);
  for (const v of Object.values((reg && reg.vaults) || {})) if (v && v.path) add(v.path, 'registry');

  if (fs.existsSync(path.join(root, '.obsidian'))) add(root, 'scan');
  let top = [];
  try { top = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !shouldPrune(e.name)); } catch { /* unreadable */ }
  for (const e of top) {
    const abs = path.join(root, e.name);
    if (fs.existsSync(path.join(abs, '.obsidian'))) add(abs, 'scan');
    let kids = [];
    try { kids = fs.readdirSync(abs, { withFileTypes: true }).filter((k) => k.isDirectory() && !k.name.startsWith('.') && !shouldPrune(k.name)); } catch { continue; }
    for (const k of kids) { const a2 = path.join(abs, k.name); if (fs.existsSync(path.join(a2, '.obsidian'))) add(a2, 'scan'); }
  }
  return [...found.values()];
}

// Merge configured vaults with detected ones. Configured entries win on name/role; the same
// path is never listed twice. A vault that lives inside a tracked product folder is flagged
// `embedded_in` (it is still a vault — it just isn't a separate folder).
export function mergeVaults(root, configured, detected, productDirs = []) {
  const byPath = new Map();
  for (const v of configured) byPath.set(norm(path.join(root, v.path)), { name: v.name, abs: path.join(root, v.path), role: v.role, source: 'config' });
  for (const d of detected) {
    const k = norm(d.abs);
    if (byPath.has(k)) continue;
    const isRoot = k === norm(root);
    byPath.set(k, { name: isRoot ? 'Documents (root)' : path.basename(d.abs), abs: d.abs, role: isRoot ? 'root' : 'auto', source: d.source });
  }
  const prods = productDirs.map((p) => ({ id: p.id, k: norm(p.abs) }));
  return [...byPath.values()].map((v) => {
    const k = norm(v.abs);
    const host = prods.find((p) => k === p.k || k.startsWith(p.k + '/'));
    return { ...v, embedded_in: host ? host.id : null };
  });
}

// Does the vault hold a note (file or folder) for this project? Matches on normalised name so
// "alliance travel" finds "alliance travel agency/" and "HAMMA SAT IPTV" finds "hamma-sat-iptv/".
// `dirs` are relative to the vault root; the first that exists and matches wins.
const slugKey = (s) => String(s).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]/g, '');
export function findProjectNote(vaultRoot, dirs, projectName) {
  const want = slugKey(projectName);
  if (want.length < 4) return null;
  for (const d of dirs) {
    let entries;
    try { entries = fs.readdirSync(path.join(vaultRoot, d), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.name.toLowerCase().endsWith('.md')) continue;
      const k = slugKey(e.name);
      if (k.length >= 4 && (k === want || k.includes(want) || want.includes(k))) return path.join(d, e.name).replace(/\\/g, '/');
    }
  }
  return null;
}

// ---- own-repo auto-discovery (data overhaul Front B) ----------------------------------------
// A git repo anywhere under the discovery roots (≤ maxDepth levels) becomes a tracked project
// when it is the owner's: its GitHub remote owner is one of ownerLogins, or it has no remote at
// all (local-only work), or its path is on the adopt list. Third-party clones stay inventory.
// Never descends into a repo (the innermost .git is the project), node_modules, dot-folders or
// pruned names; a worktree / submodule (.git is a FILE) is not a project of its own.

// "github.com/owner/repo", "https://…", "git@github.com:owner/repo.git" → "owner" (lower case); else null
export function remoteOwner(remote) {
  const m = String(remote || '').match(/github\.com[:/]+([^/\s:]+)\/[^/\s]+/i);
  return m ? m[1].toLowerCase() : null;
}

// a stable, readable id from the folder name; a clash with a taken id gets the parent's name, then a number
export function autoId(abs, taken) {
  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const base = slug(path.basename(abs));
  const cands = [base, slug(path.basename(path.dirname(abs))) + '-' + base];
  for (const c of cands) if (!taken.has(c)) { taken.add(c); return c; }
  for (let i = 2; ; i++) { const c = base + '-' + i; if (!taken.has(c)) { taken.add(c); return c; } }
}

// roots: [{ abs, ignore?: Set<top-level name> }] · skip: Set of norm()'d absolute paths already tracked
// remoteOf(abs) → origin URL or null (injected: the collector passes its git helper)
export function findOwnRepos({ roots, maxDepth = 3, shouldPrune = () => false, skip = new Set(), remoteOf, ownerLogins = [], adopt = [] }) {
  const owners = new Set(ownerLogins.map((s) => String(s).toLowerCase()));
  const adopted = new Set(adopt.map((p) => norm(p)));
  const found = [], seen = new Set();
  const consider = (abs) => {
    const key = norm(abs);
    if (seen.has(key) || skip.has(key)) return;
    seen.add(key);
    const remote = remoteOf(abs) || null;
    const owner = remoteOwner(remote);
    const reason = adopted.has(key) ? 'adopted' : !remote ? 'no-remote' : owner && owners.has(owner) ? 'owner' : null;
    if (reason) found.push({ abs, remote, reason });
  };
  for (const root of roots) {
    const stack = [[root.abs, 1]];
    while (stack.length) {
      const [dir, depth] = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || shouldPrune(e.name)) continue;
        if (depth === 1 && root.ignore && root.ignore.has(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (skip.has(norm(abs))) continue;   // a tracked folder (product / vault / clone) is neither a candidate nor searched inside
        let gitStat = null;
        try { gitStat = fs.statSync(path.join(abs, '.git')); } catch { /* not a repo */ }
        if (gitStat) { if (gitStat.isDirectory()) consider(abs); continue; }
        if (depth < maxDepth) stack.push([abs, depth + 1]);
      }
    }
  }
  return found.sort((a, b) => norm(a.abs).localeCompare(norm(b.abs)));
}
