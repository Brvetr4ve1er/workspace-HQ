// Home render values: next task, portfolio rows, momentum, changes, weekly recap.

export function homeVals(ctx) {
  const { S, H, LIVE, off, live, snap, viewedLabel, projects, open, tk, rows, rowOf, plural, top } = ctx;
  // ----- home -----
  const momSpan = this.span(14, off), momVals = momSpan.map((o) => this.series(S.momentum === 'xp' ? 'xp' : 'unc', o));
  const md = momVals[momVals.length - 1] - momVals[0];
  const changes = snap.changes.map((c) => ({ g: c.g, t: c.t, c: c.c, open: c.proj ? () => this.openProject(c.proj) : () => this.go('history', 'timeline'), when: viewedLabel }));
  const recap = H.weeklyRecap;
  const recapStats = recap && recap.stats ? ['+' + (recap.stats.xp_gain || 0) + ' xp', plural(recap.stats.quests_completed || 0, 'task'), plural(recap.stats.achievements_unlocked || 0, 'milestone')].join(' · ') + ' · measured' : '';
  // "Worth a re-run" prints the automation's LATEST run ("Failed <ago> · <exit>"), so it only
  // suggests one whose latest run failed: the newest failed run in the history picks it, and
  // an automation that has run fine since that failure is skipped
  const failing = (a) => !!(a && a.last && !a.last.ok);
  const suggest = H.INITIAL_RUNS.filter((r) => r.status === 'failed').map((r) => H.AUTOS.find((a) => a.name === r.name)).find(failing) || null;
  const home = {
    greeting: live ? 'Today' : viewedLabel,
    sub: live ? this.greet() + ' · ' + H.DOW[new Date().getDay()] + ', ' + H.fmtD(new Date()) + ' · ' + (open.filter((t) => t.tier === 'red').length ? open.filter((t) => t.tier === 'red').length + ' critical' : 'nothing critical') : 'Read-only snapshot · the next action as it stood that day',
    hasNext: open.length > 0, isRest: open.length === 0,
    next: top ? Object.assign(tk(top), { inProgress: !!top.inProgress }) : { inProgress: false }, alts: open.slice(1, 3).map(tk), hasAlts: open.length > 1,
    restSub: live ? (S.completed.length ? 'You cleared ' + S.completed.length + ' task' + (S.completed.length > 1 ? 's' : '') + ' this session. Everything else can wait.' : 'No open tasks in the latest scan. Ideas & risks are there if you want them.') : 'Nothing was open on ' + viewedLabel + '.',
    rows: rows.map(rowOf),
    kpiLine: projects.length + ' projects · ' + projects.filter((p) => p.st === 'risk').length + ' at risk · ' + projects.filter((p) => p.st === 'care').length + ' need care',
    avg: Math.round(this.sum(projects, (p) => p.pct) / Math.max(1, projects.length)),
    changes, hasChanges: changes.length > 0, noChanges: changes.length === 0, prevLabel: H.fmtD(H.dayAt(off + 1)),
    mom: { value: momVals[momVals.length - 1], delta: (md > 0 ? '▲ +' : md < 0 ? '▼ ' : '± ') + md, deltaColor: S.momentum === 'xp' ? (md > 0 ? 'var(--green)' : 'var(--faint)') : (md < 0 ? 'var(--green)' : md > 0 ? 'var(--orange)' : 'var(--faint)'), label: S.momentum === 'xp' ? 'Total XP · measured from completed work' : 'Uncommitted files · measured', pts: this.sparkPts(momVals, 280, 56), range: H.fmtD(H.dayAt(momSpan[0])) + ' → ' + viewedLabel + ' · based on ' + momVals.length + ' scans' },
    momTabs: [['unc', 'Uncommitted'], ['xp', 'XP']].map(([id, l]) => ({ label: l, on: S.momentum === id ? 'true' : 'false', go: () => this.setState({ momentum: id }), style: { height: 28, padding: '0 8px', fontFamily: 'var(--term)', fontSize: 12, cursor: 'pointer', background: S.momentum === id ? 'var(--ink)' : 'transparent', color: S.momentum === id ? 'var(--text)' : 'var(--muted)', border: '1px solid ' + (S.momentum === id ? 'var(--frame)' : 'transparent') } })),
    showRecap: live && !!recap && !S.recapDismissed, recapOpen: S.recapOpen,
    recapRange: recap ? H.fmtD(new Date(recap.week_start + 'T12:00')) + ' – ' + H.fmtD(new Date(recap.week_end + 'T12:00')) : '', recapStats, recapAi: !!(recap && recap.ai_narrative),
    recapText: recap ? String(recap.narrative_md || '').replace(/^#+[^\n]*\n?/gm, '').replace(/[*_`>]/g, '').trim() : '',
    suggest: suggest || {}, hasSuggest: live && !!suggest,
  };
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // home
    home, goTasksIdeas: () => this.go('tasks', 'ideas'), goProjects: () => this.go('projects', 'grid'),
    runSuggest: () => home.hasSuggest && this.askRun(suggest), toggleRecap: () => this.setState({ recapOpen: !S.recapOpen }), dismissRecap: () => this.setState({ recapDismissed: true }),
  };
}
