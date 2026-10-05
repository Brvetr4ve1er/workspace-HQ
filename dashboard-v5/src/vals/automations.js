// Automations render values: runnable list, pinned shelf, library, scheduled.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function automationsVals(ctx) {
  const { S, H, sub } = ctx;
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
  return {
    isRunnable: sub === 'runnable', isLibrary: sub === 'library', isScheduled: sub === 'scheduled', autos, shelf, hasShelf: shelf.length > 0, noShelf: shelf.length === 0, lib, scheduled: H.SCHEDULED, autoQuery: S.autoQuery, onAutoQuery: (e) => this.setState({ autoQuery: e.target.value }), noAutos: autos.length === 0,
  };
}
