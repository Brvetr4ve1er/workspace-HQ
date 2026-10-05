// Project page render values ("pg") and its journal composer.
import { FX } from '../logic/shared.js';

export function projectPageVals(ctx) {
  const { S, off, live, tasks, cantWrite, tabStyle, actText, viewedLabel, projects, onPage } = ctx;
  // ----- project page -----
  let pg = {};
  if (onPage) {
    const p = this.projectsAt(off, true).find((x) => x.id === S.route.id) || projects[0] || null;
    if (p) pg = projectPage.call(this, p, { off, live, tasks, cantWrite, tabStyle, actText, viewedLabel });
  }
  return {
    // journal composer (was in moreVals(), app-more.js)
    journalDraft: S.journalDraft, onJournal: (e) => this.setState({ journalDraft: e.target.value }), journalKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addJournal(); } }, addJournal: () => this.addJournal(),
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    pg,
  };
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
