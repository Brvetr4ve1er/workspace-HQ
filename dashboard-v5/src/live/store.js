// The live model behind the design. `model` exposes the same names the Claude
// Design prototype read from its fixture file (P0, T0, IDEAS, AUTOS…), filled
// from window.DATA, plus at(offset) for the time machine. `live` holds what
// arrives over window.hq after boot (sessions, captures, social, dev servers,
// casts, scan state, UI prefs, machine vitals, local-model replies); every
// change calls the listeners so the screen re-renders.
//
// Main reloads the window after most writes, so "what is running" can't live
// only in memory: start() hydrates dev servers, casts and the scan from
// hq.liveState() and then follows the push channels. A push that lands before
// the hydrate reply is newer than it and wins.
//
// window.hq is feature-detected everywhere: the dev harness runs without the
// preload, and then the screen is read-only with a stated reason.
import * as A from './adapter.mjs';
import * as C from './catalog.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// ms epoch from a number or an ISO string; null when neither parses
const msOf = (t) => (typeof t === 'number' && Number.isFinite(t) ? t : Date.parse(t) || null);

export function createStore(DATA, hq) {
  DATA = DATA || {};
  const snaps = arr(DATA.scans).map(A.snapshot);
  if (!snaps.length && DATA.latest) snaps.push(A.snapshot(DATA.latest));
  const EMPTY = A.snapshot({});
  const N = snaps.length;
  const at = (off) => snaps[N - 1 - Math.max(0, Math.min(off, N - 1))] || EMPTY;
  const metricAt = (name, off) => {
    const i = N - 1 - off;
    return i < 0 || i >= N ? 0 : A.metric(snaps[i], name, snaps[i - 1]);
  };
  const auto = A.automations(DATA.spellbook, DATA.telemetry);
  // spell id → catalog row, so a cast that arrives without a name still reads as one
  const spellRow = new Map(auto.INTERACTIVE.concat(auto.AUTOS).map((a) => [a.id, a]));
  // sessions map cwd → project against everything pname()/proj() can resolve
  const PROJS = at(0).P0.concat(at(0).archived);

  const live = {
    sessions: [], sessionOut: {}, captures: [], capturesLoaded: false,
    social: { POSTS: [], MENTIONS: [], connected: false, loaded: false },
    canvas: A.canvasWidgets(DATA.canvas), dev: {}, machine: null, browserNow: null,
    llm: null, casts: {}, recording: null,
    pcHealth: null,   // a fresher pc-health sidecar than the baked DATA.pcHealth (refreshMachine)
    scan: null,       // {state:'idle'|'running'|'done'|'failed', startedAt, endedAt, code, error?}
    uiPrefs: null,    // {theme, resolved, reduceMotion} shared by every window
  };

  // machine() is pure; memoise on the source object so the getters below stay cheap
  let machSrc, machVal;
  const mach = () => {
    const src = live.pcHealth || DATA.pcHealth;
    if (src !== machSrc || !machVal) { machSrc = src; machVal = A.machine(src); }
    return machVal;
  };

  const model = {
    ...C, fmtD: A.fmtD, fileUrl: A.fileUrl,
    N, maxOff: Math.max(0, N - 1), at, metricAt, hasData: N > 0,
    dayAt: (off) => at(off).day || new Date(),
    get P0() { return at(0).P0; }, get T0() { return at(0).T0; }, get IDEAS() { return at(0).IDEAS; }, get ACH() { return at(0).ACH; },
    AUTOS: auto.AUTOS, INTERACTIVE: auto.INTERACTIVE, autoCounts: auto.counts,
    LIBRARY: auto.LIBRARY, SCHEDULED: auto.SCHEDULED, INITIAL_RUNS: auto.RUNS, autoTotal: auto.total,
    get ISSUES() { return mach().ISSUES; }, get VITALS() { return mach().VITALS; },
    get pcScannedAt() { return mach().scannedAt; }, get pcHost() { return mach().host; },
    get CLUTTER() { return A.clutter(at(0).inventory); },
    get VAULTS() { return A.vaults(at(0).inventory); },
    get SITES() { return A.sites(at(0).browser); },
    get LEARN() { const P = at(0).P0; return at(0).learnings.map((l) => [l.text, (P.find((p) => p.id === l.proj) || {}).name || '', l.at ? A.fmtD(new Date(Date.parse(l.at))) : '']); },
    WEEKS: A.weeks(snaps),
    get SESSIONS() { return live.sessions; }, get CAPTURES() { return live.captures; }, get CANVAS() { return live.canvas; },
    get POSTS() { return live.social.POSTS; }, get MENTIONS() { return live.social.MENTIONS; },
    projectNotes: DATA.projectNotes && typeof DATA.projectNotes === 'object' ? DATA.projectNotes : {},
    weeklyRecap: DATA.weeklyRecap || null, builtAt: DATA.built_at || null,
    confirmedHashes: (DATA.telemetry && DATA.telemetry.confirmed_hashes) || {},
  };

  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const offs = [];
  const sub = (fn) => { try { const off = fn(); if (typeof off === 'function') offs.push(off); } catch (e) { console.error('[store] subscribe failed', e); } };
  // `p` may be a promise or a thunk (a thunk that throws synchronously becomes a rejected read)
  const pull = (p, fn) => {
    if (typeof p === 'function') { try { p = p(); } catch (e) { p = Promise.reject(e); } }
    return Promise.resolve(p).then(fn).catch((e) => console.warn('[store] read failed', e)).finally(emit);
  };

  // one cast row; name/icon from the event, else the catalog, else the spell id
  function castRow(d, t0) {
    const s = spellRow.get(d.spellId) || {};
    return { castId: d.castId, spellId: d.spellId, name: d.name || s.name || d.spellId, icon: d.icon || s.icon || '▶', chainId: d.chainId || null, chain: !!d.chain, out: [], status: 'running', t0: t0 || Date.now() };
  }

  function refreshCaptures() {
    if (!hq || !hq.studio || !hq.studio.libraryList) return Promise.resolve();
    return pull(() => hq.studio.libraryList({}), (rows) => { live.captures = A.captures(Array.isArray(rows) ? rows : arr(rows && rows.items)); live.capturesLoaded = true; });
  }
  function refreshSocial() {
    if (!hq || !hq.getSocial) return Promise.resolve();
    return pull(() => hq.getSocial(), (s) => { live.social = { ...A.social(s), loaded: true }; });
  }
  function refreshLlm(force) {
    if (!hq || !hq.probeLlm) return Promise.resolve();
    return pull(() => hq.probeLlm({ force: !!force }), (r) => { live.llm = r || null; });
  }
  // a fresh pc-health sidecar (e.g. after a machine fix); null falls back to the baked one
  function refreshMachine(pcHealth) {
    live.pcHealth = isObj(pcHealth) ? pcHealth : null;
    emit();
  }

  // hq:live-state → what was running before this window (re)loaded
  let scanPushed = false, prefsPushed = false;
  function hydrate(s) {
    if (!isObj(s)) return;
    const dev = {};
    for (const d of arr(s.dev)) if (d && d.id) dev[d.id] = { since: msOf(d.since) || null };   // unknown start (pre-M2 main) stays unknown — the row says 'running', not a made-up time
    live.dev = { ...dev, ...live.dev };                                                          // a dev-status push already received is newer
    for (const c of arr(s.casts)) if (c && c.castId && !live.casts[c.castId]) live.casts[c.castId] = castRow(c, msOf(c.startedAt));   // output already streaming in wins
    if (!scanPushed && isObj(s.scan)) live.scan = s.scan;
  }

  // resolves once every initial read has settled (app.js ignores it; tests and selftests await it)
  function start() {
    if (!hq) return Promise.resolve();
    const reads = [];
    scanPushed = prefsPushed = false;
    if (hq.getSessions) reads.push(pull(() => hq.getSessions(), (s) => { live.sessions = A.sessions(s, PROJS); }));
    if (hq.onClaudeSessions) sub(() => hq.onClaudeSessions((s) => { live.sessions = A.sessions(s, PROJS); emit(); }));
    if (hq.onSessionOutput) sub(() => hq.onSessionOutput((d) => {
      if (!d || !d.jobId) return;
      live.sessionOut[d.jobId] = ((live.sessionOut[d.jobId] || '') + String(d.chunk || '')).slice(-20000);
      emit();
    }));
    if (hq.onDevStatus) sub(() => hq.onDevStatus((d) => { if (d && d.id) { live.dev = { ...live.dev, [d.id]: d.running ? { since: msOf(d.since) || Date.now() } : null }; emit(); } }));
    if (hq.getCanvas) reads.push(pull(() => hq.getCanvas(), (b) => { live.canvas = A.canvasWidgets(b); }));
    if (hq.onCanvas) sub(() => hq.onCanvas((b) => { live.canvas = A.canvasWidgets(b); emit(); }));
    if (hq.onMachine) sub(() => hq.onMachine((m) => { live.machine = m || null; emit(); }));
    if (hq.getBrowserLive) reads.push(pull(() => hq.getBrowserLive(), (b) => { live.browserNow = b || null; }));
    if (hq.onBrowserTab) sub(() => hq.onBrowserTab((b) => { live.browserNow = b || null; emit(); }));
    if (hq.onCastOutput) sub(() => hq.onCastOutput((d) => {
      if (!d || !d.castId) return;
      const c = live.casts[d.castId] || (live.casts[d.castId] = castRow(d));
      String(d.chunk || '').split(/\r?\n/).filter(Boolean).forEach((l) => c.out.push((d.stream === 'err' ? '✗ ' : '') + l));
      if (c.out.length > 400) c.out = c.out.slice(-400);
      emit();
    }));
    if (hq.onCastDone) sub(() => hq.onCastDone((d) => {
      if (!d || !d.castId) return;
      const c = live.casts[d.castId] || (live.casts[d.castId] = castRow(d));
      c.status = d.outcome === 'resolved' ? 'ok' : 'failed';
      c.meta = Math.round((d.duration_ms || 0) / 1000) + 's' + (d.outcome === 'resolved' ? '' : d.timed_out ? ' · timed out' : ' · exit ' + d.exit_code);
      c.done = true;
      emit();
    }));
    // subscribe before asking, so nothing that happens in between is lost
    if (hq.onScanStatus) sub(() => hq.onScanStatus((s) => { if (isObj(s)) { scanPushed = true; live.scan = s; emit(); } }));
    if (hq.liveState) reads.push(pull(() => hq.liveState(), hydrate));
    if (hq.uiPrefs && hq.uiPrefs.on) sub(() => hq.uiPrefs.on((p) => { if (isObj(p)) { prefsPushed = true; live.uiPrefs = p; emit(); } }));
    if (hq.uiPrefs && hq.uiPrefs.get) reads.push(pull(() => hq.uiPrefs.get(), (p) => { if (isObj(p) && !prefsPushed) live.uiPrefs = p; }));
    if (hq.studio) {
      reads.push(refreshCaptures());
      if (hq.studio.onCaptureAdded) sub(() => hq.studio.onCaptureAdded(() => { refreshCaptures(); }));
      if (hq.studio.recStatus) sub(() => hq.studio.recStatus((s) => { live.recording = s && s.state === 'recording' ? s : null; emit(); }));
    }
    reads.push(refreshSocial(), refreshLlm(false));
    return Promise.all(reads).then(() => {});
  }
  function stop() { offs.splice(0).forEach((f) => { try { f(); } catch {} }); }

  return {
    model, live, bridge: !!hq, hq,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit, start, stop, refreshCaptures, refreshSocial, refreshLlm, refreshMachine,
  };
}
