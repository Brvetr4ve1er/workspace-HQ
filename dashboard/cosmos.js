// Cosmos space — main side. Owner data lives in <dataDir>/cosmos/ (gitignored). Spec:
// docs/superpowers/specs/2026-11-07-cosmos-space-design.md; IPC-CONTRACT rows hq:cosmos:*.
// This file is thin on purpose: the rules live in pure ESM modules under ./cosmos/ (reached through import()
// of file URLs — Electron 32 cannot require ESM, same idiom as money.js):
//   store.mjs (every disk write, atomic) · curation.mjs (validated intents) · paths.mjs (the security
//   surface: ids -> relative path -> realpath-contained absolute path) · importlocal.mjs (old-gallery import)
//   and, from the index engine, indexer.mjs (the walk/thumbnail/hash pipeline, run through runIndex).
//
// create({ dataDir, deps, now, newId, castSend, env }) -> { read, apply, pickFolder, index, cancelIndex,
//   trash, reveal, importFiles, importFromLocal, addClip, sweepClipTmp, whenIdle, dispose }
// init({ ipcMain, dataDir, getWin, castSend }) registers the nine invoke channels (the tenth row of the
// contract, hq:cosmos:index-progress, is a push through castSend).
//
// DEPS (the seam with cosmos-electron.js; injected so plain Node can test everything):
//   pickFolder() -> Promise<string|null>
//   pickFile({title, filters}) -> Promise<string|null>
//   trash(abs) -> Promise<void>                     (rejects with the failure)
//   reveal(abs) -> void
//   thumbnail(abs, {ext, kind, edge, size}) -> Promise<null | {jpeg:Buffer, width, height,
//        sourceWidth:number|null, sourceHeight:number|null, rgba32:{width,height,data:Uint8Array},
//        gray9x8:Uint8Array}>                       (never throws)
//   dispose()
//
// Rules this file keeps (spec §5): the renderer sends ids, never paths, for a read or a delete; every
// handler resolves a value or {error}/{ok:false}, never throws at the renderer; no network of any kind;
// the pictures folder is only ever read (the single deletion path is shell.trashItem, through deps.trash,
// and in this batch only for files the app itself copied into data/cosmos/imports).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const MAX_TRASH = 20;
const MAX_IMPORT_PATHS = 1000;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const REPLACE_TTL_MS = 10 * 60 * 1000;
const STALE_DAYS = 14;
const ONLY_IMPORTS = 'Only files you dropped into Cosmos can be moved to the Recycle Bin from here yet';
const NO_HELPERS = 'Cosmos could not start its file helpers, so this is not available right now.';

let libs = null;   // { store, curation, paths, importlocal, ids, infer, clips } once loaded
async function lib() {
  if (!libs) {
    const load = (f) => import(pathToFileURL(path.join(__dirname, 'cosmos', f)).href);
    const [store, curation, paths, importlocal, ids, infer, clips] = await Promise.all(
      ['store.mjs', 'curation.mjs', 'paths.mjs', 'importlocal.mjs', 'ids.mjs', 'infer.mjs', 'clips.mjs'].map(load));
    libs = { store, curation, paths, importlocal, ids, infer, clips };
  }
  return libs;
}

let engineLib;   // the index engine's runIndex, or null while ./cosmos/indexer.mjs does not exist
async function defaultEngine() {
  if (engineLib === undefined) {
    try {
      const m = await import(pathToFileURL(path.join(__dirname, 'cosmos', 'indexer.mjs')).href);
      engineLib = typeof m.runIndex === 'function' ? { runIndex: m.runIndex } : null;
    } catch { engineLib = null; }
  }
  return engineLib;
}

/** At most one delivery per minGapMs (260 ms: any 1000 ms window holds at most 4); the latest value wins. */
function makeProgressGate({ now, emit, timers, minGapMs = 260 }) {
  let last = -Infinity;
  let pending = null;
  let timer = null;
  let waiter = null;
  const settle = () => { if (pending === null && waiter) { const w = waiter; waiter = null; w(); } };
  const deliver = () => {
    timer = null;
    if (pending === null) { settle(); return; }
    const t = now();
    const wait = last + minGapMs - t;
    if (wait > 0) { timer = timers.set(deliver, wait); return; }
    const p = pending;
    pending = null;
    last = t;
    try { emit(p); } catch { /* a closed window must not stop the index */ }
    settle();
  };
  return {
    push(p) { pending = p; if (timer === null) deliver(); },
    finish() { return new Promise((resolve) => { if (pending === null) { resolve(); return; } waiter = resolve; if (timer === null) deliver(); }); },
    cancel() { if (timer !== null) timers.clear(timer); timer = null; pending = null; settle(); },
  };
}

const refuse = (reason, message) => ({ ok: false, reason, message });
const errText = (e) => (e && e.message ? e.message : 'unknown problem');
const yieldNow = () => new Promise((resolve) => setImmediate(resolve));

function create({
  dataDir, deps = null, now = () => new Date(), newId = () => crypto.randomBytes(4).toString('hex'),
  castSend = () => {}, env = process.env, engine = null, timers = { set: setTimeout, clear: clearTimeout }, fsImpl = fs,
}) {
  const cosmosDir = path.join(dataDir, 'cosmos');
  const importsDir = path.join(cosmosDir, 'imports');

  let ctxPromise = null;
  const ctx = () => {
    if (!ctxPromise) {
      ctxPromise = lib().then((L) => ({ L, S: L.store.makeStore({ fs: fsImpl, dir: cosmosDir }) }));
    }
    return ctxPromise;
  };

  let pickedRoot = null;       // the last folder the owner chose (memory only)
  let indexing = null;         // { phase, done, total, startedAt, cancelled }
  let activeRun = null;        // the promise of the background index
  let pendingReindex = false;  // files were dropped while an index ran
  let libraryIssue = null;     // set while the library on disk was unreadable and has not been rebuilt
  let salvagedIdMap = null;
  let cache = null;            // { key, library, works, issue }
  const holds = new Map();     // token -> { items, expires }

  const tNow = () => now().getTime();
  const hasDep = (name) => !!deps && typeof deps[name] === 'function';
  const realpath = (p) => fsImpl.realpathSync(p);
  const isoNow = () => now().toISOString();

  function purgeHolds() {
    const t = tNow();
    for (const [k, h] of holds) if (h.expires <= t) holds.delete(k);
  }

  // ---- library cache -------------------------------------------------------------------------------
  function stampOf(S) {
    try { const st = fsImpl.statSync(S.paths.library); return `${st.size}:${st.mtimeMs}`; } catch { return 'none'; }
  }

  function decorate(L, S, library, configRoot) {
    const root = library.root || configRoot;
    const thumbs = S.listThumbNames();
    return library.works.map((w) => {
      const c = L.paths.checkRel(w.rel);
      let url = null;
      if (!c.error) {
        try {
          if (c.imp) url = L.paths.fileUrl(path.join(importsDir, c.name));
          else if (root) url = L.paths.fileUrl(path.join(root, ...c.segs));
        } catch { url = null; }
      }
      const name = S.thumbName(w.id);
      const thumbUrl = w.thumb && thumbs.has(name) ? L.paths.fileUrl(path.join(S.paths.thumbs, name)) : null;
      return { ...w, url, thumbUrl };
    });
  }

  /** { library, works, issue } | { error } — cached on the library file's size and mtime. */
  function loadLibrary(L, S, config, force) {
    const key = `${stampOf(S)}|${config.root || ''}`;
    if (!force && cache && cache.key === key) return cache;
    const r = S.readLibrary();
    let library;
    let issue = null;
    if (r.error && !r.idMap) return { error: r.error };
    if (r.error) {
      libraryIssue = r.error;
      salvagedIdMap = r.idMap;
      issue = r.error;
      library = { ...L.store.emptyLibrary(), idMap: r.idMap };
    } else library = r.library;
    cache = { key: `${stampOf(S)}|${config.root || ''}`, library, works: decorate(L, S, library, config.root), issue };
    return cache;
  }

  const dropCache = () => { cache = null; };

  /** The library for an operation that must see the truth on disk (never the cache). */
  function freshLibrary(L, S, config) {
    dropCache();
    return loadLibrary(L, S, config, true);
  }

  // ---- read ----------------------------------------------------------------------------------------
  async function read(opts) {
    try {
      const { L, S } = await ctx();
      const force = !!(opts && typeof opts === 'object' && opts.force);
      const c = S.readConfig();
      if (c.error) return { error: c.error };
      const warnings = [];
      if (c.warning) warnings.push(c.warning);
      const lr = loadLibrary(L, S, c.config, force);
      if (lr.error) return { error: lr.error };
      const cu = S.readCuration();
      if (cu.error && !cu.curation) return { error: cu.error };
      if (cu.error) warnings.push(cu.error);
      const cl = S.readCleanup();
      if (cl.error && !cl.cleanup) return { error: cl.error };
      if (cl.error) warnings.push(cl.error);
      const root = lr.library.root || c.config.root;
      let rootOk = true;
      if (root) { try { rootOk = fsImpl.statSync(root).isDirectory(); } catch { rootOk = false; } }
      const issue = libraryIssue || lr.issue;
      const works = issue ? [] : lr.works;
      const unindexed = works.length === 0 && (!c.config.root || !lr.library.generatedAt);
      const out = {
        state: issue ? 'error' : (unindexed ? 'empty' : 'ready'),
        config: c.config,
        works,
        dupes: issue ? L.store.emptyDupes() : lr.library.dupes,
        curation: cu.curation,
        cleanup: cl.cleanup,
        rootOk,
        indexing: indexing ? { phase: indexing.phase, done: indexing.done, total: indexing.total, startedAt: indexing.startedAt } : null,
      };
      if (issue) out.error = issue;
      if (warnings.length) out.warnings = warnings;
      if (c.config.indexedAt) {
        const days = Math.floor((tNow() - Date.parse(c.config.indexedAt)) / 86400000);
        if (Number.isFinite(days) && days > STALE_DAYS) out.stale = { indexedAt: c.config.indexedAt, days };
      }
      return out;
    } catch (e) { return { error: 'Could not read Cosmos data: ' + errText(e) }; }
  }

  // ---- apply ---------------------------------------------------------------------------------------
  async function apply(intent) {
    try {
      const { L, S } = await ctx();
      const bad = L.curation.checkIntent(intent);
      if (bad) return { error: bad };
      purgeHolds();
      const c = S.readConfig();
      if (c.error) return { error: c.error };
      const cu = S.readCuration();
      if (cu.error) return { error: cu.error };
      const cl = S.readCleanup();
      if (cl.error) return { error: cl.error };
      const lr = loadLibrary(L, S, c.config, false);
      if (lr.error) return { error: lr.error };
      const baseTags = new Map();
      const baseOf = (id) => {
        if (baseTags.size === 0) for (const w of lr.library.works) baseTags.set(w.id, Array.isArray(w.tags) ? w.tags : []);
        return baseTags.get(id) || [];
      };
      const replace = (token, curation) => {
        const h = holds.get(token);
        holds.delete(token);
        if (!h || h.expires <= tNow()) return { error: 'This import can no longer be replaced. Import the backup again.' };
        const r = L.importlocal.applyConflicts(curation, h.items);
        return { curation: r.curation, note: `Replaced ${r.clusters} cluster${r.clusters === 1 ? '' : 's'} and ${r.overrides} edit${r.overrides === 1 ? '' : 's'} with the backup’s version.` };
      };
      const r = L.curation.applyIntent(cu.curation, cl.cleanup, intent, { idMap: lr.library.idMap, now, newId, baseTags: baseOf, replace });
      if (r.error) return { error: r.error };
      try {
        if (r.touched.curation) S.writeCuration(r.curation);
        if (r.touched.cleanup) S.writeCleanup(r.cleanup);
      } catch (e) { return { error: 'Not saved: ' + errText(e) }; }
      return { view: { curation: r.curation, cleanup: r.cleanup }, note: r.note };
    } catch (e) { return { error: 'That did not work: ' + errText(e) }; }
  }

  // ---- folder, index -------------------------------------------------------------------------------
  async function pickFolder() {
    try {
      const fromEnv = typeof env.HQ_COSMOS_ROOT === 'string' && env.HQ_COSMOS_ROOT !== '' ? env.HQ_COSMOS_ROOT : null;   // gates only
      if (fromEnv) { pickedRoot = fromEnv; return fromEnv; }
      if (!hasDep('pickFolder')) return null;
      const p = await deps.pickFolder();
      if (typeof p !== 'string' || p === '') return null;
      pickedRoot = p;
      return p;
    } catch { return null; }
  }

  function makeIo(S) {
    return {
      readdir: (dir) => fsImpl.readdirSync(dir, { withFileTypes: true })
        .map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink() })),
      stat: (abs) => { const st = fsImpl.statSync(abs); return { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }; },
      readHead: (abs, n) => {
        const fd = fsImpl.openSync(abs, 'r');
        try {
          const buf = Buffer.alloc(n);
          const got = fsImpl.readSync(fd, buf, 0, n, 0);
          return new Uint8Array(buf.buffer, buf.byteOffset, got);
        } finally { fsImpl.closeSync(fd); }
      },
      hashFile: (abs) => new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const s = fsImpl.createReadStream(abs);
        s.on('error', reject);
        s.on('data', (chunk) => h.update(chunk));
        s.on('end', () => resolve(h.digest('hex')));
      }),
      thumbnail: async (abs, o) => {
        if (!hasDep('thumbnail')) return null;
        try { return (await deps.thumbnail(abs, o)) || null; } catch { return null; }
      },
      thumbInfo: (id) => S.thumbInfo(id),
      writeThumb: (id, buf) => S.writeThumb(id, buf),
    };
  }

  function readJsonCapped(file) {
    const st = fsImpl.statSync(file);
    if (st.size > MAX_JSON_BYTES) throw new Error('that file is too large');
    return JSON.parse(fsImpl.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  }

  /** Validate and launch one background index. Returns true or a refusal; never throws. */
  async function startIndex({ fromConfig = false } = {}) {
    try {
      const { L, S } = await ctx();
      if (indexing) return refuse('running', 'An index is already running.');
      const runner = engine || await defaultEngine();
      if (!runner) return refuse('unavailable', 'The indexer is not available in this build.');
      const c = S.readConfig();
      if (c.error) return refuse('error', c.error);
      const root = fromConfig ? c.config.root : (pickedRoot || c.config.root);
      if (!root) return refuse('no-root', 'Choose a folder to index first.');
      let st;
      try { st = fsImpl.statSync(root); } catch { return refuse('root-missing', 'That folder cannot be reached right now. Is the drive connected?'); }
      if (!st.isDirectory()) return refuse('not-a-folder', 'That is not a folder.');
      const rr = path.resolve(root);
      const cc = path.resolve(cosmosDir);
      if (L.paths.isInside(rr, cc) || rr.toLowerCase() === cc.toLowerCase()) {
        return refuse('not-a-folder', 'Choose a folder that does not contain the Cosmos data folder of WorkspaceHQ itself.');
      }
      const lr = freshLibrary(L, S, c.config);
      if (lr.error) return refuse('error', lr.error);
      let oldLibrary = null;
      const haveIds = lr.library.idMap.entries.length > 0;
      if (haveIds || lr.library.works.length > 0 || lr.library.generatedAt) oldLibrary = lr.library;
      else if (salvagedIdMap && salvagedIdMap.entries.length) oldLibrary = { ...lr.library, idMap: salvagedIdMap };
      let manifest = null;
      if (!oldLibrary && typeof env.HQ_COSMOS_MANIFEST === 'string' && env.HQ_COSMOS_MANIFEST !== '') {   // gates only
        try { manifest = readJsonCapped(env.HQ_COSMOS_MANIFEST); } catch { manifest = null; }
      }
      try { fsImpl.mkdirSync(importsDir, { recursive: true }); } catch { /* the walk counts an unreadable folder */ }
      indexing = { phase: 'walk', done: 0, total: 0, startedAt: isoNow(), cancelled: false };
      const p = execute({ L, S, runner, root, oldLibrary, manifest, previousIndexedAt: c.config.indexedAt })
        .catch(() => {})
        .then(() => { if (activeRun === p) activeRun = null; });
      activeRun = p;
      return true;
    } catch (e) { return refuse('error', 'Could not start the index: ' + errText(e)); }
  }

  async function execute({ L, S, runner, root, oldLibrary, manifest, previousIndexedAt }) {
    const run = indexing;
    const gate = makeProgressGate({ now: tNow, timers, emit: (p) => castSend('hq:cosmos:index-progress', p) });
    let configWritten = false;
    const onProgress = (p) => {
      if (!p || typeof p !== 'object') return;
      if (!configWritten) {
        configWritten = true;
        try { S.writeConfig({ root, indexedAt: previousIndexedAt }); } catch { /* the final write will say */ }
      }
      run.phase = String(p.phase || run.phase);
      run.done = Number.isFinite(p.done) ? p.done : run.done;
      run.total = Number.isFinite(p.total) ? p.total : run.total;
      gate.push({ phase: run.phase, done: run.done, total: run.total });
    };
    let result = null;
    let failure = null;
    try {
      result = await runner.runIndex({
        roots: [{ prefix: '', dir: root }, { prefix: 'imports:', dir: importsDir }],
        rootLabel: root,
        io: makeIo(S),
        oldLibrary,
        manifest,
        now,
        yieldNow,
        onProgress,
        isCancelled: () => run.cancelled,
        concurrency: 3,
      });
    } catch (e) { failure = errText(e); }

    let summary = { elements: 0, thumbs: 0, thumbsFailed: 0, unchanged: 0, minted: 0, seeded: 0, cancelled: false };
    let phase = 'done';
    if (!failure && result && result.cancelled) {
      summary.cancelled = true;
      phase = 'cancelled';
    } else if (!failure) {
      const lib2 = result && result.library;
      if (!lib2 || !Array.isArray(lib2.works)) failure = 'the indexer returned nothing usable';
      else {
        try {
          S.writeLibrary({ ...lib2, version: 1, root });
          S.writeConfig({ root, indexedAt: isoNow() });
          libraryIssue = null;
          salvagedIdMap = null;
          dropCache();
          const s = result.stats || {};
          summary = {
            elements: lib2.works.length,
            thumbs: s.thumbsOk || 0,
            thumbsFailed: s.thumbsFailed || 0,
            unchanged: s.unchanged || 0,
            minted: s.minted || 0,
            seeded: s.seeded || 0,
            cancelled: false,
          };
        } catch (e) { failure = 'not saved: ' + errText(e); }
      }
    }
    const total = run.total;
    indexing = null;
    // batch 3: a grabbed clip waits for its work to exist, then gets its tags and title (the next run retries what is not there yet)
    if (!failure && !summary.cancelled) { try { await (await clipService()).afterIndex(); } catch { /* the next run retries */ } }
    const finalPush = failure
      ? { phase: 'error', done: run.done, total, done_all: true, error: failure, summary }
      : { phase, done: summary.cancelled ? run.done : (summary.elements || total), total: summary.cancelled ? total : (summary.elements || total), done_all: true, summary };
    gate.push(finalPush);
    await gate.finish();
    if (pendingReindex) {
      pendingReindex = false;
      if (!failure && !summary.cancelled) await startIndex({ fromConfig: true });
    }
  }

  async function index() {
    return startIndex({});
  }

  function cancelIndex() {
    if (indexing) indexing.cancelled = true;
    return true;
  }

  // ---- ids -> files ----------------------------------------------------------------------------------
  /** id -> { abs, rel } | { error }, always through the id map, paths.resolveWork and realpath. */
  function resolveElement(L, S, config, id, { importsOnly = false } = {}) {
    if (typeof id !== 'string' || id === '' || id.length > 300) return { error: 'That element is not valid.' };
    const lr = loadLibrary(L, S, config, false);
    if (lr.error) return { error: lr.error };
    const inLibrary = lr.library.works.some((w) => w.id === id);
    const rel = L.ids.relFor(lr.library.idMap, id);
    if (!inLibrary || rel === null) return { error: 'That element is not in the library.' };
    if (importsOnly && !rel.startsWith(L.paths.IMPORTS_PREFIX)) return { error: ONLY_IMPORTS };   // lifted when Cleanup lands
    const r = L.paths.resolveWork({ root: lr.library.root || config.root, importsDir, rel, realpath });
    if (r.error) return { error: r.error };
    return { abs: r.abs, rel, library: lr.library };
  }

  async function reveal(id) {
    try {
      const { L, S } = await ctx();
      const c = S.readConfig();
      if (c.error) return { ok: false, message: c.error };
      const r = resolveElement(L, S, c.config, id);
      if (r.error) return { ok: false, message: r.error };
      if (!hasDep('reveal')) return { ok: false, message: NO_HELPERS };
      deps.reveal(r.abs);
      return true;
    } catch (e) { return { ok: false, message: 'Could not show that file: ' + errText(e) }; }
  }

  function pruneDupes(dupes, gone) {
    const keep = (g) => ({ ...g, ids: (g.ids || []).filter((x) => !gone.has(x)) });
    const groups = (list) => (Array.isArray(list) ? list.map(keep).filter((g) => g.ids.length >= 2) : []);
    return {
      ...dupes,
      exact: groups(dupes.exact),
      near: groups(dupes.near),
      junk: Array.isArray(dupes.junk) ? dupes.junk.filter((j) => !gone.has(j && j.id)) : [],
    };
  }

  async function trash(ids) {
    const empty = { trashed: [], failed: [] };
    try {
      if (!Array.isArray(ids)) return { ...empty, failed: [{ id: '', message: 'Nothing was selected.' }] };
      if (ids.length > MAX_TRASH) return { ...empty, failed: [{ id: '', message: `Move at most ${MAX_TRASH} files to the Recycle Bin at once.` }] };
      const { L, S } = await ctx();
      const c = S.readConfig();
      const failed = [];
      const trashed = [];
      if (c.error) return { trashed, failed: ids.map((id) => ({ id: String(id), message: c.error })) };
      if (indexing) return { trashed, failed: ids.map((id) => ({ id: String(id), message: 'An index is running. Try again when it has finished.' })) };
      const seen = new Set();
      for (const id of ids) {
        const sid = typeof id === 'string' ? id : '';
        if (seen.has(sid)) continue;
        seen.add(sid);
        const r = resolveElement(L, S, c.config, sid, { importsOnly: true });
        if (r.error) { failed.push({ id: sid, message: r.error }); continue; }
        if (!hasDep('trash')) { failed.push({ id: sid, message: NO_HELPERS }); continue; }
        try { await deps.trash(r.abs); trashed.push(sid); } catch (e) { failed.push({ id: sid, message: errText(e) }); }
      }
      if (trashed.length) {
        try {
          const lr = freshLibrary(L, S, c.config);
          if (!lr.error) {
            const gone = new Set(trashed);
            const next = { ...lr.library, works: lr.library.works.filter((w) => !gone.has(w.id)), dupes: pruneDupes(lr.library.dupes, gone) };
            S.writeLibrary(next);
            dropCache();
            for (const id of trashed) S.removeThumb(id);
          }
        } catch (e) { failed.push({ id: '', message: 'The files were moved, but the library could not be updated: ' + errText(e) + ' Index again to refresh it.' }); }
      }
      return { trashed, failed };
    } catch (e) { return { trashed: [], failed: [{ id: '', message: 'That did not work: ' + errText(e) }] }; }
  }

  // ---- import files -----------------------------------------------------------------------------------
  async function importFiles(paths) {
    try {
      const { L, S } = await ctx();
      if (!Array.isArray(paths) || paths.length === 0) return { imported: 0, skipped: [] };
      if (paths.length > MAX_IMPORT_PATHS) return { imported: 0, skipped: [{ path: '', reason: `Drop at most ${MAX_IMPORT_PATHS} files at once.` }] };
      const c = S.readConfig();
      const label = (p) => (typeof p === 'string' ? p.slice(0, 1024) : '');
      if (c.error || !c.config.root) return { imported: 0, skipped: paths.map((p) => ({ path: label(p), reason: 'Index a folder first.' })) };
      const allowed = (ext) => L.infer.IMAGE_EXT.has(ext) || L.infer.VIDEO_EXT.has(ext);
      const skipped = [];
      let imported = 0;
      fsImpl.mkdirSync(importsDir, { recursive: true });
      for (const p of paths) {
        if (typeof p !== 'string' || p === '' || p.includes('\0') || !path.isAbsolute(p)) { skipped.push({ path: label(p), reason: 'Not an absolute file path.' }); continue; }
        let real;
        let st;
        try { real = realpath(p); st = fsImpl.statSync(real); } catch { skipped.push({ path: label(p), reason: 'The file could not be found.' }); continue; }
        if (!st.isFile()) { skipped.push({ path: label(p), reason: 'That is not a regular file.' }); continue; }
        const ext = path.extname(real).toLowerCase();
        if (!allowed(ext)) { skipped.push({ path: label(p), reason: 'Only pictures and videos can be added.' }); continue; }
        if (st.size > MAX_IMPORT_BYTES) { skipped.push({ path: label(p), reason: 'That file is larger than 4 GB.' }); continue; }
        let done = false;
        let lastError = '';
        for (let attempt = 0; attempt < 5 && !done; attempt++) {
          let dest;
          try { dest = L.paths.importDestination(importsDir, path.basename(real), (x) => fsImpl.existsSync(x)); } catch (e) { lastError = errText(e); break; }
          try {
            await fsImpl.promises.copyFile(real, dest.abs, fsImpl.constants.COPYFILE_EXCL);
            done = true;
          } catch (e) {
            lastError = errText(e);
            if (!(e && e.code === 'EEXIST')) break;
          }
        }
        if (done) imported += 1; else skipped.push({ path: label(p), reason: 'Could not copy it: ' + lastError });
      }
      if (imported > 0) {
        if (indexing) pendingReindex = true;
        else await startIndex({ fromConfig: true });
      }
      return { imported, skipped };
    } catch (e) { return { imported: 0, skipped: [{ path: '', reason: 'That did not work: ' + errText(e) }] }; }
  }

  // ---- grabbed clips (batch 3): a clip is an import with a stricter front door (cosmos/clips.mjs holds the rules) ----
  let clipSvc = null;
  async function clipService() {
    if (!clipSvc) {
      const { L, S } = await ctx();
      clipSvc = L.clips.makeClipService({
        fs: fsImpl, cosmosDir, importsDir, now, newId: () => crypto.randomBytes(6).toString('hex'),
        hasFolder: () => { const c = S.readConfig(); return !c.error && !!c.config.root; },
        readWorks: () => { const c = S.readConfig(); if (c.error) return []; const lr = freshLibrary(L, S, c.config); return lr.error ? [] : lr.library.works; },
        apply,
        reindex: async () => { if (indexing) pendingReindex = true; else await startIndex({ fromConfig: true }); },
      });
    }
    return clipSvc;
  }
  async function addClip(a) {
    try { return await (await clipService()).addClip(a); }
    catch (e) { return { ok: false, status: 500, error: 'Cosmos could not add that file.' }; }
  }
  const sweepClipTmp = async () => { try { return await (await clipService()).sweepTmp(); } catch { return 0; } };

  // ---- import from the old gallery ---------------------------------------------------------------------
  async function pickJson(envName, title) {
    const fromEnv = typeof env[envName] === 'string' && env[envName] !== '' ? env[envName] : null;   // gates only
    if (fromEnv) return fromEnv;
    if (!hasDep('pickFile')) return null;
    const p = await deps.pickFile({ title, filters: [{ name: 'JSON (.json)', extensions: ['json'] }] });
    return typeof p === 'string' && p !== '' ? p : null;
  }

  async function importFromLocal() {
    try {
      const { L, S } = await ctx();
      if (indexing) return refuse('running', 'An index is running. Import again when it has finished.');
      const backupFile = await pickJson('HQ_COSMOS_IMPORT_BACKUP', 'Choose the Cosmos Local backup (.json)');
      if (!backupFile) return refuse('canceled', 'Import canceled.');
      let text;
      try {
        if (fsImpl.statSync(backupFile).size > L.importlocal.MAX_BACKUP_BYTES) return refuse('bad-backup', 'That file is too large to be a Cosmos backup (over 20 MB).');
        text = fsImpl.readFileSync(backupFile, 'utf8');
      } catch (e) { return refuse('unreadable', 'Could not read that file: ' + errText(e)); }
      const rb = L.importlocal.readBackup(text, { nowIso: isoNow() });
      if (rb.error) return refuse('bad-backup', rb.error);

      let manifest = null;
      let manifestState = 'skipped';
      const manifestFile = await pickJson('HQ_COSMOS_IMPORT_MANIFEST', 'Choose the old gallery’s manifest (or cancel to import without ids)');
      if (manifestFile) {
        try {
          manifest = readJsonCapped(manifestFile);
          manifestState = manifest && Array.isArray(manifest.works) ? 'used' : 'unreadable';
          if (manifestState === 'unreadable') manifest = null;
        } catch { manifest = null; manifestState = 'unreadable'; }
      }

      const c = S.readConfig();
      if (c.error) return refuse('error', c.error);
      const cu = S.readCuration();
      if (cu.error) return refuse('error', cu.error);
      const cl = S.readCleanup();
      if (cl.error) return refuse('error', cl.error);
      const lr = freshLibrary(L, S, c.config);
      if (lr.error) return refuse('error', lr.error);

      let idMap = lr.library.idMap;
      if (idMap.entries.length === 0 && salvagedIdMap) idMap = salvagedIdMap;
      let works = lr.library.works;
      let seeded = 0;
      let rekeyed = 0;
      let skipped = [];
      let notMatched = [];
      let renames = [];
      if (manifest) {
        const referenced = L.curation.referencedIds(cu.curation, cl.cleanup);
        if (works.length > 0) {
          const mm = L.importlocal.seedManifest(manifest, L.ids.emptyIdMap());
          const rec = L.importlocal.reconcileIds({ idMap, works, manifestMap: mm.map, referenced });
          idMap = rec.idMap; works = rec.works; renames = rec.renames; rekeyed = rec.rekeyed; notMatched = rec.notMatched;
          const clash = new Set(notMatched.map((n) => n.manifestId));
          const sd = L.importlocal.seedManifest(manifest, idMap);
          idMap = sd.map; seeded = sd.seeded;
          skipped = sd.skipped.filter((s) => !(s.reason === 'path-known' && clash.has(s.id)));
        } else {
          const sd = L.importlocal.seedManifest(manifest, idMap);
          idMap = sd.map; seeded = sd.seeded; skipped = sd.skipped;
        }
        if (seeded > 0 || rekeyed > 0) {
          try {
            S.writeLibrary({ ...lr.library, idMap, works });
            for (const r of renames) S.renameThumb(r.from, r.to);
            dropCache();
          } catch (e) { return refuse('write-failed', 'Not imported: the library could not be updated: ' + errText(e)); }
        }
      }

      const m = L.importlocal.mergeCuration(cu.curation, rb.backup, { libraryIds: new Set(works.map((w) => w.id)), idMap });
      if (JSON.stringify(m.merged) !== JSON.stringify(cu.curation)) {
        try { S.writeCuration(m.merged); } catch (e) { return refuse('write-failed', 'Not imported: your curation could not be saved: ' + errText(e)); }
      }
      let token = null;
      if (m.report.conflicts > 0) {
        purgeHolds();
        token = crypto.randomBytes(16).toString('hex');
        holds.set(token, { items: m.conflictItems, expires: tNow() + REPLACE_TTL_MS });
      }
      const report = {
        clusters: m.report.clusters,
        favorites: m.report.favorites,
        hidden: m.report.hidden,
        overrides: m.report.overrides,
        found: m.report.found,
        missingIds: m.report.missingIds,
        missingCount: m.report.missingCount,
        seeded,
        rekeyed,
        skipped: skipped.slice(0, L.importlocal.MAX_SKIPPED_LISTED),
        skippedCount: skipped.length,
        notMatched: notMatched.slice(0, 200),
        notMatchedCount: notMatched.length,
        conflicts: m.report.conflicts,
        dropped: m.report.dropped,
        manifest: manifestState,
        token,
      };
      report.note = L.importlocal.importReport(report);
      return report;
    } catch (e) { return refuse('error', 'That did not work: ' + errText(e)); }
  }

  function dispose() {
    if (indexing) indexing.cancelled = true;
    try { if (deps && typeof deps.dispose === 'function') deps.dispose(); } catch { /* quitting */ }
  }

  return {
    read, apply, pickFolder, index, cancelIndex, trash, reveal, importFiles, importFromLocal, dispose, addClip, sweepClipTmp,
    whenIdle: async () => { while (activeRun) { const p = activeRun; await p; } },
    dir: cosmosDir,
  };
}

function init({ ipcMain, dataDir, getWin, castSend, deps }) {
  let d = deps || null;
  if (!d) {
    try { d = require('./cosmos-electron').makeDeps({ getWin, dataDir }); }   // lazily, so plain Node never loads electron
    catch (e) { console.error('[cosmos] file helpers unavailable:', e && e.message); d = null; }
  }
  const c = create({ dataDir, deps: d, castSend });
  c.sweepClipTmp();   // batch 3: orphans in data/cosmos/.grab-tmp older than an hour
  ipcMain.handle('hq:cosmos:read', (_e, opts) => c.read(opts));
  ipcMain.handle('hq:cosmos:apply', (_e, intent) => c.apply(intent));
  ipcMain.handle('hq:cosmos:pick-folder', () => c.pickFolder());
  ipcMain.handle('hq:cosmos:index', () => c.index());
  ipcMain.handle('hq:cosmos:cancel-index', () => c.cancelIndex());
  ipcMain.handle('hq:cosmos:trash', (_e, ids) => c.trash(ids));
  ipcMain.handle('hq:cosmos:reveal', (_e, id) => c.reveal(id));
  ipcMain.handle('hq:cosmos:import-files', (_e, paths) => c.importFiles(paths));
  ipcMain.handle('hq:cosmos:import-local', () => c.importFromLocal());
  try { require('electron').app.on('will-quit', () => c.dispose()); } catch { /* plain Node: no app */ }
  return c;
}

module.exports = { create, init, makeProgressGate };
