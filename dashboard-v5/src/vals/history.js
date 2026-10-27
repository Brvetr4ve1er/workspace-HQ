// History render values: trends, timeline weeks, milestones.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

// a timeline event with no project opens where that kind of event lives (button sweep 2026-10-27: these were no-ops)
const EVENT_GO = {
  level_up: ['history', 'milestones'], new_achievement: ['history', 'milestones'], quest_completed: ['tasks', 'ranked'],
  spell_learned: ['automations', 'library'], spell_mastery_up: ['automations', 'library'], spell_of_day_cast: ['automations', 'library'], spellcraft_xp: ['automations', 'library'],
};

export function historyVals(ctx) {
  const { S, H, off, snap, sub, tabStyle } = ctx;
  // ---- history ----
  const rng = S.trendRange;
  const mk = (metric, label, good) => { const span = this.span(rng, off), vals = span.map((o) => this.series(metric, o)); const d = vals[vals.length - 1] - vals[0]; return { label, value: vals[vals.length - 1], delta: (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '± ') + d, dColor: d === 0 ? 'var(--faint)' : ((d < 0) === (good === 'down') ? 'var(--green)' : 'var(--orange)'), pts: this.sparkPts(vals, 300, 70), min: Math.min(...vals), max: Math.max(...vals), basis: 'based on ' + vals.length + ' scan' + (vals.length === 1 ? '' : 's') }; };
  const trends = [mk('unc', 'Uncommitted files', 'down'), mk('tasks', 'Open tasks', 'down'), mk('commits', 'Commits per scan', 'up'), mk('xp', 'XP', 'up')];
  const ranges = [14, 30, 90].map((n) => ({ label: n + ' scans', go: () => this.setState({ trendRange: n }), style: tabStyle(rng === n) }));
  const weeks = H.WEEKS.map((w) => ({ w: w.w, stats: w.stats, ev: w.ev.map((e) => { const to = e[3] ? null : EVENT_GO[e[5]] || null;
    return { g: e[0], t: e[1], d: e[2], color: e[4], off: !e[3] && !to, open: e[3] ? () => this.openProject(e[3]) : to ? () => this.go(to[0], to[1]) : () => {} }; }), quiet: w.quiet + ' quiet scan' + (w.quiet === 1 ? '' : 's') }));
  const ach = snap.ACH.map((a) => {
    const un = a.unlocked, need = a.need, have = a.have;
    return { ring: un ? 'color-mix(in oklab, var(--gold) 60%, transparent)' : 'var(--frame)', op: un ? 1 : 0.6, filter: un ? 'none' : 'grayscale(1)', hasProgress: !!(need && !un), icon: a.icon, name: a.name, desc: a.desc, unlocked: un, progress: need && !un ? Math.round(have / need * 100) : undefined, progressLabel: need && !un ? have + ' / ' + need : undefined, group: un ? 0 : need ? 1 : 2 };
  });
  const achGroups = [['Unlocked', 0], ['In progress', 1], ['Locked', 2]].map(([l, g]) => ({ label: l, items: ach.filter((a) => a.group === g), count: ach.filter((a) => a.group === g).length })).filter((g) => g.count);
  return {
    isTrends: sub === 'trends', isTimeline: sub === 'timeline', isMilestones: sub === 'milestones', trends, ranges, weeks, hasWeeks: weeks.length > 0, noWeeks: weeks.length === 0, achGroups,
  };
}
