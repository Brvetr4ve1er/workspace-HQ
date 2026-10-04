// The live model behind the design. `model` exposes the same names the Claude
// Design prototype read from its fixture file (P0, T0, IDEAS, AUTOS…), filled
// from window.DATA, plus at(offset) for the time machine. `live` holds what
// arrives over window.hq after boot (sessions, captures, social, dev servers,
// casts, machine vitals, local-model replies); every change calls the
// listeners so the screen re-renders.
//
// window.hq is feature-detected everywhere: the dev harness runs without the
// preload, and then the screen is read-only with a stated reason.
import * as A from './adapter.mjs';
import * as C from './catalog.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);

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
  const mach = A.machine(DATA.pcHealth);

  const live = {
    sessions: [], sessionOut: {}, captures: [], capturesLoaded: false,
    social: { POSTS: [], MENTIONS: [], connected: false, loaded: false },
    canvas: A.canvasWidgets(DATA.canvas), dev: {}, machine: null, browserNow: null,
    llm: null, casts: {}, recording: null,
  };

  const model = {
    ...C, fmtD: A.fmtD,
    N, maxOff: Math.max(0, N - 1), at, metricAt, hasData: N > 0,
    dayAt: (off) => at(off).day || new Date(),
    get P0() { return at(0).P0; }, get T0() { return at(0).T0; }, get IDEAS() { return at(0).IDEAS; }, get ACH() { return at(0).ACH; },
    AUTOS: auto.AUTOS, LIBRARY: auto.LIBRARY, SCHEDULED: auto.SCHEDULED, INITIAL_RUNS: auto.RUNS, autoTotal: auto.total,
    ISSUES: mach.ISSUES, VITALS: mach.VITALS, pcScannedAt: mach.scannedAt, pcHost: mach.host,
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
  const pull = (p, fn) => Promise.resolve(p).then(fn).catch((e) => console.warn('[store] read failed', e)).finally(emit);

  function refreshCaptures() {
    if (!hq || !hq.studio || !hq.studio.libraryList) return Promise.resolve();
    return pull(hq.studio.libraryList({}), (rows) => { live.captures = A.captures(Array.isArray(rows) ? rows : arr(rows && rows.items)); live.capturesLoaded = true; });
  }
  function refreshSocial() {
    if (!hq || !hq.getSocial) return Promise.resolve();
    return pull(hq.getSocial(), (s) => { live.social = { ...A.social(s), loaded: true }; });
  }
  function refreshLlm(force) {
    if (!hq || !hq.probeLlm) return Promise.resolve();
    return pull(hq.probeLlm({ force: !!force }), (r) => { live.llm = r || null; });
  }

  function start() {
    if (!hq) return;
    if (hq.getSessions) pull(hq.getSessions(), (s) => { live.sessions = A.sessions(s); });
    if (hq.onClaudeSessions) sub(() => hq.onClaudeSessions((s) => { live.sessions = A.sessions(s); emit(); }));
    if (hq.onSessionOutput) sub(() => hq.onSessionOutput((d) => {
      if (!d || !d.jobId) return;
      live.sessionOut[d.jobId] = ((live.sessionOut[d.jobId] || '') + String(d.chunk || '')).slice(-20000);
      emit();
    }));
    if (hq.onDevStatus) sub(() => hq.onDevStatus((d) => { if (d && d.id) { live.dev = { ...live.dev, [d.id]: d.running ? { since: Date.now() } : null }; emit(); } }));
    if (hq.getCanvas) pull(hq.getCanvas(), (b) => { live.canvas = A.canvasWidgets(b); });
    if (hq.onCanvas) sub(() => hq.onCanvas((b) => { live.canvas = A.canvasWidgets(b); emit(); }));
    if (hq.onMachine) sub(() => hq.onMachine((m) => { live.machine = m || null; emit(); }));
    if (hq.getBrowserLive) pull(hq.getBrowserLive(), (b) => { live.browserNow = b || null; });
    if (hq.onBrowserTab) sub(() => hq.onBrowserTab((b) => { live.browserNow = b || null; emit(); }));
    if (hq.onCastOutput) sub(() => hq.onCastOutput((d) => {
      if (!d || !d.castId) return;
      const c = live.casts[d.castId] || (live.casts[d.castId] = { castId: d.castId, spellId: d.spellId, name: d.name || d.spellId, out: [], status: 'running', t0: Date.now() });
      String(d.chunk || '').split(/\r?\n/).filter(Boolean).forEach((l) => c.out.push((d.stream === 'err' ? '✗ ' : '') + l));
      if (c.out.length > 400) c.out = c.out.slice(-400);
      emit();
    }));
    if (hq.onCastDone) sub(() => hq.onCastDone((d) => {
      if (!d || !d.castId) return;
      const c = live.casts[d.castId] || (live.casts[d.castId] = { castId: d.castId, spellId: d.spellId, name: d.name || d.spellId, out: [], t0: Date.now() });
      c.status = d.outcome === 'resolved' ? 'ok' : 'failed';
      c.meta = Math.round((d.duration_ms || 0) / 1000) + 's' + (d.outcome === 'resolved' ? '' : d.timed_out ? ' · timed out' : ' · exit ' + d.exit_code);
      c.done = true;
      emit();
    }));
    if (hq.studio) {
      refreshCaptures();
      if (hq.studio.onCaptureAdded) sub(() => hq.studio.onCaptureAdded(() => { refreshCaptures(); }));
      if (hq.studio.recStatus) sub(() => hq.studio.recStatus((s) => { live.recording = s && s.state === 'recording' ? s : null; emit(); }));
    }
    refreshSocial();
    refreshLlm(false);
  }
  function stop() { offs.splice(0).forEach((f) => { try { f(); } catch {} }); }

  return {
    model, live, bridge: !!hq, hq,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit, start, stop, refreshCaptures, refreshSocial, refreshLlm,
  };
}
