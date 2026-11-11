// Security space - the live slice (LIVE.security) and the functions that move it. Pure ESM: IO is injected, so plain Node tests
// drive it with a fake window.hq.security. The store (live/store.js) builds one with createSecuritySlice and spreads the result into
// its API; its live init object gets `security: emptySecurity()`. Nothing is read when the slice is built: the space reads on
// ARRIVAL (logic/security.js secArrive), never at boot.
//
// Main owns the data (dashboard/security.js, hq:security:* channels, main window only). This file only holds the last answer:
//   loaded     false until main answered once; error = main's own words for the last failed read (the last good copy is kept)
//   map        { refreshedAt, accounts, identities } as main last wrote it, or null before the first refresh
//   owner      the owner's own edits { accounts, manual, identities }
//   snapshots  numbers-only growth lines; status = numbers, booleans and timestamps only
//   exports    null = never scanned, [] = scanned and none found (the honest difference)
//   revision   bumped on every change of map / owner / snapshots / status / exports; the vals' memo key includes it
//
// The master passphrase passes THROUGH unlockSecurity as an argument and is never stored: not in LIVE, not in a closure that
// outlives the call, not in an error text (an error is main's fixed words or this file's own). With hq.security absent every
// function resolves { error: OFFLINE } and nothing throws.

export const OFFLINE = 'Security needs the desktop app';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const words = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 200);

/** A fresh LIVE.security. */
export function emptySecurity() {
  return { loaded: false, error: '', settings: null, map: null, owner: emptyOwner(), snapshots: [], status: null, cliFound: false, vaultExists: false, exports: null, exportsError: '', revision: 0 };
}
export function emptyOwner() { return { accounts: {}, manual: [], identities: [] }; }

function takeOwner(o) {
  if (!isObj(o)) return emptyOwner();
  return { ...o, accounts: isObj(o.accounts) ? o.accounts : {}, manual: arr(o.manual), identities: arr(o.identities) };
}
function takeMap(m) {
  if (!isObj(m)) return null;
  return { ...m, accounts: arr(m.accounts), identities: arr(m.identities) };
}

/**
 * @param {{hq:object|null, live:object, emit:()=>void, pull?:(p:any, fn:(r:any)=>any)=>Promise<any>}} deps
 *   pull is the store's pull (a read that records failures and emits); without it a plain promise chain is used.
 */
export function createSecuritySlice({ hq, live, emit, pull } = {}) {
  const fire = typeof emit === 'function' ? emit : () => {};
  const S = () => (live.security || (live.security = emptySecurity()));
  const has = (m) => !!(hq && hq.security && typeof hq.security[m] === 'function');
  const offline = () => Promise.resolve({ error: OFFLINE });
  const guarded = (fn) => Promise.resolve().then(fn).catch((e) => ({ error: words(e) }));

  let seq = 0;          // reads: only the newest answer lands
  let inflight = null;  // { force, p }

  // ---- read -----------------------------------------------------------------------------------------
  function takeRead(r) {
    const s = S();
    if (!isObj(r)) { s.loaded = true; s.error = 'Security gave no answer'; return r; }
    if (typeof r.error === 'string') {
      s.loaded = true;               // keep what we had: the view says the last good copy stays
      s.error = r.error || 'Security could not be read';
      return r;
    }
    s.loaded = true;
    s.error = '';
    s.settings = isObj(r.settings) ? r.settings : null;
    s.map = takeMap(r.map);
    s.owner = takeOwner(r.owner);
    s.snapshots = arr(r.snapshots).filter(isObj);
    s.status = isObj(r.status) ? r.status : null;
    s.cliFound = r.cliFound === true;
    s.vaultExists = r.vaultExists === true;
    s.revision += 1;
    return r;
  }

  function refreshSecurity(force) {
    if (!has('read')) return offline();
    if (inflight && !force) return inflight.p;
    const my = ++seq;
    const ask = () => guarded(() => hq.security.read());
    const land = (r) => { if (my === seq) takeRead(r); return r; };
    const p = Promise.resolve(typeof pull === 'function' ? pull(ask, land) : ask().then(land).finally(fire))
      .finally(() => { if (inflight && inflight.p === p) inflight = null; });
    inflight = { force: !!force, p };
    return p;
  }

  // ---- the plain-export scan (names and sizes only; main never opens a file) --------------------------
  function scanSecurityExports() {
    if (!has('scanExports')) return offline();
    return guarded(() => hq.security.scanExports()).then((r) => {
      const s = S();
      if (isObj(r) && Array.isArray(r.files)) {
        s.exports = r.files.filter((f) => isObj(f) && typeof f.name === 'string' && typeof f.dir === 'string')
          .map((f) => ({ name: f.name, dir: f.dir, size: Number.isFinite(f.size) ? f.size : 0, mtime: typeof f.mtime === 'string' || typeof f.mtime === 'number' ? f.mtime : null }));
        s.exportsError = '';
        s.revision += 1;
      } else s.exportsError = isObj(r) && typeof r.error === 'string' ? r.error : 'the scan gave no answer';
      return r;
    }).finally(fire);
  }

  // ---- the refresh: the passphrase goes straight to main and nowhere else ---------------------------------
  function unlockSecurity(passphrase, checkBreaches) {
    if (!has('refresh')) return offline();
    return guarded(() => hq.security.refresh(passphrase, checkBreaches !== false)).then(async (r) => {
      if (!isObj(r)) return { error: 'Security gave no answer' };
      if (typeof r.error === 'string') return { error: r.error || 'the refresh failed' };
      if (r.ok !== true) return { error: 'the refresh gave no answer' };
      await refreshSecurity(true);
      await scanSecurityExports();
      return { ok: true, breachChecked: r.breachChecked === true, notes: arr(r.notes).filter((n) => typeof n === 'string').map((n) => n.slice(0, 200)).slice(0, 8) };
    }).finally(fire);
  }

  // ---- writes: main's answer is passed through, a successful one re-reads the files ------------------------
  function write(method, args) {
    if (!has(method)) return offline();
    return guarded(() => hq.security[method](...args)).then(async (r) => {
      if (isObj(r) && r.ok === true) await refreshSecurity(true);
      return isObj(r) ? r : { error: 'Security gave no answer' };
    }).finally(fire);
  }
  const editSecurity = (id, patch) => write('edit', [id, patch]);
  const addSecurityManual = (o) => write('addManual', [o]);
  const addSecurityIdentity = (o) => write('addIdentity', [o]);
  const setSecuritySettings = (patch) => write('settings', [patch]);
  const setSecurityWalkthrough = (stepId, done) => write('walkthrough', [stepId, !!done]);

  function trashSecurityExport(name, dir) {
    if (!has('trashExport')) return offline();
    return guarded(() => hq.security.trashExport(name, dir)).then(async (r) => {
      if (isObj(r) && r.ok === true) { await scanSecurityExports(); await refreshSecurity(true); }
      return isObj(r) ? r : { error: 'Security gave no answer' };
    }).finally(fire);
  }

  function copySecurity(text) {
    if (!has('copy')) return offline();
    return guarded(() => hq.security.copy(text)).then((r) => (isObj(r) ? r : { error: 'Security gave no answer' }));
  }

  return {
    refreshSecurity, scanSecurityExports, unlockSecurity, editSecurity, addSecurityManual, addSecurityIdentity,
    setSecuritySettings, setSecurityWalkthrough, trashSecurityExport, copySecurity,
  };
}
