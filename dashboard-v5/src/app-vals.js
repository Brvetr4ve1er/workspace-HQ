// renderVals(): the flat object the template binds against. Names, shapes and
// styles follow the Claude Design prototype; values come from the snapshot at
// the time-machine offset (state.snapOffset) and the live store.
const FX = () => window.HQFx || { sfx() {}, event() {} };

export function renderVals() {
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
    system: ok && !onPage && S.tab === 'system', life: ok && !onPage && S.tab === 'life', studio: ok && !onPage && S.tab === 'studio',
  });
  v.stdHeader = ok && !onPage && S.tab !== 'home';
  const sub = S.sub[S.tab];
  const subs = H.SUBS[S.tab] || [];
  const tabStyle = (a) => ({ height: 30, padding: '0 12px', cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 13, borderRadius: 8, background: a ? 'color-mix(in oklab, var(--gold) 14%, transparent)' : 'transparent', color: a ? 'var(--accent-text)' : 'var(--muted)', border: '1px solid ' + (a ? 'color-mix(in oklab, var(--gold) 55%, transparent)' : 'transparent'), transition: 'background .15s, color .15s, border-color .15s' });
  const subTabs = subs.map(([id, label]) => ({ label, go: () => this.setSub(id), style: tabStyle(sub === id), sel: sub === id }));
  const runningSessions = LIVE.sessions.filter((x) => x.status === 'running').length;
  const navBadge = { tasks: open.length ? [open.length, 'var(--red)'] : null, claude: runningSessions ? [runningSessions, 'var(--gold)'] : null, life: H.POSTS.length ? [H.POSTS.length, 'var(--red)'] : null };
  const GRP = { home: 'work', automations: 'automate', history: 'insight', life: 'life' };
  const nav = H.NAV.map((n, i) => {
    const a = S.tab === n.id && !onPage, b = navBadge[n.id];
    return Object.assign({}, n, {
      digit: String(i + 1), delay: String(i * 45), group: GRP[n.id] || '', showGroup: !!GRP[n.id] && L.railLabels, showDivider: !!GRP[n.id] && !L.railLabels && i > 0, go: () => this.go(n.id), current: a ? 'page' : undefined, title: n.label + ' (' + (i + 1) + ')', hasBadge: !!b, badge: b ? b[0] : '',
      badgeStyle: { fontFamily: 'var(--px)', fontSize: 10, padding: '3px 5px', background: b ? b[1] : 'none', color: b && b[1] === 'var(--gold)' ? '#3a2a00' : '#fff', marginLeft: L.railLabels ? 0 : -8, alignSelf: L.railLabels ? 'center' : 'flex-start' },
      style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: L.railLabels ? '0 12px 0 8px' : '0 6px', minWidth: L.railLabels ? 176 : 48, background: a ? 'var(--card)' : 'transparent', border: '1px solid ' + (a ? 'var(--frame)' : 'transparent'), boxShadow: a ? 'inset 4px 0 0 var(--gold), 0 0 0 2px var(--frame)' : 'none', color: a ? 'var(--text)' : 'var(--muted)', cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 14, textAlign: 'left', transition: 'background .12s, color .12s, transform .12s' },
    });
  });
  const bottomNav = H.NAV.slice(0, 4).map((n) => ({ icon: n.id, glyph: n.glyph, label: n.label, go: () => this.go(n.id), color: S.tab === n.id && !onPage ? 'var(--accent-text)' : 'var(--muted)' })).concat([{ icon: 'status', glyph: '⋯', label: 'More', go: () => this.setState({ moreOpen: !S.moreOpen }), color: S.moreOpen ? 'var(--accent-text)' : 'var(--muted)' }]);
  const moreNav = nav.slice(4);
  const sig = (glyph, value, label, title, color, goFn) => ({ glyph, value, label, title, go: goFn, style: { height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', background: 'var(--ink)', border: '1px solid var(--frame)', borderRadius: 8, color, fontFamily: 'var(--term)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' } });
  const signals = [
    sig('⚿', sec, sec === 1 ? 'secret' : 'secrets', sec + ' likely secrets · regex match, check before acting', sec ? 'var(--red)' : 'var(--muted)', () => this.go('tasks', 'ideas')),
    sig('●', unc, 'uncommitted', unc + ' uncommitted files · measured', unc ? 'var(--orange)' : 'var(--muted)', () => { this.go('projects', 'grid'); this.setState({ projSort: 'dirty' }); }),
    sig('↑', unp, 'unpushed', unp + ' repos with unpushed commits · measured', unp ? 'var(--orange)' : 'var(--muted)', () => this.go('projects', 'grid')),
  ];
  const sigCompact = { parts: signals.map((s) => ({ glyph: s.glyph, value: s.value, color: s.style.color })), title: signals.map((s) => s.title).join('\n'), go: () => this.go('projects', 'grid'), border: sec ? 'var(--red)' : 'var(--frame)' };
  const dateChipStyle = { height: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 13, whiteSpace: 'nowrap', background: live ? 'var(--ink)' : 'var(--blue)', color: live ? 'var(--text)' : '#fff', border: '1px solid ' + (live ? 'var(--frame)' : 'var(--ink)'), boxShadow: S.scrubOpen ? '0 0 0 1px var(--gold)' : 'none' };
  const running = this.runningCount();
  // ----- home -----
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
  const momSpan = this.span(14, off), momVals = momSpan.map((o) => this.series(S.momentum === 'xp' ? 'xp' : 'unc', o));
  const md = momVals[momVals.length - 1] - momVals[0];
  const changes = snap.changes.map((c) => ({ g: c.g, t: c.t, c: c.c, open: c.proj ? () => this.openProject(c.proj) : () => this.go('history', 'timeline'), when: viewedLabel }));
  const recap = H.weeklyRecap;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const recapStats = recap && recap.stats ? ['+' + (recap.stats.xp_gain || 0) + ' xp', plural(recap.stats.quests_completed || 0, 'task'), plural(recap.stats.achievements_unlocked || 0, 'milestone')].join(' · ') + ' · measured' : '';
  const failed = H.INITIAL_RUNS.find((r) => r.status === 'failed'), suggest = failed ? H.AUTOS.find((a) => a.name === failed.name) : null;
  const top = open[0];
  const home = {
    greeting: live ? 'Today' : viewedLabel,
    sub: live ? this.greet() + ' · ' + H.DOW[new Date().getDay()] + ', ' + H.fmtD(new Date()) + ' · ' + (open.filter((t) => t.tier === 'red').length ? open.filter((t) => t.tier === 'red').length + ' critical' : 'nothing critical') : 'Read-only snapshot · the next action as it stood that day',
    hasNext: open.length > 0, isRest: open.length === 0,
    next: top ? tk(top) : {}, alts: open.slice(1, 3).map(tk), hasAlts: open.length > 1,
    restSub: live ? (S.completed.length ? 'You cleared ' + S.completed.length + ' task' + (S.completed.length > 1 ? 's' : '') + ' today. Everything else can wait.' : 'No open tasks in the latest scan. Ideas & risks are there if you want them.') : 'Nothing was open on ' + viewedLabel + '.',
    rows: rows.map(rowOf),
    kpiLine: projects.length + ' projects · ' + projects.filter((p) => p.st === 'risk').length + ' at risk · ' + projects.filter((p) => p.st === 'care').length + ' need care',
    avg: Math.round(this.sum(projects, (p) => p.pct) / Math.max(1, projects.length)),
    changes, hasChanges: changes.length > 0, noChanges: changes.length === 0, prevLabel: H.fmtD(H.dayAt(off + 1)),
    mom: { value: momVals[momVals.length - 1], delta: (md > 0 ? '▲ +' : md < 0 ? '▼ ' : '± ') + md, deltaColor: S.momentum === 'xp' ? (md > 0 ? 'var(--green)' : 'var(--faint)') : (md < 0 ? 'var(--green)' : md > 0 ? 'var(--orange)' : 'var(--faint)'), label: S.momentum === 'xp' ? 'Total XP · measured from completed work' : 'Uncommitted files · measured', pts: this.sparkPts(momVals, 280, 56), range: H.fmtD(H.dayAt(momSpan[0])) + ' → ' + viewedLabel + ' · based on ' + momVals.length + ' scans' },
    momTabs: [['unc', 'Uncommitted'], ['xp', 'XP']].map(([id, l]) => ({ label: l, go: () => this.setState({ momentum: id }), style: { height: 28, padding: '0 8px', fontFamily: 'var(--term)', fontSize: 12, cursor: 'pointer', background: S.momentum === id ? 'var(--ink)' : 'transparent', color: S.momentum === id ? 'var(--text)' : 'var(--muted)', border: '1px solid ' + (S.momentum === id ? 'var(--frame)' : 'transparent') } })),
    social: LIVE.social.connected ? H.POSTS.length + ' post' + (H.POSTS.length === 1 ? '' : 's') + ' awaiting approval · ' + H.MENTIONS.length + ' recent mentions' : 'Social · connect accounts through the browser extension',
    showRecap: live && !!recap && !S.recapDismissed, recapOpen: S.recapOpen,
    recapRange: recap ? H.fmtD(new Date(recap.week_start + 'T12:00')) + ' – ' + H.fmtD(new Date(recap.week_end + 'T12:00')) : '', recapStats, recapAi: !!(recap && recap.ai_narrative),
    recapText: recap ? String(recap.narrative_md || '').replace(/^#+[^\n]*\n?/gm, '').replace(/[*_`>]/g, '').trim() : '',
    suggest: suggest || {}, hasSuggest: live && !!suggest,
  };
  // ----- projects -----
  const sorters = { worst: (a, b) => H.ST[a.st].rank - H.ST[b.st].rank || b.pct - a.pct, recent: (a, b) => (a.lastDays == null ? 999 : a.lastDays) - (b.lastDays == null ? 999 : b.lastDays), dirty: (a, b) => (b.dirty || 0) - (a.dirty || 0), name: (a, b) => a.name.localeCompare(b.name) };
  const projCards = projects.slice().sort(sorters[S.projSort] || sorters.worst).map(rowOf);
  const projSorts = [['worst', 'Worst first'], ['dirty', 'Most uncommitted'], ['recent', 'Recent'], ['name', 'Name']].map(([id, l]) => ({ label: l, go: () => this.setState({ projSort: id }), style: tabStyle(S.projSort === id) }));
  const archived = snap.archived.map((p) => ({ name: p.name, stack: p.stack.join(' · '), since: p.archivedOn ? 'Archived ' + H.fmtD(new Date(p.archivedOn + 'T12:00')) : 'Archived', restore: () => { if (!this.canWrite()) return this.denied(); this.toast('success', 'Restoring ' + p.name); FX().event('cheer', 'Welcome back, ' + p.name + '.'); this.defer('revive:' + p.id, () => this.call(() => this.hq.reviveProject(p.id), 'Restore failed')); } }));
  // iso map
  const tw = 88, th = 44, ox = 216, oy = 200, P2 = (x, y) => x.toFixed(1) + ',' + y.toFixed(1);
  const tiles = []; for (let gx = -1; gx <= 4; gx++) for (let gy = -1; gy <= Math.max(2, Math.ceil(rows.length / 4)); gy++) { const cx = ox + (gx - gy) * tw / 2, cy = oy + (gx + gy) * th / 2; tiles.push({ pts: [P2(cx, cy - th / 2), P2(cx + tw / 2, cy), P2(cx, cy + th / 2), P2(cx - tw / 2, cy)].join(' '), op: (gx + gy) % 2 ? 0.55 : 0.85 }); }
  const hovId = S.hoverProj && rows.some((p) => p.id === S.hoverProj) ? S.hoverProj : (rows[0] && rows[0].id);
  const towers = rows.map((p, i) => {
    const gx = i % 4, gy = Math.floor(i / 4), cx = ox + (gx - gy) * tw / 2, cy = oy + (gx + gy) * th / 2, hw = tw / 2 * 0.62, hh = th / 2 * 0.62;
    const Hh = 16 + Math.min(118, (p.dirty || 0) * 1.7 + Math.min(4, p.secrets || 0) * 34 + (p.hasGit ? 0 : 58) + (p.st === 'care' ? 14 : 0));
    const T = [cx, cy - hh], R = [cx + hw, cy], B = [cx, cy + hh], Lf = [cx - hw, cy], up = (a) => [a[0], a[1] - Hh];
    const j = (a) => a.map((q) => P2(q[0], q[1])).join(' ');
    const wins = p.activity === 'active' ? [0, 1, 2].filter((k) => 10 + k * 14 < Hh - 6).map((k) => ({ x: (cx - hw * 0.55).toFixed(1), y: (cy - 4 - k * 14 - 6).toFixed(1), dur: (1.6 + ((i + k) % 3) * 0.7).toFixed(1) + 's' })) : [];
    const smoke = p.st === 'risk' ? [0, 1, 2].map((k) => ({ x: (cx + (k - 1) * 5).toFixed(1), y0: (cy - hh - Hh).toFixed(1), y1: (cy - hh - Hh - 34).toFixed(1), begin: (k * 0.7).toFixed(1) + 's' })) : [];
    return { wins, smoke, hasSmoke: smoke.length > 0, depth: gx + gy, left: j([Lf, B, up(B), up(Lf)]), right: j([B, R, up(R), up(B)]), top: j([up(T), up(R), up(B), up(Lf)]), color: H.ST[p.st].color, stroke: hovId === p.id ? 'var(--gold)' : 'var(--ink)', sw: hovId === p.id ? 2.5 : 1.5, lx: cx, ly: cy + hh + 20, name: p.name, open: () => this.openProject(p.id), hover: () => this.setState({ hoverProj: p.id }) };
  }).sort((a, b) => a.depth - b.depth);
  const hp = projects.find((p) => p.id === hovId);
  const mapCard = hp ? Object.assign(rowOf(hp), { dirtyText: hp.dirty == null ? 'unknown (no git)' : String(hp.dirty), last: hp.lastCommit ? '"' + hp.lastCommit + '"' : 'no commits yet' }) : {};
  // ----- project page -----
  let pg = {};
  if (onPage) {
    const p = this.projectsAt(off, true).find((x) => x.id === S.route.id) || projects[0] || null;
    if (p) pg = projectPage.call(this, p, { off, live, tasks, cantWrite, tabStyle, actText, viewedLabel });
  }
  // ----- tasks -----
  const tierCount = (k) => open.filter((t) => t.tier === k).length;
  const taskFilters = [['all', 'All', open.length], ['red', 'Critical', tierCount('red')], ['orange', 'Important', tierCount('orange')], ['yellow', 'Housekeeping', tierCount('yellow')]].map(([id, l, n]) => ({ label: l + ' ' + n, go: () => this.setState({ taskFilter: id }), style: tabStyle(S.taskFilter === id) }));
  const filt = tasks.filter((t) => S.taskFilter === 'all' || t.tier === S.taskFilter);
  const trow = (t) => {
    const done = S.recentDone.includes(t.id);
    return Object.assign(tk(t), { isTask: true, isHeader: false, age: t.age + 'd old', isDone: done, isOpen: !done, ring: done ? 'var(--green)' : 'var(--frame)', opacity: done ? 0.7 : 1, claude: () => this.sendClaude(t.title, t.proj) });
  };
  let taskRows = [];
  if (sub === 'byproject') {
    const byP = {}; filt.forEach((t) => { (byP[t.proj || ''] = byP[t.proj || ''] || []).push(t); });
    Object.keys(byP).forEach((pid) => { taskRows.push({ isHeader: true, isTask: false, label: (this.pname(pid) || 'Workspace') + ' · ' + byP[pid].length, open: () => this.openProject(pid) }); byP[pid].forEach((t) => taskRows.push(trow(t))); });
  } else taskRows = filt.map(trow);
  const KIND = H.KIND;
  const ideaRows = live ? this.ideasAt().map((i) => ({ kind: KIND[i.kind][0], tone: KIND[i.kind][1], ai: i.ai, title: i.title, proj: i.projName, open: () => (i.proj ? this.openProject(i.proj) : null), meta: 'effort ' + i.effort + ' · impact ' + i.impact + (i.ai ? ' · suggested by AI, unverified' : i.capture ? ' · your capture' : ' · from scan rules'), doIt: (e) => this.doIdea(i, e), doLabel: i.purge ? 'Purge ' + i.purge + '…' : '✓ Did it', claude: () => this.sendClaude(i.title, i.proj), dismiss: () => { this.setState((s) => ({ dismissed: s.dismissed.concat([i.id]) })); this.toast('info', 'Hidden on this PC · the scan still tracks it'); } })) : snap.IDEAS.map((i) => ({ kind: KIND[i.kind][0], tone: KIND[i.kind][1], ai: i.ai, title: i.title, proj: i.projName, open: () => {}, meta: 'effort ' + i.effort + ' · impact ' + i.impact, doIt: () => this.denied(), doLabel: '✓ Did it', claude: () => this.denied(), dismiss: () => this.denied() }));
  const cleared = live ? S.completed.map((id) => H.T0.find((t) => t.id === id)).filter(Boolean).map((t) => ({ title: t.title, xp: t.xp })) : [];
  // ----- screen header -----
  const screenTitle = (H.NAV.find((n) => n.id === S.tab) || {}).label;
  const screenSub = {
    projects: projects.length + ' tracked · ' + snap.archived.length + ' archived',
    tasks: open.length + ' open · ' + tierCount('red') + ' critical · from the ' + (live ? 'latest' : viewedLabel) + ' scan',
    automations: H.autoTotal + ' catalogued · ' + H.AUTOS.length + ' runnable here',
    claude: runningSessions + ' running · uses Claude quota',
    history: 'trends, timeline and milestones · ' + H.N + ' snapshots',
    system: H.pcScannedAt ? 'Machine checked ' + new Date(Date.parse(H.pcScannedAt)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · live, not historical' : 'No machine check yet',
    life: 'screen time, social and notes',
    studio: H.CAPTURES.length + ' captures · Ctrl Alt S to snip, Ctrl Alt R to record',
  }[S.tab] || '';
  // ----- palette -----
  const PI = S.paletteOpen ? this.paletteItems() : { groups: [], count: 0 };
  const palGroups = PI.groups.map((gr) => ({ name: gr.name, items: gr.items.map((it) => ({ glyph: it.glyph, label: it.label, hint: it.hint, run: () => { this.setState({ paletteOpen: false }); it.run(); }, hoverSel: () => this.setState({ paletteSel: it.idx }), style: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--term)', fontSize: 14, background: it.active ? 'var(--card-hi)' : 'transparent', color: it.active ? 'var(--text)' : 'var(--muted)', boxShadow: it.active ? 'inset 3px 0 0 var(--gold)' : 'none' } })) }));
  const palModeTabs = [['go', 'Go & do'], ['ask', '✦ Ask local model']].map(([id, l]) => ({ label: l, go: () => this.setState({ paletteMode: id }), style: Object.assign(tabStyle(S.paletteMode === id), { height: 30, fontSize: 12 }) }));
  // ----- ask (model text renders as plain text; never outside this panel) -----
  const asks = S.askHistory.map((h) => ({ q: h.q, text: h.a.text || (h.a.status === 'thinking' ? '…' : ''), src: h.a.src || [], hasSrc: (h.a.src || []).length > 0, est: !!h.a.est, refusal: !!h.a.refusal }));
  // ----- runs: live casts, dev servers, opened terminals, then history -----
  const RS = { running: ['Running', 'var(--gold)'], ok: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'], cancelled: ['Cancelled', 'var(--faint)'], opened: ['Terminal', 'var(--blue)'], stopped: ['Stopped', 'var(--faint)'] };
  const runRow = (r) => ({ name: r.name, meta: r.meta || '', started: r.started || '', status: RS[r.status][0], color: RS[r.status][1], isRunning: r.status === 'running', canCancel: r.status === 'running' && r.kind === 'auto', isDev: r.status === 'running' && r.kind === 'dev', cancel: () => this.cancelRun(r.spellId), stop: () => this.stopDev(r.devId), expanded: S.expandedRun === r.id, toggle: () => this.setState({ expandedRun: S.expandedRun === r.id ? null : r.id }), out: (r.out || []).join('\n') || (r.status === 'running' ? 'Waiting for output…' : 'No output kept for this run.'), progress: r.status === 'running' ? 50 : 100 });
  const liveRuns = Object.values(LIVE.casts).sort((a, b) => b.t0 - a.t0).map((c) => ({ id: c.castId, kind: 'auto', spellId: c.spellId, name: c.name, status: c.done ? c.status : 'running', meta: c.done ? c.meta : 'running', started: new Date(c.t0).toTimeString().slice(0, 5), out: c.out }));
  const devRuns = Object.entries(LIVE.dev).filter(([, d]) => d).map(([id, d]) => ({ id: 'dev:' + id, kind: 'dev', devId: id, name: 'Dev server · ' + this.pname(id), status: 'running', meta: (this.proj(id) || {}).dev || '', started: new Date(d.since).toTimeString().slice(0, 5), out: [] }));
  const runs = devRuns.concat(liveRuns, S.localRuns, H.INITIAL_RUNS).map(runRow);
  // ----- scrub (time machine) -----
  const scrubSpan = this.span(90, 0), scrubVals = scrubSpan.map((o) => ({ o, v: this.series('unc', o) }));
  const smax = Math.max(1, ...scrubVals.map((x) => x.v));
  const scrubBars = scrubVals.map((x) => ({ h: 6 + Math.round(x.v / smax * 40), c: x.o === off ? 'var(--gold)' : x.o === 0 ? 'var(--green)' : 'var(--frame-hi)', title: H.fmtD(H.dayAt(x.o)) + ' · ' + x.v + ' uncommitted', go: () => this.setState({ snapOffset: x.o }) }));
  const quick = [['Live', 0], ['Yesterday', 1], ['7 scans ago', 7], ['30 scans ago', 30], ['Oldest', H.maxOff]].filter(([, o], i, a) => o <= H.maxOff && a.findIndex((x) => x[1] === o) === i);
  const scrubQuick = quick.map(([l, o]) => ({ label: l, go: () => this.setState({ snapOffset: o }), style: Object.assign(tabStyle(off === o), { height: 30, fontSize: 12, padding: '0 10px' }) }));
  // ----- focus -----
  let focus = {};
  if (S.focus) {
    const t = H.T0.find((x) => x.id === S.focus.taskId), secs = Math.floor((S.now - S.focus.start) / 1000);
    focus = t ? Object.assign(tk(t), { has: true, none: false, elapsed: String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0') }) : { has: false, none: true, elapsed: '00:00' };
    focus.picker = open.filter((x) => !t || x.id !== t.id).slice(0, 4).map((x) => ({ title: x.title, color: TR[x.tier].color, go: () => this.setState({ focus: { taskId: x.id, start: Date.now() } }) }));
    focus.hasPicker = focus.picker.length > 0;
    focus.stop = () => this.endFocus(true);
  }
  // ----- run confirm -----
  let confirm = {};
  const ca = S.confirm ? this.auto(S.confirm) : null;
  if (ca) {
    confirm = { icon: ca.icon, name: ca.name, desc: ca.desc || 'No description', kind: 'Runs in the background · tracked in Activity', kindTone: 'green', cmd: ca.cmd, dir: ca.dir, quota: false, steps: (ca.steps || []).map((s, i) => ({ n: i + 1, s })), hasSteps: !!ca.steps, destructive: !!ca.destructive, last: ca.last ? (ca.last.ok ? 'Last run ' + ca.last.ago + ' · finished' : 'Last run ' + ca.last.ago + ' · failed (' + ca.last.err + ')') : 'Never run from here', lastColor: ca.last ? (ca.last.ok ? 'var(--green)' : 'var(--red)') : 'var(--faint)',
      askOpts: [['always', 'Ask every time'], ['never', 'Don’t ask again for this exact command']].map(([id, l]) => ({ label: l, on: S.confirmAsk === id ? '●' : '○', go: () => this.setState({ confirmAsk: id }), disabled: id === 'never' && !!ca.destructive })) };
  }
  // ----- commit -----
  let commit = {};
  if (S.commit) {
    const c = S.commit, p = this.proj(c.pid) || {}, n = c.files.length;
    const selF = c.files[Math.min(S.commitSel, n - 1)];
    const envHit = c.files.some((f) => /(^|\/)\.env(\.|$)/.test(f.name));
    const statLines = String(c.stat || '').split('\n');
    const selStat = selF ? statLines.filter((l) => l.includes(selF.name.split('/').pop())) : [];
    commit = { selName: selF ? selF.name : (c.loading ? 'reading changes…' : 'no changes'), diff: c.loading ? 'Reading git status…' : (selStat.length ? selStat.join('\n') : (selF && selF.st === 'new' ? '+ new file (untracked)' : (c.stat || 'No line counts for this file')) ) + '\n\n(line counts from git diff --stat · open the file in your editor for the full diff)',
      title: 'Commit to ' + (p.branch || 'main') + ' · ' + (p.name || ''), files: c.files.map((f, i) => ({ name: f.name, st: f.st === 'new' ? 'A' : f.st === 'del' ? 'D' : 'M', stColor: f.st === 'new' ? 'var(--green)' : f.st === 'del' ? 'var(--red)' : 'var(--orange)', on: '■', warn: /(^|\/)\.env(\.|$)/.test(f.name), isSel: i === S.commitSel, rowBg: i === S.commitSel ? 'var(--card-hi)' : 'transparent', toggle: () => { this.setState({ commitSel: i }); if (!this._toggleNoted) { this._toggleNoted = true; this.toast('info', 'This commits every changed file (git add -A) · per-file staging isn’t wired yet'); } } })),
      more: 0, hasMore: false, msg: c.msg, onMsg: (e) => { const val = e.target.value; this.setState((s) => ({ commit: Object.assign({}, s.commit, { msg: val }) })); }, drafted: envHit ? '⚠ a .env file is in the change set · add it to .gitignore before committing' : c.drafted, okLabel: c.loading ? 'Reading…' : 'Commit ' + n + ' file' + (n === 1 ? '' : 's'), none: c.loading || n === 0 || envHit || !(c.msg || '').trim(), cmd: 'git add -A && git commit' };
  }
  // ----- toasts -----
  const TK = { success: 'var(--green)', error: 'var(--red)', info: 'var(--blue)', progress: 'var(--gold)' };
  const toasts = S.toasts.map((t) => ({ text: t.text, color: TK[t.kind], ref: this.toastRef(t.id), hasUndo: !!t.undo && !!this._pending['done:' + t.undo], undo: () => this.undoTask(t.undo), hasCancel: !!t.runSpell, cancel: () => this.cancelRun(t.runSpell), close: () => this.dismissToast(t.id), isProgress: t.kind === 'progress' }));
  // ----- ambient rail -----
  const sysIssues = H.ISSUES.length + (LIVE.llm && !LIVE.llm.available ? 1 : 0);
  const mach = LIVE.machine, devList = Object.keys(LIVE.dev).filter((k) => LIVE.dev[k]);
  const siteMins = this.sum(H.SITES, (s) => s[1]);
  const amb = [
    { label: 'Do now', title: top ? top.title : 'Nothing on fire', sub: top ? (this.pname(top.proj) || 'Workspace') + ' · press F to focus' : 'Board is clear', color: top ? TR[top.tier].color : 'var(--green)', go: () => (top ? this.startFocus(top.id) : this.go('home')) },
    { label: 'Running', title: running ? running + ' running' : 'Nothing running', sub: devList.length ? 'Dev server · ' + devList.map((d) => this.pname(d)).join(', ') : 'No dev servers', color: running ? 'var(--gold)' : 'var(--faint)', go: () => this.setState({ runsOpen: true, ambientOverlay: false }) },
    { label: 'Machine', title: sysIssues ? sysIssues + ' issue' + (sysIssues > 1 ? 's' : '') : 'Machine OK', sub: mach ? 'CPU ' + Math.round(mach.cpu) + '% · RAM ' + Math.round(mach.ram) + '%' : 'live vitals in the app only', color: sysIssues ? 'var(--orange)' : 'var(--green)', go: () => this.go('system') },
    { label: 'Claude', title: runningSessions + ' session' + (runningSessions === 1 ? '' : 's') + ' running', sub: (LIVE.sessions.find((x) => x.status === 'running') || {}).title || '—', color: 'var(--purple)', go: () => this.go('claude') },
    { label: 'Screen time', title: snap.browser ? Math.floor(siteMins / 60) + 'h ' + (siteMins % 60) + 'm' : 'No data yet', sub: (snap.browser ? 'browser focus · last 3 days' : 'connect the browser extension') + (LIVE.browserNow && LIVE.browserNow.domain ? ' · now: ' + LIVE.browserNow.domain : ''), color: 'var(--blue)', go: () => this.go('life', 'screen') },
  ];
  const ambientStyle = ambientDocked ? { flex: '0 0 256px', width: 256, background: 'var(--panel)', borderLeft: '2px solid var(--ink)', boxShadow: '-2px 0 0 var(--frame)', overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 } : { position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(300px, 92vw)', zIndex: 60, background: 'var(--panel)', borderLeft: '2px solid var(--ink)', boxShadow: '-2px 0 0 var(--frame), -18px 0 40px rgba(0,0,0,.35)', overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 };
  // ----- settings -----
  const sw = (label, desc, on, toggle) => ({ label, desc, state: on ? 'On' : 'Off', toggle, style: { width: 64, height: 32, flex: '0 0 auto', cursor: 'pointer', fontFamily: 'var(--px)', fontSize: 10, border: '1px solid var(--frame)', borderRadius: 10, boxShadow: '0 0 0 1px ' + (on ? 'var(--gold)' : 'var(--frame)'), background: on ? 'var(--gold)' : 'var(--ink)', color: on ? '#3a2a00' : 'var(--muted)' } });
  const settings = [
    sw('Sound', 'Tiny chiptune blips on clicks, completions and level-ups.', S.sound, () => this.setState({ sound: !S.sound })),
    sw('Bit the pet', 'A small companion that roams the bottom edge. Click or drag it.', S.petOn, () => this.setState({ petOn: !S.petOn })),
    sw('Status rail', 'Do now · running · machine · Claude · screen time, on the right.', S.ambientPref, () => this.setState({ ambientPref: !S.ambientPref })),
    sw('Reduce motion', 'Turns off bursts, coin flights, hops and transitions.', S.reduceMotion, () => this.setState({ reduceMotion: !S.reduceMotion })),
    sw('Notifications', 'Only for measured, actionable, new events. Never reminders.', S.notifyMeasured, () => this.setState({ notifyMeasured: !S.notifyMeasured })),
  ];
  const themeOpts = [['dark', 'Dark'], ['light', 'Light'], ['os', 'Follow system']].map(([id, l]) => ({ label: l, go: () => this.setState({ themePref: id }), style: tabStyle(S.themePref === id) }));
  // ----- level-up stat card (measured) -----
  const wk = this.span(7, 0), uncThen = this.series('unc', wk[0]);
  const lvl = S.levelUp ? { l: S.levelUp.l, t: S.levelUp.t, stats: [['Tasks done (all time)', String(snap.doneTasks.length + S.completed.length)], ['Commits, last ' + wk.length + ' scans', String(this.sum(wk, (o) => this.series('commits', o)))], ['Scan streak', snap.account.streak + ' days'], ['Uncommitted, then → now', uncThen + ' → ' + unc]].map((s) => ({ k: s[0], v: s[1] })) } : {};
  // ----- since last scan / notifications -----
  const latest = H.at(0);
  const since = latest.changes.slice(0, 6).map((c) => ({ g: c.g, t: c.t, c: c.c, open: c.proj ? () => this.openProject(c.proj) : () => this.go('history', 'timeline') }));
  const notes = (S.notifLog || []).map((n) => ({ t: n.text, d: 'Today ' + n.at, c: TK[n.kind] })).concat(latest.changes.map((c) => ({ t: c.t, d: H.fmtD(latest.day) + ' scan', c: c.c })));
  const cmpRows = S.compareOff == null ? [] : [['Uncommitted files', 'unc', 'down'], ['Open tasks', 'tasks', 'down'], ['Likely secrets', 'secrets', 'down'], ['Commits that scan', 'commits', 'up'], ['XP', 'xp', 'up']].map(([l, m, good]) => { const a = this.series(m, S.compareOff), b = this.series(m, off), d = b - a; return { l, a, b, d: (d > 0 ? '+' : '') + d, c: d === 0 ? 'var(--faint)' : ((d < 0) === (good === 'down') ? 'var(--green)' : 'var(--orange)') }; });
  const scrubTo = H.fmtD(H.dayAt(0)), scrubFrom = H.fmtD(H.dayAt(scrubSpan[0]));

  const out = {
    themeName: this.themeName(), L, v, cantWrite, writeReason, isPast: !live, noBridge: ps === 'nobridge' || !this.hq, viewedLabel,
    goHome: () => this.go('home'), backToLive: () => this.setState({ snapOffset: 0, scrubOpen: false }),
    dateChipStyle, dateChipLabel: live ? (L.wide ? 'Live · ' : '') + viewedLabel : (L.wide ? 'Viewing ' : '') + viewedLabel, dateDot: live ? 'var(--green)' : '#fff',
    toggleScrub: () => this.setState({ scrubOpen: !S.scrubOpen }), signals, sigCompact,
    showPrompt: ok && !onPage, promptHints: ['commit ' + ((rows[0] || {}).name || 'a project').toLowerCase(), 'run full scan', top ? 'focus ' + top.title.toLowerCase().split(' ').slice(0, 3).join(' ') : 'what changed this week?', 'which projects are stale?', 'theme light', 'open ' + ((rows[1] || rows[0] || {}).name || 'a project').toLowerCase()].join('|'),
    isScanning: S.localRuns.some((r) => r.id === 'scan' && r.status === 'running'), notScanning: !S.localRuns.some((r) => r.id === 'scan' && r.status === 'running'),
    hasScreenModel: ['projects', 'automations', 'history', 'system'].includes(S.tab) && !onPage && L.wide, screenModel: { projects: 'model:folder', automations: 'model:gear', history: 'model:trophy', system: 'model:computer' }[S.tab] || 'model:gear',
    showSince: live && ps === 'live' && !S.sinceDismissed && since.length > 0, dismissSince: () => this.setState({ sinceDismissed: true }), since, sinceLabel: 'since the last scan · ' + H.fmtD(latest.day) + (latest.at ? ', ' + new Date(Date.parse(latest.at)).toTimeString().slice(0, 5) : ''),
    actTabs: [['runs', 'Runs'], ['notes', 'Notifications']].map(([id, l]) => ({ label: l, go: () => this.setState({ actTab: id }), style: tabStyle(S.actTab === id) })), isRunsTab: S.actTab === 'runs', isNotesTab: S.actTab === 'notes', notes,
    compareOn: S.compareOff != null, toggleCompare: () => this.setState({ compareOff: S.compareOff == null ? Math.min(H.maxOff, off + 7) : null }), compareLabel: S.compareOff != null ? H.fmtD(H.dayAt(S.compareOff)) + ' → ' + viewedLabel : '', compareShift: (d) => this.setState((st) => ({ compareOff: Math.max(0, Math.min(H.maxOff, (st.compareOff || 0) + d)) })), cmpBack: () => this.setState((st) => ({ compareOff: Math.min(H.maxOff, (st.compareOff || 0) + 1) })), cmpFwd: () => this.setState((st) => ({ compareOff: Math.max(0, (st.compareOff || 0) - 1) })),
    cmpRows, scrubFrom, scrubTo,
    onboardOpen: !!S.onboard, ob: S.onboard ? Object.assign({}, S.onboard, { s1: S.onboard.step === 1, s2: S.onboard.step === 2, s3: S.onboard.step === 3, notS1: S.onboard.step > 1, notS3: S.onboard.step < 3, stepLabel: 'step ' + S.onboard.step + ' of 3', dots: [1, 2, 3].map((n) => ({ c: n <= S.onboard.step ? 'var(--gold)' : 'var(--frame)' })) }) : {},
    openOnboard: () => { if (!this.canWrite()) return this.denied(); this.setState({ onboard: { step: 1, path: '', dev: 'npm run dev', branch: 'main', name: '' } }); },
    closeOnboard: () => this.setState({ onboard: null }), obNext: () => this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { step: Math.min(3, st.onboard.step + 1) }) })), obBack: () => this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { step: Math.max(1, st.onboard.step - 1) }) })),
    obPath: (e) => this.obSet('path', e), obName: (e) => this.obSet('name', e), obDev: (e) => this.obSet('dev', e), obBranch: (e) => this.obSet('branch', e), obFinish: () => this.finishOnboard(),
    // shell
    scanLabel: 'Last scan ' + S.lastScan, scanTitle: cantWrite ? writeReason : 'Scan now · re-reads every project (uses Claude quota)', scanNow: () => this.scanNow(),
    running, hasRunning: running > 0, toggleRuns: () => this.setState({ runsOpen: !S.runsOpen }), openRuns: () => this.setState({ runsOpen: true }),
    openPalette: () => { this.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); FX().sfx('open'); },
    toggleFocus: () => this.toggleFocus(), toggleTheme: () => this.toggleTheme(), openSettings: () => this.setState({ settingsOpen: true }), openCheat: () => this.setState({ cheatOpen: true }),
    showAmbient: ok && (ambientDocked || S.ambientOverlay), showAmbientToggle: !ambientDocked, ambientOverlayOpen: !ambientDocked && S.ambientOverlay, toggleAmbientOverlay: () => this.setState({ ambientOverlay: !S.ambientOverlay }), amb, ambientStyle,
    xpRef: this.xpRef, level, displayXp: live ? S.displayXp : this.xpAt(off), levelBar: level.pct, levelTitle: 'Level ' + level.l + ' · ' + level.t + (level.next ? ' · ' + level.toNext + ' xp to level ' + (level.l + 1) : ' · max level'),
    nav, bottomNav, moreOpen: S.moreOpen, moreNav,
    mainRef: this.mainRef, popIn: this.popIn, slideIn: this.slideIn, shimmer: this.shimmer, pulse: this.pulse, rise: this.rise, barsAnim: this.bars, stop: (e) => e.stopPropagation(),
    retry: () => (this.hq ? this.scanNow() : location.reload()),
    screenTitle, screenSub, subTabs, hasSubTabs: subTabs.length > 0,
    // home
    home, goTasksIdeas: () => this.go('tasks', 'ideas'), goProjects: () => this.go('projects', 'grid'), goSocial: () => this.go('life', 'social'),
    runSuggest: () => home.hasSuggest && this.askRun(suggest), toggleRecap: () => this.setState({ recapOpen: !S.recapOpen }), dismissRecap: () => this.setState({ recapDismissed: true }),
    // projects
    isGrid: sub === 'grid', isMap: sub === 'map', isArchived: sub === 'archived', projSorts, projCards, archived, noArchived: archived.length === 0,
    tiles, towers, mapCard, mapOpen: () => hp && this.openProject(hp.id),
    pg,
    // tasks
    isRanked: sub === 'ranked' || sub === 'byproject', isIdeas: sub === 'ideas', taskFilters, taskRows, noTasks: taskRows.length === 0, ideaRows, noIdeas: ideaRows.length === 0,
    cleared, hasCleared: cleared.length > 0, clearedXp: this.sum(cleared, (c) => c.xp),
    // snapshots
    scrubOpen: S.scrubOpen, closeScrub: () => this.setState({ scrubOpen: false }), scrubBars, scrubQuick,
    scrubSel: { label: live ? 'Live · ' + viewedLabel : viewedLabel, unc, tasks: open.length, xp: this.xpAt(off), changes: snap.changes.length },
    // activity
    runsOpen: S.runsOpen, closeRuns: () => this.setState({ runsOpen: false }), runs,
    // ask
    askOpen: S.askOpen, closeAsk: () => this.setState({ askOpen: false }), askPastNote: !live, asks, askDraft: S.askDraft,
    onAskInput: (e) => this.setState({ askDraft: e.target.value }), askKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitAsk(this.state.askDraft); } }, askSubmit: () => this.submitAsk(S.askDraft),
    // palette
    paletteOpen: S.paletteOpen, closePalette: () => this.setState({ paletteOpen: false }), palModeTabs, paletteQuery: S.paletteQuery,
    onPaletteInput: (e) => this.setState({ paletteQuery: e.target.value, paletteSel: 0 }),
    palPlaceholder: S.paletteMode === 'ask' ? 'Ask about your projects, tasks or scans…' : 'Go to, open or run…  try “commit ' + ((rows[0] || {}).name || 'a project').toLowerCase() + '”',
    palIsGo: S.paletteMode === 'go', palIsAsk: S.paletteMode === 'ask', palGroups, palEmpty: S.paletteMode === 'go' && PI.count === 0,
    askExamples: ['What is uncommitted?', 'Any exposed secrets?', 'What went stale?', 'What should I do first?'].map((q) => ({ q, go: () => this.submitAsk(q) })),
    // overlays
    hasFocus: !!S.focus, focus, closeFocus: () => this.endFocus(false),
    hasConfirm: !!ca, confirm, cancelConfirm: () => this.setState({ confirm: null }), confirmRun: () => this.confirmRun(),
    hasCommit: !!S.commit, commit, cancelCommit: () => this.setState({ commit: null }), doCommit: () => this.doCommit(),
    hasSheet: !!S.sheet, sheet: S.sheet || {}, sheetDanger: !!(S.sheet && S.sheet.danger), sheetSafe: !!(S.sheet && !S.sheet.danger), cancelSheet: () => this.setState({ sheet: null }), sheetOk: () => this.sheetOk(),
    settingsOpen: S.settingsOpen, closeSettings: () => this.setState({ settingsOpen: false }), themeOpts, settings,
    hotkeys: H.HOTKEYS.map((h) => ({ k: h[0], d: h[1], st: h[2] === 'ok' ? 'ok' : 'conflict', color: h[2] === 'ok' ? 'var(--green)' : 'var(--orange)' })), keys: H.KEYS.map((k) => ({ k: k[0], d: k[1] })),
    exportCard: () => this.notWired('Exporting the stat card'),
    cheatOpen: S.cheatOpen, closeCheat: () => this.setState({ cheatOpen: false }),
    hasLevel: !!S.levelUp, lvl, closeLevel: () => this.setState({ levelUp: null }),
    refreshing: S.refreshing, toasts,
  };
  return Object.assign(out, this.moreVals(out, { off, live, tabStyle, projects, snap }));
}

// The project page ("pg"). Split out only for length; same `this`.
function projectPage(p, { off, live, tasks, cantWrite, tabStyle, actText, viewedLabel }) {
  const S = this.state, H = this.M, TR = H.TIER;
  const pt = tasks.filter((t) => t.proj === p.id && !S.recentDone.includes(t.id));
  const nextItems = pt.map((t) => ({ kind: TR[t.tier].label, tone: t.tier === 'red' ? 'red' : t.tier === 'orange' ? 'orange' : 'gold', ai: false, title: t.title, why: t.why, doIt: (e) => this.completeTask(t.id, e), claude: () => this.sendClaude(t.title, p.id), dismiss: () => {}, canDismiss: false }))
    .concat((live ? this.ideasAt() : H.at(off).IDEAS).filter((i) => i.proj === p.id).map((i) => ({ kind: H.KIND[i.kind][0], tone: H.KIND[i.kind][1], ai: i.ai, title: i.title, why: 'effort ' + i.effort + ' · impact ' + i.impact + (i.ai ? ' · suggested by AI, unverified' : ' · from scan rules'), doIt: (e) => this.doIdea(i, e), claude: () => this.sendClaude(i.title, p.id), dismiss: () => this.setState((s) => ({ dismissed: s.dismissed.concat([i.id]) })), canDismiss: true })));
  if (!nextItems.length && p.dirty) nextItems.push({ kind: 'Task', tone: 'gold', ai: false, title: 'Commit ' + p.dirty + ' files', why: 'Small, safe, done in a minute', doIt: () => this.openCommit(p.id), claude: () => this.sendClaude('Commit the work in progress in ' + p.name, p.id), dismiss: () => {}, canDismiss: false });
  const nextText = pt[0] ? pt[0].title : p.dirty ? 'Commit ' + p.dirty + ' dirty files' : 'Open it and look around';
  const devOn = live && !!this.LIVE.dev[p.id];
  const diagTabs = [['git', 'Git'], ['security', 'Security'], ['standing', 'Standing'], ['insights', 'Insights'], ['roadmap', 'Roadmap']].map(([id, l]) => ({ label: l, go: () => this.setState({ diagTab: id }), style: Object.assign(tabStyle(S.diagTab === id), { height: 30, padding: '0 9px', fontSize: 12 }) }));
  const ins = p.insights.length ? p.insights.slice(0, 4).map((i) => ['Insight', i.text, i.severity === 'danger' ? 'var(--red)' : i.severity === 'warning' ? 'var(--orange)' : 'var(--text)', true]) : [['Insight', 'No insights in this snapshot', 'var(--muted)', false]];
  const road = p.roadmap.length ? p.roadmap.slice(0, 3).flatMap((r) => [[r.status === 'done' ? 'Done' : r.status === 'in_progress' ? 'In progress' : 'Planned', r.milestone + (r.pct != null ? ' · ~' + r.pct + '%' : ''), 'var(--text)', true]].concat(r.items.length ? [['Items', r.items.slice(0, 4).join(' · '), 'var(--muted)', true]] : [])) : [['Roadmap', 'No roadmap in this snapshot', 'var(--muted)', false]];
  const rowsD = {
    git: [['Repository', p.hasGit ? 'yes · ' + p.commits + ' commits' : 'none', p.hasGit ? 'var(--text)' : 'var(--red)'], ['Remote', p.remote, p.remote === 'none' ? 'var(--orange)' : 'var(--text)'], ['Branch', p.branch + (p.hasGit && p.branch !== p.canonical ? ' (canonical: ' + p.canonical + ')' : ''), p.branch !== p.canonical && p.hasGit ? 'var(--orange)' : 'var(--text)'], ['Uncommitted', p.dirty == null ? 'unknown' : String(p.dirty), p.dirty ? 'var(--orange)' : 'var(--green)'], ['Ahead / behind', p.ahead + ' / ' + p.behind, p.ahead ? 'var(--orange)' : 'var(--text)'], ['Last commit', p.lastCommit ? p.lastCommit + (p.lastDays != null ? ' · ' + p.lastDays + 'd ago' : '') : '—', 'var(--text)']],
    security: [['Likely secrets', String(p.secrets), p.secrets ? 'var(--red)' : 'var(--green)', true], ['Where', p.secretWhere || '—', 'var(--text)'], ['Matcher', 'regex · over-matches, check each hit', 'var(--faint)']],
    standing: [['Completion', p.pct + '%', 'var(--text)', true], ['Basis', p.pctBasis || '—', 'var(--muted)', true], ['Build', p.build + ' (never actually built)', p.build === 'green' ? 'var(--green)' : 'var(--muted)', true], ['Tests', p.tests, 'var(--text)'], ['Activity', actText(p), 'var(--text)'], ['Size', p.files + ' files · ' + p.loc.toLocaleString() + ' lines', 'var(--text)'], ['Project level', 'L' + p.level + ' · ' + p.pxp + ' xp', 'var(--accent-text)']],
    insights: ins, roadmap: road,
  }[S.diagTab].map((r) => ({ k: r[0], v: r[1], color: r[2], est: !!r[3] }));
  const KIND = { note: ['Note', 'var(--muted)'], decision: ['Decision', 'var(--blue)'], learning: ['Learned', 'var(--green)'] };
  const notes = (H.projectNotes[p.id] || []).slice().reverse().map((n) => ({ k: 'note', t: String(n.text || ''), d: n.date ? H.fmtD(new Date(Date.parse(n.date))) : '' }));
  const learned = H.at(0).learnings.filter((l) => l.proj === p.id).map((l) => ({ k: 'learning', t: l.text, d: l.at ? H.fmtD(new Date(Date.parse(l.at))) : '' }));
  const jr = (S.journalAdds[p.id] || []).concat(notes, learned).slice(0, 30).map((j) => ({ kind: KIND[j.k][0], color: KIND[j.k][1], text: j.t, date: j.d }));
  const can = () => { if (!this.canWrite()) { this.denied(); return false; } return true; };
  return {
    name: p.name, tag: H.ST[p.st].label, tone: H.ST[p.st].tone, color: H.ST[p.st].color, stack: p.stack.join(' · '), path: p.path, fresh: 'scanned ' + (live ? H.fmtD(H.dayAt(0)) + ' ' + S.lastScan : viewedLabel),
    back: () => this.setState({ route: null }), backLabel: (H.NAV.find((n) => n.id === S.tab) || H.NAV[0]).label,
    resume: async () => {
      if (!can()) return;
      await this.call(() => this.hq.openRepo(p.path), 'Couldn’t open the folder');
      if (p.dev && !devOn) this.hq.devStart(p.id);
      if (p.recent[0]) this.hq.openFile(p.path, p.recent[0]);
      this.toast('success', 'Opened the folder' + (p.dev && !devOn ? ' · started ' + p.dev : '') + (p.recent[0] ? ' · opened ' + p.recent[0] : '')); FX().event('cheer', 'Back to work!');
    },
    resumeHint: 'Resume opens the folder' + (p.dev ? ', starts ' + p.dev : '') + (p.recent[0] ? ' and opens ' + p.recent[0] : '') + '.',
    dirty: p.dirty || 0, cantCommit: cantWrite || !p.dirty, commit: () => this.openCommit(p.id),
    devLabel: p.dev ? (devOn ? '■ Stop' + (p.port ? ' :' + p.port : '') : '▶ Start dev') : 'No dev command', noDev: cantWrite || !p.dev,
    dev: () => { if (!can()) return; if (devOn) this.stopDev(p.id); else { this.hq.devStart(p.id); this.toast('success', 'Dev server starting · ' + p.dev); } },
    openFolder: () => { if (this.hq) this.call(() => this.hq.openRepo(p.path), 'Couldn’t open the folder'); },
    snapshot: () => { if (!can()) return; this.call(() => this.hq.snapshot(p.path, p.name), 'Snapshot failed'); },
    toggleMore: () => this.setState({ pageMore: !S.pageMore }), moreOpen: S.pageMore,
    logLearning: () => this.setState({ journalKind: 'learning', pageMore: false }), logDecision: () => this.setState({ journalKind: 'decision', pageMore: false }),
    archive: () => { if (!can()) return; this.setState({ pageMore: false }); this.sheet({ act: 'archive', id: p.id, title: 'Archive ' + p.name + '?', body: 'It leaves counts, tasks and the map. Files are not touched, and you can restore it any time from Projects › Archived.', ok: 'Archive', danger: true }); },
    brief: [['is', p.stack.slice(0, 3).join(' · ') || '—', 'var(--text)', ''], ['done', p.pct + '%', 'var(--text)', 'est'], ['last', p.lastCommit ? '"' + p.lastCommit + '"' + (p.lastDays != null ? ' · ' + p.lastDays + 'd ago' : '') : 'no commits yet', 'var(--text)', ''], ['wip', p.dirty == null ? 'unknown · no git' : p.dirty + ' uncommitted files', p.dirty ? 'var(--orange)' : 'var(--green)', ''], ['next', nextText, 'var(--accent-text)', '']].map((b) => ({ k: b[0], v: b[1], color: b[2], est: b[3] === 'est' })),
    recent: p.recent.map((f) => ({ name: f.split(/[\\/]/).pop(), open: () => { if (this.hq) this.hq.openFile(p.path, f); } })), hasRecent: p.recent.length > 0,
    next: nextItems, hasNext: nextItems.length > 0, noNext: nextItems.length === 0, nextCount: nextItems.length,
    journal: jr, hasJournal: jr.length > 0, noJournal: jr.length === 0, mirrorNote: 'notes, decisions and learnings · mirrored to your Obsidian vault',
    jKinds: [['note', 'Note'], ['decision', 'Decision'], ['learning', 'Learned']].map(([id, l]) => ({ label: l, go: () => this.setState({ journalKind: id }), style: Object.assign(tabStyle(S.journalKind === id), { height: 30, padding: '0 10px', fontSize: 12 }) })),
    diagTabs, diag: rowsD, secretAlert: p.secrets > 0, secretText: p.secrets + ' likely secret' + (p.secrets > 1 ? 's' : '') + (p.secretWhere ? ' · ' + p.secretWhere : '') + ' · regex match, check it before rotating.',
  };
}
