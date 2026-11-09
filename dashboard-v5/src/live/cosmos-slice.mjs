// Cosmos space — the live slice (LIVE.cosmos) and the functions that move it. Pure ESM: IO is injected, so plain Node
// tests drive it with a fake window.hq.cosmos. The store (live/store.js) builds one with createCosmosSlice and spreads the
// result into its API; its live init object gets `cosmos: emptyCosmos()`.
//
// Main owns the data (dashboard/cosmos.js, hq:cosmos:* channels). This file only holds the last answer:
//   works     null = nothing has arrived yet, [] = arrived and the library is empty (the honest difference)
//   curation  clusters / favorites / hidden / overrides; cleanup  { dismissed:{clusters,candidates} }
//   revision  bumped every time works or curation change; the Feed's memo key includes it
//   _memo     the Feed memo (created by vals/cosmos.js on first use, lives and dies with the slice)
// A refused or failed answer never blanks what is on screen: a read that comes back {error} keeps the previous copy and
// only records the message. Writes resolve main's answer as-is and never reject.
//
// Every function feature-detects hq.cosmos. With it absent each resolves { error: OFFLINE } and nothing throws.

export const OFFLINE = 'Cosmos needs the desktop app';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const msg = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 300);

/** A fresh LIVE.cosmos. */
export function emptyCosmos() {
  return {
    loaded: false, error: '', state: null, config: null, works: null, dupes: null,
    curation: emptyCuration(), cleanup: emptyCleanup(),
    rootOk: true, indexing: null, summary: null, report: null, revision: 0, _memo: null,
  };
}

export function emptyCuration() { return { clusters: [], favorites: {}, hidden: {}, overrides: {} }; }
export function emptyCleanup() { return { dismissed: { clusters: {}, candidates: {} } }; }

// main's documents are trusted for their shape but a half-written one must not blank the Feed or throw in a render
function takeCuration(c) {
  if (!isObj(c)) return emptyCuration();
  return { ...c, clusters: arr(c.clusters), favorites: isObj(c.favorites) ? c.favorites : {}, hidden: isObj(c.hidden) ? c.hidden : {}, overrides: isObj(c.overrides) ? c.overrides : {} };
}
function takeCleanup(c) {
  if (!isObj(c)) return emptyCleanup();
  const d = isObj(c.dismissed) ? c.dismissed : {};
  return { ...c, dismissed: { clusters: isObj(d.clusters) ? d.clusters : {}, candidates: isObj(d.candidates) ? d.candidates : {} } };
}

/**
 * @param {{hq:object|null, live:object, emit:()=>void, pull?:(p:any, fn:(r:any)=>any)=>Promise<any>}} deps
 *   pull is the store's pull (a read that records failures and emits); without it a plain promise chain is used.
 */
export function createCosmosSlice({ hq, live, emit, pull } = {}) {
  const fire = typeof emit === 'function' ? emit : () => {};
  const C = () => (live.cosmos || (live.cosmos = emptyCosmos()));
  const has = (m) => !!(hq && hq.cosmos && typeof hq.cosmos[m] === 'function');
  const offline = () => Promise.resolve({ error: OFFLINE });
  const safe = (fn) => Promise.resolve().then(fn).catch((e) => ({ error: msg(e) }));

  let seq = 0;          // reads: only the newest answer lands
  let epoch = 0;        // writes: a read that began before a write answered must not roll the curation back
  let inflight = null;  // { force, p }
  let unsub = null;

  // ---- read -----------------------------------------------------------------------------------------
  function takeRead(r, startEpoch) {
    const c = C();
    if (!isObj(r)) { c.loaded = true; c.error = 'Cosmos gave no answer'; return r; }
    if (typeof r.error === 'string') {
      // keep what we had (works, curation, config): the view says "your last good copy is kept"
      c.loaded = true;
      c.error = r.error || 'Cosmos could not be read';
      return r;
    }
    const fresh = startEpoch === epoch;
    c.loaded = true;
    c.error = '';
    c.state = typeof r.state === 'string' ? r.state : 'ready';
    c.config = isObj(r.config) ? r.config : null;
    c.works = Array.isArray(r.works) ? r.works : [];
    c.dupes = isObj(r.dupes) ? r.dupes : null;
    if (fresh) { c.curation = takeCuration(r.curation); c.cleanup = takeCleanup(r.cleanup); }
    c.rootOk = r.rootOk !== false;
    c.indexing = isObj(r.indexing) ? r.indexing : null;
    c.revision += 1;
    return r;
  }

  function refreshCosmos(force) {
    if (!has('read')) return offline();
    if (inflight && !force) return inflight.p;
    const my = ++seq, startEpoch = epoch;
    const ask = () => safe(() => hq.cosmos.read(force ? { force: true } : undefined));
    const land = (r) => { if (my === seq) takeRead(r, startEpoch); return r; };
    const p = Promise.resolve(typeof pull === 'function' ? pull(ask, land) : ask().then(land).finally(fire))
      .finally(() => { if (inflight && inflight.p === p) inflight = null; });
    inflight = { force: !!force, p };
    return p;
  }

  // ---- write ----------------------------------------------------------------------------------------
  function takeApply(intent, r) {
    if (!isObj(r)) return { error: 'Cosmos gave no answer' };
    if (isObj(r.view) && typeof r.error !== 'string') {
      const c = C();
      if (isObj(r.view.curation)) c.curation = takeCuration(r.view.curation);
      if (isObj(r.view.cleanup)) c.cleanup = takeCleanup(r.view.cleanup);
      c.revision += 1;
      epoch += 1;
      // a replace is single-use: the token is spent, the report stops offering it
      if (intent && intent.type === 'import-replace' && isObj(c.report)) c.report = { ...c.report, token: null, replaced: true };
    }
    return r;
  }
  function applyCosmos(intent) {
    if (!has('apply')) return offline();
    return safe(() => hq.cosmos.apply(intent)).then((r) => takeApply(intent, r)).finally(fire);
  }

  // ---- folder, index ---------------------------------------------------------------------------------
  function pickCosmosFolder() {
    if (!has('pickFolder')) return offline();
    return safe(() => hq.cosmos.pickFolder());
  }
  function indexCosmos() {
    if (!has('index')) return offline();
    return safe(() => hq.cosmos.index()).then((r) => {
      // accepted: show the banner at once, the push channel takes over from here
      if (r === true) { const c = C(); c.summary = null; c.indexing = { phase: 'walk', done: 0, total: 0 }; }
      return r;
    }).finally(fire);
  }
  function cancelCosmosIndex() {
    if (!has('cancelIndex')) return offline();
    return safe(() => hq.cosmos.cancelIndex());
  }

  // ---- elements -------------------------------------------------------------------------------------
  function trashCosmos(ids) {
    if (!has('trash')) return offline();
    return safe(() => hq.cosmos.trash(ids)).then((r) => {
      // drop an element ONLY when main lists it in trashed[]; failures leave the survivors and every reference intact
      if (isObj(r) && Array.isArray(r.trashed) && r.trashed.length) {
        const c = C();
        if (Array.isArray(c.works)) {
          const gone = new Set(r.trashed);
          c.works = c.works.filter((w) => !gone.has(w.id));
          c.revision += 1;
        }
      }
      return r;
    }).finally(fire);
  }
  function revealCosmos(id) {
    if (!has('reveal')) return offline();
    return safe(() => hq.cosmos.reveal(id));
  }
  function importCosmosFiles(paths) {
    if (!has('importFiles')) return offline();
    return safe(() => hq.cosmos.importFiles(paths)).then((r) => {
      // main starts an index after a copy; show it before the first push arrives
      if (isObj(r) && r.imported > 0) { const c = C(); if (!c.indexing) c.indexing = { phase: 'walk', done: 0, total: 0 }; }
      return r;
    }).finally(fire);
  }
  function importCosmosLocal() {
    if (!has('importFromLocal')) return offline();
    return safe(() => hq.cosmos.importFromLocal()).then(async (r) => {
      // a refusal ({ok:false}) or error changes nothing; a report means main merged curation (and maybe re-keyed ids)
      if (!isObj(r) || r.ok === false || typeof r.error === 'string') return r;
      C().report = r;
      await refreshCosmos(true);
      return r;
    }).finally(fire);
  }

  // ---- progress ---------------------------------------------------------------------------------------
  function cosmosProgress(p) {
    if (!has('read')) return offline();
    if (!isObj(p)) return undefined;
    const c = C();
    if (p.done_all) {
      const s = isObj(p.summary) ? p.summary : null;
      c.summary = typeof p.error === 'string' && p.error ? { ...(s || {}), error: p.error } : s;
      c.indexing = null;
      fire();
      return refreshCosmos(true);
    }
    c.indexing = { phase: String(p.phase || ''), done: Number.isFinite(p.done) ? p.done : 0, total: Number.isFinite(p.total) ? p.total : 0 };
    fire();
    return undefined;
  }
  function watchCosmos() {
    if (!has('onProgress')) return { error: OFFLINE };
    if (unsub) return true;
    try {
      const off = hq.cosmos.onProgress((p) => cosmosProgress(p));
      unsub = typeof off === 'function' ? off : () => {};
    } catch (e) { return { error: msg(e) }; }
    return true;
  }
  function stopCosmos() {
    if (!hq || !hq.cosmos) return { error: OFFLINE };
    const off = unsub;
    unsub = null;
    if (off) { try { off(); } catch { /* quitting */ } }
    return !!off;
  }

  return {
    refreshCosmos, applyCosmos, pickCosmosFolder, indexCosmos, cancelCosmosIndex, trashCosmos, revealCosmos,
    importCosmosFiles, importCosmosLocal, cosmosProgress, watchCosmos, stopCosmos,
  };
}
