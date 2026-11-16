// The Vault desk, main side (Life > Notes; IPC-CONTRACT hq:vault-desk:read and hq:vault-desk:capture; plan batch 8, dish 3).
// Today's daily note read-only, one capture line that is appended to it, and the twelve most recent notes (names only).
//
//   create({ env?, vaultDir, readLatest?, vaultOpen?, fsApi?, now?, coreLoader? }) -> { read(), capture(text), open(), _clear() }
//   init({ ipcMain, getWin, dataDir, ...create deps }) -> the same object; registers the two channels
//
//   hq:vault-desk:read    ()           -> { state, vaultName, canOpen, folder, folderFromSettings, settingsIgnored, noteName, date, text, truncated, recent:[{name}] } | { error }
//   hq:vault-desk:capture { text }     -> { ok: true } | { error }
//     Main window only (event.sender === getWin().webContents, the security.js pattern). Answers are fixed words, never an error message or a path.
//     state is 'ready' (the note is there), 'no-folder' (the daily folder is not in the vault) or 'no-note' (no note for today yet).
//
// The vault. When env.HQ_VAULT_DIR is set it is the ONLY vault: a missing folder answers "vault not found" and never falls back to the default.
// The daily folder and the date format come from <vault>/.obsidian/daily-notes.json, treated as untrusted (vault-desk-core parseDailySettings);
// with none, the app's own folder name is used and the card says which folder it looks in.
//
// What a capture may do. Append ONE line at the very end of today's note, and nothing else: it never creates a folder or a note, never
// rewrites a note, refuses a symlink or a junction as the note, and requires the note's folder to resolve (realpath) inside the vault's own
// realpath. The file is opened with O_APPEND and without O_CREAT. Re-entrancy lock, 30 captures an hour. Reads are masked (the same two
// rule sets as the Hub) and capped at 20 KB.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WIN = process.platform === 'win32';
const HOUR_MS = 3600e3;
const MAX_PER_HOUR = 30;
const WALK_FILES = 4000;
const WALK_DEPTH = 4;
const NOT_HERE = 'not available here';
const WORDS = Object.freeze({
  noVault: 'vault not found',
  read: 'the vault desk could not be read',
  noFolder: 'the daily folder is not in the vault',
  noNote: 'there is no note for today yet',
  path: 'the daily note path is not safe',
  empty: 'nothing to capture',
  long: 'that line is too long',
  busy: 'a capture is already running',
  rate: 'too many captures this hour',
  unsafe: 'the daily note is not a plain file',
  big: 'the daily note is too big to add to',
  failed: 'the line could not be added',
});

let corePromise = null, maskPromise = null;
const loadCore = () => corePromise || (corePromise = import(pathToFileURL(path.join(__dirname, 'vault-desk-core.mjs')).href));
const loadMask = () => maskPromise || (maskPromise = Promise.all([
  import(pathToFileURL(path.join(__dirname, 'claude-hub', 'redact.mjs')).href),
  import(pathToFileURL(path.join(__dirname, 'claude-hub', 'redact-more.mjs')).href),
]).then(([a, b]) => (s) => b.maskText(s, (t) => a.maskSecrets(t))));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const norm = (p) => { let s = path.resolve(String(p)); if (s.length > path.parse(s).root.length) s = s.replace(/[\\/]+$/, ''); return WIN ? s.toLowerCase() : s; };
const within = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function create({ env = process.env, vaultDir, readLatest = () => null, vaultOpen = null, fsApi = fs, now = () => new Date(), coreLoader = loadCore, maskLoader = loadMask } = {}) {
  const vaultRoot = () => (typeof env.HQ_VAULT_DIR === 'string' && env.HQ_VAULT_DIR ? env.HQ_VAULT_DIR : vaultDir);
  const times = [];
  let busy = false;

  const isDir = (p) => { try { return fsApi.statSync(p).isDirectory(); } catch { return false; } };
  const realOf = (p) => { try { return fsApi.realpathSync(p); } catch { return null; } };

  // the vault, its real path and the daily settings; null when the vault folder is not there
  function locate(core) {
    const root = vaultRoot();
    if (typeof root !== 'string' || !root || !isDir(root)) return null;
    const realRoot = realOf(root);
    if (!realRoot) return null;
    let raw = null;
    try {
      const f = path.join(root, '.obsidian', 'daily-notes.json');
      const st = fsApi.lstatSync(f);
      if (st.isFile() && st.size <= 20000) raw = fsApi.readFileSync(f, 'utf8');
    } catch { raw = null; }
    const settings = core.parseDailySettings(raw);
    return { root, realRoot, settings, name: path.basename(path.resolve(root)) };
  }

  // where today's note is, and what is missing: { rel, abs, parentOk, exists, lst }
  function noteState(core, v) {
    const plan = core.planNotePath(v.settings, now());
    if (plan.error) return { error: 'path' };
    const abs = path.join(v.root, ...plan.rel.split('/'));
    const parent = path.dirname(abs);
    const realParent = isDir(parent) ? realOf(parent) : null;
    const parentOk = !!realParent && within(norm(realParent), norm(v.realRoot));
    let lst = null;
    if (parentOk) { try { lst = fsApi.lstatSync(abs); } catch { lst = null; } }
    return { plan, abs, parent, parentOk, lst };
  }

  function recentNotes(core, v) {
    const found = [];
    let visited = 0;
    const walk = (dir, depth) => {
      if (depth > WALK_DEPTH || visited >= WALK_FILES) return;
      let ents;
      try { ents = fsApi.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (visited >= WALK_FILES) return;
        if (!e || typeof e.name !== 'string' || e.name.startsWith('.')) continue;
        if (e.isDirectory()) { walk(path.join(dir, e.name), depth + 1); continue; }
        if (!e.isFile() || !/\.md$/i.test(e.name)) continue;   // a symlink is neither: never followed
        visited++;
        try { found.push({ name: e.name, mtimeMs: fsApi.statSync(path.join(dir, e.name)).mtimeMs }); } catch { /* gone */ }
      }
    };
    walk(v.root, 0);
    return core.sortRecent(found, core.RECENT_MAX).map((r) => ({ name: r.name }));
  }

  function readHead(file, bytes) {
    let fd = null;
    try {
      fd = fsApi.openSync(file, 'r');
      const size = fsApi.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(bytes + 4, Math.max(size, 0)));
      const n = buf.length ? fsApi.readSync(fd, buf, 0, buf.length, 0) : 0;
      return { text: buf.toString('utf8', 0, n), size };
    } catch { return null; } finally { if (fd !== null) { try { fsApi.closeSync(fd); } catch { /* closed */ } } }
  }

  const canOpenOf = (name) => {
    try {
      const inv = ((readLatest() || {}).inventory) || {};
      return (Array.isArray(inv.vaults) ? inv.vaults : []).some((x) => x && x.name === name && typeof x.path === 'string' && x.path);
    } catch { return false; }
  };

  async function read() {
    try {
      const core = await coreLoader();
      const v = locate(core);
      if (!v) return { error: WORDS.noVault };
      const mask = await maskLoader();
      const ns = noteState(core, v);
      const out = {
        state: 'no-folder', vaultName: v.name.slice(0, 100), canOpen: canOpenOf(v.name), folder: v.settings.folder, folderFromSettings: !!v.settings.fromSettings,
        settingsIgnored: !!v.settings.ignored, noteName: '', date: core.formatDate(now(), 'YYYY-MM-DD'), text: '', truncated: false, recent: [],
      };
      if (ns.plan) out.noteName = ns.plan.name.replace(/\.md$/i, '');
      if (ns.error) return { ...out, recent: recentNotes(core, v) };
      if (!ns.parentOk) return { ...out, recent: recentNotes(core, v) };
      out.state = 'no-note';
      if (ns.lst && ns.lst.isFile() && !ns.lst.isSymbolicLink()) {
        const head = readHead(ns.abs, core.READ_MAX);
        if (head) {
          out.state = 'ready';
          out.truncated = head.size > core.READ_MAX;
          let t = head.text;
          if (out.truncated) t = Buffer.from(t, 'utf8').subarray(0, core.READ_MAX).toString('utf8').replace(/�$/, '');
          out.text = mask(t);
        }
      }
      out.recent = recentNotes(core, v);
      return out;
    } catch { return { error: WORDS.read }; }
  }

  async function capture(text) {
    if (busy) return { error: WORDS.busy };
    busy = true;
    let fd = null;
    try {
      const core = await coreLoader();
      const n = core.normalizeLine(text);
      if (n.error) return { error: n.error === 'long' ? WORDS.long : WORDS.empty };
      const v = locate(core);
      if (!v) return { error: WORDS.noVault };
      const ns = noteState(core, v);
      if (ns.error) return { error: WORDS.path };
      if (!ns.parentOk) return { error: WORDS.noFolder };
      if (!ns.lst) return { error: WORDS.noNote };
      if (ns.lst.isSymbolicLink() || !ns.lst.isFile()) return { error: WORDS.unsafe };
      if (ns.lst.size > core.NOTE_APPEND_MAX) return { error: WORDS.big };
      const t = now().getTime();
      while (times.length && t - times[0] >= HOUR_MS) times.shift();
      if (times.length >= MAX_PER_HOUR) return { error: WORDS.rate };
      const C = fsApi.constants || fs.constants;
      // no O_CREAT: a note that is not there is never made; O_NOFOLLOW where the platform has it
      fd = fsApi.openSync(ns.abs, C.O_WRONLY | C.O_APPEND | (C.O_NOFOLLOW || 0));
      // the lstat above was a check; what was opened is checked again: the same file, one name only, still inside the vault
      const st = fsApi.fstatSync(fd);
      if (!st.isFile() || st.nlink > 1) return { error: WORDS.unsafe };
      if (ns.lst.ino && st.ino && (String(st.ino) !== String(ns.lst.ino) || String(st.dev) !== String(ns.lst.dev))) return { error: WORDS.unsafe };
      const realNote = realOf(ns.abs);
      if (!realNote || !within(norm(realNote), norm(v.realRoot))) return { error: WORDS.unsafe };
      let existing = '';
      try { existing = fsApi.readFileSync(ns.abs, 'utf8'); } catch { return { error: WORDS.failed }; }
      const { add } = core.planAppend(existing, n.line);
      fsApi.writeSync(fd, add);
      times.push(t);
      return { ok: true };
    } catch { return { error: WORDS.failed }; } finally {
      if (fd !== null) { try { fsApi.closeSync(fd); } catch { /* closed */ } }
      busy = false;
    }
  }

  // not an IPC channel: the renderer opens Obsidian through the existing hq:vault-open; this is the injected opener for callers in main
  async function open() {
    try {
      const core = await coreLoader();
      const v = locate(core);
      if (!v) return { error: WORDS.noVault };
      if (!canOpenOf(v.name) || typeof vaultOpen !== 'function') return { error: 'not available here' };
      return await vaultOpen(v.name, 'open');
    } catch { return { error: WORDS.failed }; }
  }

  return { read, capture, open, _clear() { times.length = 0; busy = false; } };
}

function init({ ipcMain, getWin, dataDir, ...deps } = {}) {
  const readLatest = deps.readLatest || (() => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'latest.json'), 'utf8')); } catch { return null; } });
  const desk = create({ ...deps, readLatest });
  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
      const wc = w.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
      return !!event && event.sender === wc;
    } catch { return false; }
  };
  ipcMain.handle('hq:vault-desk:read', async (event) => (fromMain(event) ? desk.read() : { error: NOT_HERE }));
  ipcMain.handle('hq:vault-desk:capture', async (event, arg) => {
    if (!fromMain(event)) return { error: NOT_HERE };
    return desk.capture(isObj(arg) && typeof arg.text === 'string' ? arg.text : '');
  });
  return desk;
}

module.exports = { create, init, WORDS, NOT_HERE, MAX_PER_HOUR };
