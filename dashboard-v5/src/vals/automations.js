// Automations render values: runnable list, pinned shelf, library, scheduled.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export const PIN_MAX = 8;   // the shelf copy promises "Pin up to 8"
// LIBRARY rows carry their label only; the spellbook source each label counts (adapter.mjs LIB)
const LIB_SOURCE = { 'Claude skills': 'skill', 'Claude commands': 'command', Plugins: 'plugin', 'Scheduled tasks': 'task', 'npm scripts': 'npm', Scripts: 'script', WorkspaceHQ: 'grimoire' };

export function automationsVals(ctx) {
  const { S, H, sub } = ctx;
  // ---- automations ----
  const q = S.autoQuery.trim().toLowerCase();
  const autoRow = (a) => {
    const pinned = S.pinned.includes(a.id);
    return { icon: a.icon, name: a.name, desc: a.desc || a.cmd, cat: a.cat, mode: 'Background', modeTone: 'default', kindLabel: a.kind === 'chain' ? 'Chain · ' + (a.steps || []).length + ' steps' : a.kind, quota: false,
      last: a.last ? (a.last.ok ? '✓ ' + a.last.ago : '✗ failed ' + a.last.ago) : 'never run', lastColor: a.last ? (a.last.ok ? 'var(--green)' : 'var(--red)') : 'var(--faint)',
      run: () => this.askRun(a), pin: () => togglePin(a.id), pinLabel: pinned ? '★' : '☆', pinTitle: pinned ? 'Unpin' : 'Pin to shelf', pinColor: pinned ? 'var(--gold)' : 'var(--faint)' };
  };
  // read the current list, not the render-time one: two quick clicks must not pass the cap
  const togglePin = (id) => {
    const cur = this.state.pinned;
    if (cur.includes(id)) return this.setState((s) => ({ pinned: s.pinned.filter((x) => x !== id) }));
    if (cur.length >= PIN_MAX) return this.toast('info', 'Pin up to ' + PIN_MAX + ' — unpin one first');
    this.setState((s) => ({ pinned: s.pinned.includes(id) ? s.pinned : s.pinned.concat([id]) }));
  };
  const autos = H.AUTOS.filter((a) => !q || (a.name + ' ' + a.desc + ' ' + a.cat + ' ' + a.cmd).toLowerCase().includes(q)).map(autoRow);
  const shelf = H.AUTOS.filter((a) => S.pinned.includes(a.id)).map(autoRow);
  const libMax = Math.max(1, ...H.LIBRARY.map((l) => l[1]));
  const bySource = (H.autoCounts && H.autoCounts.bySource) || {};
  // per row: what the spellbook says can run here / opens a terminal; the rest is reference only
  const lib = H.LIBRARY.map(([name, total, runnable]) => {
    const term = (bySource[LIB_SOURCE[name]] || {}).interactive || 0;
    const why = [runnable ? runnable + ' can run here' : '', term ? term + ' open in a terminal' : ''].filter(Boolean).join(' · ') || 'reference only · can’t run from the app';
    return { name, total, runnable, w: Math.round(total / libMax * 100), why };
  });
  // the Library intro, from the spellbook's own counts (was a fixed "980 … Only 29" in the design)
  const libTotal = H.autoTotal || 0, libBg = H.AUTOS.length, libTerm = (H.INTERACTIVE || []).length;
  const libIntro = libTotal + ' thing' + (libTotal === 1 ? ' is' : 's are') + ' catalogued. ' + libBg + ' run' + (libBg === 1 ? 's' : '') + ' here in the background and ' + libTerm + ' open' + (libTerm === 1 ? 's' : '') + ' in a terminal; the rest are reference only, so they have no Run button here.';
  return {
    isRunnable: sub === 'runnable', isLibrary: sub === 'library', isScheduled: sub === 'scheduled', autos, shelf, hasShelf: shelf.length > 0, noShelf: shelf.length === 0, lib, libIntro, scheduled: H.SCHEDULED, autoQuery: S.autoQuery, onAutoQuery: (e) => this.setState({ autoQuery: e.target.value }), noAutos: autos.length === 0,
  };
}
