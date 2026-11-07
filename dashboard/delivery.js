// Client delivery, main side (spec: the 2026-11-07 client-delivery item; IPC-CONTRACT "Client delivery").
// Reads what is left against a project's agreed scope (an owner-picked checklist file in the repo, read-only, or a
// checklist kept in data/delivery.json), the newest link to send (data/accounts.json) and an update to paste, through
// the pure engine (delivery-core.mjs). WorkspaceHQ never writes the repo's files; data/delivery.json is written only here,
// Money's idiom: validated intents of at most 16 KB, tmp then rename, a corrupt file quarantined as .corrupt, -2, -3 …
// Nothing is sent anywhere and no network is used.
//
// create({ dataDir, resolveProjectPath, now?, newId?, fsMod? }) → { read(projectId), apply(intent) }   (for tests)
// init({ ipcMain, dataDir, resolveProjectPath })   → hq:delivery:read(projectId) · hq:delivery:apply(intent)
//   both resolve the view { client, mode, source, scopeFile, fileState, candidates, milestones, done, total, doneSince,
//   link, linkWhy, update, lastCopyAt, … } or { error } — they never throw at the renderer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'delivery-core.mjs')).href));
const msg = (e) => String((e && e.message) || e).slice(0, 200);

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { value: null, absent: e.code === 'ENOENT' }; }
  try { return { value: JSON.parse(raw) }; } catch { return { value: null }; }
}

function create({ dataDir, resolveProjectPath, now = () => new Date(), newId = () => crypto.randomUUID(), fsMod = fs }) {
  const file = path.join(dataDir, 'delivery.json');

  function readState(L) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return L.emptyState(); throw e; }
    try {
      const v = JSON.parse(raw);
      // valid JSON of the wrong shape is as unreadable as garbage: quarantine it too, or the next save overwrites it
      if (!v || typeof v !== 'object' || Array.isArray(v) || !v.projects || typeof v.projects !== 'object' || Array.isArray(v.projects)) throw new Error('not a delivery state object');
      return L.sanitizeState(v);
    } catch (e) {
      // never overwrite an earlier quarantine: .corrupt, then .corrupt-2, -3 …
      let to = file + '.corrupt';
      for (let i = 2; fs.existsSync(to) && i < 1000; i++) to = file + '.corrupt-' + i;
      try { fs.renameSync(file, to); } catch { /* best effort — never throw from a read */ }
      console.error(`[delivery] corrupt delivery.json quarantined to ${path.basename(to)} — ${msg(e)}`);
      return L.emptyState();
    }
  }
  function writeState(state) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, file);
  }

  const projectsNow = (L) => L.listProjects(readJson(path.join(dataDir, 'latest.json')).value);
  function viewFor(L, state, project, withCandidates = true) {
    const entry = state.projects[project.id] || null;
    let root = null;
    try { root = resolveProjectPath ? resolveProjectPath(project.path) : null; } catch { root = null; }
    const scope = L.gatherScope({ root, entry, io: L.nodeIo(fsMod), withCandidates });
    const accounts = readJson(path.join(dataDir, 'accounts.json')).value;
    const d = now();
    return L.buildView({ projectId: project.id, name: project.name, entry, scope, accounts, remote: project.remote, now: d, tzOffsetMin: -d.getTimezoneOffset() });
  }

  async function read(projectId) {
    const L = await lib();
    try {
      const project = typeof projectId === 'string' ? projectsNow(L).find((p) => p.id === projectId) : null;
      if (!project) return { error: 'that project is not in the current scan.' };
      return viewFor(L, readState(L), project).view;
    } catch (e) { return { error: 'could not read client delivery — ' + msg(e) }; }
  }

  async function apply(intent) {
    const L = await lib();
    // cheap checks before any IO: shape, size, allowlisted type
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return { error: 'unknown action.' };
    let size = 0; try { size = JSON.stringify(intent).length; } catch { return { error: 'unknown action.' }; }
    if (size > L.MAX_INTENT_BYTES || !L.INTENTS.includes(intent.type)) return { error: 'unknown action.' };
    try {
      const projects = projectsNow(L), project = typeof intent.projectId === 'string' ? projects.find((p) => p.id === intent.projectId) : null;
      if (!project) return { error: 'that project is not in the current scan.' };
      const state = readState(L);
      let resolved = intent;
      if (intent.type === 'set-scope-file' && intent.rel) {
        // the pick must be a readable .md inside the project's own folder right now
        let root = null; try { root = resolveProjectPath ? resolveProjectPath(project.path) : null; } catch { root = null; }
        const c = L.containScope(root, intent.rel, L.nodeIo(fsMod));
        if (!c.ok) return { error: 'not picked — ' + c.detail + '.' };
        resolved = { type: intent.type, projectId: intent.projectId, rel: intent.rel };
      } else if (intent.type === 'copied') {
        // the "done so far" mark comes from the live source, never from the renderer
        resolved = { type: 'copied', projectId: intent.projectId, doneHashes: viewFor(L, state, project, false).doneHashes };
      }
      let next;
      try { next = L.applyIntent(state, resolved, { now: now(), newId, known: (id) => projects.some((p) => p.id === id) }); }
      catch (e) { return { error: e instanceof L.DeliveryError ? e.message : 'that did not work — ' + msg(e) }; }
      try { writeState(next); } catch (e) { return { error: 'not saved — could not write client delivery: ' + msg(e) }; }
      return viewFor(L, next, project).view;
    } catch (e) { return { error: 'could not update client delivery — ' + msg(e) }; }
  }

  return { read, apply };
}

function init({ ipcMain, dataDir, resolveProjectPath }) {
  const d = create({ dataDir, resolveProjectPath });
  ipcMain.handle('hq:delivery:read', (_e, projectId) => d.read(projectId));
  ipcMain.handle('hq:delivery:apply', (_e, intent) => d.apply(intent));
  return d;
}

module.exports = { create, init };
