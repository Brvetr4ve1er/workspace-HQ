// Shell render values: header (date chip, signals, scan, level / XP), side rail and
// bottom nav, screen header and sub-tabs, prompt bar, status rail, settings, the
// keyboard sheet and toasts.
import { FX } from '../logic/shared.js';
import { machineIssues, machineVerdict } from '../logic/system.js';

export function shellVals(ctx) {
  const { S, H, LIVE, off, live, ps, cantWrite, writeReason, snap, viewedLabel, projects, open, unc, unp, sec, level, L, ambientDocked, v, ok, onPage, sub, subs, tabStyle, TR, rows, top, tierCount, TK } = ctx;
  const subTabs = subs.map(([id, label]) => ({ label, go: () => this.setSub(id), style: tabStyle(sub === id), sel: sub === id }));
  const runningSessions = LIVE.sessions.filter((x) => x.status === 'running').length;
  const navBadge = { tasks: open.length ? [open.length, 'var(--red)'] : null, claude: runningSessions ? [runningSessions, 'var(--gold)'] : null, social: H.POSTS.length ? [H.POSTS.length, 'var(--red)'] : null };
  const GRP = { home: 'work', automations: 'automate', history: 'insight', life: 'life' };
  // current: null (not undefined) on the other tabs: an attribute bound to undefined counts as a
  // never-resolved hole (dc/runtime.js compileAttr); null just removes aria-current
  const nav = H.NAV.map((n, i) => {
    const a = S.tab === n.id && !onPage, b = navBadge[n.id];
    return Object.assign({}, n, {
      digit: String((i + 1) % 10), delay: String(i * 45), group: GRP[n.id] || '', showGroup: !!GRP[n.id] && L.railLabels, showDivider: !!GRP[n.id] && !L.railLabels && i > 0, go: () => this.go(n.id), current: a ? 'page' : null, title: n.label + ' (' + ((i + 1) % 10) + ')', hasBadge: !!b, badge: b ? b[0] : '',
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
  // ----- screen header -----
  const screenTitle = (H.NAV.find((n) => n.id === S.tab) || {}).label;
  // what can run here: the background automations and the interactive ones (they open a
  // terminal), worded like the Library intro (vals/automations.js libIntro)
  const bgN = H.AUTOS.length, termN = (H.INTERACTIVE || []).length;
  const runnableSub = [bgN + (bgN === 1 ? ' runs' : ' run') + ' in the background', termN ? termN + (termN === 1 ? ' opens' : ' open') + ' a terminal' : ''].filter(Boolean).join(' · ');
  const screenSub = {
    projects: projects.length + ' tracked · ' + snap.archived.length + ' archived',
    tasks: open.length + ' open · ' + tierCount('red') + ' critical · from the ' + (live ? 'latest' : viewedLabel) + ' scan',
    automations: H.autoTotal + ' catalogued · ' + runnableSub,
    claude: runningSessions + ' running · uses Claude quota',
    history: 'trends, timeline and milestones · ' + H.N + ' snapshots',
    system: H.pcScannedAt ? 'Machine checked ' + new Date(Date.parse(H.pcScannedAt)).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · live, not historical' : 'No machine check yet',
    life: 'screen time and notes',
    social: (LIVE.social && Array.isArray(LIVE.social.ACCOUNTS) ? LIVE.social.ACCOUNTS.length : 0) + ' of ' + H.PLATFORMS.length + ' accounts connected · Instagram & Facebook archive · vault: ' + ((LIVE.socialVault && LIVE.socialVault.vault) || 'VEEMO CORTEX'),
    studio: H.CAPTURES.length + ' captures · Ctrl Alt S to snip, Ctrl Alt R opens the recorder',
  }[S.tab] || '';
  // ----- toasts -----
  const toasts = S.toasts.map((t) => ({ text: t.text, color: TK[t.kind], ref: this.toastRef(t.id), hasUndo: !!t.undo && !!this._pending['done:' + t.undo], undo: () => this.undoTask(t.undo), hasCancel: !!t.runSpell, cancel: () => this.cancelRun(t.runSpell), close: () => this.dismissToast(t.id), isProgress: t.kind === 'progress' }));
  // ----- ambient rail -----
  // the Machine card says what System says: the same issue list (pc-health organs + the local
  // model), the same fixed set and the same "not checked yet" rule (logic/system.js)
  const machVerdict = machineVerdict(machineIssues(H.ISSUES, LIVE.llm), S.fixed, { scannedAt: H.pcScannedAt, fresh: !!LIVE.pcHealth });
  const mach = LIVE.machine, devList = Object.keys(LIVE.dev).filter((k) => LIVE.dev[k]);
  const siteMins = this.sum(H.SITES, (s) => s[1]);
  const amb = [
    { label: 'Do now', title: top ? top.title : 'Nothing on fire', sub: top ? (this.pname(top.proj) || 'Workspace') + ' · press F to focus' : 'Board is clear', color: top ? TR[top.tier].color : 'var(--green)', go: () => (top ? this.startFocus(top.id) : this.go('home')) },
    { label: 'Running', title: running ? running + ' running' : 'Nothing running', sub: devList.length ? 'Dev server · ' + devList.map((d) => this.pname(d)).join(', ') : 'No dev servers', color: running ? 'var(--gold)' : 'var(--faint)', go: () => this.setState({ runsOpen: true, ambientOverlay: false }) },
    { label: 'Machine', title: machVerdict.short, sub: mach ? 'CPU ' + Math.round(mach.cpu) + '% · RAM ' + Math.round(mach.ram) + '%' : 'live vitals in the app only', color: machVerdict.color, go: () => this.go('system', 'machine') },
    { label: 'Claude', title: runningSessions + ' session' + (runningSessions === 1 ? '' : 's') + ' running', sub: (LIVE.sessions.find((x) => x.status === 'running') || {}).title || '—', color: 'var(--purple)', go: () => this.go('claude', 'sessions') },
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
    // (the prototype's "Notifications" switch was cut: nothing reads it)
  ];
  // ----- scan state (contract C-2, logic/runs.js scanStatus) -----
  const sc = this.scanStatus();
  const scanTitle = cantWrite ? writeReason
    : sc.running ? sc.label + ' · it reloads the window when it finishes'
    : sc.failed ? sc.label + (sc.error ? ' · ' + sc.error : '') + ' · Scan now to try again'
    : 'Scan now · re-reads every project (uses Claude quota)';
  // ----- streak: consecutive days the scanner ran, at the viewed snapshot -----
  const streak = Math.max(0, Math.floor(+snap.account.streak || 0));
  const streakTitle = streak ? streak + (streak === 1 ? ' day' : ' days') + ' in a row the scanner ran' : 'No scan streak right now';   // 0 = no run of consecutive scan days at this snapshot (a broken streak too)
  const themeOpts = [['dark', 'Dark'], ['light', 'Light'], ['os', 'Follow system']].map(([id, l]) => ({ label: l, go: () => this.setState({ themePref: id }), style: tabStyle(S.themePref === id) }));
  return {
    themeName: this.themeName(), L, v, cantWrite, writeReason, isPast: !live, noBridge: ps === 'nobridge' || !this.hq, viewedLabel,
    goHome: () => this.go('home'), backToLive: () => this.setState({ snapOffset: 0, scrubOpen: false }),
    dateChipStyle, dateChipLabel: live ? (L.wide ? 'Live · ' : '') + viewedLabel : (L.wide ? 'Viewing ' : '') + viewedLabel, dateDot: live ? 'var(--green)' : '#fff',
    toggleScrub: () => this.setState({ scrubOpen: !S.scrubOpen }), signals, sigCompact,
    showPrompt: ok && !onPage, promptHints: ['commit ' + ((rows[0] || {}).name || 'a project').toLowerCase(), 'run full scan', top ? 'focus ' + top.title.toLowerCase().split(' ').slice(0, 3).join(' ') : 'what changed this week?', 'which projects are stale?', 'theme light', 'open ' + ((rows[1] || rows[0] || {}).name || 'a project').toLowerCase()].join('|'),
    isScanning: sc.running, notScanning: !sc.running, scanSpin: (sc.label || 'Scanning').replace(/…$/, ''),
    streakDays: String(streak), streakTitle,
    // three ways in: the bundle didn't read (boot's error text), no scan yet, or the ?state=error preview over good data
    errorText: this.props.errorText || (H.hasData ? 'Preview of the error screen (?state=error) · the data bundle loaded fine' : 'No scan data yet — run a scan, then reload'),
    errorLead: this.props.errorText ? 'The data bundle couldn’t be read. Your place is kept — nothing was lost.' : H.hasData ? 'Nothing failed: this is the error screen’s preview.' : 'There’s no scan in the data bundle yet.',
    hasScreenModel: ['projects', 'automations', 'history', 'system'].includes(S.tab) && !onPage && L.wide, screenModel: { projects: 'model:folder', automations: 'model:gear', history: 'model:trophy', system: 'model:computer' }[S.tab] || 'model:gear',
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // shell
    scanLabel: sc.label || 'Last scan ' + S.lastScan, scanTitle, scanNow: () => this.scanNow(),
    // data overhaul Front A2: the live scan's age (+ how old its estimates are); only the live view gets the badge
    scanStale: !sc.label && live && H.FRESH.stale, scanStaleText: '· ' + H.FRESH.badge, scanFreshTip: H.FRESH.note,
    running, hasRunning: running > 0, toggleRuns: () => this.setState({ runsOpen: !S.runsOpen }), openRuns: () => this.setState({ runsOpen: true }),
    openPalette: () => { this.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); FX().sfx('open'); },
    toggleFocus: () => this.toggleFocus(), toggleTheme: () => this.toggleTheme(), openSettings: () => this.setState({ settingsOpen: true }), openCheat: () => this.setState({ cheatOpen: true }),
    showAmbient: ok && (ambientDocked || S.ambientOverlay), showAmbientToggle: !ambientDocked, ambientOverlayOpen: !ambientDocked && S.ambientOverlay, toggleAmbientOverlay: () => this.setState({ ambientOverlay: !S.ambientOverlay }), amb, ambientStyle,
    xpRef: this.xpRef, level: Object.assign({}, level, { t: level.t.split(' ').pop() }), displayXp: live ? S.displayXp : this.xpAt(off), levelBar: level.pct, levelTitle: 'Level ' + level.l + ' · ' + level.t + (level.next ? ' · ' + level.toNext + ' xp to level ' + (level.l + 1) : ' · max level'),
    nav, bottomNav, moreOpen: S.moreOpen, moreNav,
    mainRef: this.mainRef, popIn: this.popIn, slideIn: this.slideIn, shimmer: this.shimmer, pulse: this.pulse, rise: this.rise, barsAnim: this.bars, stop: (e) => e.stopPropagation(),
    retry: () => (this.hq ? this.scanNow() : location.reload()),
    screenTitle, screenSub, subTabs, hasSubTabs: subTabs.length > 0,
    // settings, keyboard sheet, refresh pill, toasts
    settingsOpen: S.settingsOpen, closeSettings: () => this.setState({ settingsOpen: false }), themeOpts, settings,
    // whether main managed to register each hotkey isn't reported to this window, so no ok / conflict status
    hotkeys: H.HOTKEYS.map((h) => ({ k: h[0], d: h[1], st: '', color: 'var(--faint)' })), keys: H.KEYS.map((k) => ({ k: k[0], d: k[1] })),
    cheatOpen: S.cheatOpen, closeCheat: () => this.setState({ cheatOpen: false }),
    refreshing: S.refreshing, toasts,
  };
}
