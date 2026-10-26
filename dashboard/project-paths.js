// Which folders the app may act on (open, commit, dev server, Claude session cwd).
// Inside Documents: as before. Outside it (own repos the scan found on the Desktop — data
// overhaul Front B): only a folder that is EXACTLY the path of a project in the current
// data/latest.json. A renderer can't widen this: it can only name a path the scan already tracks.
const fs = require('node:fs');
const path = require('node:path');

const DOCS_ROOT = 'C:\\Users\\ROG STRIX\\Documents';

function trackedOutside(latest, docsRoot = DOCS_ROOT) {
  const root = path.resolve(docsRoot).toLowerCase();
  const out = new Set();
  const projects = latest && Array.isArray(latest.projects) ? latest.projects : [];
  const archived = latest && Array.isArray(latest.archived_projects) ? latest.archived_projects : [];
  for (const p of projects.concat(archived)) {
    const s = p && typeof p.path === 'string' ? p.path : '';
    if (!s || !path.isAbsolute(s)) continue;
    const abs = path.resolve(s).toLowerCase();
    if (abs !== root && !abs.startsWith(root + path.sep)) out.add(abs);
  }
  return out;
}

// readLatest() → the parsed latest.json or null (injected so tests need no file)
function createResolver({ docsRoot = DOCS_ROOT, readLatest }) {
  const root = path.resolve(docsRoot);
  return function resolveProjectPath(p) {
    const s = String(p || '');
    if (!s) return null;
    const abs = path.resolve(path.isAbsolute(s) ? s : path.join(docsRoot, s.replace(/\//g, path.sep)));
    if (abs === root || abs.startsWith(root + path.sep)) return abs;
    return trackedOutside(readLatest(), docsRoot).has(abs.toLowerCase()) ? abs : null;
  };
}

const readLatestFrom = (dataDir) => () => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8')); } catch { return null; } };

module.exports = { DOCS_ROOT, createResolver, trackedOutside, readLatestFrom };
