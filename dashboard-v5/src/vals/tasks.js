// Tasks render values: tier filters, ranked / by-project rows, ideas & risks, cleared today.

export function tasksVals(ctx) {
  const { S, H, live, snap, tasks, open, sub, tabStyle, tk, tierCount } = ctx;
  // ----- tasks -----
  const taskFilters = [['all', 'All', open.length], ['red', 'Critical', tierCount('red')], ['orange', 'Important', tierCount('orange')], ['yellow', 'Housekeeping', tierCount('yellow')]].map(([id, l, n]) => ({ label: l + ' ' + n, go: () => this.setState({ taskFilter: id }), style: tabStyle(S.taskFilter === id) }));
  const filt = tasks.filter((t) => S.taskFilter === 'all' || t.tier === S.taskFilter);
  const trow = (t) => {
    const done = S.recentDone.includes(t.id);
    return Object.assign(tk(t), { isTask: true, isHeader: false, age: t.age + 'd old', isDone: done, isOpen: !done, inProgress: !!t.inProgress, ring: done ? 'var(--green)' : 'var(--frame)', opacity: done ? 0.7 : 1, claude: () => this.sendClaude(t.title, t.proj) });
  };
  let taskRows = [];
  if (sub === 'byproject') {
    const byP = {}; filt.forEach((t) => { (byP[t.proj || ''] = byP[t.proj || ''] || []).push(t); });
    Object.keys(byP).forEach((pid) => { taskRows.push({ isHeader: true, isTask: false, label: (this.pname(pid) || 'Workspace') + ' · ' + byP[pid].length, open: () => this.openProject(pid) }); byP[pid].forEach((t) => taskRows.push(trow(t))); });
  } else taskRows = filt.map(trow);
  const KIND = H.KIND;
  const ideaRows = live ? this.ideasAt().map((i) => ({ kind: KIND[i.kind][0], tone: KIND[i.kind][1], ai: i.ai, title: i.title, proj: i.projName, open: () => (i.proj ? this.openProject(i.proj) : null), meta: 'effort ' + i.effort + ' · impact ' + i.impact + (i.ai ? ' · suggested by AI, unverified' : i.capture ? ' · your capture' : ' · from scan rules'), doIt: (e) => this.doIdea(i, e), doLabel: i.purge ? 'Purge ' + i.purge + '…' : '✓ Did it', claude: () => this.sendClaude(i.title, i.proj), dismiss: () => { this.setState((s) => ({ dismissed: s.dismissed.concat([i.id]) })); this.toast('info', 'Hidden on this PC · the scan still tracks it'); } })) : snap.IDEAS.map((i) => ({ kind: KIND[i.kind][0], tone: KIND[i.kind][1], ai: i.ai, title: i.title, proj: i.projName, open: () => {}, meta: 'effort ' + i.effort + ' · impact ' + i.impact, doIt: () => this.denied(), doLabel: '✓ Did it', claude: () => this.denied(), dismiss: () => this.denied() }));
  const cleared = live ? S.completed.map((id) => H.T0.find((t) => t.id === id)).filter(Boolean).map((t) => ({ title: t.title, xp: t.xp })) : [];
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // tasks
    isRanked: sub === 'ranked' || sub === 'byproject', isIdeas: sub === 'ideas', taskFilters, taskRows, noTasks: taskRows.length === 0, ideaRows, noIdeas: ideaRows.length === 0,
    cleared, hasCleared: cleared.length > 0, clearedXp: this.sum(cleared, (c) => c.xp),
  };
}
