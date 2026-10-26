// WorkspaceHQ v3 — screen logic. Structure, names and render values come from
// the Claude Design prototype (WorkspaceHQ v3.dc.html); every value the
// template binds is computed here from the real snapshot model (live/store.js)
// and every action goes through window.hq (feature-detected).
//
// Honesty rules that changed the prototype's behaviour:
//  - nothing is simulated: no fake run output, sessions, diffs or answers.
//  - writes that reload the window (quest done, learn, archive) are delayed a
//    moment so their animation plays, and Undo really cancels the write.
//  - things the app can't do yet say so instead of pretending (toast reason).
//
// Layout: this file keeps the state, lifecycle and core helpers. The actions
// are Component.prototype mixins in src/logic/*.js, renderVals() is built in
// src/vals/*.js and the markup is src/tpl/*.tpl.js (joined by app.tpl.js).
import { DCLogic, createRef } from './dc/runtime.js';
import { FX, loadPrefs, savePrefs, hhmm, WRITE_DELAY, THEMES, readV3Prefs, mirrorV3Theme, setReduceFlag, planUiSeed, placeSnapId, restoreSnapOffset } from './logic/shared.js';
import { tasksLogic } from './logic/tasks.js';
import { claudeLogic } from './logic/claude.js';
import { claudeLibLogic, clPrefs } from './logic/claude-lib.js';
import { claudeChatLogic } from './logic/claude-chat.js';
import { claudeImportLogic } from './logic/claude-import.js';
import { claudeImportsLogic } from './logic/claude-imports.js';
import { runsLogic } from './logic/runs.js';
import { commitLogic } from './logic/commit.js';
import { sheetLogic } from './logic/sheet.js';
import { journalLogic } from './logic/journal.js';
import { askLogic } from './logic/ask.js';
import { paletteLogic } from './logic/palette.js';
import { onboardLogic } from './logic/onboard.js';
import { whatsNewLogic } from './logic/whats-new.js';
import { claudeVaultLogic } from './logic/claude-vault.js';
import { promptsLogic } from './logic/prompts.js';
import { runLogic } from './logic/run.js';
import { candidatesLogic } from './logic/prompt-candidates.js';
import { systemLogic } from './logic/system.js';
import { libraryLogic } from './logic/library.js';
import { studioLogic } from './logic/studio.js';
import { projectLogic } from './logic/project.js';
import { githubLogic } from './logic/github.js';
import { accountsLogic } from './logic/accounts.js';
import { renderVals } from './vals/index.js';

export class Component extends DCLogic {
  state = this.initState();
  mainRef = createRef();
  _xpEl = null;
  _tr = {};
  _pending = {};

  get store() { return this.props.store; }
  get M() { return this.props.store.model; }
  get LIVE() { return this.props.store.live; }
  get hq() { return this.props.store.hq; }

  initState() {
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem('whq3-place') || '{}'); } catch (e) {}
    const P = loadPrefs(), M = this.props.store.model, a = M.at(0).account;
    const scanAt = M.at(0).at ? new Date(Date.parse(M.at(0).at)) : null;
    // a past scan is remembered by id (gone → back to live); live stays live (logic/shared.js)
    const snapOffset = restoreSnapOffset(saved, M);
    // before the first render: the custom elements read data-hq-reduce when they connect
    setReduceFlag(!!P.reduceMotion);
    return {
      tab: saved.tab || this.props.startTab || 'home',
      sub: Object.assign({ projects: 'grid', tasks: 'ranked', automations: 'runnable', claude: 'chats', history: 'trends', system: 'machine', life: 'screen' }, saved.sub || {}),
      route: saved.route || null, snapOffset,
      themePref: P.themePref || this.props.theme || 'dark', sound: P.sound !== false, petOn: P.petOn != null ? P.petOn : this.props.pet !== false,
      ambientPref: P.ambientPref !== false, reduceMotion: !!P.reduceMotion,
      vw: window.innerWidth, completed: [], recentDone: [], dismissed: P.dismissed || [], xp: a.xp, displayXp: a.xp, committed: {},
      trusted: P.trusted || [], pinned: P.pinned || M.AUTOS.slice(0, 3).map((x) => x.id),
      // askHistory's real value comes from askInitState() below (v3's hq-oracle-chat, contract K-1)
      scrubOpen: false, paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, askHistory: [], askDraft: '',
      runsOpen: false, localRuns: [], expandedRun: null, settingsOpen: false, cheatOpen: false, ambientOverlay: false, moreOpen: false,
      focus: saved.focus || null, now: Date.now(), confirm: null, confirmAsk: 'always', commit: null, sheet: null, levelUp: null, toasts: [], refreshing: false,
      lastScan: scanAt && !isNaN(scanAt) ? (scanAt.toDateString() === new Date().toDateString() ? '' : M.fmtD(scanAt) + ' ') + hhmm(scanAt) : (M.at(0).id || '—'),
      projSort: 'worst', taskFilter: 'all', hoverProj: null, diagTab: 'git', pageMore: false,
      journalAdds: {}, journalDraft: '', journalKind: 'note', autoQuery: '', trendRange: 30, lifeRange: 'window', lightbox: null, studioFilter: 'all',
      recapOpen: false, recapDismissed: P.recapSeen === (M.weeklyRecap && M.weeklyRecap.week_end), sessionSel: null, composer: '', composerProj: (M.P0[0] || {}).id || null,
      momentum: 'unc', fixed: [], sinceDismissed: P.sinceSeen === M.at(0).id, actTab: 'runs', compareOff: null, commitSel: 0, onboard: null, notifLog: [],
      // What's new · trailers (logic/whats-new.js): open, and trailers whose video failed to play (id → true)
      whatsNewOpen: false, whatsNewMissing: {},
      vault: null,   // Save to vault dialog (Claude Hub H5, logic/claude-vault.js)
      // Phase 3 surface state (contract K-4; each reader also treats undefined as these defaults):
      // System (logic/system.js): Re-examine running · per-capture-text save state ('saving'|'noted'|'failed')
      sysExamining: false, sysSaves: {},
      // Automations (logic/library.js): kind / source / category chips · rows shown · Rescan running
      libKind: 'all', libSource: 'all', libSchool: 'all', libShow: 40, libRescanning: false,
      // Projects grid (vals/projects.js): search + status chip, this session only
      projSearch: '', projStatus: 'all',
      // Projects › GitHub (logic/github.js): Refresh running · repo list filter
      ghBusy: false, ghFilter: 'all',
      // Projects › Vercel & Supabase (logic/accounts.js): Refresh running
      acBusy: false,
      // Claude › Canvas ＋ Note (logic/claude.js): form open · draft · picked board (null = the first) · add in flight
      canvasNoteOpen: false, canvasDraft: '', canvasBoard: null, canvasSaving: false,
      // Claude library (H2, logic/claude-lib.js): Chats filters (persisted in localStorage) · search · open thread · Forget confirm · link picker
      ...clPrefs(), clQuery: '', clSearched: false, prQuery: '', prSearched: false, prFor: null, prView: 'library', hcSel: [], promote: null, run: null, pack: null, clOpen: false, clExpanded: {}, clForgetAsk: false, clLinkPick: '',
      // Claude chat composer (H3, logic/claude-chat.js) — not persisted: every composer opens Read-only
      ccOpen: false, ccConv: null, ccProj: '', ccText: '', ccMode: 'read-only', ccTurn: null, ccSending: false,
      // Ask's offline box: Retry is probing (logic/ask.js)
      askChecking: false,
      // Ask (logic/ask.js, contract K-1): { askHistory, askInclude } from v3's localStorage keys; Ask saves them itself
      ...(this.askInitState ? this.askInitState() : {}),
    };
  }

  componentDidMount() {
    this._prev = Object.assign({}, this.state, { sub: Object.assign({}, this.state.sub) }); this._prevProps = Object.assign({}, this.props);
    // deep links (mini HUD, tray): subscribed first and synchronously, main may push right after load
    if (this.hq && this.hq.onNavigate) { try { this._offNav = this.hq.onNavigate((r) => this.navigateTo(r)); } catch (e) { console.warn('[nav] subscribe failed', e); } }
    this._onKey = (e) => this.onKey(e);
    this._onResize = () => this.forceUpdate();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    requestAnimationFrame(() => { this.forceUpdate(); requestAnimationFrame(() => this.forceUpdate()); });
    this._mq = [480, 560, 720, 880, 900, 1000, 1020, 1100, 1120, 1160, 1240, 1320, 1400, 1440].map((px) => { const m = matchMedia('(min-width:' + px + 'px)'), h = () => this.forceUpdate(); m.addEventListener('change', h); return [m, h]; });
    this._wT = setInterval(() => { const w = document.documentElement.clientWidth || window.innerWidth; if (w !== this._lastW) this.forceUpdate(); }, 300);
    if (window.ResizeObserver) { this._ro = new ResizeObserver(() => this.forceUpdate()); this._ro.observe(document.body); this._ro.observe(document.documentElement); }
    FX().init({ sound: this.state.sound, pet: this.state.petOn, reduce: this.state.reduceMotion, floor: () => (window.innerWidth < 720 ? 70 : 6), facts: () => this.petFacts() });
    setTimeout(() => FX().say('Hi, I’m Bit.', 2200), 900);
    setTimeout(() => window.HQAlive && window.HQAlive.stagger(), 300);
    this._focusT = setInterval(() => { if (this.state.focus) this.setState({ now: Date.now() }); }, 1000);
    // live data → re-render; finished runs → one toast each; main's shared UI prefs → state
    this._offStore = this.store.on(() => { this.announceRuns(); this.followUiPrefs(); this.forceUpdate(); });
    this.store.start();
    { const S = this.state; if (S.tab === 'claude' && !S.route && (S.sub.claude === 'chats' || S.sub.claude === 'projects')) this.clLoad(); if (S.tab === 'claude' && !S.route && S.sub.claude === 'prompts') this.prLoad(); }   // a cold start on Chats/Projects loads too; P1: the Library loads on arrival
    this.followUiPrefs();
    if (this.hq && this.hq.studio && this.hq.studio.onOpenRealm) this._offRealm = this.hq.studio.onOpenRealm(() => this.go('studio'));   // Ctrl+Alt+L
    this._onHide = () => this.flushPending(); window.addEventListener('pagehide', this._onHide);
    if (this.hq && this.hq.llm && this.hq.llm.onDelta) this._offDelta = this.hq.llm.onDelta((d) => this.onAskDelta(d));
    this.maybeLevelUp();
    this.maybeShowWhatsNew();   // once per version, when the window has focus (logic/whats-new.js)
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._onKey); window.removeEventListener('resize', this._onResize); if (this._ro) this._ro.disconnect(); clearInterval(this._wT); (this._mq || []).forEach(([m, h]) => m.removeEventListener('change', h));
    clearInterval(this._focusT); FX().destroy(); this.stopWhatsNewWait();
    if (this._offStore) this._offStore(); if (this._offRealm) this._offRealm(); if (this._offDelta) this._offDelta(); if (this._offNav) this._offNav(); this.store.stop();
    this.flushPending(); window.removeEventListener('pagehide', this._onHide);
  }
  componentDidUpdate() {
    const S = this.state;
    const ps = this._prev || S;
    this._prev = Object.assign({}, S, { sub: Object.assign({}, S.sub) }); this._prevProps = Object.assign({}, this.props);
    // the Ask chat isn't kept here any more: Ask saves it in v3's hq-oracle-chat (contract K-1)
    try { sessionStorage.setItem('whq3-place', JSON.stringify({ tab: S.tab, sub: S.sub, route: S.route, snapOffset: S.snapOffset, snapId: placeSnapId(this.M, S.snapOffset), focus: S.focus })); } catch (e) {}
    if (ps.reduceMotion !== S.reduceMotion) setReduceFlag(S.reduceMotion);
    if (ps.themePref !== S.themePref) mirrorV3Theme(S.themePref);
    if (ps.themePref !== S.themePref || ps.reduceMotion !== S.reduceMotion) this.pushUiPrefs();
    if (['themePref', 'sound', 'petOn', 'ambientPref', 'reduceMotion', 'pinned', 'trusted', 'dismissed', 'recapDismissed', 'sinceDismissed'].some((k) => ps[k] !== S[k])) {
      const P = loadPrefs();
      delete P.notifyMeasured;   // the Notifications switch was cut (Phase 2); drop what older builds saved
      savePrefs(Object.assign(P, { themePref: S.themePref, sound: S.sound, petOn: S.petOn, ambientPref: S.ambientPref, reduceMotion: S.reduceMotion, pinned: S.pinned, trusted: S.trusted, dismissed: S.dismissed.slice(-200),
        recapSeen: S.recapDismissed && this.M.weeklyRecap ? this.M.weeklyRecap.week_end : P.recapSeen, sinceSeen: S.sinceDismissed ? this.M.at(0).id : P.sinceSeen }));
    }
    { const pr = this.projectsAt(0), sec = this.sum(pr, (p) => p.secrets), run = this.runningCount() > 0; FX().set({ level: this.M.levelOf(S.xp).l, mood: run ? 'busy' : sec > 0 ? 'nervous' : this.openTasks(0).length === 0 ? 'sleepy' : 'ok' }); }
    if (ps.sound !== S.sound || ps.petOn !== S.petOn || ps.reduceMotion !== S.reduceMotion) FX().set({ sound: S.sound, pet: S.petOn, reduce: S.reduceMotion });
    const moved = ps.tab !== S.tab || JSON.stringify(ps.route) !== JSON.stringify(S.route) || ps.sub[S.tab] !== S.sub[S.tab];
    if (moved && window.HQAlive) window.HQAlive.stagger();
    if (moved && this.mainRef.current) {
      this.mainRef.current.scrollTop = 0;
      if (!S.reduceMotion) this.mainRef.current.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    if (moved && S.tab === 'studio') this.store.refreshCaptures();
    if (moved && S.tab === 'life') this.store.refreshSocial();
    if (moved && S.tab === 'claude' && (S.sub.claude === 'chats' || S.sub.claude === 'projects')) this.clLoad();
    if (moved && S.tab === 'claude' && !S.route && S.sub.claude === 'prompts') this.prLoad();   // P1: the Library loads on arrival
    if (moved && S.route && S.route.id) this.store.refreshClaudeForProject && this.store.refreshClaudeForProject(S.route.id);
    if (moved && S.tab === 'history' && !S.route) this.store.refreshClaudeStats && this.store.refreshClaudeStats(30);
  }

  // ---------- helpers ----------
  ps() { return this.props.previewState || 'live'; }
  isEmpty() { return false; }
  canWrite() { return this.state.snapOffset === 0 && this.ps() !== 'nobridge' && !!this.hq; }
  writeReason() {
    if (this.state.snapOffset > 0) return 'Read-only · viewing ' + this.M.fmtD(this.M.dayAt(this.state.snapOffset));
    if (this.ps() === 'nobridge' || !this.hq) return 'Read-only here · this window has no app bridge';
    return '';
  }
  hhmm() { return hhmm(new Date()); }
  pt(e) {
    if (e && e.clientX) return { x: e.clientX, y: e.clientY };
    const t = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
    return t ? { x: t.left + t.width / 2, y: t.top + t.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  }
  statusOf(p) {
    if (p.secrets > 0 || !p.hasGit || (p.commits === 0 && p.dirty > 0)) return 'risk';
    if (p.activity === 'stale' || p.dirty > 20 || (p.hasGit && p.branch !== p.canonical)) return 'care';
    if (p.activity === 'dormant') return 'idle';
    if (p.dirty > 0) return 'care';
    return 'ok';
  }
  reasonOf(p) {
    if (p.secrets > 0) return p.secrets + ' likely secret' + (p.secrets > 1 ? 's' : '');
    if (!p.hasGit) return 'No version control';
    if (p.commits === 0) return '0 commits · ' + p.dirty + ' files never saved';
    if (p.dirty > 0 && p.dirty >= 5) return p.dirty + ' uncommitted files';
    if (p.branch !== p.canonical) return 'On ' + p.branch + ', not ' + p.canonical;
    if (p.activity === 'stale') return 'Stale ' + p.lastDays + ' days';
    if (p.dirty > 0) return p.dirty + ' uncommitted files';
    if (p.activity === 'dormant') return 'Dormant ' + (p.lastDays == null ? '' : p.lastDays + ' days');
    return 'All clear';
  }
  projectsAt(off, includeArchived) {
    const S = this.state, snap = this.M.at(off);
    return (includeArchived ? snap.P0.concat(snap.archived) : snap.P0).map((p) => {
      const q = Object.assign({}, p);
      if (off === 0 && S.committed[p.id]) { q.dirty = 0; if (!q.commits) { q.commits = 1; q.lastDays = 0; } }
      q.st = this.statusOf(q); q.reason = this.reasonOf(q);
      return q;
    });
  }
  tasksAt(off) {
    const S = this.state, TR = this.M.TIER;
    let t = this.M.at(off).T0.slice();
    if (off === 0) t = t.filter((x) => (!S.completed.includes(x.id) || S.recentDone.includes(x.id)) && !(S.committed[x.proj] && x.commitTask));
    return t.sort((a, b) => TR[a.tier].rank - TR[b.tier].rank || b.xp - a.xp || b.age - a.age);
  }
  openTasks(off) { return this.tasksAt(off).filter((t) => !this.state.recentDone.includes(t.id)); }
  ideasAt() { return this.M.IDEAS.filter((i) => !this.state.dismissed.includes(i.id) && !this.state.completed.includes(i.id)); }
  pname(id) { const s = this.M.at(0), p = s.P0.concat(s.archived).find((x) => x.id === id); return p ? p.name : (id ? '' : 'Workspace'); }
  proj(id) { const s = this.M.at(0); return s.P0.concat(s.archived).find((x) => x.id === id) || null; }
  sum(arr, f) { return arr.reduce((a, x) => a + (f(x) || 0), 0); }
  xpAt(off) { return off === 0 ? this.state.xp : this.M.at(off).account.xp; }
  series(metric, off) {
    if (off === 0 && metric === 'tasks') return this.openTasks(0).length;
    if (off === 0 && metric === 'xp') return this.state.xp;
    if (off === 0 && metric === 'unc') return this.sum(this.projectsAt(0), (p) => p.dirty);
    return this.M.metricAt(metric, off);
  }
  // offsets [from … to] that exist, oldest first, at most n of them
  span(n, off) { const out = []; for (let i = Math.min(this.M.maxOff, off + n - 1); i >= off; i--) out.push(i); return out.length ? out : [off]; }
  sparkPts(vals, w, h) {
    if (vals.length < 2) vals = [vals[0] || 0, vals[0] || 0];
    const mn = Math.min(...vals), mx = Math.max(...vals), n = vals.length;
    return vals.map((v, i) => (i * (w / Math.max(1, n - 1))).toFixed(1) + ',' + (h - 3 - ((v - mn) / ((mx - mn) || 1)) * (h - 6)).toFixed(1)).join(' ');
  }
  greet() { const h = new Date().getHours(); return h < 5 ? 'late night' : h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : h < 22 ? 'good evening' : 'late night'; }
  petFacts() {
    const pr = this.projectsAt(0), unc = this.sum(pr, (p) => p.dirty), open = this.openTasks(0);
    const crit = open.filter((t) => t.tier === 'red').length;
    return [unc ? unc + ' files uncommitted.' : 'Every repo is clean.', crit ? crit + ' critical tasks left.' : 'No critical tasks.', 'Last scan ' + this.state.lastScan + '.', 'Drag me somewhere.', 'Press F to focus.', '♪ beep boop'];
  }
  runningCount() {
    const L = this.LIVE;
    // + the scan: its Activity row comes from LIVE.scan (scanStatus), not from localRuns
    return Object.values(L.casts).filter((c) => !c.done).length + L.sessions.filter((x) => x.status === 'running').length + Object.values(L.dev).filter(Boolean).length + this.state.localRuns.filter((r) => r.status === 'running').length + (this.scanStatus().running ? 1 : 0);
  }

  // ---------- actions ----------
  toast(kind, text, o) {
    this._tid = (this._tid || 0) + 1; const id = 'k' + this._tid;
    this.setState((s) => ({ toasts: s.toasts.slice(-3).concat([Object.assign({ id, kind, text }, o || {})]), notifLog: [{ text, kind, at: this.hhmm() }].concat(s.notifLog || []).slice(0, 30) }));
    if (kind !== 'progress') setTimeout(() => this.dismissToast(id), (o && o.ms) || 3600);
    return id;
  }
  dismissToast(id) { this.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); }
  toastRef(id) {
    if (!this._tr[id]) this._tr[id] = (el) => { if (el && !this.state.reduceMotion) el.animate([{ transform: 'translateX(24px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.22,1.4,.36,1)' }); };
    return this._tr[id];
  }
  popIn = (el) => { if (el && !this.state.reduceMotion) el.animate([{ transform: 'translateY(12px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.22,1.3,.36,1)' }); };
  slideIn = (el) => { if (el && !this.state.reduceMotion) el.animate([{ transform: 'translateX(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' }); };
  shimmer = (el) => { if (el) el.animate([{ opacity: 0.4 }, { opacity: 0.9 }, { opacity: 0.4 }], { duration: 1400, iterations: Infinity }); };
  pulse = (el) => { if (el && !this.state.reduceMotion) el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0.35 }, { transform: 'scale(1)', opacity: 1 }], { duration: 1200, iterations: Infinity }); };
  rise = (el) => {
    if (!el || this.state.reduceMotion) return;
    el.querySelectorAll('[data-tower]').forEach((g, i) => g.animate([{ transform: 'translateY(46px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 80 + i * 70, easing: 'cubic-bezier(.22,1.3,.36,1)', fill: 'backwards' }));
  };
  bars = (el) => {
    if (!el || this.state.reduceMotion) return;
    el.querySelectorAll('[data-bar]').forEach((b, i) => b.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 600, delay: i * 60, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' }));
  };
  xpRef = (el) => { this._xpEl = el; };

  go(tab, sub) {
    this.setState((s) => ({ tab, route: null, sub: sub ? Object.assign({}, s.sub, { [tab]: sub }) : s.sub, moreOpen: false, ambientOverlay: false, paletteOpen: false }));
    FX().sfx('tab');
  }
  openProject(id) { if (!id) return; this.setState({ route: { type: 'project', id }, diagTab: 'git', pageMore: false, paletteOpen: false, ambientOverlay: false, journalDraft: '' }); FX().sfx('open'); }
  setSub(sub) { this.setState((s) => ({ sub: Object.assign({}, s.sub, { [s.tab]: sub }) })); FX().sfx('tab'); }
  denied(why) { this.toast('error', why || this.writeReason()); FX().sfx('error'); FX().event('look', 'Can’t do that here.'); }
  notWired(what) { this.toast('info', what + ' isn’t wired in this version yet'); }
  async call(fn, fail) {
    try { const r = await fn(); if (r && r.error) { this.toast('error', (fail || 'Failed') + ' · ' + r.error); return null; } return r; }
    catch (e) { this.toast('error', (fail || 'Failed') + ' · ' + (e && e.message || e)); return null; }
  }

  // A write that makes main reload the window: wait a beat (Undo window), then fire.
  defer(key, fn) {
    clearTimeout((this._pending[key] || {}).timer);
    this._pending[key] = { fn, timer: setTimeout(() => { delete this._pending[key]; fn(); }, WRITE_DELAY) };
  }
  // never drop a confirmed write: if the window goes away inside the Undo window, send it now
  flushPending() { for (const [k, p] of Object.entries(this._pending)) { clearTimeout(p.timer); delete this._pending[k]; try { p.fn(); } catch (e) { console.error(e); } } }
  // task, claude, run, commit, sheet, journal, ask, palette and onboarding
  // actions: src/logic/*.js, mixed into Component.prototype below
  toggleTheme() { this.setState(() => ({ themePref: this.themeName() === 'light' ? 'dark' : 'light', paletteOpen: false })); }
  themeName() { const p = this.state.themePref; if (p === 'os') return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; return p === 'light' ? 'light' : 'dark'; }

  // ---------- shared UI prefs (theme, reduce motion) ----------
  // Main is the source of truth so the satellites follow (hq.uiPrefs; the store
  // keeps the latest in LIVE.uiPrefs). The first time main's prefs arrive, the
  // one-time seed runs (planUiSeed in logic/shared.js); after that every push from
  // main that differs updates the state, and every change made here is sent to
  // main. _uiKnown is what main has or is about to have (last adopted or sent), so
  // an echo of our own change is not sent back and two quick toggles both reach
  // main. Without the bridge none of this runs and the prefs stay local.
  followUiPrefs() {
    const up = this.hq && this.hq.uiPrefs, p = this.LIVE.uiPrefs;
    if (!up || !p || typeof p !== 'object' || p === this._uiSeen) return;
    this._uiSeen = p;
    const main = { theme: THEMES.includes(p.theme) ? p.theme : 'dark', reduceMotion: !!p.reduceMotion };
    let patch = { themePref: main.theme, reduceMotion: main.reduceMotion };
    const first = !this._uiReady;
    this._uiReady = true; this._uiKnown = main;
    if (first && !loadPrefs().uiPrefsSeeded) {
      const plan = planUiSeed(loadPrefs(), main, readV3Prefs());
      savePrefs(Object.assign(loadPrefs(), { uiPrefsSeeded: true }));
      if (plan.push) this.sendUiPrefs(plan.push);
      patch = plan.state;
    }
    const S = this.state, diff = {};
    for (const k of Object.keys(patch)) if (patch[k] !== S[k]) diff[k] = patch[k];
    if (Object.keys(diff).length) this.setState(diff);
    if (first) mirrorV3Theme(this.state.themePref);   // a theme chosen before this build reaches v3's key too
  }
  pushUiPrefs() {
    const up = this.hq && this.hq.uiPrefs, k = this._uiKnown;
    if (!this._uiReady || !k || !up || !up.set) return;
    const S = this.state, patch = {};
    if (S.themePref !== k.theme && THEMES.includes(S.themePref)) patch.theme = S.themePref;
    if (S.reduceMotion !== k.reduceMotion) patch.reduceMotion = !!S.reduceMotion;
    if (Object.keys(patch).length) this.sendUiPrefs(patch);
  }
  sendUiPrefs(patch) {
    const up = this.hq && this.hq.uiPrefs;
    if (!up || !up.set) return;
    this._uiKnown = Object.assign({}, this._uiKnown, patch);
    Promise.resolve().then(() => up.set(patch)).catch((e) => console.warn('[ui-prefs] set failed', e));
  }

  // ---------- deep links (hq:navigate) ----------
  // route = { tab, sub?, projectId?, sort? }, already format-checked by main
  // (dashboard/nav-bridge.js); a tab or sub-tab this build doesn't have is ignored.
  navigateTo(r) {
    if (!r || typeof r !== 'object') return;
    const M = this.M, tab = typeof r.tab === 'string' ? r.tab : '';
    if (!M.NAV.some((n) => n.id === tab)) return;
    const sub = (M.SUBS[tab] || []).some((s) => s[0] === r.sub) ? r.sub : undefined;
    if (r.projectId) {
      // the route's tab first, so the page's Back leads there, not to whatever tab was open
      if (this.proj(r.projectId)) { this.go(tab, sub); this.openProject(r.projectId); }
      else { this.go(tab, sub); this.toast('info', 'That project isn’t in the latest scan'); }
    } else this.go(tab, sub);
    if (['worst', 'dirty', 'recent', 'name'].includes(r.sort)) this.setState({ projSort: r.sort });
  }
  closeTop() {
    const S = this.state;
    // What's new sits over Settings (it opens from there), so it closes first
    // canvasNoteOpen: Escape folds the Canvas ＋ Note form, an in-page form, so after the
    // overlays and only while it is on screen (the flag outlives a tab switch)
    const noteShown = S.canvasNoteOpen && !S.route && S.tab === 'claude' && S.sub && S.sub.claude === 'canvas';
    const order = ['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard', 'vault', 'promote', 'pack', 'run', 'whatsNewOpen', 'cheatOpen', 'settingsOpen', 'paletteOpen', 'scrubOpen', 'moreOpen', 'runsOpen', 'askOpen', 'ambientOverlay', 'focus', 'canvasNoteOpen', 'pageMore'];
    for (const k of order) if (S[k] && (k !== 'canvasNoteOpen' || noteShown)) { if (k === 'focus') this.endFocus(false); else if (k === 'pack') this.rnPackCancel(); else if (k === 'run') this.rnClose(); else this.setState({ [k]: ['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard', 'vault', 'promote'].includes(k) ? null : false }); return; }
    if (S.route) this.setState({ route: null });
  }
  onKey(e) {
    const S = this.state, tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.setState({ paletteOpen: !S.paletteOpen, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); FX().sfx('open'); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.closeTop(); return; }
    if (S.paletteOpen) {
      if (e.key === 'Tab') { e.preventDefault(); if (S.paletteMode === 'go') this.warmModel(); this.setState({ paletteMode: S.paletteMode === 'go' ? 'ask' : 'go' }); return; }
      if (S.paletteMode === 'go') {
        const P = this.paletteItems();
        if (e.key === 'ArrowDown') { e.preventDefault(); this.setState({ paletteSel: Math.min(P.count - 1, S.paletteSel + 1) }); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.setState({ paletteSel: Math.max(0, S.paletteSel - 1) }); return; }
        if (e.key === 'Enter') { e.preventDefault(); const it = P.flat[S.paletteSel]; if (it) { this.setState({ paletteOpen: false }); it.run(); } return; }
      } else if (e.key === 'Enter') { e.preventDefault(); this.submitAsk(S.paletteQuery); return; }
      return;
    }
    if (S.confirm && e.key === 'Enter' && !typing && this.confirmKey(e)) return;
    if (typing) return;
    if (S.levelUp || S.sheet || S.commit || S.confirm || S.settingsOpen || S.cheatOpen || S.onboard || S.whatsNewOpen || S.vault) return;
    if (e.key === '/') { e.preventDefault(); this.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); return; }
    if (e.key === '?') { this.setState({ cheatOpen: true }); return; }
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) { this.go(this.M.NAV[+e.key - 1].id); return; }
    if (e.key === 'f' || e.key === 'F') { this.toggleFocus(); return; }
    if (e.key === 'ArrowLeft') { this.setState((s) => ({ snapOffset: Math.min(this.M.maxOff, s.snapOffset + 1) })); return; }
    if (e.key === 'ArrowRight') { this.setState((s) => ({ snapOffset: Math.max(0, s.snapOffset - 1) })); return; }
  }
  copy(text, msg) {
    const done = () => this.toast('success', msg || 'Copied');
    try { navigator.clipboard.writeText(String(text || '')).then(done, () => this.toast('error', 'Clipboard unavailable')); } catch { this.toast('error', 'Clipboard unavailable'); }
  }
}
Object.assign(Component.prototype, tasksLogic, claudeLogic, claudeLibLogic, claudeChatLogic, claudeImportLogic, runsLogic, commitLogic, sheetLogic, journalLogic, askLogic, paletteLogic, onboardLogic,
  whatsNewLogic, systemLogic, libraryLogic, studioLogic, projectLogic, claudeVaultLogic, claudeImportsLogic, promptsLogic, candidatesLogic, runLogic, githubLogic, accountsLogic);
Component.prototype.renderVals = renderVals;
