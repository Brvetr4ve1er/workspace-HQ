// makeCtx(): what several surfaces of renderVals() share, built once per render
// (src/vals/index.js) and passed to every src/vals/<surface>.js. Each value is the
// local of the same name from the pre-split renderVals() in app-vals.js; `ro` is
// from moreVals() in app-more.js (both removed in the split; see a8e0bf1).
export function makeCtx() {
  const S = this.state, H = this.M, LIVE = this.LIVE;
  const w = document.documentElement.clientWidth || window.innerWidth; this._lastW = w;
  const off = S.snapOffset, live = off === 0, ps = this.ps();
  const cantWrite = !this.canWrite(), writeReason = this.writeReason();
  const snap = H.at(off), viewed = H.dayAt(off), viewedLabel = H.fmtD(viewed);
  const projects = this.projectsAt(off), tasks = this.tasksAt(off), open = tasks.filter((t) => !S.recentDone.includes(t.id));
  const unc = this.sum(projects, (p) => p.dirty), unp = projects.filter((p) => p.ahead > 0).length, sec = this.sum(projects, (p) => p.secrets);
  const level = H.levelOf(this.xpAt(off));
  const L = { sideRail: w >= 720, railLabels: w >= 1240, bottomNav: w < 720, wordmark: w >= 900, signals: w >= 1100, signalCompact: w >= 480 && w < 1100, signalLabels: w >= 1600, scanText: w >= 1240, searchText: w >= 1160, levelText: w >= 1100, extras: w >= 720, wide: w >= 1000 };
  const ambientDocked = S.ambientPref && w >= 1320;
  const v0 = { loading: ps === 'loading', error: ps === 'error' || !H.hasData };
  const ok = !v0.loading && !v0.error;
  const onPage = !!S.route;
  const v = Object.assign(v0, {
    home: ok && !onPage && S.tab === 'home', projects: ok && !onPage && S.tab === 'projects', project: ok && onPage, tasks: ok && !onPage && S.tab === 'tasks',
    automations: ok && !onPage && S.tab === 'automations', claude: ok && !onPage && S.tab === 'claude', history: ok && !onPage && S.tab === 'history',
    system: ok && !onPage && S.tab === 'system', life: ok && !onPage && S.tab === 'life',
  });
  v.stdHeader = ok && !onPage && S.tab !== 'home';
  const sub = S.sub[S.tab];
  const subs = H.SUBS[S.tab] || [];
  const tabStyle = (a) => ({ height: 30, padding: '0 12px', cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 13, borderRadius: 8, background: a ? 'color-mix(in oklab, var(--gold) 14%, transparent)' : 'transparent', color: a ? 'var(--accent-text)' : 'var(--muted)', border: '1px solid ' + (a ? 'color-mix(in oklab, var(--gold) 55%, transparent)' : 'transparent'), transition: 'background .15s, color .15s, border-color .15s' });
  // row builders shared by home, projects, tasks, focus, the status rail and the project page
  const TR = H.TIER;
  const tk = (t) => ({ title: t.title, why: t.why, proj: this.pname(t.proj), xp: t.xp, tier: TR[t.tier].label, color: TR[t.tier].color, focus: () => this.startFocus(t.id), done: (e) => this.completeTask(t.id, e), open: () => (t.proj ? this.openProject(t.proj) : this.go('tasks')) });
  const rows = projects.slice().sort((a, b) => H.ST[a.st].rank - H.ST[b.st].rank || b.pct - a.pct);
  const chipsOf = (p) => {
    const c = [];
    if (!p.hasGit) c.push({ text: 'no git', color: 'var(--red)' });
    if (p.dirty) c.push({ text: p.dirty + ' dirty', color: 'var(--orange)' });
    if (p.ahead) c.push({ text: '↑' + p.ahead + ' unpushed', color: 'var(--orange)' });
    if (p.secrets) c.push({ text: '⚿ ' + p.secrets + ' secret' + (p.secrets > 1 ? 's' : ''), color: 'var(--red)' });
    if (p.hasGit && p.branch !== p.canonical) c.push({ text: '⑂ ' + p.branch, color: 'var(--orange)' });
    if (!c.length) c.push({ text: 'clean', color: 'var(--green)' });
    return c;
  };
  const actText = (p) => (p.activity === 'active' ? (p.lastDays === 0 ? 'Active today' : p.lastDays == null ? 'Active · no commits' : 'Active · ' + p.lastDays + 'd') : (p.activity === 'stale' ? 'Stale · ' : 'Dormant · ') + (p.lastDays == null ? '?' : p.lastDays + 'd'));
  const devOn = (id) => live && !!LIVE.dev[id];
  const rowOf = (p) => ({ id: p.id, name: p.name, reason: p.reason, reasonColor: p.st === 'ok' ? 'var(--muted)' : H.ST[p.st].color, color: H.ST[p.st].color, tag: H.ST[p.st].label, tone: H.ST[p.st].tone, chips: chipsOf(p), pct: p.pct, stack: p.stack.join(' · '), activity: actText(p), devOn: devOn(p.id), alive: live && p.activity === 'active', port: p.port || '', open: () => this.openProject(p.id) });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const top = open[0];
  // tasks filters + the Tasks screen header
  const tierCount = (k) => open.filter((t) => t.tier === k).length;
  // toast colours, also used by the notifications list
  const TK = { success: 'var(--green)', error: 'var(--red)', info: 'var(--blue)', progress: 'var(--gold)' };
  // read-only guard for claude / system actions
  const ro = () => { if (!this.canWrite()) { this.denied(); return true; } return false; };
  return {
    S, H, LIVE, w, off, live, ps, cantWrite, writeReason, snap, viewed, viewedLabel, projects, tasks, open, unc, unp, sec, level, L, ambientDocked,
    v, ok, onPage, sub, subs, tabStyle, TR, tk, rows, chipsOf, actText, devOn, rowOf, plural, top, tierCount, TK, ro,
  };
}
