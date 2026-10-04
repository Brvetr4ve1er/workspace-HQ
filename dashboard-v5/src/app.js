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
import { DCLogic, createRef } from './dc/runtime.js';
import { moreVals } from './app-more.js';
import { renderVals } from './app-vals.js';

const FX = () => window.HQFx || { sfx() {}, burst() {}, coinFly() { return Promise.resolve(); }, event() {}, say() {}, set() {}, init() {}, destroy() {}, floatText() {}, asciiBurst() {} };
const PREFS = 'whq3-prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} };
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const WRITE_DELAY = 1600;   // ms before a reloading write fires (Undo window)

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
    return {
      tab: saved.tab || this.props.startTab || 'home',
      sub: Object.assign({ projects: 'grid', tasks: 'ranked', automations: 'runnable', claude: 'sessions', history: 'trends', system: 'machine', life: 'screen' }, saved.sub || {}),
      route: saved.route || null, snapOffset: Math.min(M.maxOff, saved.snapOffset || 0),
      themePref: P.themePref || this.props.theme || 'dark', sound: P.sound !== false, petOn: P.petOn != null ? P.petOn : this.props.pet !== false,
      ambientPref: P.ambientPref !== false, reduceMotion: !!P.reduceMotion, notifyMeasured: P.notifyMeasured !== false,
      vw: window.innerWidth, completed: [], recentDone: [], dismissed: P.dismissed || [], xp: a.xp, displayXp: a.xp, committed: {},
      trusted: P.trusted || [], pinned: P.pinned || M.AUTOS.slice(0, 3).map((x) => x.id),
      scrubOpen: false, paletteOpen: false, paletteMode: 'go', paletteQuery: '', paletteSel: 0, askOpen: false, askHistory: saved.ask || [], askDraft: '',
      runsOpen: false, localRuns: [], expandedRun: null, settingsOpen: false, cheatOpen: false, ambientOverlay: false, moreOpen: false,
      focus: saved.focus || null, now: Date.now(), confirm: null, confirmAsk: 'always', commit: null, sheet: null, levelUp: null, toasts: [], refreshing: false,
      lastScan: scanAt && !isNaN(scanAt) ? (scanAt.toDateString() === new Date().toDateString() ? '' : M.fmtD(scanAt) + ' ') + hhmm(scanAt) : (M.at(0).id || '—'),
      projSort: 'worst', taskFilter: 'all', hoverProj: null, diagTab: 'git', pageMore: false,
      journalAdds: {}, journalDraft: '', journalKind: 'note', autoQuery: '', trendRange: 30, lifeRange: 'window', lightbox: null, studioFilter: 'all',
      recapOpen: false, recapDismissed: P.recapSeen === (M.weeklyRecap && M.weeklyRecap.week_end), sessionSel: null, composer: '', composerProj: (M.P0[0] || {}).id || null,
      momentum: 'unc', fixed: [], sinceDismissed: P.sinceSeen === M.at(0).id, actTab: 'runs', compareOff: null, commitSel: 0, onboard: null, notifLog: [],
    };
  }

  componentDidMount() {
    this._prev = Object.assign({}, this.state, { sub: Object.assign({}, this.state.sub) }); this._prevProps = Object.assign({}, this.props);
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
    // live data → re-render; finished runs → one toast each
    this._offStore = this.store.on(() => { this.announceRuns(); this.forceUpdate(); });
    this.store.start();
    if (this.hq && this.hq.studio && this.hq.studio.onOpenRealm) this._offRealm = this.hq.studio.onOpenRealm(() => this.go('studio'));   // Ctrl+Alt+L
    this._onHide = () => this.flushPending(); window.addEventListener('pagehide', this._onHide);
    if (this.hq && this.hq.llm && this.hq.llm.onDelta) this._offDelta = this.hq.llm.onDelta((d) => this.onAskDelta(d));
    this.maybeLevelUp();
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._onKey); window.removeEventListener('resize', this._onResize); if (this._ro) this._ro.disconnect(); clearInterval(this._wT); (this._mq || []).forEach(([m, h]) => m.removeEventListener('change', h));
    clearInterval(this._focusT); FX().destroy();
    if (this._offStore) this._offStore(); if (this._offRealm) this._offRealm(); if (this._offDelta) this._offDelta(); this.store.stop();
    this.flushPending(); window.removeEventListener('pagehide', this._onHide);
  }
  componentDidUpdate() {
    const S = this.state;
    const ps = this._prev || S;
    this._prev = Object.assign({}, S, { sub: Object.assign({}, S.sub) }); this._prevProps = Object.assign({}, this.props);
    try { sessionStorage.setItem('whq3-place', JSON.stringify({ tab: S.tab, sub: S.sub, route: S.route, snapOffset: S.snapOffset, focus: S.focus, ask: S.askHistory.filter((h) => h.a && h.a.status !== 'thinking').slice(-12) })); } catch (e) {}
    if (['themePref', 'sound', 'petOn', 'ambientPref', 'reduceMotion', 'notifyMeasured', 'pinned', 'trusted', 'dismissed', 'recapDismissed', 'sinceDismissed'].some((k) => ps[k] !== S[k])) {
      const P = loadPrefs();
      savePrefs(Object.assign(P, { themePref: S.themePref, sound: S.sound, petOn: S.petOn, ambientPref: S.ambientPref, reduceMotion: S.reduceMotion, notifyMeasured: S.notifyMeasured, pinned: S.pinned, trusted: S.trusted, dismissed: S.dismissed.slice(-200),
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
    return Object.values(L.casts).filter((c) => !c.done).length + L.sessions.filter((x) => x.status === 'running').length + Object.values(L.dev).filter(Boolean).length + this.state.localRuns.filter((r) => r.status === 'running').length;
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
  completeTask(id, e) {
    if (!this.canWrite()) return this.denied();
    const t = this.M.T0.find((x) => x.id === id); if (!t || this.state.completed.includes(id)) return;
    const p = this.pt(e);
    this.setState((s) => ({ completed: s.completed.concat([id]), recentDone: s.recentDone.concat([id]), focus: s.focus && s.focus.taskId === id ? null : s.focus }));
    setTimeout(() => this.setState((s) => ({ recentDone: s.recentDone.filter((x) => x !== id) })), 1500);
    FX().sfx('done'); FX().floatText(p.x, p.y - 10, '+' + t.xp + ' xp'); FX().asciiBurst && FX().asciiBurst(p.x, p.y, '✓');
    FX().event('cheer', 'Nice. +' + t.xp + ' xp');
    this.toast('success', 'Done · ' + t.title, { undo: id });
    FX().coinFly(p.x, p.y, this._xpEl).then(() => this.gainXp(t.xp));
    this.defer('done:' + id, () => {
      this.hq.actedOn && this.hq.actedOn({ kind: 'quest', action_id: id, project_id: t.proj, resolved: true, marked_done: true, via: 'board' });
      this.call(() => this.hq.markQuestDone(id), 'Couldn’t save');   // main re-assembles today and reloads
    });
  }
  undoTask(id) {
    const p = this._pending['done:' + id];
    const t = this.M.T0.find((x) => x.id === id) || this.M.IDEAS.find((x) => x.id === id);
    if (!p) { this.toast('info', 'Already saved · it can’t be undone from here'); return; }
    clearTimeout(p.timer); delete this._pending['done:' + id];
    const xp = (t && t.xp) || 0;
    this.setState((s) => ({ completed: s.completed.filter((x) => x !== id), xp: s.xp - xp, displayXp: s.xp - xp, toasts: s.toasts.filter((k) => k.undo !== id) }));
    this.toast('info', 'Restored · ' + (t ? t.title : 'task'));
  }
  gainXp(n) {
    const from = this.state.xp, to = from + n, L0 = this.M.levelOf(from), L1 = this.M.levelOf(to);
    this.setState({ xp: to });
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 650); this.setState({ displayXp: Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))) }); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    if (this._xpEl && !this.state.reduceMotion) this._xpEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.22,1.6,.36,1)' });
    if (L1.l > L0.l) setTimeout(() => this.showLevelUp(L1), 450);
  }
  showLevelUp(L) { this.setState({ levelUp: { l: L.l, t: L.t } }); FX().sfx('level'); FX().asciiBurst && FX().asciiBurst(innerWidth / 2, innerHeight * 0.35, 'level ' + L.l); FX().event('cheer', 'Level ' + L.l + '!', 2600); }
  // the scan that just landed carries a level_up the user hasn't seen → celebrate once
  maybeLevelUp() {
    const s = this.M.at(0), ch = s.changes.find((c) => c.type === 'level_up');
    if (!ch || this.ps() !== 'live') return;
    const P = loadPrefs(); if (P.levelSeen === s.id) return;
    savePrefs(Object.assign(P, { levelSeen: s.id }));
    setTimeout(() => this.showLevelUp(this.M.levelOf(s.account.xp)), 1200);
  }
  startFocus(id) { this.setState({ focus: { taskId: id, start: Date.now() }, now: Date.now(), paletteOpen: false }); FX().sfx('open'); FX().event('look', 'Focus mode. Shh.'); }
  endFocus(note) {
    const f = this.state.focus; if (!f) return;
    const secs = Math.round((Date.now() - f.start) / 1000), t = this.M.T0.find((x) => x.id === f.taskId);
    if (t && this.hq && this.hq.actedOn && secs >= 5) this.hq.actedOn({ kind: 'quest', action_id: t.id, project_id: t.proj, seconds: secs, resolved: false, via: 'focus' });
    this.setState({ focus: null });
    if (note) this.toast('info', 'Focus stopped · ' + Math.max(1, Math.round(secs / 60)) + ' min');
  }
  toggleFocus() {
    if (this.state.focus) return this.endFocus(false);
    const t = this.openTasks(this.state.snapOffset)[0]; this.startFocus(t ? t.id : null);
  }
  sendClaude(title, proj) {
    if (!this.canWrite()) return this.denied();
    this.setState((s) => ({ tab: 'claude', route: null, sub: Object.assign({}, s.sub, { claude: 'sessions' }), composer: title, composerProj: proj || s.composerProj, focus: null }));
    this.toast('info', 'Session drafted · review it, then Run (uses Claude quota)');
  }
  async startSession() {
    if (!this.canWrite()) return this.denied();
    const txt = (this.state.composer || '').trim(); if (!txt) return;
    const p = this.proj(this.state.composerProj);
    if (!p || !this.hq.sessionStart) return this.denied('Pick a project first');
    const r = await this.call(() => this.hq.sessionStart({ cwd: p.path, task: txt, label: txt.slice(0, 60) }), 'Session didn’t start');
    if (!r || !r.jobId) return;
    this.setState({ sessionSel: r.jobId, composer: '' });
    FX().sfx('run'); FX().event('look', 'Claude is on it.');
    this.toast('info', 'Session started in ' + p.name + ' · output streams here');
  }
  // ---- automations (casting engine: confirm-first is enforced in main too) ----
  auto(id) { return this.M.AUTOS.find((x) => x.id === id) || null; }
  askRun(a) {
    if (!a) return;
    if (!this.canWrite()) return this.denied();
    if (this.state.trusted.includes(a.id) && !a.destructive && this.M.confirmedHashes[a.id] === a.hash) return this.startRun(a);
    this.setState({ confirm: a.id, confirmAsk: this.state.trusted.includes(a.id) ? 'never' : 'always', paletteOpen: false }); FX().sfx('open');
  }
  confirmRun() {
    const a = this.auto(this.state.confirm); if (!a) return this.setState({ confirm: null });
    this.setState((s) => ({ confirm: null, trusted: s.confirmAsk === 'never' ? (s.trusted.includes(a.id) ? s.trusted : s.trusted.concat([a.id])) : s.trusted.filter((x) => x !== a.id) }));
    this.startRun(a, a.hash);
  }
  async startRun(a, hash) {
    if (!this.hq || !this.hq.castSpell) return this.denied();
    const r = await this.call(() => this.hq.castSpell(a.id, hash), 'Run failed');
    if (!r) return;
    if (r.confirm_required) { this.setState({ confirm: a.id, confirmAsk: 'always' }); this.toast('info', 'This command changed since you last ran it · check it, then run'); return; }
    if (r.channeled) { this.setState((s) => ({ localRuns: [{ id: 't' + Date.now(), name: a.name, status: 'opened', meta: 'Terminal opened · ' + a.cmd, started: this.hhmm(), out: ['Opened in an external terminal; output stays there.'] }].concat(s.localRuns) })); this.toast('info', 'Terminal opened · ' + a.name); return; }
    this.toast('progress', 'Running · ' + a.name, { runSpell: a.id });
    FX().sfx('run'); FX().event('look', 'Watching ' + a.name.toLowerCase() + '…');
  }
  announceRuns() {
    for (const c of Object.values(this.LIVE.casts)) {
      if (!c.done || c.announced) continue;
      c.announced = true;
      this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== c.spellId) }));
      if (c.status === 'ok') { this.toast('success', c.name + ' finished'); FX().sfx('done'); FX().event('cheer', 'Run finished.'); }
      else { this.toast('error', c.name + ' failed · ' + (c.meta || '')); FX().sfx('error'); }
    }
  }
  cancelRun(spellId) {
    if (!spellId || !this.hq || !this.hq.cancelCast) return;
    this.hq.cancelCast(spellId);
    this.setState((s) => ({ toasts: s.toasts.filter((t) => t.runSpell !== spellId) }));
    this.toast('info', 'Cancelling…');
  }
  stopDev(id) { if (this.hq && this.hq.devStop) { this.hq.devStop(id); this.toast('info', 'Dev server stopped · ' + this.pname(id)); } }
  scanNow() {
    if (!this.canWrite()) return this.denied();
    this.setState((s) => ({ paletteOpen: false, localRuns: [{ id: 'scan', kind: 'scan', name: 'Full scan', status: 'running', meta: 'run-pipeline.ps1 · the window reloads when it finishes', started: this.hhmm(), out: [] }].concat(s.localRuns.filter((r) => r.id !== 'scan')) }));
    this.hq.runScan();
    this.toast('progress', 'Scanning every project · the window reloads when it’s done', { scan: true });
    FX().sfx('run'); FX().event('look', 'Scanning…');
  }
  // ---- commit: real changed files + a local-model draft --------------------
  async openCommit(pid) {
    if (!this.canWrite()) return this.denied();
    const p = this.projectsAt(0).find((x) => x.id === pid); if (!p || !p.dirty) return;
    this.setState({ commit: { pid, files: [], stat: '', loading: true, msg: '', drafted: 'Drafting with the local model…' }, commitSel: 0, paletteOpen: false }); FX().sfx('open');
    const diff = this.hq.sessionDiff ? await this.call(() => this.hq.sessionDiff({ cwd: p.path }), 'Couldn’t read changes') : null;
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    const files = diff && Array.isArray(diff.files) ? diff.files.map((f) => ({ name: f.path, st: /\?|A/.test(f.status) ? 'new' : /D/.test(f.status) ? 'del' : 'mod', on: true })) : [];
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { files, stat: (diff && diff.stat) || '', loading: false }) }));
    const d = await this.call(() => this.hq.draftCommit(p.path), 'No draft');
    if (!this.state.commit || this.state.commit.pid !== pid) return;
    this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: s.commit.msg || (d && d.message) || '', drafted: d && d.message ? (String(d.via || '').startsWith('local') ? 'Drafted by the local model · edit before committing' : 'Drafted by Claude (used quota) · edit before committing') : 'No draft · write the message yourself' }) }));
  }
  async doCommit() {
    const c = this.state.commit; if (!c || c.loading) return;
    const p = this.proj(c.pid), msg = (c.msg || '').trim();
    if (!p || !msg) return this.denied('Write a commit message first');
    if (c.files.some((f) => /(^|\/)\.env(\.|$)/.test(f.name))) return this.denied('A .env file would be committed · add it to .gitignore first');
    const r = await this.call(() => this.hq.doCommit(p.path, msg), 'Commit failed');
    if (!r) return;
    this.setState((s) => ({ commit: null, committed: Object.assign({}, s.committed, { [c.pid]: true }) }));
    this.toast('success', 'Committed ' + c.files.length + ' files to ' + p.branch + ' · ' + p.name + ' · re-scanning');
    FX().sfx('done'); FX().event('cheer', 'Saved!'); FX().asciiBurst && FX().asciiBurst(innerWidth / 2, innerHeight / 2, p.name.toLowerCase() + ' · clean');
  }
  sheet(o) { this.setState({ sheet: o }); FX().sfx('open'); }
  async sheetOk() {
    const s = this.state.sheet; if (!s) return; this.setState({ sheet: null });
    if (s.act === 'archive') { this.toast('success', 'Archiving ' + this.pname(s.id) + ' · restore it from Projects › Archived'); this.defer('archive:' + s.id, () => this.call(() => this.hq.archiveProject(s.id), 'Archive failed')); }
    if (s.act === 'delete') { const r = await this.call(() => this.hq.studio.libraryDelete(s.path), 'Delete failed'); if (r !== null) { this.setState({ lightbox: null }); this.toast('success', 'Moved to the Recycle Bin · ' + s.name); this.store.refreshCaptures(); } }
  }
  async addJournal() {
    if (!this.canWrite()) return this.denied();
    const txt = this.state.journalDraft.trim(); const pid = this.state.route && this.state.route.id; if (!txt || !pid) return;
    const kind = this.state.journalKind;
    const fn = kind === 'learning' ? () => this.hq.learn(pid, txt) : kind === 'decision' ? () => this.hq.logDecision(pid, txt) : () => this.hq.saveNote(pid, txt);
    const ok = await this.call(fn, 'Not saved');
    if (!ok) return;
    this.setState((s) => ({ journalAdds: Object.assign({}, s.journalAdds, { [pid]: [{ k: kind, t: txt, d: 'Today' }].concat(s.journalAdds[pid] || []) }), journalDraft: '' }));
    this.toast('success', kind === 'decision' ? 'Decision logged in the project’s vault note' : kind === 'learning' ? 'Learning saved · +knowledge xp' : 'Note saved · mirrored to the vault');
    FX().event('cheer', 'Noted.');
  }
  doIdea(i, e) {
    if (!this.canWrite()) return this.denied();
    if (i.purge) {
      const p = this.proj(i.proj);
      if (!p || !i.fatDirs.length) return this.denied('Nothing purgeable listed for this project');
      return this.call(() => this.hq.reclaim(p.path, i.fatDirs), 'Purge failed');   // main asks to confirm, deletes, then re-scans
    }
    const pt = this.pt(e); FX().floatText(pt.x, pt.y - 10, 'done');
    this.setState((s) => ({ completed: s.completed.concat([i.id]) })); this.toast('success', 'Marked done · ' + i.title, { ms: 3000, undo: i.id }); FX().sfx('done');
    this.defer('done:' + i.id, () => this.call(() => this.hq.markQuestDone(i.id), 'Couldn’t save'));
  }
  // ---- Ask: the local model only; answers stay in this panel ----------------
  submitAsk(q) {
    q = (q || '').trim(); if (!q) return;
    const S = this.state, live = this.LIVE.llm;
    const entry = { q, id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), a: { text: '', src: [], est: false, status: 'thinking' } };
    const refuse = (text) => { entry.a = { text, src: [], est: false, refusal: true, status: 'done' }; };
    if (S.snapOffset > 0) refuse('Ask only reads today’s data. Go back to live to ask about it.');
    else if (!this.hq || !this.hq.llm) refuse('Ask runs on the local model inside the app; this window has no app bridge.');
    else if (live && (!live.available || !live.chatModel)) refuse(live.available ? 'No local chat model is installed. Pull one with Ollama, then retry.' : 'The local model runtime isn’t running. Start Ollama, then ask again.');
    this.setState((s) => ({ askHistory: s.askHistory.concat([entry]).slice(-20), askOpen: true, paletteOpen: false, askDraft: '', paletteQuery: '', runsOpen: false }));
    FX().sfx('open');
    if (entry.a.status === 'thinking') this.runAsk(entry);
  }
  async runAsk(entry) {
    const prior = this.state.askHistory.filter((h) => h.id !== entry.id && h.a && h.a.status === 'done' && !h.a.refusal).slice(-4);
    const messages = prior.flatMap((h) => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a.text }]).concat([{ role: 'user', content: entry.q }]);
    let r;
    try { r = await this.hq.llm.chat({ jobId: entry.id, messages, include: { scan: true, tasks: true, projects: true } }); }
    catch (e) { r = { status: 'error', reason: String(e && e.message || e) }; }
    const src = (r && r.sections || []).filter((x) => x.chars > 0).map((x) => x.label + (x.clipped ? ' (clipped)' : ''));
    this.patchAsk(entry.id, r && r.status === 'done'
      ? { text: String(r.output || '').trim() || '(empty answer)', src: src.concat([(r.model || 'local model') + ' · ' + Math.round((r.ms || 0) / 100) / 10 + 's']), est: true, status: 'done' }
      : { text: r && r.status === 'cancelled' ? 'Stopped.' : 'The local model didn’t answer · ' + ((r && (r.reason || r.output)) || 'unknown error'), src: [], refusal: true, status: 'done' });
  }
  onAskDelta(d) { if (d && d.jobId) this.patchAsk(d.jobId, { text: String(d.text || ''), status: 'thinking' }, true); }
  patchAsk(id, a, partial) {
    this.setState((s) => ({ askHistory: s.askHistory.map((h) => (h.id === id && (!partial || h.a.status === 'thinking') ? Object.assign({}, h, { a: Object.assign({}, h.a, a) }) : h)) }));
  }
  paletteItems() {
    const S = this.state, q = S.paletteQuery.trim().toLowerCase(), M = this.M, NAV = M.NAV;
    const g = [];
    const vm = q.match(/^(commit|open|run|focus|theme|go)\s+(.+)$/), doItems = [];
    if (vm) {
      const verb = vm[1], arg = vm[2].trim();
      if (verb === 'commit' || verb === 'open') this.projectsAt(0).filter((p) => p.name.toLowerCase().includes(arg) || p.id === arg).forEach((p) => doItems.push({ glyph: '›', label: (verb === 'commit' ? 'Commit ' : 'Open ') + p.name, hint: verb === 'commit' ? (p.dirty || 0) + ' files' : 'project page', run: () => (verb === 'commit' ? this.openCommit(p.id) : this.openProject(p.id)) }));
      if (verb === 'run') M.AUTOS.filter((a) => a.name.toLowerCase().includes(arg)).forEach((a) => doItems.push({ glyph: '›', label: 'Run ' + a.name, hint: 'confirm first', run: () => this.askRun(a) }));
      if (verb === 'focus') this.openTasks(0).filter((t) => t.title.toLowerCase().includes(arg)).forEach((t) => doItems.push({ glyph: '›', label: 'Focus · ' + t.title, hint: 'F', run: () => this.startFocus(t.id) }));
      if (verb === 'theme') ['dark', 'light', 'os'].filter((x) => x.startsWith(arg)).forEach((x) => doItems.push({ glyph: '›', label: 'Theme · ' + x, hint: '', run: () => this.setState({ themePref: x }) }));
      if (verb === 'go') NAV.filter((n) => n.label.toLowerCase().startsWith(arg)).forEach((n) => doItems.push({ glyph: '›', label: 'Go to ' + n.label, hint: '', run: () => this.go(n.id) }));
    }
    if (doItems.length) g.push(['Do', doItems]);
    const go = NAV.map((n, i) => ({ glyph: n.glyph, label: n.label, hint: String(i + 1), run: () => this.go(n.id) }));
    [['Map', 'projects', 'map'], ['Archived projects', 'projects', 'archived'], ['Ideas & risks', 'tasks', 'ideas'], ['Library', 'automations', 'library'], ['Canvas', 'claude', 'canvas'], ['Sessions', 'claude', 'sessions'], ['Timeline', 'history', 'timeline'], ['Milestones', 'history', 'milestones'], ['Workspace clutter', 'system', 'clutter'], ['Screen time', 'life', 'screen'], ['Social', 'life', 'social'], ['Notes', 'life', 'notes']].forEach((a) => go.push({ glyph: '↳', label: a[0], hint: NAV.find((n) => n.id === a[1]).label, run: () => this.go(a[1], a[2]) }));
    g.push(['Go to', go]);
    g.push(['Projects', this.projectsAt(0).map((p) => ({ glyph: '▦', label: p.name, hint: p.reason, run: () => this.openProject(p.id) }))]);
    g.push(['Tasks', this.openTasks(0).map((t) => ({ glyph: '◎', label: t.title, hint: 'Focus', run: () => this.startFocus(t.id) }))]);
    g.push(['Automations', M.AUTOS.map((a) => ({ glyph: a.icon, label: 'Run ' + a.name, hint: 'background', run: () => this.askRun(a) }))]);
    const cmds = [
      { glyph: '⟳', label: 'Scan now', hint: 'uses Claude quota', run: () => this.scanNow() },
      { glyph: '◎', label: 'Start focus', hint: 'F', run: () => this.toggleFocus() },
      { glyph: '◐', label: 'Toggle light / dark', hint: '', run: () => this.toggleTheme() },
      { glyph: '♥', label: S.petOn ? 'Hide Bit' : 'Show Bit', hint: 'pet', run: () => this.setState({ petOn: !S.petOn, paletteOpen: false }) },
      { glyph: '⚙', label: 'Settings', hint: '', run: () => this.setState({ settingsOpen: true, paletteOpen: false }) },
      { glyph: '?', label: 'Keyboard shortcuts', hint: '?', run: () => this.setState({ cheatOpen: true, paletteOpen: false }) },
      { glyph: '≡', label: 'Activity & runs', hint: '', run: () => this.setState({ runsOpen: true, paletteOpen: false }) },
    ];
    if (S.snapOffset) cmds.unshift({ glyph: '●', label: 'Back to live', hint: '', run: () => this.setState({ snapOffset: 0, paletteOpen: false }) });
    g.push(['Commands', cmds]);
    let idx = 0; const out = [];
    g.forEach(([name, items]) => {
      const f = name === 'Do' ? items.slice(0, 8) : items.filter((it) => !q || it.label.toLowerCase().includes(q) || (it.hint || '').toLowerCase().includes(q)).slice(0, q ? 8 : (name === 'Go to' ? 9 : 4));
      if (!f.length) return;
      out.push({ name, items: f.map((it) => { const my = idx++; return Object.assign({}, it, { active: my === S.paletteSel, idx: my }); }) });
    });
    return { groups: out, count: idx, flat: out.reduce((a, gr) => a.concat(gr.items), []) };
  }
  toggleTheme() { this.setState(() => ({ themePref: this.themeName() === 'light' ? 'dark' : 'light', paletteOpen: false })); }
  themeName() { const p = this.state.themePref; if (p === 'os') return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; return p === 'light' ? 'light' : 'dark'; }
  closeTop() {
    const S = this.state;
    const order = ['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard', 'cheatOpen', 'settingsOpen', 'paletteOpen', 'scrubOpen', 'moreOpen', 'runsOpen', 'askOpen', 'ambientOverlay', 'focus', 'pageMore'];
    for (const k of order) if (S[k]) { if (k === 'focus') this.endFocus(false); else this.setState({ [k]: ['levelUp', 'sheet', 'commit', 'confirm', 'lightbox', 'onboard'].includes(k) ? null : false }); return; }
    if (S.route) this.setState({ route: null });
  }
  onKey(e) {
    const S = this.state, tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.setState({ paletteOpen: !S.paletteOpen, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); FX().sfx('open'); return; }
    if (e.key === 'Escape') { e.preventDefault(); this.closeTop(); return; }
    if (S.paletteOpen) {
      if (e.key === 'Tab') { e.preventDefault(); this.setState({ paletteMode: S.paletteMode === 'go' ? 'ask' : 'go' }); return; }
      if (S.paletteMode === 'go') {
        const P = this.paletteItems();
        if (e.key === 'ArrowDown') { e.preventDefault(); this.setState({ paletteSel: Math.min(P.count - 1, S.paletteSel + 1) }); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.setState({ paletteSel: Math.max(0, S.paletteSel - 1) }); return; }
        if (e.key === 'Enter') { e.preventDefault(); const it = P.flat[S.paletteSel]; if (it) { this.setState({ paletteOpen: false }); it.run(); } return; }
      } else if (e.key === 'Enter') { e.preventDefault(); this.submitAsk(S.paletteQuery); return; }
      return;
    }
    if (S.confirm && e.key === 'Enter' && !typing) { e.preventDefault(); this.confirmRun(); return; }
    if (typing) return;
    if (S.levelUp || S.sheet || S.commit || S.confirm || S.settingsOpen || S.cheatOpen || S.onboard) return;
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
  obSet(k, e) { const val = e.target.value; this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { [k]: val }) })); }
  // Tracked projects live in collector/collector.config.json (structure lane);
  // there is no app channel to add one yet, so the last step hands over a
  // ready-to-paste entry instead of pretending it was added.
  finishOnboard() {
    const o = this.state.onboard; if (!o) return;
    const name = (o.name || '').trim() || (o.path || '').split(/[\\/]/).filter(Boolean).pop() || 'new-project';
    const entry = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, path: o.path, dev_cmd: o.dev || null, canonical_branch: o.branch || 'main' };
    this.copy(JSON.stringify(entry, null, 2), 'Copied the project entry · paste it into collector.config.json, then Scan now');
    this.setState({ onboard: null });
  }
}
Component.prototype.moreVals = moreVals;
Component.prototype.renderVals = renderVals;
