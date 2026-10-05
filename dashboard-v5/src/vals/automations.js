// Automations render values: runnable list, pinned shelf, library, scheduled.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).
import { libFilters, libView, libCountText, LIB_PAGE, LIB_MORE, usesQuota } from '../logic/library.js';

export const PIN_MAX = 8;   // the shelf copy promises "Pin up to 8"
// LIBRARY rows carry their label only; the spellbook source each label counts (adapter.mjs LIB)
const LIB_SOURCE = { 'Claude skills': 'skill', 'Claude commands': 'command', Plugins: 'plugin', 'Scheduled tasks': 'task', 'npm scripts': 'npm', Scripts: 'script', WorkspaceHQ: 'grimoire' };

// a filter chip: smaller than the sub tabs, outlined when off so a row of them reads as choices
const chipStyle = (on) => ({ height: 26, padding: '0 10px', cursor: 'pointer', fontFamily: 'var(--term)', fontSize: 12, borderRadius: 999, whiteSpace: 'nowrap', background: on ? 'color-mix(in oklab, var(--gold) 14%, transparent)' : 'transparent', color: on ? 'var(--accent-text)' : 'var(--muted)', border: '1px solid ' + (on ? 'color-mix(in oklab, var(--gold) 55%, transparent)' : 'var(--frame)'), transition: 'background .15s, color .15s, border-color .15s' });

export function automationsVals(ctx) {
  const { S, H, sub, cantWrite, writeReason } = ctx;
  // ---- automations ----
  const INTER = H.INTERACTIVE || [];
  const autoRow = (a) => {
    const pinned = S.pinned.includes(a.id);
    // an interactive (channeled) item opens a terminal; it goes through the same confirm-first run
    const term = a.kind === 'interactive' || a.mode === 'terminal';
    return { icon: a.icon, name: a.name, desc: a.desc || a.cmd, cat: a.cat, mode: term ? 'Terminal' : 'Background', modeTone: term ? 'blue' : 'default', kindLabel: a.kind === 'chain' ? 'Chain · ' + (a.steps || []).length + ' steps' : a.kind, quota: usesQuota(a),
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
  // P6: everything the app can run (background, then interactive), filtered by kind,
  // source and category together with the search; the list is capped (Show more)
  const pool = H.AUTOS.concat(INTER);
  const lf = libFilters(S), lv = libView(pool, lf);
  const autos = lv.list.map(autoRow);
  const shelf = pool.filter((a) => S.pinned.includes(a.id)).map(autoRow);
  const chipOf = (key) => (c) => ({ label: c.label + ' · ' + c.n, title: c.title || '', on: c.on, style: chipStyle(c.on), go: () => this.setLibFilter(key, c.id) });
  const allChip = (key, n, on) => ({ label: 'All · ' + n, title: '', on, style: chipStyle(on), go: () => this.setLibFilter(key, 'all') });
  const srcAll = lv.sources.reduce((t, c) => t + c.n, 0), schAll = lv.schools.reduce((t, c) => t + c.n, 0);
  const libMoreN = Math.min(LIB_MORE, lv.matches - lv.shown);
  const canRescan = !cantWrite && !!(this.hq && typeof this.hq.rescanSpellbook === 'function');
  const libMax = Math.max(1, ...H.LIBRARY.map((l) => l[1]));
  const bySource = (H.autoCounts && H.autoCounts.bySource) || {};
  // per row: what the spellbook says can run here / opens a terminal; the rest is reference only
  const lib = H.LIBRARY.map(([name, total, runnable]) => {
    const term = (bySource[LIB_SOURCE[name]] || {}).interactive || 0;
    const why = [runnable ? runnable + ' can run here' : '', term ? term + ' open in a terminal' : ''].filter(Boolean).join(' · ') || 'reference only · can’t run from the app';
    return { name, total, runnable, w: Math.round(total / libMax * 100), why };
  });
  // the Library intro, from the spellbook's own counts (was a fixed "980 … Only 29" in the design)
  const libTotal = H.autoTotal || 0, libBg = H.AUTOS.length, libTerm = INTER.length;
  const libIntro = libTotal + ' thing' + (libTotal === 1 ? ' is' : 's are') + ' catalogued. ' + libBg + ' run' + (libBg === 1 ? 's' : '') + ' here in the background and ' + libTerm + ' open' + (libTerm === 1 ? 's' : '') + ' in a terminal; the rest are reference only, so they have no Run button here.';
  return {
    isRunnable: sub === 'runnable', isLibrary: sub === 'library', isScheduled: sub === 'scheduled', autos, shelf, hasShelf: shelf.length > 0, noShelf: shelf.length === 0, lib, libIntro, scheduled: H.SCHEDULED, autoQuery: S.autoQuery || '', onAutoQuery: (e) => this.setState({ autoQuery: e.target.value, libShow: LIB_PAGE }), noAutos: autos.length === 0,
    // P6 filters: kind / source / category chips (counts = what each chip would show), "N of M", Clear, Show more
    libKinds: lv.kinds.map(chipOf('kind')),
    libSources: [allChip('source', srcAll, !lf.source)].concat(lv.sources.map(chipOf('source'))),
    libSchools: [allChip('school', schAll, !lf.school)].concat(lv.schools.map(chipOf('school'))),
    libCount: libCountText(lv), libFiltered: lv.filtered, clearLibFilters: () => this.clearLibFilters(),
    libMore: libMoreN > 0, libMoreLabel: 'Show ' + libMoreN + ' more', libShowMore: () => this.libShowMore(),
    // Rescan (spellbook only, the window reloads): needs the live app
    rescanLib: () => this.rescanLib(), rescanOff: !canRescan || !!S.libRescanning, rescanLabel: S.libRescanning ? 'Rescanning…' : '↻ Rescan',
    rescanTitle: canRescan ? 'Rescan skills, scripts and tasks only (fast, no full scan) · the window reloads' : (writeReason || 'Needs the live app — this window can’t rescan'),
  };
}
