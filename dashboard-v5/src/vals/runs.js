// Activity panel (runs tab) and run-confirm render values.

export function runsVals(ctx) {
  const { S, H, LIVE, tabStyle } = ctx;
  // ----- runs: live casts, dev servers, opened terminals, then history -----
  const RS = { running: ['Running', 'var(--gold)'], ok: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'], cancelled: ['Cancelled', 'var(--faint)'], opened: ['Terminal', 'var(--blue)'], stopped: ['Stopped', 'var(--faint)'] };
  const runRow = (r) => ({ name: r.name, meta: r.meta || '', started: r.started || '', status: RS[r.status][0], color: RS[r.status][1], isRunning: r.status === 'running', canCancel: r.status === 'running' && r.kind === 'auto', isDev: r.status === 'running' && r.kind === 'dev', cancel: () => this.cancelRun(r.spellId), stop: () => this.stopDev(r.devId), expanded: S.expandedRun === r.id, toggle: () => this.setState({ expandedRun: S.expandedRun === r.id ? null : r.id }), out: (r.out || []).join('\n') || (r.status === 'running' ? 'Waiting for output…' : 'No output kept for this run.'), progress: r.status === 'running' ? 50 : 100 });
  const liveRuns = Object.values(LIVE.casts).sort((a, b) => b.t0 - a.t0).map((c) => ({ id: c.castId, kind: 'auto', spellId: c.spellId, name: c.name, status: c.done ? c.status : 'running', meta: c.done ? c.meta : 'running', started: new Date(c.t0).toTimeString().slice(0, 5), out: c.out }));
  const devRuns = Object.entries(LIVE.dev).filter(([, d]) => d).map(([id, d]) => ({ id: 'dev:' + id, kind: 'dev', devId: id, name: 'Dev server · ' + this.pname(id), status: 'running', meta: (this.proj(id) || {}).dev || '', started: new Date(d.since).toTimeString().slice(0, 5), out: [] }));
  const runs = devRuns.concat(liveRuns, S.localRuns, H.INITIAL_RUNS).map(runRow);
  // ----- run confirm -----
  let confirm = {};
  const ca = S.confirm ? this.auto(S.confirm) : null;
  if (ca) {
    confirm = { icon: ca.icon, name: ca.name, desc: ca.desc || 'No description', kind: 'Runs in the background · tracked in Activity', kindTone: 'green', cmd: ca.cmd, dir: ca.dir, quota: false, steps: (ca.steps || []).map((s, i) => ({ n: i + 1, s })), hasSteps: !!ca.steps, destructive: !!ca.destructive, last: ca.last ? (ca.last.ok ? 'Last run ' + ca.last.ago + ' · finished' : 'Last run ' + ca.last.ago + ' · failed (' + ca.last.err + ')') : 'Never run from here', lastColor: ca.last ? (ca.last.ok ? 'var(--green)' : 'var(--red)') : 'var(--faint)',
      askOpts: [['always', 'Ask every time'], ['never', 'Don’t ask again for this exact command']].map(([id, l]) => ({ label: l, on: S.confirmAsk === id ? '●' : '○', go: () => this.setState({ confirmAsk: id }), disabled: id === 'never' && !!ca.destructive })) };
  }
  return {
    actTabs: [['runs', 'Runs'], ['notes', 'Notifications']].map(([id, l]) => ({ label: l, go: () => this.setState({ actTab: id }), style: tabStyle(S.actTab === id) })), isRunsTab: S.actTab === 'runs', isNotesTab: S.actTab === 'notes',
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // activity
    runsOpen: S.runsOpen, closeRuns: () => this.setState({ runsOpen: false }), runs,
    // run confirm
    hasConfirm: !!ca, confirm, cancelConfirm: () => this.setState({ confirm: null }), confirmRun: () => this.confirmRun(),
  };
}
