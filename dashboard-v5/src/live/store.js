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
    social: { POSTS: [], MENTIONS: [], ACCOUNTS: [], ACTIVITY: {}, connected: false, loaded: false },
    socialArchive: { summary: null, error: null, busy: false, sel: null, list: null, listErr: null, q: '', hits: null, doc: null },   // Social › Archive: Hub socialSummary + one kind's documents + search + the open document, raw
    socialVault: { vault: null, folder: null, exists: false, obsidian: false, notes: null, error: null, busy: false },   // Social › Vault: main's VEEMO CORTEX social-notes listing
    canvas: A.canvasWidgets(DATA.canvas), dev: {}, machine: null, browserNow: null,
    canvasBoards: A.canvasBoards(DATA.canvas),   // raw boards [{name, nodes, edges}] (Canvas "＋ Note" board picker)
    llm: null, casts: {}, recording: null,
    pcHealth: null,   // a fresher pc-health sidecar than the baked DATA.pcHealth (refreshMachine)
    github: null,     // a fresher data/github.json than the baked DATA.github (refreshGithub)
    accounts: null,   // a fresher data/accounts.json than the baked DATA.accounts (refreshAccounts)
    scan: null,       // {state:'idle'|'running'|'done'|'failed', startedAt, endedAt, code, error?}
    uiPrefs: null,    // {theme, resolved, reduceMotion} shared by every window
    claudeLib: { projects: null, convs: null, convsMore: false, filters: {}, q: '', hits: null, docHits: null, doc: null, noTerms: false, thread: null, stats: null, byHq: {}, pageErr: {}, statsErr: null, error: null, busy: false },   // Claude library (H2): Hub rows, raw; vals map them via adapter hub*()
    claudeImports: { folder: null, found: [], refused: [], error: null },   // AI archive H6: drop-folder offers (main's watcher), raw
    candidates: { rows: null, pooled: null, capped: null, hidden: 0, error: null, busy: false, loaded: false },   // Prompt library P2: harvest candidates, scored by the Hub on ask
    prompts: { rows: null, stats: null, status: null, q: '', hits: null, error: null, statsErr: null, busy: false },   // Prompt library P1: Library (vault prompt notes via the Hub)
    claudeChat: { turns: [] },   // Claude Hub H3: in-app chat turns, newest last (chatReduce)
    claudeImport: null,  // Claude Hub H4: latest claude.ai import progress event
    claudeHub: null,  // hq.claudeHub.health() / the hq:claude-hub:event push (null until the first answer); logic/claude-hub.js reads it
  };

  // machine() is pure; memoise on the source object so the getters below stay cheap
  let machSrc, machVal;
  const mach = () => {
    const src = live.pcHealth || DATA.pcHealth;
    if (src !== machSrc || !machVal) { machSrc = src; machVal = A.machine(src); }
    return machVal;
  };
  let ghSrc, ghVal;
  const gh = () => {
    const src = live.github || DATA.github;
    if (src !== ghSrc || !ghVal) { ghSrc = src; ghVal = A.github(src); }
    return ghVal;
  };
  let acSrc, acVal;
  const acc = () => {
    const src = live.accounts || DATA.accounts;
    if (src !== acSrc || !acVal) { acSrc = src; acVal = A.accounts(src); }
    return acVal;
  };

  const model = {
    ...C, fmtD: A.fmtD, fileUrl: A.fileUrl,
    N, maxOff: Math.max(0, N - 1), at, metricAt, hasData: N > 0,
    dayAt: (off) => at(off).day || new Date(),
    get P0() { return at(0).P0; }, get T0() { return at(0).T0; }, get IDEAS() { return at(0).IDEAS; }, get ACH() { return at(0).ACH; },
    AUTOS: auto.AUTOS, INTERACTIVE: auto.INTERACTIVE, autoCounts: auto.counts,
    LIBRARY: auto.LIBRARY, SCHEDULED: auto.SCHEDULED, INITIAL_RUNS: auto.RUNS, autoTotal: auto.total,
    get ISSUES() { return mach().ISSUES; }, get VITALS() { return mach().VITALS; },
    get pcScannedAt() { return mach().scannedAt; }, get pcHost() { return mach().host; }, get MACHINE() { return mach().DETAIL; },
    get GITHUB() { return gh(); },
    get ACCOUNTS() { return acc(); },
    get CLUTTER() { return A.clutter(at(0).inventory); },
    get VAULTS() { return A.vaults(at(0).inventory); },
    get SITES() { return A.sites(at(0).browser); },
    get LEARN() { const P = at(0).P0; return at(0).learnings.map((l) => [l.text, (P.find((p) => p.id === l.proj) || {}).name || '', l.at ? A.fmtD(new Date(Date.parse(l.at))) : '']); },
    WEEKS: A.weeks(snaps),
    get SESSIONS() { return live.sessions; }, get CAPTURES() { return live.captures; }, get CANVAS() { return live.canvas; },
    get POSTS() { return live.social.POSTS; }, get MENTIONS() { return live.social.MENTIONS; },
    projectNotes: DATA.projectNotes && typeof DATA.projectNotes === 'object' ? DATA.projectNotes : {},
    weeklyRecap: DATA.weeklyRecap || null, builtAt: DATA.built_at || null,
    get FRESH() { const s = at(0); return A.freshness(s.at, s.enrichAge); },   // how old the live scan + its estimates are (top-bar badge)
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

  // Claude Hub H3 — in-app chat turns. Events can beat the send() answer, so unknown turnIds wait in `pending`.
  const pendingChat = [];
  let chatTimer = null;
  const emitSoon = () => { if (chatTimer) return; chatTimer = setTimeout(() => { chatTimer = null; emit(); }, 50); };
  const applyChat = (e) => {
    if (!e || typeof e !== 'object' || typeof e.turnId !== 'string') return false;
    const turns = live.claudeChat.turns, i = turns.findIndex((t) => t.turnId === e.turnId);
    if (i < 0) { pendingChat.push(e); if (pendingChat.length > 200) pendingChat.shift(); return false; }
    turns[i] = A.chatReduce(turns[i], e, Date.now());
    return true;
  };
  async function sendClaudeChat(req = {}) {
    if (!hq || !hq.claudeChat) return { error: 'This window has no app bridge' };
    let r;
    try { r = await hq.claudeChat.send(req); } catch (e) { return { error: String((e && e.message) || e) }; }
    if (!r || typeof r !== 'object' || r.error || typeof r.turnId !== 'string') return { error: (r && r.error) || 'no answer from the app' };
    adoptClaudeTurn({ turnId: r.turnId, convId: req.conversationId || null, projectId: req.projectId || null, prompt: req.text, mode: req.mode, sessionId: r.sessionId || null, seeded: r.seeded || null });
    return r;
  }
  async function cancelClaudeChat(turnId) {
    if (!hq || !hq.claudeChat) return false;
    try { return (await hq.claudeChat.cancel(turnId)) === true; } catch { return false; }
  }

  // Prompt library P3 — a chat run's turn is started by main (claudePrompts.run), so the store adopts it the way
  // sendClaudeChat does after its answer: push the row, replay events that beat the answer, emit.
  function adoptClaudeTurn({ turnId, convId = null, projectId = null, prompt = '', mode = 'read-only', sessionId = null, seeded = null } = {}) {
    if (typeof turnId !== 'string' || !turnId) return false;
    const turns = live.claudeChat.turns;
    if (turns.some((t) => t.turnId === turnId)) return false;
    turns.push(A.chatTurnNew({ turnId, convId, projectId, prompt, mode, sessionId, seeded, now: Date.now() }));
    if (turns.length > 20) turns.splice(0, turns.length - 20);
    for (const e of pendingChat.splice(0).filter((x) => { if (x.turnId === turnId) return true; pendingChat.push(x); return false; })) applyChat(e);
    emit();
    return true;
  }
  async function runPrompt(req = {}) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.run) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.run(req));
    if (!r || typeof r !== 'object') return { error: 'no answer from the app' };
    if (r.error) return r;
    if (r.target === 'chat' && typeof r.turnId === 'string')
      adoptClaudeTurn({ turnId: r.turnId, projectId: req.projectId || null, prompt: 'Prompt · ' + (r.title || 'untitled'), mode: req.mode || 'read-only', sessionId: r.sessionId || null, seeded: r.seeded || null });
    if (r.usage === 'recorded') refreshPrompts();   // prompt_use rows emit no Hub changed event
    return r;
  }
  async function packImport(req = {}) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.importPack) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.importPack(req));
    if (r && typeof r.imported === 'number' && r.imported > 0) refreshPrompts();
    return r && typeof r === 'object' ? r : { error: 'no answer from the app' };
  }
  async function packExport() {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.exportPack) return { error: 'This window has no app bridge' };
    const r = await askHq(() => hq.claudePrompts.exportPack());
    return r && typeof r === 'object' ? r : { error: 'no answer from the app' };
  }

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
  // ---- Social tab › Archive (Hub) and › Vault (main). Every answer is checked; a stale reply (newer ask) is dropped.
  const sa = () => live.socialArchive, sv = () => live.socialVault;
  const socialSeq = { sum: 0, list: 0, q: 0, doc: 0, vault: 0 };
  const hubOk = (fn) => !!(hq && hq.claudeHub && hq.claudeHub[fn]);
  const errOf = (r) => (isObj(r) && r.error ? String(r.error) : null);
  function refreshSocialArchive() {
    if (!hubOk('socialSummary')) return Promise.resolve();
    const my = ++socialSeq.sum; sa().busy = true; emit();
    return askHq(() => hq.claudeHub.socialSummary()).then((r) => {
      if (my !== socialSeq.sum) return;
      sa().busy = false;
      if (!isObj(r) || errOf(r)) sa().error = 'Claude Hub: ' + (errOf(r) || 'no answer'); else { sa().error = null; sa().summary = { kinds: arr(r.kinds), dms: arr(r.dms) }; }
      emit();
    });
  }
  function socialArchiveKind(origin, kind) {
    if (!hubOk('documents')) return Promise.resolve();
    const my = ++socialSeq.list;
    sa().sel = origin && kind ? { origin: String(origin), kind: String(kind) } : null; sa().list = null; sa().listErr = null; emit();
    if (!sa().sel) return Promise.resolve();
    return askHq(() => hq.claudeHub.documents({ source: 'social', origin: sa().sel.origin, kind: sa().sel.kind, limit: 200 })).then((r) => {
      if (my !== socialSeq.list) return;
      if (errOf(r) || !Array.isArray(r)) sa().listErr = 'Claude Hub: ' + (errOf(r) || 'no answer'); else sa().list = r;
      emit();
    });
  }
  function searchSocialArchive(text) {
    sa().q = String(text || '').trim().slice(0, 200);
    const my = ++socialSeq.q;
    if (!sa().q || !hubOk('documents')) { sa().hits = null; emit(); return Promise.resolve(); }
    return askHq(() => hq.claudeHub.documents({ source: 'social', q: sa().q, limit: 50 })).then((r) => {
      if (my !== socialSeq.q) return;
      sa().hits = Array.isArray(r) ? r : { error: 'Claude Hub: ' + (errOf(r) || 'no answer') };
      emit();
    });
  }
  function openSocialDoc(id) {
    if (!hubOk('document')) return Promise.resolve();
    const my = ++socialSeq.doc; sa().doc = { id: String(id), loading: true }; emit();
    return askHq(() => hq.claudeHub.document(String(id))).then((r) => {
      if (my !== socialSeq.doc) return;
      sa().doc = isObj(r) && r.id ? r : { id: String(id), error: errOf(r) ? 'Claude Hub: ' + errOf(r) : DOC_GONE };
      emit();
    });
  }
  function closeSocialDoc() { ++socialSeq.doc; sa().doc = null; emit(); }
  function refreshSocialVault() {
    if (!hq || !hq.socialVault || !hq.socialVault.list) return Promise.resolve();
    const my = ++socialSeq.vault; sv().busy = true; emit();
    return askHq(() => hq.socialVault.list()).then((r) => {
      if (my !== socialSeq.vault) return;
      sv().busy = false;
      if (!isObj(r) || errOf(r) || !Array.isArray(r.notes)) sv().error = errOf(r) || 'no answer from the app';
      else Object.assign(sv(), { error: null, vault: r.vault || null, folder: r.folder || null, exists: !!r.exists, obsidian: !!r.obsidian, notes: r.notes });
      emit();
    });
  }
  function openSocialNote(rel, how) {
    if (!hq || !hq.socialVault || !hq.socialVault.open) return Promise.resolve({ error: 'Opening a vault note needs the WorkspaceHQ app' });
    return askHq(() => hq.socialVault.open(rel, how)).then((r) => (isObj(r) ? r : { error: 'no answer' }));
  }
  function saveSocialNote(req) {
    if (!hq || !hq.socialVault || !hq.socialVault.save) return Promise.resolve({ error: 'Saving to the vault needs the WorkspaceHQ app' });
    return askHq(() => hq.socialVault.save(req)).then((r) => (isObj(r) ? r : { error: 'no answer' }));
  }
  // Inbox Discard: main cancels the staged post, then the bridge snapshot is read again (the post leaves the list)
  function discardSocialPost(id) {
    if (!hq || !hq.socialCancel) return Promise.resolve({ error: 'Discarding needs the WorkspaceHQ app' });
    return askHq(() => hq.socialCancel(String(id))).then((r) => { refreshSocial(); return isObj(r) ? r : { error: 'no answer' }; });
  }
  function openSocialSite(platform) {
    if (!hq || !hq.socialOpenSite) return Promise.resolve({ error: 'Opening a site needs the WorkspaceHQ app' });
    return askHq(() => hq.socialOpenSite(platform)).then((r) => (isObj(r) ? r : { error: 'no answer' }));
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
  // a fresh GitHub snapshot (Projects › GitHub Refresh); junk or {error} keeps the baked one
  function refreshGithub(g) {
    if (!isObj(g) || typeof g.state !== 'string') return false;
    live.github = g;
    emit();
    return true;
  }
  // a fresh Vercel + Supabase snapshot (Projects › Accounts Refresh); junk or {error} keeps the baked one
  function refreshAccounts(a) {
    if (!isObj(a) || !isObj(a.vercel) || !isObj(a.supabase)) return false;
    live.accounts = a;
    emit();
    return true;
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
    if (hq.claudeChat && hq.claudeChat.on) sub(() => hq.claudeChat.on((e) => { if (applyChat(e)) { if (e.kind === 'delta' || e.kind === 'tool') emitSoon(); else emit(); } }));
    if (hq.claudeHub && hq.claudeHub.health) reads.push(pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : null; }));
    if (hq.claudeImports && hq.claudeImports.on) sub(() => hq.claudeImports.on(applyImports));
    if (hq.claudeImports && hq.claudeImports.pending) reads.push(refreshClaudeImports());
    if (hq.claudeHub && hq.claudeHub.on) sub(() => hq.claudeHub.on((e) => {
      if (!isObj(e)) return;
      if (e.event === 'progress' && isObj(e.data) && e.data.kind === 'import') {   // H4: import progress is not backfill progress
        live.claudeImport = e.data;
        if (e.data.phase === 'done' || e.data.phase === 'failed') pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
        emit();
        return;
      }
      if (e.event === 'progress' && isObj(e.data)) {
        live.claudeHub = { ...(live.claudeHub || {}), state: e.data.done >= e.data.total ? 'ready' : 'indexing', backfill: e.data };
        if (e.data.done >= e.data.total) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
      } else if (e.event === 'health' && isObj(e.data)) live.claudeHub = e.data;
      // a Hub that came up after the first health() answered "starting" (a reader never backfills, so no progress follows)
      else if (e.event === 'ready' && hq.claudeHub.health) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; retryLibLoad(); if (live.prompts.error) refreshPrompts(); if (sa().error || (sa().busy === false && !sa().summary)) refreshSocialArchive(); });
      // the Hub indexed something new (a live append, a sweep): the card's counts are from the last answer, so ask again
      else if (e.event === 'changed') {
        if (hq.claudeHub.health) pull(() => hq.claudeHub.health(), (h) => { live.claudeHub = isObj(h) ? h : live.claudeHub; });
        if (lib().convs) syncClaudeLib();
        if (live.prompts.rows && Array.isArray(e.data && e.data.documents) && e.data.documents.some((d) => String(d).startsWith('prompt:'))) refreshPrompts();
        if (live.candidates.loaded && Array.isArray(e.data && e.data.documents) && e.data.documents.some((d) => String(d).startsWith('prompt:'))) refreshCandidates();
        if (lib().stats) refreshClaudeStats();
        // Social › Archive: an import (or a forget) changed social documents or Instagram / Facebook chats → fresh counts
        if (sa().summary && ((Array.isArray(e.data && e.data.documents) && e.data.documents.some((d) => String(d).startsWith('social:'))) || (Array.isArray(e.data && e.data.ids) && e.data.ids.some((d) => /^(instagram|facebook):/.test(String(d)))))) { refreshSocialArchive(); if (sa().sel) socialArchiveKind(sa().sel.origin, sa().sel.kind); }
        for (const k of new Set([...Object.keys(lib().byHq), ...Object.keys(lib().pageErr)])) refreshClaudeForProject(k);
        const docIds = Array.isArray(e.data && e.data.documents) ? e.data.documents : [];
        if (docIds.length && lib().q && /[\p{L}\p{N}]/u.test(lib().q)) searchClaude(lib().q);
        if (docIds.length && lib().doc && lib().doc.id && docIds.includes(lib().doc.id)) openClaudeDocument(lib().doc.id);
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
    if (!h || !(h.state === 'ready' || h.state === 'indexing')) return;
    if (lib().convs === null && lib().error && !lib().busy) refreshClaudeLib();
    // a project page or History that failed its first load while the Hub was starting asks again now
    for (const k of Object.keys(lib().pageErr)) if (lib().pageErr[k] && lib().byHq[k] === undefined) refreshClaudeForProject(k);
    if (lib().statsErr && !lib().stats) refreshClaudeStats();
  }
  // One error slot for the whole library: each ENTRY function clears it before it asks (fresh action, fresh verdict);
  // a success never clears it, so two parallel calls cannot erase each other's failure. busy counts calls in flight.
  let libPending = 0;
  // stale() answers "is this response still wanted?": a late answer for a closed thread, a replaced search or changed filters is dropped whole
  // fail(msg) routes a failure to a slot of its own (project page, History stats) instead of the shared Chats banner
  const hubCall = (fn, ok, stale, fail) => {
    if (!hq || !hq.claudeHub) return Promise.resolve();
    libPending++; lib().busy = true;
    return Promise.resolve().then(fn).then((r) => {
      if (stale && stale()) return;
      if (r && typeof r === 'object' && !Array.isArray(r) && r.error) { (fail || setLibError)('Claude Hub: ' + r.error); return; }
      ok(r);
    }).catch((e) => { if (!(stale && stale())) (fail || setLibError)('Claude Hub: ' + ((e && e.message) || e)); })
      .finally(() => { libPending--; lib().busy = libPending > 0; emit(); });
  };
  const setLibError = (m) => { lib().error = m; };
  const fresh = () => { lib().error = null; };
  const PAGE = 50, MAXPAGE = 200;
  // per-slot sequence numbers: a request is current only while its slot's number is unchanged
  const seq = { filters: 0, thread: 0, search: 0, doc: 0 };
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
    if (!/[\p{L}\p{N}]/u.test(lib().q)) { fresh(); lib().hits = null; lib().docHits = null; lib().noTerms = lib().q.trim() !== ''; emit(); return Promise.resolve(); }
    lib().noTerms = false; fresh();
    const docs = hq.claudeHub.documents
      ? hubCall(() => hq.claudeHub.documents({ q: lib().q, limit: 20 }), (r) => { lib().docHits = Array.isArray(r) ? r : []; }, stale)
      : Promise.resolve();
    return Promise.all([hubCall(() => hq.claudeHub.search(lib().q, { limit: 50 }), (r) => { lib().hits = Array.isArray(r) ? r : []; }, stale), docs]);
  }
  const DOC_GONE = 'That document is no longer in the index (its file was removed or it was forgotten).';
  function openClaudeDocument(id) {
    if (!hq || !hq.claudeHub || !hq.claudeHub.document) return Promise.resolve();
    const my = ++seq.doc, stale = () => my !== seq.doc;
    lib().doc = { id: String(id), loading: true }; emit();
    return hubCall(() => hq.claudeHub.document(String(id)), (r) => { lib().doc = r && r.id ? r : { id: String(id), error: DOC_GONE }; }, stale,
      (m) => { lib().doc = { id: String(id), error: m }; });
  }
  function closeClaudeDocument() { ++seq.doc; lib().doc = null; emit(); }
  const imp = () => live.claudeImports;
  function refreshClaudeImports() {
    if (!hq || !hq.claudeImports || !hq.claudeImports.pending) return Promise.resolve();
    return Promise.resolve().then(() => hq.claudeImports.pending()).then((p) => {
      if (isObj(p)) { imp().folder = isObj(p.folder) ? p.folder : null; imp().found = Array.isArray(p.found) ? p.found : []; imp().refused = Array.isArray(p.refused) ? p.refused : []; imp().error = null; }
    }, (e) => { imp().error = 'Imports folder: ' + ((e && e.message) || e); }).finally(emit);
  }
  function applyImports(e) {
    if (!isObj(e) || !isObj(e.data)) return;
    const d = e.data;
    if (e.event === 'found' && d.dropId && !imp().found.some((f) => f.dropId === d.dropId)) imp().found = [...imp().found, d];
    else if (e.event === 'gone') imp().found = imp().found.filter((f) => f.dropId !== d.dropId);
    else if (e.event === 'error' && d.file) imp().refused = [...imp().refused.filter((x) => x.file !== d.file), d].slice(-10);
    emit();
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
  function refreshClaudeForProject(hqProjectId) {
    if (!hqProjectId) return Promise.resolve();
    // its own error slot (a background page fetch must not put a banner on Chats); cleared here as this entry's fresh action
    lib().pageErr = { ...lib().pageErr, [hqProjectId]: null };
    return hubCall(() => hq.claudeHub.conversations({ hqProjectId, limit: 5 }),
      (r) => { lib().byHq = { ...lib().byHq, [hqProjectId]: Array.isArray(r) ? r : [] }; },
      null, (m) => { lib().pageErr = { ...lib().pageErr, [hqProjectId]: m }; });
  }
  function closeClaudeThread() { seq.thread++; lib().thread = null; emit(); }
  const localDay = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  // Prompt library P1 — the Library reads the Hub's prompt documents, their prompt_use stats and main's folder/Obsidian status
  let promptSeq = 0, promptSearchSeq = 0, searchFailed = false;   // searchFailed: P.error came from a search, so a later good search (or clearing it) lifts it
  const askHq = (f) => Promise.resolve().then(f).catch((e) => ({ error: String((e && e.message) || e).slice(0, 300) }));
  function refreshPrompts() {
    const P = live.prompts;
    if (!hq || !hq.claudeHub || !hq.claudeHub.documents) return Promise.resolve();
    const my = ++promptSeq;
    P.busy = true; emit();
    return Promise.all([
      askHq(() => hq.claudeHub.documents({ source: 'prompt', limit: 200 })),
      hq.claudeHub.promptStats ? askHq(() => hq.claudeHub.promptStats()) : Promise.resolve(null),
      hq.claudePrompts && hq.claudePrompts.status ? askHq(() => hq.claudePrompts.status()) : Promise.resolve(null),
    ]).then(([rows, stats, status]) => {
      if (my !== promptSeq) return undefined;
      P.busy = false;
      searchFailed = false;
      if (isObj(rows) && rows.error) P.error = 'Claude Hub: ' + rows.error; else { P.error = null; P.rows = Array.isArray(rows) ? rows : []; }
      if (isObj(stats) && stats.error) P.statsErr = 'Claude Hub: ' + stats.error; else { P.statsErr = null; P.stats = Array.isArray(stats) ? stats : null; }
      if (isObj(status) && !status.error) P.status = status;
      if (P.q) return searchPrompts(P.q);
      emit(); return undefined;
    });
  }
  function searchPrompts(q) {
    const P = live.prompts;
    P.q = String(q || '').trim().slice(0, 200);
    if (!P.q || !hq || !hq.claudeHub || !hq.claudeHub.documents) { P.hits = null; if (searchFailed) { P.error = null; searchFailed = false; } emit(); return Promise.resolve(); }
    const my = ++promptSearchSeq;
    return askHq(() => hq.claudeHub.documents({ source: 'prompt', q: P.q, limit: 200 })).then((r) => {
      if (my !== promptSearchSeq) return;
      if (isObj(r) && r.error) { P.error = 'Claude Hub: ' + r.error; searchFailed = true; } else { P.hits = Array.isArray(r) ? r : []; if (searchFailed) { P.error = null; searchFailed = false; } }
      emit();
    });
  }
  function openPrompt(id, how) {
    if (!hq || !hq.claudePrompts || !hq.claudePrompts.open) return Promise.resolve({ error: 'Opening a prompt note needs the WorkspaceHQ app' });
    return askHq(() => hq.claudePrompts.open(id, how)).then((r) => (isObj(r) ? r : { error: 'no answer' }));
  }
  // Prompt library P2 — harvest candidates are scored by the Hub on ask (never polled)
  let candSeq = 0;
  function refreshCandidates() {
    const C = live.candidates;
    if (!hq || !hq.claudeHub || !hq.claudeHub.promptCandidates) return Promise.resolve();
    const my = ++candSeq;
    C.busy = true; C.loaded = true; emit();
    return askHq(() => hq.claudeHub.promptCandidates({ limit: 50 })).then((r) => {
      if (my !== candSeq) return;
      C.busy = false;
      if (!isObj(r) || r.error) C.error = 'Claude Hub: ' + ((isObj(r) && r.error) || 'no answer');
      else { C.error = null; C.rows = Array.isArray(r.candidates) ? r.candidates : []; C.pooled = r.pooled || null; C.capped = r.capped || null; C.hidden = Number(r.hidden) || 0; }
      emit();
    });
  }
  function refreshClaudeStats(days = 30) {
    const to = new Date(), from = new Date(to.getTime() - (days - 1) * 86400000);
    lib().statsErr = null;
    return hubCall(() => hq.claudeHub.stats({ from: localDay(from), to: localDay(to), tzOffsetMin: -new Date().getTimezoneOffset() }), (r) => { lib().stats = r; }, null, (m) => { lib().statsErr = m; });
  }
  function stop() { offs.splice(0).forEach((f) => { try { f(); } catch {} }); clearTimeout(chatTimer); chatTimer = null; }

  return {
    model, live, bridge: !!hq, hq,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit, start, stop, refreshCaptures, refreshSocial, refreshLlm, refreshMachine, refreshGithub, refreshAccounts,
    refreshClaudeLib, syncClaudeLib, moreClaudeConvs, searchClaude, openClaudeDocument, closeClaudeDocument, refreshClaudeImports, openClaudeThread, earlierClaudeThread, closeClaudeThread, refreshClaudeStats, refreshClaudeForProject, refreshPrompts, searchPrompts, openPrompt, refreshCandidates,
    sendClaudeChat, cancelClaudeChat, adoptClaudeTurn, runPrompt, packImport, packExport,
    refreshSocialArchive, socialArchiveKind, searchSocialArchive, openSocialDoc, closeSocialDoc, refreshSocialVault, openSocialNote, saveSocialNote, openSocialSite, discardSocialPost,
  };
}
