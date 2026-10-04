// moreVals(): render values for Automations, Claude, History, System, Life and
// Studio. Same names and shapes as the Claude Design prototype.
const FX = () => window.HQFx || { sfx() {}, event() {} };

export function moreVals(out, ctx) {
  const S = this.state, H = this.M, LIVE = this.LIVE, { off, live, tabStyle, projects, snap } = ctx, sub = S.sub[S.tab];
  const ro = () => { if (!this.canWrite()) { this.denied(); return true; } return false; };
  // ---- automations ----
  const q = S.autoQuery.trim().toLowerCase();
  const autoRow = (a) => {
    const pinned = S.pinned.includes(a.id);
    return { icon: a.icon, name: a.name, desc: a.desc || a.cmd, cat: a.cat, mode: 'Background', modeTone: 'default', kindLabel: a.kind === 'chain' ? 'Chain · ' + (a.steps || []).length + ' steps' : a.kind, quota: false,
      last: a.last ? (a.last.ok ? '✓ ' + a.last.ago : '✗ failed ' + a.last.ago) : 'never run', lastColor: a.last ? (a.last.ok ? 'var(--green)' : 'var(--red)') : 'var(--faint)',
      run: () => this.askRun(a), pin: () => this.setState((s) => ({ pinned: pinned ? s.pinned.filter((x) => x !== a.id) : s.pinned.concat([a.id]) })), pinLabel: pinned ? '★' : '☆', pinTitle: pinned ? 'Unpin' : 'Pin to shelf', pinColor: pinned ? 'var(--gold)' : 'var(--faint)' };
  };
  const autos = H.AUTOS.filter((a) => !q || (a.name + ' ' + a.desc + ' ' + a.cat + ' ' + a.cmd).toLowerCase().includes(q)).map(autoRow);
  const shelf = H.AUTOS.filter((a) => S.pinned.includes(a.id)).map(autoRow);
  const libMax = Math.max(1, ...H.LIBRARY.map((l) => l[1]));
  const lib = H.LIBRARY.map(([name, total, runnable]) => ({ name, total, runnable, w: Math.round(total / libMax * 100), why: runnable ? runnable + ' can run here' : name === 'Claude skills' || name === 'Claude commands' ? 'open in a terminal with Claude' : 'reference only · can’t run from the app' }));
  // ---- claude ----
  const SST = { running: ['Running', 'var(--gold)'], done: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'] };
  const sessions = LIVE.sessions.map((x) => ({ title: x.title, proj: this.pname(x.proj), started: x.started, status: SST[x.status][0], color: SST[x.status][1], sel: S.sessionSel === x.id, go: () => this.setState({ sessionSel: x.id }),
    style: { textAlign: 'left', width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', cursor: 'pointer', fontFamily: 'var(--term)', color: 'var(--text)', background: S.sessionSel === x.id ? 'var(--card-hi)' : 'var(--card)', border: '1px solid var(--frame)', borderRadius: 10, boxShadow: '0 0 0 1px ' + (S.sessionSel === x.id ? 'var(--purple)' : 'var(--frame)') } }));
  const selS = LIVE.sessions.find((x) => x.id === S.sessionSel) || LIVE.sessions[0];
  const sessionDetail = selS ? { title: selS.title, proj: this.pname(selS.proj) || 'session', tail: (LIVE.sessionOut[selS.id] || selS.tail.join('\n') || 'No output reached this window yet.').split('\n').slice(-60).join('\n'), running: selS.status === 'running',
    stop: () => { if (this.hq && this.hq.sessionKill) { this.hq.sessionKill(selS.id); this.toast('info', 'Stopping the session'); } },
    term: () => { const p = this.proj(S.composerProj); if (!p || ro()) return; this.hq.claudeQuest(p.path, selS.title); this.toast('info', 'Opened interactive Claude in a terminal · ' + p.name); } } : null;
  const composerProjs = projects.map((p) => ({ label: p.name, go: () => this.setState({ composerProj: p.id }), style: Object.assign(tabStyle(S.composerProj === p.id), { height: 28, padding: '0 8px', fontSize: 12 }) }));
  const TONE = { orange: 'var(--orange)', gold: 'var(--gold)', blue: 'var(--blue)', green: 'var(--green)' };
  const canvas = H.CANVAS.map((w) => ({ title: w.title, isStat: w.type === 'stat', isList: w.type === 'list', isNote: w.type === 'note', value: w.value, note: w.note || 'board · ' + w.board, items: w.items || [], body: w.body, color: TONE[w.tone], span: w.wide ? 'span 2' : 'span 1', pin: () => this.notWired('Pinning canvas cards to Home'), remove: () => this.notWired('Removing canvas cards (boards are append-only for now)') }));
  // ---- history ----
  const rng = S.trendRange;
  const mk = (metric, label, good) => { const span = this.span(rng, off), vals = span.map((o) => this.series(metric, o)); const d = vals[vals.length - 1] - vals[0]; return { label, value: vals[vals.length - 1], delta: (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '± ') + d, dColor: d === 0 ? 'var(--faint)' : ((d < 0) === (good === 'down') ? 'var(--green)' : 'var(--orange)'), pts: this.sparkPts(vals, 300, 70), min: Math.min(...vals), max: Math.max(...vals), basis: 'based on ' + vals.length + ' scan' + (vals.length === 1 ? '' : 's') }; };
  const trends = [mk('unc', 'Uncommitted files', 'down'), mk('tasks', 'Open tasks', 'down'), mk('commits', 'Commits per scan', 'up'), mk('xp', 'XP', 'up')];
  const ranges = [14, 30, 90].map((n) => ({ label: n + ' scans', go: () => this.setState({ trendRange: n }), style: tabStyle(rng === n) }));
  const weeks = H.WEEKS.map((w) => ({ w: w.w, stats: w.stats, ev: w.ev.map((e) => ({ g: e[0], t: e[1], d: e[2], color: e[4], open: e[3] ? () => this.openProject(e[3]) : () => {} })), quiet: w.quiet + ' quiet scan' + (w.quiet === 1 ? '' : 's') }));
  const ach = snap.ACH.map((a) => {
    const un = a.unlocked, need = a.need, have = a.have;
    return { ring: un ? 'color-mix(in oklab, var(--gold) 60%, transparent)' : 'var(--frame)', op: un ? 1 : 0.6, filter: un ? 'none' : 'grayscale(1)', hasProgress: !!(need && !un), icon: a.icon, name: a.name, desc: a.desc, unlocked: un, progress: need && !un ? Math.round(have / need * 100) : undefined, progressLabel: need && !un ? have + ' / ' + need : undefined, group: un ? 0 : need ? 1 : 2 };
  });
  const achGroups = [['Unlocked', 0], ['In progress', 1], ['Locked', 2]].map(([l, g]) => ({ label: l, items: ach.filter((a) => a.group === g), count: ach.filter((a) => a.group === g).length })).filter((g) => g.count);
  // ---- system ----
  const llm = LIVE.llm, llmIssue = llm && (!llm.available || !llm.chatModel) ? [{ id: 'llm', title: llm.available ? 'No local chat model installed' : 'Local model runtime is not running', why: 'Commit drafts fall back to Claude, which uses quota; Ask can’t answer.', fix: llm.available ? 'Pull a chat model with Ollama' : 'Start Ollama', cmd: llm.available ? 'ollama pull qwen2.5:7b-instruct-q4_K_M' : 'ollama serve', safe: false }] : [];
  const issues = H.ISSUES.concat(llmIssue).filter((i) => !S.fixed.includes(i.id)).map((i) => ({ title: i.title, why: i.why, fix: i.fix, cmd: i.cmd || '—',
    run: async () => {
      if (ro()) return;
      if (!i.safe || !this.hq.healthFix) { this.copy(i.cmd, 'Copied · run it in a terminal (this fix isn’t on the safe list)'); return; }
      // safe-listed fixes can still delete things (%TEMP% purge): show the command, then run
      this.sheet({ act: 'fix', cmd: i.cmd, fixTitle: i.fix, title: i.fix + '?', body: 'Runs this PowerShell command now:\n\n' + i.cmd, ok: 'Run fix', danger: /Remove-Item|-Force|\bdel\b|\brm\b|Stop-Process/i.test(i.cmd) });
    },
    copy: () => this.copy(i.cmd, 'Copied · ' + i.cmd) }));
  const vitals = H.VITALS.map((v) => ({ k: v[0], v: v[1], color: v[2] === 'ok' ? 'var(--green)' : v[2] === 'warn' ? 'var(--orange)' : v[2] === 'bad' ? 'var(--red)' : 'var(--faint)' }));
  if (LIVE.machine) vitals.unshift({ k: 'Now', v: 'CPU ' + Math.round(LIVE.machine.cpu) + '% · RAM ' + Math.round(LIVE.machine.ram) + '%', color: 'var(--blue)' });
  const clutter = H.CLUTTER.filter((c) => !S.fixed.includes(c.id)).map((c) => ({ title: c.title, detail: c.detail, verb: c.verb, danger: c.danger, safe: !c.danger, act: () => { if (!this.hq) return this.denied(); this.call(() => this.hq.openRepo('.'), 'Couldn’t open Documents'); this.toast('info', 'Opened Documents · ' + c.detail, { ms: 6000 }); } }));
  const verdictBad = issues.length > 0;
  // ---- life ----
  const sites = H.SITES.slice(0, 12).map((s) => ({ name: s[0], mins: s[1], label: (s[1] >= 60 ? Math.floor(s[1] / 60) + 'h ' : '') + (s[1] % 60) + 'm', w: Math.round(s[1] / Math.max(1, H.SITES[0] ? H.SITES[0][1] : 1) * 100), cat: s[2], color: s[2] === 'Project' ? 'var(--green)' : 'var(--blue)' }));
  const siteMins = this.sum(H.SITES, (s) => s[1]), otherMins = this.sum(H.SITES.filter((s) => s[2] !== 'Project'), (s) => s[1]);
  const lifeRanges = [['window', 'Last 3 days']].map(([id, l]) => ({ label: l, go: () => this.setState({ lifeRange: id }), style: tabStyle(true) }));
  const posts = H.POSTS.map((p) => ({ handle: p.handle, text: p.text, where: p.where, staged: p.staged, open: () => this.toast('info', 'Approve & send happens in the browser extension popup'), skip: () => this.notWired('Discarding a staged post from here') }));
  const vaults = H.VAULTS.map((vv) => ({ name: vv.name, active: vv.active, stale: vv.stale, total: vv.total, aw: Math.round(vv.active / vv.total * 100), sw: Math.round(vv.stale / vv.total * 100), sync: vv.sync, open: () => this.notWired('Opening Obsidian from here'), search: () => this.notWired('Vault search from here') }));
  // ---- studio ----
  const caps = H.CAPTURES.filter((c) => S.studioFilter === 'all' || c.kind === S.studioFilter);
  const days = []; caps.slice(0, 120).forEach((c) => { let d = days.find((x) => x.day === c.day); if (!d) { d = { day: c.day, items: [] }; days.push(d); } d.items.push({ name: c.name, time: c.time, size: c.size, isRec: c.kind === 'rec', dur: '', open: () => this.setState({ lightbox: c.id }) }); });
  const latest = caps[0];
  const lbC = S.lightbox ? H.CAPTURES.find((c) => c.id === S.lightbox) : null;
  const studioFilters = [['all', 'All'], ['snip', 'Snips'], ['rec', 'Recordings']].map(([id, l]) => ({ label: l, go: () => this.setState({ studioFilter: id }), style: tabStyle(S.studioFilter === id) }));
  const studio = this.hq && this.hq.studio;
  return {
    journalDraft: S.journalDraft, onJournal: (e) => this.setState({ journalDraft: e.target.value }), journalKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addJournal(); } }, addJournal: () => this.addJournal(),
    isRunnable: sub === 'runnable', isLibrary: sub === 'library', isScheduled: sub === 'scheduled', autos, shelf, hasShelf: shelf.length > 0, noShelf: shelf.length === 0, lib, scheduled: H.SCHEDULED, autoQuery: S.autoQuery, onAutoQuery: (e) => this.setState({ autoQuery: e.target.value }), noAutos: autos.length === 0,
    isSessions: sub === 'sessions', isCanvas: sub === 'canvas', sessions, hasSessions: sessions.length > 0, sessionDetail: sessionDetail || {}, hasDetail: !!sessionDetail, composer: S.composer, onComposer: (e) => this.setState({ composer: e.target.value }), startSession: () => this.startSession(), composerProjs, canvas, hasCanvas: canvas.length > 0, noCanvas: canvas.length === 0,
    isTrends: sub === 'trends', isTimeline: sub === 'timeline', isMilestones: sub === 'milestones', trends, ranges, weeks, hasWeeks: weeks.length > 0, noWeeks: weeks.length === 0, achGroups,
    isMachine: sub === 'machine', isClutter: sub === 'clutter', issues, hasIssues: issues.length > 0, verdict: verdictBad ? issues.length + ' issue' + (issues.length > 1 ? 's' : '') + ' to look at' : 'Machine OK', verdictColor: verdictBad ? 'var(--orange)' : 'var(--green)', verdictHex: verdictBad ? '#e0a35a' : '#86b98a',
    verdictSub: (H.pcScannedAt ? 'Checked ' + new Date(Date.parse(H.pcScannedAt)).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' with the scan' : 'No machine check yet') + ' · drag the monitor to spin it',
    vitals, clutter, hasClutter: clutter.length > 0, noClutter: clutter.length === 0,
    isScreen: sub === 'screen', isSocial: sub === 'social', isNotes: sub === 'notes', sites, hasSites: sites.length > 0, noSites: sites.length === 0, lifeRanges,
    screenTotal: Math.floor(siteMins / 60) + 'h ' + (siteMins % 60) + 'm', screenShare: siteMins ? Math.round(otherMins / siteMins * 100) + '%' : '—', screenShareLabel: 'on sites not linked to a project',
    posts, hasPosts: posts.length > 0, noPosts: posts.length === 0, mentions: H.MENTIONS, hasMentions: H.MENTIONS.length > 0, vaults, learnings: H.LEARN.map((l) => ({ t: l[0], p: l[1], d: l[2] })), socialEmpty: !LIVE.social.connected,
    days, hasCaps: caps.length > 0, noCaps: caps.length === 0, latest: latest || {}, hasLatest: !!latest, openLatest: () => latest && this.setState({ lightbox: latest.id }), studioFilters,
    snip: () => { if (!studio) return this.denied(); studio.snipArm('region'); },
    record: () => { if (!studio) return this.denied(); studio.panelToggle(); },
    hasLightbox: !!lbC, lb: lbC ? { name: lbC.name, meta: lbC.day + ' ' + lbC.time + ' · ' + lbC.size, isRec: lbC.kind === 'rec' } : {}, closeLightbox: () => this.setState({ lightbox: null }),
    lbOpen: () => lbC && studio && studio.libraryReveal(lbC.path), lbCopy: () => lbC && this.copy(lbC.path, 'Copied the file path'), lbReveal: () => lbC && studio && studio.libraryReveal(lbC.path),
    lbDelete: () => lbC && !ro() && this.sheet({ act: 'delete', path: lbC.path, name: lbC.name, title: 'Delete ' + lbC.name + '?', body: 'It goes to the Recycle Bin.', ok: 'Delete', danger: true }),
  };
}
