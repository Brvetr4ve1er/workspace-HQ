// dashboard/claude-hub/link.mjs
// Claude Code folders -> WorkspaceHQ projects (spec 2026-10-13 §3.1 Linker). Pure except readHqProjects (one
// read-only read of data/latest.json). The ranking mirrors dashboard-v5/src/live/adapter.mjs projectForCwd; the
// parity test in link.test.mjs keeps them identical.
import fs from 'node:fs';

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isAbsPath = (n) => /^[a-z]:(\/|$)/.test(n) || n.startsWith('/');
function segmentAt(c, root) {
  for (let i = c.indexOf(root); i >= 0; i = c.indexOf(root, i + 1)) {
    const end = i + root.length;
    if ((i === 0 || c[i - 1] === '/') && (end === c.length || c[end] === '/')) return i;
  }
  return -1;
}
export function matchProject(cwd, hqProjects) {
  const c = normPath(cwd);
  if (!c) return null;
  let best = null, rank = null;
  for (const p of Array.isArray(hqProjects) ? hqProjects : []) {
    const root = normPath(p && p.path).replace(/^(\.\/)+/, '');
    if (!root || root === '.' || root === '..' || root.startsWith('../')) continue;
    const at = isAbsPath(root) ? (c === root || c.startsWith(root + '/') ? 0 : -1) : segmentAt(c, root);
    if (at < 0) continue;
    const r = [isAbsPath(root) ? 0 : 1, at, -root.length];
    if (!rank || (r[0] - rank[0] || r[1] - rank[1] || r[2] - rank[2]) < 0) { best = String(p.id); rank = r; }
  }
  return best;
}

export function readHqProjects(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const j = JSON.parse(raw.replace(/^\uFEFF/, ''));   // a BOM (Windows PowerShell's utf8) is not a broken scan
  const pick = (xs) => (Array.isArray(xs) ? xs : []).filter((p) => p && p.id).map((p) => ({ id: String(p.id), path: String(p.path || '') }));
  return pick(j.projects).concat(pick(j.archived_projects));
}

export function autoLink(store, hqProjects) {
  let linked = 0, cleared = 0;
  for (const row of store.linkRows()) {
    if (row.link_state !== 'none' && row.link_state !== 'auto') continue;   // confirmed/rejected are the owner's
    const m = matchProject(row.path, hqProjects);
    if (m && !(row.link_state === 'auto' && row.hq_project_id === m)) { store.setLink({ projectId: row.id, hqProjectId: m, state: 'auto' }); linked++; }
    else if (!m && row.link_state === 'auto') { store.setLink({ projectId: row.id, hqProjectId: null, state: 'none' }); cleared++; }
  }
  return { linked, cleared };
}
