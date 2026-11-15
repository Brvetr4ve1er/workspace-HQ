// Memory card, main side (Settings, only while the Console layer is on): what the app keeps on this PC, by KIND - how many files, how many bytes,
// how long ago the newest one was written - and how fresh the daily chat-index snapshot is. READ-ONLY: there is no forget, delete, clear or
// export here, and the one channel only looks.
//
//   create({ dataDir, logsDir?, snapshotDir?, env?, homedir?, now?, fsImpl?, limits? }) -> { read() }
//   init({ ipcMain, getWin, dataDir, ... }) -> the same object; registers ipcMain.handle('hq:memory:read')
//
//   read() -> { at: ISO, capped: boolean, slots: [{ kind, label, files, bytes, newestMs, partial }],
//               snapshot: { newestMs|null, kept|null, max, ok } } | { error }
//
// PRIVACY (public repo, owner data): this process never sends a file or folder NAME. It classifies by the fixed table of generic top-level names in
// memory-card-core.mjs (anything unmatched is 'other') and sends numbers only. Nothing is read from file contents. Symlinks are not followed (and
// not counted). The walk is bounded (LIMITS: 3 levels, 5,000 entries, 2 s): what a cap cut off makes its slot an "at least" figure (partial:true,
// and capped:true on the reply); a folder or file that cannot be looked at makes its slot null ("could not look") - never a guess, never a zero.
// A missing logs folder is simply no files; a missing or unreadable data folder is { error }.
//
// Main window only: the channel checks event.sender === getWin().webContents first (like the security channels) and answers { error } otherwise.
// Concurrent reads share one walk. The snapshot folder comes from hub-snapshot.defaultDir(env, home) (never touched by tests: they inject it).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DENIED = { error: 'not available here' };
const COULD_NOT = 'could not look';

let coreP = null;
const loadCore = () => coreP || (coreP = import(pathToFileURL(path.join(__dirname, 'memory-card-core.mjs')).href));

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// The bounded walk. Returns { entries } for summarise() or { error } when the data folder itself cannot be listed.
function collect(core, { fsImpl, dataDir, logsDir, lim, clock }) {
  const entries = [];
  const budget = { left: lim.entries, deadline: clock() + lim.ms };
  const spent = () => budget.left <= 0 || clock() > budget.deadline;

  function visit(d, abs, kind, depth) {
    if (d.isSymbolicLink()) return;                           // not followed, not counted
    const dir = d.isDirectory();
    if (!dir && !d.isFile()) return;                          // sockets, devices: not data the app keeps
    if (spent()) { entries.push({ kind, partial: true }); return; }
    budget.left -= 1;
    if (dir) {
      if (depth >= lim.depth) { entries.push({ kind, partial: true }); return; }   // below the depth limit: not looked into, so "at least"
      let kids;
      try { kids = fsImpl.readdirSync(abs, { withFileTypes: true }); } catch { entries.push({ kind, unreadable: true }); return; }
      for (const k of kids.slice().sort(byName)) visit(k, path.join(abs, k.name), kind, depth + 1);
      return;
    }
    try {
      const st = fsImpl.lstatSync(abs);
      if (st.isSymbolicLink()) return;
      entries.push({ kind, size: st.size, mtimeMs: st.mtimeMs });
    } catch (e) {
      if (!(e && e.code === 'ENOENT')) entries.push({ kind, unreadable: true });   // gone between listing and stat: not an entry; anything else: could not look
    }
  }

  let top;
  try { top = fsImpl.readdirSync(dataDir, { withFileTypes: true }); } catch { return { error: 'could not look at the data folder' }; }
  for (const d of top.slice().sort(byName)) visit(d, path.join(dataDir, d.name), core.classify(d.name), 1);

  if (logsDir) {   // the app's own day logs live beside data/ and are one kind: logs
    let kids = null;
    try { kids = fsImpl.readdirSync(logsDir, { withFileTypes: true }); } catch (e) { if (!(e && e.code === 'ENOENT')) entries.push({ kind: 'logs', unreadable: true }); }
    if (kids) for (const k of kids.slice().sort(byName)) visit(k, path.join(logsDir, k.name), 'logs', 1);
  }
  return { entries };
}

function create({ dataDir, logsDir, snapshotDir, env = process.env, homedir = os.homedir(), now = Date.now, fsImpl = fs, limits } = {}) {
  let lim = null;   // resolved with the core (LIMITS live there)
  const logs = logsDir !== undefined ? logsDir : (dataDir ? path.join(dataDir, '..', 'logs') : null);
  const snapDir = () => {
    if (snapshotDir !== undefined) return snapshotDir;
    try { return require('./hub-snapshot').defaultDir(env, homedir); } catch { return null; }
  };

  function snapshot(core) {
    const base = { newestMs: null, kept: null, max: core.SNAPSHOT_MAX, ok: false };
    const dir = snapDir();
    if (!dir) return base;
    let names;
    try { names = fsImpl.readdirSync(dir, { withFileTypes: true }); } catch (e) { return e && e.code === 'ENOENT' ? { ...base, kept: 0, ok: true } : base; }
    const files = [];
    for (const d of names.slice(0, 500)) {
      if (!d.isFile() || !core.SNAPSHOT_NAME_RE.test(d.name)) continue;
      try { files.push({ name: d.name, mtimeMs: fsImpl.lstatSync(path.join(dir, d.name)).mtimeMs }); } catch (e) { if (!(e && e.code === 'ENOENT')) return base; }
    }
    return { ...core.snapshotSummary(files), max: core.SNAPSHOT_MAX, ok: true };
  }

  async function run() {
    const core = await loadCore();
    lim = { ...core.LIMITS, ...(limits || {}) };
    if (!dataDir) return { error: 'could not look at the data folder' };
    const got = collect(core, { fsImpl, dataDir, logsDir: logs, lim, clock: now });
    if (got.error) return { error: got.error };
    const slots = core.summarise(got.entries);
    let at;
    try { at = new Date(now()).toISOString(); } catch { at = new Date().toISOString(); }
    return { at, capped: slots.some((s) => s.partial), slots, snapshot: snapshot(core) };
  }

  let inflight = null;
  function read() {
    if (inflight) return inflight;
    inflight = (async () => { try { return await run(); } finally { inflight = null; } })();   // the await yields first, so this assignment always lands before the finally
    return inflight;
  }
  return { read };
}

function init({ ipcMain, getWin, dataDir, ...rest } = {}) {
  const api = create({ dataDir, ...rest });
  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
      const wc = w.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
      return !!event && event.sender === wc;
    } catch { return false; }
  };
  if (ipcMain && typeof ipcMain.handle === 'function') {
    // the arguments are ignored on purpose: the channel takes nothing, so nothing can steer what it looks at; a throw answers a fixed word
    ipcMain.handle('hq:memory:read', async (event) => {
      if (!fromMain(event)) return { ...DENIED };
      try { return await api.read(); } catch { return { error: COULD_NOT }; }
    });
  }
  return api;
}

module.exports = { create, init, collect, DENIED };
