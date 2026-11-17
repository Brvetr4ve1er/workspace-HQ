// The Launcher, main side (IPC-CONTRACT hq:launcher:*; plan batch 9, dish "launcher core and IO"). The owner's own list of folders, files, apps and
// links, and one "Open workspace" click per project (dev server, editor at the folder, terminal at the folder).
//
//   create({ dataDir, documentsRoot, resolveProjectPath, latest, dev, shell, dialog, getWin, crypto, useMark, audit?, spawn?, fsApi?, env?,
//            platform?, now?, driveType?, randomBytes?, core?, log? })
//     -> { read(), add({kind}), remove({id}), setEditor({id}), open({id}), openWorkspace({projectId}), _clear() }
//   init({ ipcMain, getWin, safeStorage, ...create deps }) registers the six channels, every one main-window-only (main-gate.js)
//
// Every answer is a fixed word or a fixed sentence (launcher-core.mjs); never a path, an error text or a name beyond the owner's own entry names.
// Entries (data/launcher/entries.json, gitignored, cap 40) are HMAC-signed with a key sealed by the OS (safeStorage; no key = "locked": nothing
// is added and nothing is shown), re-validated on EVERY read, and a launch re-checks the file system again: lstat, no reparse point, the real
// path equals the stored path, the kind still matches and the extension is still allowed. A failing entry is dropped from the list.
// Nothing here opens a shell: an app is a bare spawn with no arguments, a file or folder goes to shell.openPath, a link to shell.openExternal,
// the editor is [exe, folder], the terminal is wt.exe -d <folder> (fixed WindowsApps location) else the console with cwd.
// Limits in memory per hour: add 20, remove 30, set-editor 10, open 30, open-workspace 10; one launch at a time (the lock is shared with a Brief verb).
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const childProcess = require('node:child_process');
const { pathToFileURL } = require('node:url');

const HOUR_MS = 3600e3;
const LIMITS = Object.freeze({ add: 20, remove: 30, setEditor: 10, open: 30, workspace: 10 });
const MAX_JSON = 256 * 1024;
const MAX_PROJECTS = 200;
const NOT_HERE = 'not available here';
const LOCKED = 'this computer cannot keep the launcher list safely';
const ENV_DROP = /(token|secret|password|passwd|api[_-]?key|credential|cookie)/i;

let corePromise = null, auditPromise = null;
const loadCore = () => corePromise || (corePromise = import(pathToFileURL(path.join(__dirname, 'launcher-core.mjs')).href));
const loadAudit = () => auditPromise || (auditPromise = import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const lower = (s) => String(s).toLowerCase();
const plain = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

function create({ dataDir, documentsRoot, resolveProjectPath, latest, dev, shell, dialog, getWin = () => null, crypto, useMark = () => ({}), audit, spawn = childProcess.spawn,
  fsApi = fs, env = process.env, platform = process.platform, now = () => Date.now(), driveType, randomBytes = nodeCrypto.randomBytes, core: coreIn, log = () => {} } = {}) {
  const dir = path.join(dataDir, 'launcher');
  const entriesFile = path.join(dir, 'entries.json');
  const keyFile = path.join(dir, 'key.json');
  const hits = { add: [], remove: [], setEditor: [], open: [], workspace: [] };
  const fixed = new Map();   // drive letter -> true once the system said "fixed" (a failure is never cached)
  let busy = false;
  const getCore = () => (coreIn ? Promise.resolve(coreIn) : loadCore());
  const enc = crypto && typeof crypto.encrypt === 'function' ? crypto.encrypt : () => null;
  const dec = crypto && typeof crypto.decrypt === 'function' ? crypto.decrypt : () => null;

  const hourOk = (k) => { const t = now(), l = hits[k]; while (l.length && t - l[0] >= HOUR_MS) l.shift(); if (l.length >= LIMITS[k]) return false; l.push(t); return true; };
  const norm = (p) => lower(path.win32.normalize(String(p)));

  // ---- small files ---------------------------------------------------------------------------------
  function readJson(file) {
    try {
      const st = fsApi.lstatSync(file);
      if (!st.isFile() || st.size > MAX_JSON) return null;
      const v = JSON.parse(fsApi.readFileSync(file, 'utf8'));
      return isObj(v) ? v : null;
    } catch { return null; }
  }
  function writeJson(file, obj) {
    fsApi.mkdirSync(dir, { recursive: true });
    const tmp = file + '.' + process.pid + '.' + nodeCrypto.randomBytes(4).toString('hex') + '.tmp';
    fsApi.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fsApi.renameSync(tmp, file);
  }
  // the signing key: 32 random bytes, sealed by the OS. null = locked.
  function getKey() {
    const k = readJson(keyFile);
    if (k && typeof k.key === 'string' && k.key.startsWith('enc:')) {
      let hex = null;
      try { hex = dec(k.key.slice(4)); } catch { hex = null; }
      if (typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)) return hex;
      return null;   // a key that no longer opens is never replaced silently: the old entries would all fail, and a new key would hide that
    }
    let sealed = null;
    const hex = randomBytes(32).toString('hex');
    try { sealed = enc(hex); } catch { sealed = null; }
    if (typeof sealed !== 'string' || !sealed) return null;
    try { writeJson(keyFile, { v: 1, key: 'enc:' + sealed }); } catch { return null; }
    return hex;
  }

  // ---- drives: asked of the system once per letter, off the main thread's critical path ----------------
  const askDrive = driveType || (async (letter) => {
    if (platform !== 'win32') return 'Fixed';
    const ps = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return new Promise((resolve) => {
      try {
        childProcess.execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', `[System.IO.DriveInfo]::new('${letter}').DriveType`], { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out || '').trim()));
      } catch { resolve(''); }
    });
  });
  async function learnDrives(letters) {
    for (const l of new Set(letters)) {
      if (!/^[A-Z]$/.test(l) || fixed.has(l)) continue;
      let t = '';
      try { t = await askDrive(l); } catch { t = ''; }
      if (t === 'Fixed') fixed.set(l, true);
    }
  }
  const fixedDrive = (l) => fixed.get(l) === true;

  // ---- entries --------------------------------------------------------------------------------------
  async function loadEntries() {
    const core = await getCore();
    const key = getKey();
    if (!key) return { core, key: null, entries: [], editor: null };
    const raw = readJson(entriesFile) || {};
    const list = Array.isArray(raw.entries) ? raw.entries.slice(0, core.MAX_ENTRIES * 2) : [];
    await learnDrives(list.filter(isObj).map((e) => core.driveOf(e.path)));
    const entries = [];
    for (const e of list) {
      if (!isObj(e) || entries.length >= core.MAX_ENTRIES || typeof e.id !== 'string' || !core.ID_RE.test(e.id)) continue;
      if (!core.verifyEntry(key, e)) continue;
      const v = core.validateEntry(e, { fixedDrive });
      if (!v.ok) continue;
      entries.push({ id: e.id, kind: e.kind, path: e.kind === 'url' ? undefined : e.path, url: e.kind === 'url' ? e.url : undefined, name: e.name, addedAt: e.addedAt, sig: e.sig, host: v.host });
    }
    const editor = typeof raw.editor === 'string' && entries.some((e) => e.id === raw.editor && e.kind === 'app') ? raw.editor : null;
    return { core, key, entries, editor };
  }
  function saveEntries(entries, editor) {
    const out = entries.map((e) => { const o = { id: e.id, kind: e.kind, name: e.name, addedAt: e.addedAt, sig: e.sig }; if (e.kind === 'url') o.url = e.url; else o.path = e.path; return o; });
    writeJson(entriesFile, { v: 1, entries: out, editor: editor || null });
  }

  // the file system half of "is this entry still what the owner added?" (sync; the drive cache is already filled by loadEntries)
  function recheck(core, e) {
    if (e.kind === 'url') return core.checkUrl(e.url).ok ? 'ok' : 'refused';
    let st;
    try { st = fsApi.lstatSync(e.path); } catch { return 'missing'; }
    if (st.isSymbolicLink()) return 'refused';
    if (e.kind === 'folder' ? !st.isDirectory() : !st.isFile()) return 'refused';
    let real;
    try { real = fsApi.realpathSync(e.path); } catch { return 'missing'; }
    if (norm(real) !== norm(e.path)) return 'refused';
    return core.validateEntry(e, { fixedDrive }).ok ? 'ok' : 'refused';
  }

  const childEnv = () => {
    const o = {};
    for (const k of Object.keys(env)) if (!ENV_DROP.test(k)) o[k] = env[k];
    o.NoDefaultCurrentDirectoryInExePath = '1';
    return o;
  };
  // one detached start; true when spawn handed back a child (a later 'error' is swallowed: the window simply never appears)
  function launch(file, args, cwd) {
    try {
      const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false, env: childEnv() });
      if (!child) return false;
      if (typeof child.on === 'function') child.on('error', () => {});
      if (typeof child.unref === 'function') child.unref();
      return true;
    } catch { return false; }
  }

  async function record(tool, ok, reason, ms) {
    try {
      const fields = { at: now(), door: 'app', tool, tier: 'run', ok, ms, pid: 0, reason };
      if (typeof audit === 'function') await audit(fields);
      else (await loadAudit()).record(dataDir, fields);
    } catch { /* the log must never break a click */ }
  }
  async function locked(fn) {
    if (busy) return null;
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }
  const terminalPath = () => {
    if (platform !== 'win32') return null;
    const base = env.LOCALAPPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Local') : '');
    if (!base) return null;
    const wt = path.join(base, 'Microsoft', 'WindowsApps', 'wt.exe');   // an app-execution alias (a reparse point on purpose): the fixed place, never a PATH search
    try { fsApi.lstatSync(wt); return wt; } catch { return null; }
  };
  const consolePath = () => path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'cmd.exe');

  // ---- the six calls --------------------------------------------------------------------------------
  async function read() {
    try {
      const { core, key, entries, editor } = await loadEntries();
      const out = { entries: [], editor: null, projects: [], terminal: terminalPath() ? 'wt' : 'console', locked: !key, limit: core.MAX_ENTRIES };
      for (const e of entries) out.entries.push({ id: e.id, kind: e.kind, name: plain(e.name, 100), host: e.host || '', editor: e.id === editor });
      out.editor = editor;
      let s = null;
      try { s = latest(); } catch { s = null; }
      for (const p of (s && Array.isArray(s.projects) ? s.projects : []).slice(0, MAX_PROJECTS)) {
        if (!p || typeof p.id !== 'string' || !core.PROJECT_ID_RE.test(p.id)) continue;
        out.projects.push({ id: p.id, name: plain(p.name || p.id, 80), dev: dev && typeof dev.state === 'function' ? await dev.state(p.id) : 'none' });
      }
      return out;
    } catch { return { error: 'the launcher could not be read' }; }
  }

  async function add(arg) {
    try {
      const core = await getCore();
      const kind = isObj(arg) && typeof arg.kind === 'string' ? arg.kind : '';
      if (!core.KINDS.includes(kind)) return { state: 'refused', why: core.WHY.kind };
      if (!hourOk('add')) return { state: 'busy' };
      const cur = await loadEntries();
      if (!cur.key) return { state: 'locked', why: LOCKED };
      if (cur.entries.length >= core.MAX_ENTRIES) return { state: 'full' };
      const properties = kind === 'folder' ? ['openDirectory'] : ['openFile'];
      const filters = kind === 'app' ? [{ name: 'Programs', extensions: ['exe'] }] : kind === 'url' ? [{ name: 'Internet shortcuts', extensions: ['url'] }] : undefined;
      // the app dialog starts at the usual install folder (the owner still picks the file); every other kind starts at the Documents root
      const startAt = kind === 'app' && typeof env.ProgramFiles === 'string' && /^[A-Za-z]:[\\/]/.test(env.ProgramFiles) ? env.ProgramFiles : documentsRoot;
      const opts = { properties, defaultPath: startAt, ...(filters ? { filters } : {}) };
      let res;
      const win = getWin();
      try { res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts); } catch { return { state: 'cancelled' }; }
      if (!res || res.canceled || !Array.isArray(res.filePaths) || typeof res.filePaths[0] !== 'string') return { state: 'cancelled' };
      const picked = res.filePaths[0];
      let entry;
      if (kind === 'url') {
        const c = core.checkPath(picked);
        if (!c.ok) return { state: 'refused', why: c.why };
        if (!/\.url$/i.test(picked)) return { state: 'refused', why: core.WHY.shortcut };
        let text = null;
        try {
          const st = fsApi.lstatSync(picked);
          if (st.isSymbolicLink() || !st.isFile()) return { state: 'refused', why: core.WHY.shortcut };
          const fd = fsApi.openSync(picked, 'r');
          try { const buf = Buffer.alloc(core.SHORTCUT_BYTES); const n = fsApi.readSync(fd, buf, 0, core.SHORTCUT_BYTES, 0); text = buf.toString('utf8', 0, n); } finally { try { fsApi.closeSync(fd); } catch { /* closed */ } }
        } catch { return { state: 'refused', why: core.WHY.shortcut }; }
        const addr = core.parseShortcut(text);
        entry = { kind: 'url', url: addr || '' };
        if (!addr) return { state: 'refused', why: core.WHY.shortcut };
      } else {
        entry = { kind, path: picked };
        await learnDrives([core.driveOf(picked)]);
      }
      const v = core.validateEntry(entry, { fixedDrive });
      if (!v.ok) return { state: 'refused', why: v.why };
      if (kind !== 'url' && recheck(core, entry) !== 'ok') return { state: 'refused', why: core.WHY.odd };
      const dup = cur.entries.find((e) => e.kind === kind && (kind === 'url' ? e.url === v.target : norm(e.path) === norm(v.target)));
      if (dup) return { state: 'exists', id: dup.id };
      const rec = { id: core.newId(randomBytes), kind, name: v.name, addedAt: new Date(now()).toISOString(), ...(kind === 'url' ? { url: v.target } : { path: v.target }) };
      rec.sig = core.signEntry(cur.key, rec);
      saveEntries(cur.entries.concat([rec]), cur.editor);
      return { state: 'added', id: rec.id };
    } catch { return { state: 'failed' }; }
  }

  async function remove(arg) {
    try {
      const core = await getCore();
      const id = isObj(arg) && typeof arg.id === 'string' ? arg.id : '';
      if (!core.ID_RE.test(id)) return { state: 'refused' };
      if (!hourOk('remove')) return { state: 'busy' };
      const cur = await loadEntries();
      if (!cur.key) return { state: 'locked' };
      if (!cur.entries.some((e) => e.id === id)) return { state: 'unknown' };
      saveEntries(cur.entries.filter((e) => e.id !== id), cur.editor === id ? null : cur.editor);
      return { state: 'removed' };
    } catch { return { state: 'failed' }; }
  }

  async function setEditor(arg) {
    try {
      const core = await getCore();
      const id = isObj(arg) && typeof arg.id === 'string' ? arg.id : '';
      if (!core.ID_RE.test(id)) return { state: 'refused' };
      if (!hourOk('setEditor')) return { state: 'busy' };
      const cur = await loadEntries();
      if (!cur.key) return { state: 'locked' };
      const e = cur.entries.find((x) => x.id === id);
      if (!e) return { state: 'unknown' };
      if (!core.isEditorOk(e, { fixedDrive })) return { state: 'refused', why: core.WHY.notExe };
      saveEntries(cur.entries, id);
      return { state: 'set' };
    } catch { return { state: 'failed' }; }
  }

  async function open(arg) {
    const t0 = now();
    try {
      const core = await getCore();
      const id = isObj(arg) && typeof arg.id === 'string' ? arg.id : '';
      if (!core.ID_RE.test(id)) return { state: 'refused' };
      if (!hourOk('open')) return { state: 'busy' };
      const res = await locked(async () => {
        const cur = await loadEntries();
        const e = cur.entries.find((x) => x.id === id);
        if (!e) return { state: 'unknown', kind: 'none' };
        const r = recheck(core, e);
        if (r === 'missing') return { state: 'missing', kind: e.kind };
        if (r !== 'ok') return { state: 'refused', kind: e.kind };
        let ok = false;
        if (e.kind === 'app') ok = launch(e.path, [], path.win32.dirname(e.path));
        else if (e.kind === 'url') { try { await shell.openExternal(e.url); ok = true; } catch { ok = false; } }
        else { let msg = 'x'; try { msg = await shell.openPath(e.path); } catch { msg = 'x'; } ok = msg === ''; }
        return { state: ok ? 'opened' : 'failed', kind: e.kind };
      });
      if (res === null) return { state: 'busy' };
      await record('launcher_open', res.state === 'opened', res.kind + ':' + res.state, now() - t0);
      return { state: res.state };
    } catch { return { state: 'failed' }; }
  }

  // the project's folder, only when the scan names it, it resolves, it is a real directory and it is not reached through a link
  function projectFolder(core, projectId) {
    let s = null;
    try { s = latest(); } catch { s = null; }
    const p = s && Array.isArray(s.projects) ? s.projects.find((x) => x && x.id === projectId) : null;
    if (!p) return null;
    let abs = null;
    try { abs = resolveProjectPath(p.path); } catch { abs = null; }
    if (!abs || typeof abs !== 'string') return null;
    try {
      const resolved = path.win32.normalize(path.resolve(abs));
      const real = fsApi.realpathSync(resolved);
      if (norm(real) !== norm(resolved) || !fsApi.statSync(real).isDirectory()) return null;
      return real;
    } catch { return null; }
  }

  async function openWorkspace(arg) {
    const t0 = now();
    try {
      const core = await getCore();
      const projectId = isObj(arg) && typeof arg.projectId === 'string' ? arg.projectId : '';
      if (!core.PROJECT_ID_RE.test(projectId)) return { ok: false, steps: [], line: '', state: 'refused' };
      if (!hourOk('workspace')) return { ok: false, steps: [], line: '', state: 'busy' };
      const res = await locked(async () => {
        const folder = projectFolder(core, projectId);
        const fa = folder ? core.folderArg(folder) : { ok: false };
        if (!folder || !fa.ok) {
          const steps = core.STEPS.map((step) => ({ step, state: 'skipped' }));
          return { ok: false, steps, line: core.FOLDER_MISSING, missing: true };
        }
        const steps = [];
        // 1. the dev server (dev-command.js decides: allowed commands only)
        let word = 'none';
        try {
          const st = dev && typeof dev.state === 'function' ? await dev.state(projectId) : 'none';
          if (st !== 'none') { const w = await dev.start(projectId); word = core.DEV_WORDS[w] || 'refused'; }
        } catch { word = 'refused'; }
        steps.push({ step: 'dev', state: word });
        // 2. the editor, at the folder
        const cur = await loadEntries();
        const ed = cur.editor ? cur.entries.find((e) => e.id === cur.editor) : null;
        let edState = 'none';
        if (ed) edState = recheck(core, ed) === 'ok' && core.isEditorOk(ed, { fixedDrive }) && launch(ed.path, [folder], folder) ? 'opened' : 'failed';
        steps.push({ step: 'editor', state: edState });
        // 3. the terminal, at the folder
        let tState = 'skipped';
        if (core.folderArg(folder, { terminal: true }).ok) {
          const wt = terminalPath();
          tState = (wt ? launch(wt, ['-d', folder], folder) : launch(consolePath(), [], folder)) ? 'opened' : 'failed';
        }
        steps.push({ step: 'terminal', state: tState });
        // a terminal-only launch is not an act (owner question 9, default no)
        if (word === 'started' || edState === 'opened') { try { useMark('launcher-workspace', 'act'); } catch { /* a mark never breaks a launch */ } }
        return { ok: core.stepsOk(steps), steps, line: core.buildLine(steps) };
      });
      if (res === null) return { ok: false, steps: [], line: '', state: 'busy' };
      await record('launcher_workspace', res.ok, res.missing ? 'folder:missing' : core.stepWords(res.steps), now() - t0);
      return { ok: res.ok, steps: res.steps, line: res.line };
    } catch { return { ok: false, steps: [], line: '', state: 'failed' }; }
  }

  return { read, add, remove, setEditor, open, openWorkspace, _clear() { for (const k of Object.keys(hits)) hits[k].length = 0; fixed.clear(); busy = false; } };
}

function init({ ipcMain, getWin, safeStorage, gate = require('./main-gate').fromMain, ...deps } = {}) {
  const crypto = safeStorage ? {
    encrypt: (s) => { try { return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(s)).toString('base64') : null; } catch { return null; } },
    decrypt: (b) => { try { return safeStorage.decryptString(Buffer.from(String(b), 'base64')); } catch { return null; } },
  } : deps.crypto;
  const l = create({ ...deps, crypto, getWin });
  const arg = (a) => (isObj(a) ? a : {});
  ipcMain.handle('hq:launcher:read', async (event) => (gate(event, getWin) ? l.read() : { error: NOT_HERE }));
  ipcMain.handle('hq:launcher:add', async (event, a) => (gate(event, getWin) ? l.add(arg(a)) : { state: 'refused' }));
  ipcMain.handle('hq:launcher:remove', async (event, a) => (gate(event, getWin) ? l.remove(arg(a)) : { state: 'refused' }));
  ipcMain.handle('hq:launcher:set-editor', async (event, a) => (gate(event, getWin) ? l.setEditor(arg(a)) : { state: 'refused' }));
  ipcMain.handle('hq:launcher:open', async (event, a) => (gate(event, getWin) ? l.open(arg(a)) : { state: 'refused' }));
  ipcMain.handle('hq:launcher:open-workspace', async (event, a) => (gate(event, getWin) ? l.openWorkspace(arg(a)) : { ok: false, steps: [], line: '', state: 'refused' }));
  return l;
}

module.exports = { create, init, LIMITS, NOT_HERE };
