// The phone file, main side (batch 6, dish phone-file; engine: brief-file-core.mjs). When the owner picks a folder they already sync to their phone,
// this keeps ONE small counts-only text file there, <folder>/workspacehq-brief.txt: the same words the tray shows, no names, paths, amounts or ids.
// OFF by default: with no folder picked nothing is written, anywhere.
//
//   init({ ipcMain, dialog, getWin, dataDir, repoRoot, now?, ...test hooks }) → { act(action), check(force?), dispose(), ready }
//     getWin: () => the MAIN window. The one channel hq:reach:brief-file checks event.sender === getWin().webContents first.
//     dataDir: data/ (state in the gitignored data/.brief-file.json: { v:1, folder, lastWriteAt, lastError }; the Brief is read from data/brief.json
//              and brief-state.json, the two files brief.js already writes, so main.js needs no onBrief hook).
//     repoRoot: the project folder; a folder inside it is refused on pick AND on every write.
//   hq:reach:brief-file (invoke(action)): 'pick' | 'clear' (anything else is refused)
//     pick  → the native folder dialog; validates; saves; writes the file once at once → { ok:true, folderName, written } | { error, canceled? }
//     clear → turns the file off; the file already written stays where it is, and the answer says so → { ok:true, folderName:null, fileLeft, note }
//
// When it writes: brief.json changes (watched, debounced 2 s) and the text minus its time line differs from the last write, or 10 minutes passed
// since the last write (so the time on the first line stays true). The write is atomic: a temp file in the same folder, then a rename; when a sync
// client holds the target and the rename fails it falls back to ONE direct write. A failure keeps the last file, sets lastError (words, never a path)
// and tries again on the next change or tick. Nothing here ever throws to a caller or becomes a Brief row.
//
// Test hooks (never passed by main.js): fsApi, watchFn, timers { setTimeout, clearTimeout, setInterval, clearInterval }, debounceMs, watch:false.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const CHANNEL = 'hq:reach:brief-file';
const MAX_JSON_BYTES = 8 * 1024 * 1024;

let mod = null;
const lib = () => mod || (mod = import(pathToFileURL(path.join(__dirname, 'brief-file-core.mjs')).href));
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const errWords = (e) => 'could not write the file' + (e && typeof e.code === 'string' && /^[A-Z0-9_]{2,20}$/.test(e.code) ? ' (' + e.code + ')' : '');

function init({ ipcMain, dialog, getWin, dataDir, repoRoot, now = () => new Date(), fsApi = fs, watch = true, watchFn, debounceMs = 2000, timers = {} } = {}) {
  const T = {
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    setInterval: timers.setInterval || setInterval, clearInterval: timers.clearInterval || clearInterval,
  };
  const stateFile = path.join(dataDir, '.brief-file.json');
  const briefFile = path.join(dataDir, 'brief.json');
  const briefStateFile = path.join(dataDir, 'brief-state.json');
  const ready = lib().catch(() => null);

  let lastBody = null;      // the body (text minus the time line) of the last successful write by this process
  let pending = false;      // the last attempt failed: the next check writes even if the text is unchanged
  let timer = null, tick = null, watcher = null, picking = false, disposed = false;
  let chain = Promise.resolve();
  const run = (fn) => { const p = chain.then(fn); chain = p.then(() => {}, () => {}); return p; };

  // ---- state file (the source of truth: re-read on every check, so an edit by hand or by another module is honoured) ----
  function readState(C) {
    let raw;
    try { raw = fsApi.readFileSync(stateFile, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { state: C.normalizeState(null) } : { unreadable: true, state: C.normalizeState(null) }; }
    try { return { state: C.normalizeState(JSON.parse(raw)) }; } catch { return { unreadable: true, state: C.normalizeState(null) }; }
  }
  function writeState(state) {
    const tmp = stateFile + '.' + process.pid + '.tmp';
    try { fsApi.writeFileSync(tmp, JSON.stringify(state, null, 1)); fsApi.renameSync(tmp, stateFile); return true; }
    catch { try { fsApi.unlinkSync(tmp); } catch { /* never created */ } return false; }
  }
  function readJson(file) {
    try {
      if (fsApi.statSync(file).size > MAX_JSON_BYTES) return null;
      const j = JSON.parse(fsApi.readFileSync(file, 'utf8'));
      return isObj(j) ? j : null;
    } catch { return null; }
  }

  // ---- one check: build the text, decide whether to write, write ----
  async function doCheck(force) {
    const C = await ready;
    if (!C) return { skipped: 'unavailable' };
    const st = readState(C);
    if (st.unreadable || !st.state.folder) return { skipped: 'off' };
    const state = st.state;
    const brief = readJson(briefFile);
    if (!brief) return { skipped: 'no-brief' };                      // no brief to say anything about: the file already there stays, with its own time
    const bs = readJson(briefStateFile);
    const t = now();
    const text = C.fileText(brief, { now: t, firstSeen: bs && isObj(bs.firstSeen) ? bs.firstSeen : {} });
    const body = C.bodyOf(text);
    const lastAt = state.lastWriteAt ? Date.parse(state.lastWriteAt) : null;
    const due = force || pending || lastBody === null || body !== lastBody || lastAt === null || t.getTime() - lastAt >= C.REWRITE_MS;
    if (!due) return { skipped: 'unchanged' };

    const fail = (words) => {
      pending = true;
      writeState({ ...state, lastError: words });
      return { error: words };
    };
    const ok = C.refuseFolder(state.folder, { repoRoot, fsApi });     // re-checked on every write: the folder may have moved, vanished or become a repo path
    if (!ok.ok) return fail(ok.reason);
    const target = path.join(ok.folder, C.FILE_NAME);
    const tmp = path.join(ok.folder, '.' + C.FILE_NAME + '.' + process.pid + '.tmp');
    try {
      fsApi.writeFileSync(tmp, text);
      try { fsApi.renameSync(tmp, target); }
      catch { try { fsApi.unlinkSync(tmp); } catch { /* gone */ } fsApi.writeFileSync(target, text); }   // a sync client holds the target: one direct write
    } catch (e) {
      try { fsApi.unlinkSync(tmp); } catch { /* never created */ }
      return fail(errWords(e));
    }
    lastBody = body; pending = false;
    writeState({ ...state, lastWriteAt: t.toISOString(), lastError: null });
    return { wrote: true };
  }

  function schedule() {
    if (disposed) return;
    if (timer) T.clearTimeout(timer);
    timer = T.setTimeout(() => { timer = null; run(() => doCheck(false)).catch(() => {}); }, debounceMs);
    if (timer && timer.unref) timer.unref();
  }

  // ---- the two actions ----
  async function doPick(C) {
    if (picking) return { error: 'A folder window is already open' };
    picking = true;
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      const opts = { title: 'Pick the folder your phone already syncs', buttonLabel: 'Use this folder', properties: ['openDirectory', 'createDirectory'] };
      const res = await (w && !(typeof w.isDestroyed === 'function' && w.isDestroyed()) ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
      if (!res || res.canceled || !Array.isArray(res.filePaths) || typeof res.filePaths[0] !== 'string') return { error: 'No folder was picked', canceled: true };
      const ok = C.refuseFolder(res.filePaths[0], { repoRoot, fsApi });
      if (!ok.ok) return { error: ok.reason };
      return await run(async () => {
        if (!writeState({ v: 1, folder: ok.folder, lastWriteAt: null, lastError: null })) return { error: 'The setting could not be saved' };
        lastBody = null; pending = false;
        const r = await doCheck(true);
        if (r.error) return { error: 'The folder is saved, but the first write failed: ' + r.error };
        return { ok: true, folderName: C.folderNameOf(ok.folder), written: r.wrote === true };
      });
    } catch { return { error: 'The folder window could not open' }; }
    finally { picking = false; }
  }

  function doClear(C) {
    return run(async () => {
      const prev = readState(C).state;
      if (timer) { T.clearTimeout(timer); timer = null; }
      if (!writeState({ v: 1, folder: null, lastWriteAt: null, lastError: null })) return { error: 'The setting could not be saved' };
      lastBody = null; pending = false;
      const fileLeft = !!(prev.folder && prev.lastWriteAt);
      return { ok: true, folderName: null, fileLeft, note: fileLeft ? 'Turned off. The file already written stays in that folder - delete it there if you want it gone.' : 'Turned off.' };
    });
  }

  async function act(action) {
    if (action !== 'pick' && action !== 'clear') return { error: 'Unknown action' };
    const C = await ready;
    if (!C) return { error: 'The phone file module could not load' };
    return action === 'pick' ? doPick(C) : doClear(C);
  }

  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      const wc = w && !(typeof w.isDestroyed === 'function' && w.isDestroyed()) ? w.webContents : null;
      return !!wc && !!event && event.sender === wc;
    } catch { return false; }
  };
  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle(CHANNEL, async (event, action) => {
      if (!fromMain(event)) return { error: 'Not allowed from this window' };
      try { return await act(action); } catch { return { error: 'Could not do that' }; }
    });
  }

  if (watch) {
    try {
      const w = typeof watchFn === 'function' ? watchFn : (dir, cb) => fs.watch(dir, cb);
      watcher = w(dataDir, (_ev, f) => { if (!f || String(f) === 'brief.json') schedule(); });
    } catch { watcher = null; }
  }
  tick = T.setInterval(() => { run(() => doCheck(false)).catch(() => {}); }, 5 * 60e3);   // half the rewrite age, so "10 minutes" never slips to 20
  if (tick && tick.unref) tick.unref();
  schedule();    // a folder set in an earlier run gets its file refreshed shortly after startup; with none set the check does nothing

  function dispose() {
    disposed = true;
    if (timer) { T.clearTimeout(timer); timer = null; }
    if (tick) { T.clearInterval(tick); tick = null; }
    if (watcher && typeof watcher.close === 'function') { try { watcher.close(); } catch { /* already closed */ } }
    watcher = null;
  }

  return { act, check: (force) => run(() => doCheck(force === true)), dispose, ready, channel: CHANNEL, stateFile };
}

module.exports = { init, CHANNEL };
