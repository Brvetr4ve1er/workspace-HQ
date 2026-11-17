// The dev server, main side (IPC-CONTRACT hq:dev-start, hq:dev-allow, hq:dev-stop, hq:kill-servers; plan batch 9, dish "dev command as an argv array").
//
// A project's scanned dev command (`dev_cmd`, text) is only a suggestion. It never reaches a shell. Start runs ONLY a command the owner
// allowed, as a list of words (dev-command-core.mjs), through `spawn` with shell:false:
//
//   create({ dataDir, resolveProjectPath, latest, servers, sendStatus, spawn?, spawnSync?, fsApi?, env?, platform?, now?, isAlive?, procStart?, core? })
//     -> { start(id), allow(id, shownHash), stop(id), killAll(), orphan(id), _clear() }
//   init({ ipcMain, getWin, ...create deps }) registers the four channels; every one is main-window-only (main-gate.js)
//
//   start(id)  -> 'started' | 'running' | 'unconfirmed' | 'refused' | 'busy'            (fixed words; never a path or an error text)
//   allow(id, shownHash) -> 'allowed' | 'changed' | 'refused' | 'busy'
//     The owner's Allow stores the words, a key and a time. `shownHash` is the hash of the command text the owner SAW; it must equal the
//     hash of the project's current scanned text, else nothing is stored and the answer is 'changed'. The key binds the allow to the
//     resolved folder, the package.json script entries the command runs (the named script plus its pre and post) and the runner's own
//     config files (.npmrc, .yarnrc.yml, bunfig.toml): change any of them and the next Start asks again.
//   stop(id)   -> true | false     (true when a process was killed: a live child, or a leftover one this app started earlier)
//   killAll()  -> the number of trees killed
//
// What runs. The runner is resolved to an absolute path HERE (the app's own PATH search: absolute entries only, never the current folder,
// a hit inside the project folder is skipped). npm prefers `node.exe <npm-cli.js>` from the same folder as npm.cmd; any other .cmd shim goes
// through the System32 cmd.exe with a verbatim command line built only from words the grammar already allowed. The child runs with
// shell:false, stdio 'ignore', windowsHide, NoDefaultCurrentDirectoryInExePath=1 and an environment allowlist (no tokens, no keys).
// Limits (in memory): 10 starts an hour, 20 allows an hour. The Map `servers` is main.js's activeDevServers, shared with the tray,
// live-state (proc.__hqStartedAt), the delivery check and quit.
// Leftovers: data/launcher/running.json keeps pid + start time of each child; the next start sees a still-living one as 'running' and
// stop(id) kills it only when the pid AND its real start time match. Nothing is ever killed on its own.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { pathToFileURL } = require('node:url');

const HOUR_MS = 3600e3;
const MAX_STARTS = 10;
const MAX_ALLOWS = 20;
const MAX_JSON = 512 * 1024;
const MAX_ENTRIES = 200;
const START_SLOP_MS = 15e3;
const SHELL_UNSAFE = /["%^&|<>!\r\n]/;
const RUNNER_FILES = { npm: ['npm.cmd'], pnpm: ['pnpm.exe', 'pnpm.cmd'], yarn: ['yarn.cmd', 'yarn.exe'], bun: ['bun.exe', 'bun.cmd'], node: ['node.exe'] };
const RC_FILES = ['.npmrc', '.yarnrc.yml', 'bunfig.toml'];

let corePromise = null;
const loadCore = () => corePromise || (corePromise = import(pathToFileURL(path.join(__dirname, 'dev-command-core.mjs')).href));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const lower = (p) => String(p).toLowerCase();
const within = (child, parent) => { const c = lower(path.resolve(child)), p = lower(path.resolve(parent)); return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep); };

function create({ dataDir, resolveProjectPath, latest, servers, sendStatus = () => {}, spawn = childProcess.spawn, spawnSync = childProcess.spawnSync, fsApi = fs,
  env = process.env, platform = process.platform, now = () => Date.now(), isAlive, procStart, core: coreIn, log = () => {} } = {}) {
  const WIN = platform === 'win32';
  const dir = path.join(dataDir, 'launcher');
  const storeFile = path.join(dir, 'dev-commands.json');
  const runningFile = path.join(dir, 'running.json');
  const starts = [], allows = [];
  const getCore = () => (coreIn ? Promise.resolve(coreIn) : loadCore());

  const hourOk = (list, cap) => { const t = now(); while (list.length && t - list[0] >= HOUR_MS) list.shift(); if (list.length >= cap) return false; list.push(t); return true; };

  // ---- the two small files ------------------------------------------------------------------------
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
    const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    fsApi.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fsApi.renameSync(tmp, file);
  }
  function readStore(core) {
    const raw = readJson(storeFile);
    const out = Object.create(null);
    if (!raw) return out;
    let n = 0;
    for (const k of Object.keys(raw)) {
      if (!core.ID_RE.test(k) || n >= MAX_ENTRIES) continue;
      const e = core.cleanEntry(raw[k]);
      if (e) { out[k] = e; n += 1; }
    }
    return out;
  }
  function writeStore(store) { const o = {}; for (const k of Object.keys(store)) o[k] = store[k]; writeJson(storeFile, o); }
  function readRunning() {
    const raw = readJson(runningFile) || {};
    const out = Object.create(null);
    for (const k of Object.keys(raw)) {
      const e = raw[k];
      if (/^[a-z0-9._-]{1,64}$/.test(k) && isObj(e) && Number.isInteger(e.pid) && e.pid > 0 && Number.isFinite(e.startedAt)) out[k] = { pid: e.pid, startedAt: e.startedAt };
    }
    return out;
  }
  function writeRunning(map) { try { const o = {}; for (const k of Object.keys(map)) o[k] = map[k]; writeJson(runningFile, o); } catch (e) { log('running.json not written'); } }
  const noteRunning = (id, pid, startedAt) => { const m = readRunning(); m[id] = { pid, startedAt }; writeRunning(m); };
  const dropRunning = (id, pid) => { const m = readRunning(); if (m[id] && (pid == null || m[id].pid === pid)) { delete m[id]; writeRunning(m); } };

  // ---- what the scan says, and the folder it names -----------------------------------------------
  function project(id) {
    let s = null;
    try { s = latest(); } catch { s = null; }
    const p = s && Array.isArray(s.projects) ? s.projects.find((x) => x && x.id === id) : null;
    return p && typeof p.dev_cmd === 'string' && p.dev_cmd ? p : null;
  }
  function folderOf(p) {
    let abs = null;
    try { abs = resolveProjectPath(p.path); } catch { abs = null; }
    if (!abs) return null;
    try { const real = fsApi.realpathSync(abs); return fsApi.statSync(real).isDirectory() ? real : null; } catch { return null; }
  }
  function readText(file, cap = MAX_JSON) {
    try {
      const st = fsApi.lstatSync(file);
      if (!st.isFile() || st.size > cap) return null;
      return fsApi.readFileSync(file, 'utf8');
    } catch { return null; }
  }
  // the parts a key hashes; null when the command cannot be bound to anything (refused)
  function parts(core, parsed, folder) {
    const scripts = {};
    if (parsed.scripts.length) {
      const txt = readText(path.join(folder, 'package.json'));
      let pkg = null;
      try { pkg = txt == null ? null : JSON.parse(txt); } catch { pkg = null; }
      const table = isObj(pkg) && isObj(pkg.scripts) ? pkg.scripts : null;
      if (!table || typeof table[parsed.scripts[0]] !== 'string') return null;   // nothing to allow: the script is not there
      for (const n of parsed.scripts) scripts[n] = typeof table[n] === 'string' ? table[n] : null;
    }
    if (parsed.file) {
      const f = path.join(folder, ...parsed.file.split('/'));
      try { const real = fsApi.realpathSync(f); if (!within(real, folder) || !fsApi.statSync(real).isFile()) return null; } catch { return null; }
    }
    const rc = {};
    for (const n of RC_FILES) rc[n] = readText(path.join(folder, n), 64 * 1024);
    return { folder: WIN ? lower(folder) : folder, words: parsed.words, scripts, rc };
  }

  // ---- finding the runner ------------------------------------------------------------------------
  function findOnPath(runner, folder) {
    const dirs = String(env.PATH || env.Path || '').split(WIN ? ';' : ':');
    const names = WIN ? (RUNNER_FILES[runner] || []) : [runner];
    for (let d of dirs) {
      d = d.trim().replace(/^"(.*)"$/, '$1');
      if (!d || !path.isAbsolute(d)) continue;   // an empty or relative entry means the current folder: never searched
      for (const n of names) {
        const cand = path.join(d, n);
        try {
          const real = fsApi.realpathSync(cand);
          if (!fsApi.statSync(real).isFile()) continue;
          if (within(real, folder)) continue;   // a hit inside the project is not a runner
          return { hit: cand, dir: d, name: n };
        } catch { /* not here */ }
      }
    }
    return null;
  }
  function plan(parsed, folder) {
    const args = parsed.words.slice(1);
    const found = findOnPath(parsed.runner, folder);
    if (!found) return null;
    const baseEnv = {};
    for (const k of Object.keys(env)) if (ENV_ALLOW_LC.has(k.toLowerCase())) baseEnv[k] = env[k];
    baseEnv.NoDefaultCurrentDirectoryInExePath = '1';
    const options = { cwd: folder, shell: false, stdio: 'ignore', windowsHide: true, env: baseEnv };
    if (!WIN || /\.exe$/i.test(found.name)) return { file: found.hit, args, options };
    if (parsed.runner === 'npm') {
      const cli = path.join(found.dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), nodeExe = path.join(found.dir, 'node.exe');
      try { if (fsApi.statSync(cli).isFile() && fsApi.statSync(nodeExe).isFile()) return { file: nodeExe, args: [cli, ...args], options }; } catch { /* fall back to the shim */ }
    }
    if (SHELL_UNSAFE.test(found.hit)) return null;
    const comspec = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'cmd.exe');
    return { file: comspec, args: ['/d', '/s', '/c', '""' + found.hit + '" ' + args.join(' ') + '"'], options: { ...options, windowsVerbatimArguments: true } };
  }
  let ENV_ALLOW_LC = new Set();

  // ---- the four calls ----------------------------------------------------------------------------
  async function evaluate(id) {
    const core = await getCore();
    ENV_ALLOW_LC = new Set(core.ENV_ALLOW.map((k) => k.toLowerCase()));
    if (typeof id !== 'string' || !core.ID_RE.test(id)) return { word: core.WORDS.refused };
    const p = project(id);
    if (!p) return { word: core.WORDS.refused };
    const parsed = core.parseDevCommand(p.dev_cmd);
    if (!parsed.ok) return { word: core.WORDS.refused };
    const folder = folderOf(p);
    if (!folder) return { word: core.WORDS.refused };
    const pr = parts(core, parsed, folder);
    if (!pr) return { word: core.WORDS.refused };
    return { core, id, p, parsed, folder, key: core.devKey(pr) };
  }

  async function start(id) {
    try {
      const core = await getCore();
      if (typeof id === 'string' && servers.has(id)) return core.WORDS.running;
      const ev = await evaluate(id);
      if (ev.word) return ev.word;
      const store = readStore(core);
      const entry = store[id];
      if (!entry || entry.key !== ev.key || entry.words.join(' ') !== ev.parsed.words.join(' ')) return core.WORDS.unconfirmed;
      if (orphan(id)) return core.WORDS.running;
      const pl = plan(ev.parsed, ev.folder);
      if (!pl) return core.WORDS.refused;
      if (!hourOk(starts, MAX_STARTS)) return core.WORDS.busy;
      let proc;
      try { proc = spawn(pl.file, pl.args, pl.options); } catch { return core.WORDS.refused; }
      if (!proc) return core.WORDS.refused;
      proc.__hqStartedAt = now();   // hq:live-state reports it, so a reloaded window knows how long it has run
      servers.set(id, proc);
      if (proc.pid) { try { noteRunning(id, proc.pid, proc.__hqStartedAt); } catch { /* the leftover list is a courtesy */ } }
      proc.on('close', (code) => {
        if (servers.get(id) === proc) servers.delete(id);
        try { dropRunning(id, proc.pid); } catch { /* ignore */ }
        sendStatus({ id, running: false, code: Number.isInteger(code) ? code : null });
      });
      proc.on('error', () => {
        if (servers.get(id) === proc) servers.delete(id);
        try { dropRunning(id, proc.pid); } catch { /* ignore */ }
        sendStatus({ id, running: false, error: 'could not start' });
      });
      sendStatus({ id, running: true });
      return core.WORDS.started;
    } catch { return 'refused'; }
  }

  async function allow(id, shownHash) {
    try {
      const core = await getCore();
      if (typeof shownHash !== 'string' || !/^[0-9a-f]{8}$/.test(shownHash)) return core.ALLOW_WORDS.refused;
      if (!hourOk(allows, MAX_ALLOWS)) return core.ALLOW_WORDS.busy;
      const ev = await evaluate(id);
      if (ev.word) return core.ALLOW_WORDS.refused;
      if (core.hashShown(ev.p.dev_cmd) !== shownHash) return core.ALLOW_WORDS.changed;
      const store = readStore(core);
      store[id] = { words: ev.parsed.words.slice(), key: ev.key, confirmedAt: new Date(now()).toISOString() };
      writeStore(store);
      return core.ALLOW_WORDS.allowed;
    } catch { return 'refused'; }
  }

  // state(id) -> 'allowed' | 'unconfirmed' | 'refused' | 'none'   (read only: starts nothing, stores nothing; the launcher's project rows and its Open workspace step read it)
  async function state(id) {
    try {
      const core = await getCore();
      if (typeof id !== 'string' || !core.ID_RE.test(id) || !project(id)) return 'none';
      const ev = await evaluate(id);
      if (ev.word) return 'refused';
      const e = readStore(core)[id];
      return e && e.key === ev.key && e.words.join(' ') === ev.parsed.words.join(' ') ? 'allowed' : 'unconfirmed';
    } catch { return 'refused'; }
  }

  // ---- leftovers and stopping --------------------------------------------------------------------
  const alive = isAlive || ((pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } });
  const startedAtOf = procStart || ((pid) => {
    if (!WIN || !Number.isInteger(pid) || pid <= 0) return null;
    try {
      const r = spawnSync(path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { windowsHide: true, timeout: 8000, encoding: 'utf8' });
      const t = Date.parse(String(r.stdout || '').trim());
      return Number.isFinite(t) ? t : null;
    } catch { return null; }
  });
  // a leftover child of an earlier run of this app that is still alive: { pid, startedAt } or null (a dead or reused pid is dropped)
  function orphan(id) {
    try {
      const e = readRunning()[id];
      if (!e) return null;
      if (!alive(e.pid)) { dropRunning(id); return null; }
      const real = startedAtOf(e.pid);
      if (real == null || Math.abs(real - e.startedAt) > START_SLOP_MS) { dropRunning(id); return null; }
      return e;
    } catch { return null; }
  }
  const killTree = (pid) => {
    try { return spawnSync(path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(pid), '/f', '/t'], { windowsHide: true, timeout: 10000 }).status === 0; } catch { return false; }
  };
  function stop(id) {
    if (typeof id !== 'string') return false;
    const proc = servers.get(id);
    if (proc && proc.pid) {
      const ok = killTree(proc.pid);
      servers.delete(id);
      try { dropRunning(id, proc.pid); } catch { /* ignore */ }
      sendStatus({ id, running: false });
      return ok;
    }
    const o = orphan(id);
    if (o) { const ok = killTree(o.pid); try { dropRunning(id); } catch { /* ignore */ } sendStatus({ id, running: false }); return ok; }
    return false;
  }
  function killAll() {
    let n = 0;
    for (const [, proc] of servers) if (proc && proc.pid) { killTree(proc.pid); n += 1; }
    servers.clear();
    try { writeRunning({}); } catch { /* ignore */ }
    return n;
  }
  return { start, allow, state, stop, killAll, orphan, _clear() { starts.length = 0; allows.length = 0; } };
}

function init({ ipcMain, getWin, gate = require('./main-gate').fromMain, afterKill = () => {}, ...deps } = {}) {
  const dev = create(deps);
  const idOf = (arg) => (isObj(arg) && typeof arg.id === 'string' ? arg.id : typeof arg === 'string' ? arg : '');
  ipcMain.handle('hq:dev-start', async (event, arg) => (gate(event, getWin) ? dev.start(idOf(arg)) : 'refused'));
  ipcMain.handle('hq:dev-allow', async (event, arg) => (gate(event, getWin) ? dev.allow(idOf(arg), isObj(arg) && typeof arg.shownHash === 'string' ? arg.shownHash : '') : 'refused'));
  ipcMain.handle('hq:dev-stop', (event, id) => (gate(event, getWin) ? dev.stop(typeof id === 'string' ? id : '') : false));
  ipcMain.handle('hq:kill-servers', (event) => { if (!gate(event, getWin)) return 0; const n = dev.killAll(); try { afterKill(n); } catch { /* a refresh hook */ } return n; });
  return dev;
}

module.exports = { create, init, MAX_STARTS, MAX_ALLOWS, RC_FILES };
