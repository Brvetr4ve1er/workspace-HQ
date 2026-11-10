// Clients list, main side (batch 2 rest, dish "delivery-clients"; IPC-CONTRACT "hq:delivery:clients").
// One row per project the owner marked as a client job in data/delivery.json: how much of the agreed scope is done, the state of
// the newest link, the last time an update was copied. It READS only: data/delivery.json is never written, repaired or set aside
// here (a damaged file is reported, and the project page's own read sets it aside as before).
//
// Why not read() 50 times: delivery.js read() runs the candidate walk (depth 3, 500 files, 5000 entries), re-reads accounts.json
// per project and builds every item and milestone text. This module reads delivery.json, latest.json and accounts.json ONCE per
// list, never starts the candidate walk (withCandidates:false) and keeps only counts: no item text, no milestone name, no file
// content ever leaves this module. Scope files are read under the engine's own containment rules; the link is the newest READY
// deploy of the production branch of THAT project's own Vercel match (delivery-core.mjs chooseLink), never across projects.
//
//   create({ dataDir, resolveProjectPath, now?, fsMod?, lib?, summaries?, ttlMs?, max? }) → { read(), invalidate() }
//     read() → { clients:[{ id, name, mode, done, total, linkState, lastCopyAt, fileState, inScan }], generatedAt, omitted } | { error }
//     omitted = marked clients beyond the cap of 50 (0 normally). never throws, never writes.
//     `summaries(ids)` may be injected (async → the rows); the default is summariesFor() below, which reads through `fsMod`.
//   summariesFor({ L, dataDir, resolveProjectPath, now, fsMod, ids }) → rows   (sync; throws on an unreadable delivery.json / scan)
//   linkStateOf(link) → 'ready-production' | 'ready-preview' | 'not-ready' | 'none'
//   init({ ipcMain, dataDir, resolveProjectPath }) → registers hq:delivery:clients
// The 20 s cache is keyed on delivery.json's mtime+size, so any write by delivery.js (hq:delivery:apply) bypasses it by itself;
// invalidate() drops it explicitly (main may call it after an apply). Errors are never cached.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MAX_CLIENTS = 50;
const TTL_MS = 20e3;
const LINK_STATES = Object.freeze(['ready-production', 'ready-preview', 'not-ready', 'none']);

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'delivery-core.mjs')).href));
const msg = (e) => String((e && e.message) || e).slice(0, 200);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// the view's link (kind + state, see delivery-core.mjs buildView) in four words the list can show. chooseLink only ever offers a
// READY deploy, so 'not-ready' is a guard for a link that arrives otherwise; a missing link is 'none'.
function linkStateOf(link) {
  if (!isObj(link) || typeof link.url !== 'string' || !link.url) return 'none';
  if (link.state !== 'ready') return 'not-ready';
  return link.kind === 'production' ? 'ready-production' : link.kind === 'preview' ? 'ready-preview' : 'not-ready';
}

function readJson(fsMod, file) {
  let raw;
  try { raw = fsMod.readFileSync(file, 'utf8'); } catch (e) { return { value: null, absent: !!e && e.code === 'ENOENT' }; }
  try { return { value: JSON.parse(raw), absent: false }; } catch { return { value: null, absent: false }; }
}

// the same shape check as delivery.js readState, minus the quarantine rename: this module never writes
function readDeliveryState(L, fsMod, file) {
  let raw;
  try { raw = fsMod.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return L.emptyState();
    throw new Error('the client delivery file could not be read');
  }
  let v;
  try { v = JSON.parse(raw); } catch { v = null; }
  if (!isObj(v) || !isObj(v.projects)) throw new Error('the client delivery file is damaged — opening a project page sets it aside and starts a clean list');
  return L.sanitizeState(v);
}

function markedIds(state) {
  return Object.keys(state.projects).filter((id) => state.projects[id] && state.projects[id].client === true).sort();
}

function summariesFor({ L, dataDir, resolveProjectPath, now = () => new Date(), fsMod = fs, ids }) {
  const state = readDeliveryState(L, fsMod, path.join(dataDir, 'delivery.json'));
  const want = Array.isArray(ids) ? ids : markedIds(state);
  // an id that is no longer marked (unmarked between the id list and this read) is not a client any more: dropped
  const marked = [...new Set(want)].filter((id) => typeof id === 'string' && state.projects[id] && state.projects[id].client === true);
  if (!marked.length) return [];
  const latest = readJson(fsMod, path.join(dataDir, 'latest.json')).value;
  if (!isObj(latest)) throw new Error('the latest scan is not available');
  const byId = new Map(L.listProjects(latest).map((p) => [p.id, p]));
  const accounts = readJson(fsMod, path.join(dataDir, 'accounts.json')).value;   // ONCE for every client
  const io = L.nodeIo(fsMod);
  const d = now();
  const tz = -d.getTimezoneOffset();
  return marked.map((id) => {
    const entry = state.projects[id];
    const lastCopyAt = entry.lastCopy ? entry.lastCopy.at : null;
    const project = byId.get(id);
    // gone from the latest scan: no view call, listed under its id and told apart from a service error
    if (!project) return { id, name: id, mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt, fileState: null, inScan: false };
    try {
      let root = null;
      try { root = resolveProjectPath ? resolveProjectPath(project.path) : null; } catch { root = null; }
      const scope = L.gatherScope({ root, entry, io, withCandidates: false });
      const { view } = L.buildView({ projectId: id, name: project.name, entry, scope, accounts, remote: project.remote, now: d, tzOffsetMin: tz });
      // counts and words only: never view.milestones, view.update, view.doneSince or any item text
      return { id, name: project.name, mode: view.mode, done: view.done, total: view.total, linkState: linkStateOf(view.link), lastCopyAt: view.lastCopyAt, fileState: view.fileState, inScan: true };
    } catch {
      return { id, name: project.name, mode: 'client', done: 0, total: 0, linkState: 'none', lastCopyAt, fileState: 'unreadable', inScan: true };
    }
  });
}

function create({ dataDir, resolveProjectPath, now = () => new Date(), fsMod = fs, lib: libFn = lib, summaries, ttlMs = TTL_MS, max = MAX_CLIENTS }) {
  const deliveryFile = path.join(dataDir, 'delivery.json');
  let cache = null, flight = null;

  const sigNow = () => { try { const s = fsMod.statSync(deliveryFile); return s.mtimeMs + ':' + s.size; } catch { return 'absent'; } };

  async function build() {
    const L = await libFn();
    const state = readDeliveryState(L, fsMod, deliveryFile);
    const all = markedIds(state);
    const ids = all.slice(0, max);
    const rows = ids.length ? await (summaries ? summaries(ids) : summariesFor({ L, dataDir, resolveProjectPath, now, fsMod, ids })) : [];
    return { clients: Array.isArray(rows) ? rows : [], generatedAt: now().toISOString(), omitted: all.length - ids.length };
  }

  async function read() {
    try {
      const sig = sigNow(), t = now().getTime();
      if (cache && cache.sig === sig && t - cache.at < ttlMs) return cache.value;
      if (flight && flight.sig === sig) return await flight.p;   // one build for callers that arrive while it runs, unless the file changed under it
      const f = { sig, p: null };
      f.p = build().then((value) => { cache = { at: now().getTime(), sig, value }; return value; });
      flight = f;
      try { return await f.p; } finally { if (flight === f) flight = null; }
    } catch (e) { return { error: msg(e) }; }
  }
  function invalidate() { cache = null; }

  return { read, invalidate };
}

function init({ ipcMain, dataDir, resolveProjectPath }) {
  const c = create({ dataDir, resolveProjectPath });
  ipcMain.handle('hq:delivery:clients', () => c.read());
  return c;
}

module.exports = { create, init, summariesFor, linkStateOf, markedIds, MAX_CLIENTS, TTL_MS, LINK_STATES };
