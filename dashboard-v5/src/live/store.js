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
    canvasBoards: A.canvasBoards(DATA.canvas),   // raw boards [{name, nodes, edges}] (Canvas "＋ Note" board picker)
    llm: null, casts: {}, recording: null,
    pcHealth: null,   // a fresher pc-health sidecar than the baked DATA.pcHealth (refreshMachine)
    scan: null,       // {state:'idle'|'running'|'done'|'failed', startedAt, endedAt, code, error?}
    uiPrefs: null,    // {theme, resolved, reduceMotion} shared by every window
    claudeLib: { projects: null, convs: null, convsMore: false, filters: {}, q: '', hits: null, noTerms: false, thread: null, stats: null, error: null, busy: false },   // Claude library (H2): Hub rows, raw; vals map them via adapter hub*()
    claudeHub: null,  // hq.claudeHub.health() / the hq:claude-hub:event push (null until the first answer); logic/claude-hub.js reads it
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
  // hq:canvas-read / the hq:canvas push: an array of boards (or { boards }). Both
  // the widgets and the raw boards follow it; a payload that isn't a board list
  // (a failed read) changes nothing. Answers whether it applied.
  function setBoards(payload) {
    if (!A.boardList(payload)) return false;
    live.canvas = A.canvasWidgets(payload);
    live.canvasBoards = A.canvasBoards(payload);
    return true;
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
    if (hq.getCanvas) reads.push(pull(() => hq.getCanvas(), setBoards));
    if (hq.onCanvas) sub(() => hq.onCanvas((b) => { if (setBoards(b)) emit(); }));
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
      // a chain settles with exit_code null (its member's cast has the code); null or missing reads "exit code unknown"
      c.meta = Math.round((d.duration_ms || 0) / 1000) + 's' + (d.outcome === 'resolved' ? '' : d.timed_out ? ' · timed out' : ' · ' + A.exitLabel(d.exit_code));
      c.done = true;
      emit();
    }));
    // subscribe before asking, so nothing that happens in between is lost
    if (hq.onScanStatus) sub(() => hq.onScanStatus((s) => { if (isObj(s)) { scanPushed = true; live.scan = s; emit(); } }));
    if (hq.liveState) reads.push(pull(() => hq.liveState(), hydrate));
    if (hq.uiPrefs && hq.uiPrefs.on) sub(() => hq.uiPrefs.on((p) => { if (isObj(p)) { prefsPushed = true; live.uiPrefs = p; emit(); } }));
    if (hq.uiPrefs && hq.uiPrefs.get) reads.push(pull(() => hq.uiPrefs.get(), (p) => { if (isObj(p) && !prefsPushed) live.uiPrefs = p; }));
    if (hq.claudeHub && hq.claudeHub.health) reads.push(pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : null; }));
    if (hq.claudeHub && hq.claudeHub.on) sub(() => hq.claudeHub.on((e) => {
      if (!isObj(e)) return;
      if (e.event === 'progress' && isObj(e.data)) {
        live.claudeHub = { ...(live.claudeHub || {}), state: e.data.done >= e.data.total ? 'ready' : 'indexing', backfill: e.data };
        if (e.data.done >= e.data.total) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
      } else if (e.event === 'health' && isObj(e.data)) live.claudeHub = e.data;
      // a Hub that came up after the first health() answered "starting" (a reader never backfills, so no progress follows)
      else if (e.event === 'ready' && hq.claudeHub.health) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; retryLibLoad(); });
      // the Hub indexed something new (a live append, a sweep): the card's counts are from the last answer, so ask again
      else if (e.event === 'changed') {
        if (hq.claudeHub.health) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
        if (lib().convs) syncClaudeLib();
        if (lib().stats) refreshClaudeStats();
        const t = lib().thread;
        if (t && t.conversation && Array.isArray(e.data && e.data.ids) && e.data.ids.includes(t.conversation.id)) syncClaudeThread(t.conversation.id);
      }
      retryLibLoad();
      emit();
    }));
    if (hq.studio) {
      reads.push(refreshCaptures());
      if (hq.studio.onCaptureAdded) sub(() => hq.studio.onCaptureAdded(() => { refreshCaptures(); }));
      if (hq.studio.recStatus) sub(() => hq.studio.recStatus((s) => { live.recording = s && s.state === 'recording' ? s : null; emit(); }));
    }
    reads.push(refreshSocial(), refreshLlm(false));
    return Promise.all(reads).then(() => {});
  }
  const lib = () => live.claudeLib;
  // the first library load can land while the Hub is still starting ('hub not running'): once it reports ready/indexing, ask again
  function retryLibLoad() {
    const h = live.claudeHub;
    if (lib().convs === null && lib().error && !lib().busy && h && (h.state === 'ready' || h.state === 'indexing')) refreshClaudeLib();
  }
  // One error slot for the whole library: each ENTRY function clears it before it asks (fresh action, fresh verdict);
  // a success never clears it, so two parallel calls cannot erase each other's failure. busy counts calls in flight.
  let libPending = 0;
  // stale() answers "is this response still wanted?": a late answer for a closed thread, a replaced search or changed filters is dropped whole
  const hubCall = (fn, ok, stale) => {
    if (!hq || !hq.claudeHub) return Promise.resolve();
    libPending++; lib().busy = true;
    return Promise.resolve().then(fn).then((r) => {
      if (stale && stale()) return;
      if (r && typeof r === 'object' && !Array.isArray(r) && r.error) { lib().error = 'Claude Hub: ' + r.error; return; }
      ok(r);
    }).catch((e) => { if (!(stale && stale())) lib().error = 'Claude Hub: ' + ((e && e.message) || e); })
      .finally(() => { libPending--; lib().busy = libPending > 0; emit(); });
  };
  const fresh = () => { lib().error = null; };
  const PAGE = 50, MAXPAGE = 200;
  // per-slot sequence numbers: a request is current only while its slot's number is unchanged
  const seq = { filters: 0, thread: 0, search: 0 };
  const convBefore = (a, b) => a.last_at < b.last_at || (a.last_at === b.last_at && a.id < b.id); // a sorts after b in (last_at DESC, id DESC)
  function refreshClaudeLib(filters = lib().filters) {
    lib().filters = { ...filters }; fresh();
    const my = ++seq.filters, stale = () => my !== seq.filters;
    return Promise.all([
      hubCall(() => hq.claudeHub.projects({}), (r) => { lib().projects = Array.isArray(r) ? r : []; }, stale),
      hubCall(() => hq.claudeHub.conversations({ ...lib().filters, limit: PAGE }), (r) => { const rows = Array.isArray(r) ? r : []; lib().convs = rows; lib().convsMore = rows.length === PAGE; }, stale),
    ]);
  }
  // A Hub `changed` event: refetch the head (as many rows as are loaded, up to the Hub's cap) and merge by id, keeping every older page already loaded.
  function syncClaudeLib() {
    const have = lib().convs || [], n = Math.max(PAGE, Math.min(MAXPAGE, have.length));
    const my = seq.filters, stale = () => my !== seq.filters;
    fresh();
    return Promise.all([
      hubCall(() => hq.claudeHub.projects({}), (r) => { lib().projects = Array.isArray(r) ? r : []; }, stale),
      hubCall(() => hq.claudeHub.conversations({ ...lib().filters, limit: n }), (r) => {
        const rows = Array.isArray(r) ? r : [], cur = lib().convs || [], ids = new Set(rows.map((x) => x.id)), edge = rows[rows.length - 1];
        const tail = edge ? cur.filter((x) => !ids.has(x.id) && convBefore(x, edge)) : [];
        lib().convs = rows.concat(tail);
        lib().convsMore = tail.length ? lib().convsMore : rows.length >= n;
      }, stale),
    ]);
  }
  function moreClaudeConvs() {
    const rows = lib().convs || [], last = rows[rows.length - 1];
    if (!last) return Promise.resolve();
    fresh();
    const my = seq.filters, stale = () => my !== seq.filters;
    return hubCall(() => hq.claudeHub.conversations({ ...lib().filters, limit: PAGE, before: last.last_at, beforeId: last.id }),
      (r) => { const more = Array.isArray(r) ? r : [], cur = lib().convs || [], ids = new Set(cur.map((x) => x.id)); lib().convs = cur.concat(more.filter((x) => !ids.has(x.id))); lib().convsMore = more.length === PAGE; }, stale);
  }
  function searchClaude(q) {
    lib().q = String(q || '');
    const my = ++seq.search, stale = () => my !== seq.search;
    if (!/[\p{L}\p{N}]/u.test(lib().q)) { fresh(); lib().hits = null; lib().noTerms = lib().q.trim() !== ''; emit(); return Promise.resolve(); }
    lib().noTerms = false; fresh();
    return hubCall(() => hq.claudeHub.search(lib().q, { limit: 50 }), (r) => { lib().hits = Array.isArray(r) ? r : []; }, stale);
  }
  function openClaudeThread(id) {
    fresh();
    const my = ++seq.thread;
    return hubCall(() => hq.claudeHub.conversation(id, { limit: 200 }), (r) => { lib().thread = r && r.conversation ? r : { missing: id }; }, () => my !== seq.thread);
  }
  // A Hub `changed` event for the open thread: fetch the newest page and merge it onto what is loaded, keeping any earlier pages.
  function syncClaudeThread(id) {
    const t0 = lib().thread;
    if (!t0 || !t0.conversation || t0.conversation.id !== id) return Promise.resolve();
    fresh();
    const my = seq.thread;
    return hubCall(() => hq.claudeHub.conversation(id, { limit: 200 }), (r) => {
      const cur = lib().thread;
      if (!cur || !cur.conversation || cur.conversation.id !== id) return;
      if (!r || !r.conversation) { lib().thread = { missing: id }; return; }
      const fm = r.messages || [], idx = fm.length ? cur.messages.findIndex((m) => m.id === fm[0].id) : -1;
      // overlap found: keep the loaded older pages and their hasMore; no overlap (more than a page arrived): the fetched page stands alone
      lib().thread = idx >= 0 ? { ...r, messages: cur.messages.slice(0, idx).concat(fm), hasMore: cur.hasMore } : r;
    }, () => my !== seq.thread);
  }
  function earlierClaudeThread() {
    const t = lib().thread, first = t && t.messages && t.messages[0];
    if (!first || !t.hasMore) return Promise.resolve();
    fresh();
    const my = seq.thread, id = t.conversation.id;
    return hubCall(() => hq.claudeHub.conversation(id, { limit: 200, before: first.at, beforeId: first.id }),
      (r) => {
        const cur = lib().thread;
        if (!r || !r.conversation || !cur || !cur.conversation || cur.conversation.id !== id) return;
        const ids = new Set(cur.messages.map((m) => m.id));
        lib().thread = { ...cur, messages: r.messages.filter((m) => !ids.has(m.id)).concat(cur.messages), hasMore: !!r.hasMore };
      }, () => my !== seq.thread);
  }
  function closeClaudeThread() { seq.thread++; lib().thread = null; emit(); }
  const localDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function refreshClaudeStats(days = 30) {
    const to = new Date(), from = new Date(to.getTime() - (days - 1) * 86400000);
    fresh();
    return hubCall(() => hq.claudeHub.stats({ from: localDay(from), to: localDay(to), tzOffsetMin: -new Date().getTimezoneOffset() }), (r) => { lib().stats = r; });
  }
  function stop() { offs.splice(0).forEach((f) => { try { f(); } catch {} }); }

  return {
    model, live, bridge: !!hq, hq,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit, start, stop, refreshCaptures, refreshSocial, refreshLlm, refreshMachine,
    refreshClaudeLib, syncClaudeLib, moreClaudeConvs, searchClaude, openClaudeThread, earlierClaudeThread, closeClaudeThread, refreshClaudeStats,
  };
}
