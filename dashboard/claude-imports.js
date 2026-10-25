// AI archive H6 — the imports drop folder (spec 2026-10-15 §2, §3, §6.3). Main side, new file, one hook line in main.js.
// Read-only on the folder: it is listed and ZIP central directories are read; nothing is created, moved or deleted there.
// A file is announced once (a `found` push + pending()) and imported only after the owner confirms in v5.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const EVENT = 'hq:claude-imports:event';
const FOLDER_NAME = 'WorkspaceHQ Imports';
const NOT_EXPORT = 'Not a ChatGPT or claude.ai export (looked for conversations.json)';
const importsDir = (env = process.env) => env.HQ_IMPORTS_DIR || path.join(os.homedir(), 'Documents', FOLDER_NAME);

function detectExportKind(names) {
  const has = (n) => names.includes(n);
  if (!has('conversations.json')) return { kind: null, reason: NOT_EXPORT };
  if (has('user.json')) return { kind: 'chatgpt', reason: null };
  if (has('projects.json') || has('users.json')) return { kind: 'claude', reason: null };
  return { kind: null, reason: 'This ZIP has conversations.json but neither user.json (ChatGPT) nor projects.json / users.json (claude.ai) — use Import ChatGPT export or Import claude.ai export' };
}

let unzipMod = null;   // ESM: Electron 32's Node cannot require() it
async function readEntryNames(file) {
  if (!unzipMod) unzipMod = await import(pathToFileURL(path.join(__dirname, 'claude-hub', 'unzip.mjs')).href);
  const { entries } = await unzipMod.readZipIndex(file);
  return entries.filter((e) => !e.name.endsWith('/')).map((e) => unzipMod.baseName(e.name).toLowerCase());
}

function createWatcher({ dir, seenFile, send = () => {}, readNames = readEntryNames, pollMs = 5000, stableMs = 2000, refuseAfterMs = 30000 }) {
  let seen = {};
  try { const s = JSON.parse(fs.readFileSync(seenFile, 'utf8')); if (s && typeof s === 'object') seen = s; } catch { /* first run */ }
  const cand = new Map();      // name -> {size, mtimeMs, since}
  const found = new Map();     // dropId -> {dropId, name, file, bytes, kind, key}
  const refused = new Map();   // key -> {file, error}
  let exists = false, timer = null, fsw = null, debounce = null, scanning = null;
  const push = (event, data) => { try { send(EVENT, { event, data }); } catch { /* a closed window */ } };
  const saveSeen = () => {
    fs.mkdirSync(path.dirname(seenFile), { recursive: true });
    const tmp = seenFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seen)); fs.renameSync(tmp, seenFile);
  };
  const drop = (d) => { found.delete(d.dropId); push('gone', { dropId: d.dropId }); };

  async function scanOnce() {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); exists = true; } catch { exists = false; ents = []; }
    const now = Date.now(), live = new Map();
    for (const e of ents) {
      if (!e.isFile() || !/\.zip$/i.test(e.name)) continue;
      let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
      live.set(e.name, { size: st.size, mtimeMs: Math.floor(st.mtimeMs), key: e.name + '|' + st.size + '|' + Math.floor(st.mtimeMs) });
    }
    for (const d of [...found.values()]) { const l = live.get(d.name); if (!l || l.key !== d.key) drop(d); }   // vanished or replaced
    for (const [name, l] of live) {
      if (seen[l.key] || refused.has(l.key) || [...found.values()].some((d) => d.key === l.key)) continue;
      const c = cand.get(name);
      if (!c || c.size !== l.size || c.mtimeMs !== l.mtimeMs) { cand.set(name, { size: l.size, mtimeMs: l.mtimeMs, since: now }); continue; }
      if (now - c.since < stableMs) continue;
      let names;
      try { names = await readNames(path.join(dir, name)); }
      catch (err) {   // still being written, locked, or not a ZIP: refuse only once it has been still for refuseAfterMs
        if (now - c.since >= refuseAfterMs) { cand.delete(name); refused.set(l.key, { file: name, error: 'not a readable ZIP (' + String((err && err.message) || err).slice(0, 120) + ')' }); push('error', refused.get(l.key)); }
        continue;
      }
      cand.delete(name);
      const k = detectExportKind(names);
      if (!k.kind) { refused.set(l.key, { file: name, error: k.reason }); push('error', refused.get(l.key)); continue; }
      const d = { dropId: crypto.randomBytes(8).toString('hex'), name, file: path.join(dir, name), bytes: l.size, kind: k.kind, key: l.key };
      found.set(d.dropId, d);
      push('found', { dropId: d.dropId, file: name, bytes: d.bytes, kind: d.kind });
    }
    for (const name of [...cand.keys()]) if (!live.has(name)) cand.delete(name);
  }
  const scan = () => { if (!scanning) scanning = scanOnce().finally(() => { scanning = null; }); return scanning; };
  const arm = () => {
    if (fsw) return;
    try {
      fsw = fs.watch(dir, () => { clearTimeout(debounce); debounce = setTimeout(scan, 500); });
      fsw.on('error', () => { try { fsw.close(); } catch { /* closed */ } fsw = null; });
    } catch { fsw = null; }   // missing folder: the poll re-arms once it exists
  };
  return {
    start() { scan().then(arm, () => {}); timer = setInterval(() => { scan().then(arm, () => {}); }, pollMs); },
    stop() { clearInterval(timer); clearTimeout(debounce); try { fsw && fsw.close(); } catch { /* closed */ } fsw = null; },
    scan,
    pending: () => ({ folder: { exists, name: path.basename(dir) },
      found: [...found.values()].map(({ dropId, name, bytes, kind }) => ({ dropId, file: name, bytes, kind })),
      refused: [...refused.values()] }),
    dismiss(dropId) { const d = found.get(dropId); if (!d) return false; seen[d.key] = 'dismissed'; saveSeen(); drop(d); return true; },
    take(dropId) { const d = found.get(dropId); return d ? { file: d.file, kind: d.kind, key: d.key } : null; },
    markImported(key) { seen[key] = 'imported'; saveSeen(); for (const d of [...found.values()]) if (d.key === key) drop(d); },
  };
}

let current_ = null;
function init({ ipcMain, send, dataDir, env = process.env }) {
  // next to the Hub's db (HQ_CLAUDE_DB moves both): a gate's second instance never writes the owner's data/claude
  const db = env.HQ_CLAUDE_DB || path.join(dataDir, 'claude', 'hub.sqlite');
  current_ = createWatcher({ dir: importsDir(env), seenFile: path.join(path.dirname(db), 'imports-seen.json'), send });
  ipcMain.handle('hq:claude-imports:pending', () => current_.pending());
  ipcMain.handle('hq:claude-imports:dismiss', (_e, id) => current_.dismiss(String(id || '')));
  current_.start();
  return current_;
}
const current = () => current_;

module.exports = { EVENT, FOLDER_NAME, importsDir, detectExportKind, readEntryNames, createWatcher, init, current };
