// Activity panel (runs tab) and run-confirm render values.
import { hhmm } from '../logic/shared.js';
import { usesQuota } from '../logic/library.js';

// "HH:MM" from an ISO string or ms epoch; '' when it doesn't parse
const clock = (t) => { const ms = typeof t === 'number' ? t : Date.parse(t); return Number.isFinite(ms) ? hhmm(new Date(ms)) : ''; };
// A run's meta line as people read it: an unknown exit code reads "exit code unknown"
// and a line never starts with a dangling " · ". Every producer now builds it that way at
// the source (live/adapter.mjs exitLabel for the history's RUNS and last.err, store.js
// onCastDone for live casts), so this rewrite is only the safety net for a producer that
// slips; library.test.mjs pins it.
export function runMeta(m) {
  const s = String(m == null ? '' : m).replace(/\bexit (?:\?|undefined|null)$/, 'exit code unknown');
  return s.replace(/^\s*·\s*/, '');
}

export function runsVals(ctx) {
  const { S, H, LIVE, tabStyle } = ctx;
  // ----- runs: the scan, live casts, dev servers, opened terminals, then history -----
  const RS = { running: ['Running', 'var(--gold)'], ok: ['Finished', 'var(--green)'], failed: ['Failed', 'var(--red)'], cancelled: ['Cancelled', 'var(--faint)'], opened: ['Terminal', 'var(--blue)'], stopped: ['Stopped', 'var(--faint)'] };
  const runRow = (r) => { const rs = RS[r.status] || [String(r.status || 'Unknown'), 'var(--muted)']; return { name: r.name, meta: runMeta(r.meta), started: r.started || '', status: rs[0], color: rs[1], isRunning: r.status === 'running', canCancel: r.status === 'running' && r.kind === 'auto', isDev: r.status === 'running' && r.kind === 'dev', cancel: () => this.cancelRun(r.spellId), stop: () => this.stopDev(r.devId), expanded: S.expandedRun === r.id, toggle: () => this.setState({ expandedRun: S.expandedRun === r.id ? null : r.id }), out: (r.out || []).join('\n') || (r.status === 'running' ? 'Waiting for output…' : 'No output kept for this run.'), progress: r.status === 'running' ? 50 : 100 }; };
  // the full scan, from main's scan state (hydrated on load, then pushed): survives the reload, shows a failure
  const sc = this.scanStatus();
  const scanRuns = sc.running || sc.failed || sc.done ? [{
    id: 'scan', kind: 'scan', name: 'Full scan', status: sc.running ? 'running' : sc.failed ? 'failed' : 'ok', started: clock(sc.startedAt),
    meta: sc.running ? 'run-pipeline.ps1 · the window reloads when it finishes'
      : sc.failed ? (sc.code != null && sc.code >= 0 ? 'exit ' + sc.code : sc.code === -1 ? 'didn’t start' : 'failed') + (clock(sc.endedAt) ? ' at ' + clock(sc.endedAt) : '') + ' · see workspace hq/logs'
      : 'finished' + (clock(sc.endedAt) ? ' at ' + clock(sc.endedAt) : '') + ' · run-pipeline.ps1',
    out: sc.running ? ['The scan writes to workspace hq/logs; its output doesn’t stream here.'] : sc.error ? [sc.error] : [],
  }] : [];
  // casts; a chain's member casts sit under the chain, labelled as part of it. Members are matched by the
  // event's chainId when the store keeps one, else by the chain's step list (spellbook chains list member ids)
  const casts = Object.values(LIVE.casts);
  const stepsOf = (c) => ((this.auto(c.spellId) || {}).steps || []);
  const isChain = (c) => !!c.chain || (this.auto(c.spellId) || {}).kind === 'chain';
  const chains = casts.filter(isChain);
  const chainOf = (c) => {
    if (isChain(c)) return null;
    if (c.chainId) return chains.find((k) => k.castId === c.chainId) || null;
    const cands = chains.filter((k) => stepsOf(k).includes(c.spellId) && (k.t0 || 0) <= (c.t0 || 0) && !(k.done && !c.done));
    return cands.sort((a, b) => b.t0 - a.t0)[0] || null;
  };
  const castRun = (c, chain) => {
    const steps = chain ? stepsOf(chain) : [], k = steps.indexOf(c.spellId);
    const part = chain ? 'part of ' + chain.name + (k >= 0 ? ' · step ' + (k + 1) + ' of ' + steps.length : '') : '';
    const base = c.done ? (c.meta || '') : 'running';
    return { id: c.castId, kind: 'auto', spellId: c.spellId, name: (chain ? '↳ ' : '') + c.name, status: c.done ? c.status : 'running', meta: [base, part].filter(Boolean).join(' · '), started: clock(c.t0), out: c.out };
  };
  const members = new Map(), top = [];
  for (const c of casts) { const ch = chainOf(c); if (ch) (members.get(ch.castId) || members.set(ch.castId, []).get(ch.castId)).push(c); else top.push(c); }
  const liveRuns = top.sort((a, b) => b.t0 - a.t0).flatMap((c) => [castRun(c, null)].concat((members.get(c.castId) || []).sort((a, b) => a.t0 - b.t0).map((m) => castRun(m, c))));
  const devRuns = Object.entries(LIVE.dev).filter(([, d]) => d).map(([id, d]) => {
    const since = clock(d.since);
    return { id: 'dev:' + id, kind: 'dev', devId: id, name: 'Dev server · ' + this.pname(id), status: 'running', meta: (this.proj(id) || {}).dev || '', started: since ? 'running since ' + since : 'running', out: ['This window doesn’t capture dev server output.'] };
  });
  const runs = scanRuns.concat(devRuns, liveRuns, S.localRuns, H.INITIAL_RUNS).map(runRow);
  // ----- run confirm -----
  let confirm = {};
  const ca = S.confirm ? this.auto(S.confirm) : null;
  if (ca) {
    // main's "confirm first" answer carries the command as it is now; show that, not data.js's copy
    const pv = S.confirmPreview && S.confirmPreview.id === ca.id ? S.confirmPreview : null;
    // an interactive (channeled) item opens a terminal: its output never comes back here
    const term = ca.kind === 'interactive' || ca.mode === 'terminal';
    // quota: the command starts the Claude CLI (every Claude skill / command / agent does)
    // last: an interactive run only opened a terminal (last.opened): it never reads "finished"
    const cmdNow = (pv && pv.cmd) || ca.cmd;
    confirm = { icon: ca.icon, name: ca.name, desc: ca.desc || 'No description', kind: term ? 'Opens a terminal · output stays there' : 'Runs in the background · tracked in Activity', kindTone: term ? 'blue' : 'green', cmd: cmdNow, dir: (pv && pv.dir) || ca.dir, quota: usesQuota({ cmd: cmdNow }), steps: (ca.steps || []).map((s, i) => ({ n: i + 1, s })), hasSteps: !!ca.steps, destructive: !!ca.destructive, last: ca.last ? (ca.last.opened ? 'Last opened in a terminal ' + ca.last.ago : ca.last.ok ? 'Last run ' + ca.last.ago + ' · finished' : 'Last run ' + ca.last.ago + ' · failed (' + runMeta(ca.last.err) + ')') : 'Never run from here', lastColor: ca.last ? (ca.last.opened ? 'var(--muted)' : ca.last.ok ? 'var(--green)' : 'var(--red)') : 'var(--faint)',
      askOpts: [['always', 'Ask every time'], ['never', 'Don’t ask again for this exact command']].map(([id, l]) => ({ label: l, on: S.confirmAsk === id ? '●' : '○', go: () => this.setState({ confirmAsk: id }), disabled: id === 'never' && !!ca.destructive })) };
  }
  // the confirm dialog takes focus when it opens (one stable callback, so it runs once per open, not per render)
  if (!this._confirmRef) this._confirmRef = (el) => {
    if (typeof this.popIn === 'function') this.popIn(el);
    if (!el || typeof el.focus !== 'function') return;
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (!a || !el.contains(a)) el.focus({ preventScroll: true });
  };
  return {
    confirmRef: this._confirmRef,
    actTabs: [['runs', 'Runs'], ['notes', 'Notifications']].map(([id, l]) => ({ label: l, go: () => this.setState({ actTab: id }), style: tabStyle(S.actTab === id) })), isRunsTab: S.actTab === 'runs', isNotesTab: S.actTab === 'notes',
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // activity
    runsOpen: S.runsOpen, closeRuns: () => this.setState({ runsOpen: false }), runs,
    // run confirm
    hasConfirm: !!ca, confirm, cancelConfirm: () => this.setState({ confirm: null, confirmHash: null, confirmPreview: null }), confirmRun: () => this.confirmRun(),
  };
}
