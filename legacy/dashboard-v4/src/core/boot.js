// v4 boot — registers the 9 surfaces, starts the shell, initialises the two
// app-lifetime overlays (command palette, focus mode), and logs one scriptable
// line the smoke/selftest harness asserts on. Adapted from v3's boot.js MINUS
// its extras (themes, lexicon, chrome.js, fx, ambient) — Phase C wired the
// substrate; the boot path stays flat so the selftest gate has the fewest
// ways to fail.
import { bus } from './bus.js';
import { data } from './data.js';
import { startShell, switchSurface, surfaces } from './shell.js';
import { initActions } from './actions.mjs';
import { initPalette } from './palette.js';
import { initFocus } from './focus.js';
import { view as homeView } from '../surfaces/home/view.js';
import { view as tasksView } from '../surfaces/tasks/view.js';
import { view as workView } from '../surfaces/work/view.js';
import { view as projectsView } from '../surfaces/projects/view.js';
import { view as mapView } from '../surfaces/map/view.js';
import { view as systemView } from '../surfaces/system/view.js';
import { view as mindView } from '../surfaces/mind/view.js';
import { view as automateView } from '../surfaces/automate/view.js';
import { view as lookbackView } from '../surfaces/lookback/view.js';

// The familiar v4.2 rail. HOME is the decision surface the app opens on;
// AGENT keeps the actionable workbench reachable without asking users to
// remember an abstract internal name. Every registered view is real.
// v4.3 adds TASKS between them: the full queue board (the restored SITROOM
// threat board), leaving AGENT with only a compact "next up" seed list — and
// MAP directly after PROJECTS, because the isometric city IS the project list
// seen from above: the two surfaces answer the same question at different
// altitudes, so they sit next to each other in the rail.
const SURFACES = [
  { id: 'home',      label: 'HOME',        glyph: '◎', view: homeView },
  { id: 'tasks',     label: 'TASKS',       glyph: '◈', view: tasksView },
  { id: 'work',      label: 'AGENT',       glyph: '›', view: workView },
  { id: 'projects',  label: 'PROJECTS',    glyph: '▣', view: projectsView },
  { id: 'map',       label: 'MAP',         glyph: '⬢', view: mapView },
  { id: 'system',    label: 'SYSTEM',      glyph: '⧉', view: systemView },
  { id: 'mind',      label: 'NOTES',       glyph: '✦', view: mindView },
  { id: 'automate',  label: 'AUTOMATIONS', glyph: '⚙', view: automateView },
  { id: 'lookback',  label: 'HISTORY',     glyph: '↺', view: lookbackView },
];

// Restore the active surface across win.reload() (main reloads on scan/commit)
// so a data refresh doesn't snap the user home. Unknown stored ids fall back
// to 'home' via switchSurface's registry lookup — but guard here anyway so the
// boot log's active= claim stays true.
const stored = sessionStorage.getItem('hq-v4-surface');
const startId = SURFACES.some((s) => s.id === stored) ? stored : 'home';

// The audited action registry, seeded HERE rather than at WORK's first mount:
// the command palette must be able to navigate and act on a session that was
// restored onto some other surface, where wire.js has not run yet. `ordered`
// is the v3-shaped shim initActions expects — it only reads `manifest.id` and
// `manifest.sigil` — and yields one `go:<surface>` action per rail entry.
//
// wire.js (WORK) and system/view.js both call initActions({hq}) later. Those
// calls pass no `ordered`, so they cannot disturb the `go:*` actions, and they
// re-register the shared verbs with the SAME window.hq — identical effects, so
// the callers can never disagree.
initActions({
  switchRealm: switchSurface,
  ordered: () => SURFACES.map((s) => ({ manifest: { id: s.id, sigil: s.glyph } })),
  hq: window.hq,
});

startShell(SURFACES, startId);
initPalette();   // one window keydown for the app's lifetime; overlay built lazily

// FOCUS MODE — the full-screen "one thing" overlay, on the same footing as the
// palette: an app-lifetime chrome overlay that lives in #overlays, OUTSIDE
// #stage, so a surface re-mount (every scrub is one) never disturbs it.
// initFocus() is idempotent behind its own `inited` flag, which matters
// because the selftest re-runs this module's boot logic; calling it twice
// registers no second keydown listener and no second set of bus handlers.
initFocus();

// Debug/harness handle — screenshot/verify harnesses drive surface switches
// through this instead of synthesizing clicks.
window.V4 = { switchSurface, surfaces };

const dataOk = Array.isArray(data.scans) && data.scans.length > 0;
console.log(
  `V4 boot surfaces=${surfaces().length} active=${startId} ` +
  `data=${dataOk ? `OK(${data.scans.length})` : 'FAIL'} bus=${bus.ok ? 'OK' : 'FAIL'}`
);

// --selftest: cycle every surface, counting mount errors. force=true so all
// NINE mounts actually execute (the active surface would otherwise early-return).
if (new URLSearchParams(location.search).get('selftest')) {
  let errors = 0;
  const seen = [];
  for (const s of surfaces()) {
    try {
      switchSurface(s.id, true);
      seen.push(s.id);
      const stage = document.getElementById('stage');
      console.log(`SELFTEST-SURFACE ${s.id} nodes=${stage.childElementCount} chars=${stage.innerHTML.length}`);
    } catch (err) { errors++; console.error('[selftest] surface', s.id, err); }
  }
  switchSurface('home', true);   // leave the app in default state
  console.log(`V4 SELFTEST surfaces=${seen.length} errors=${errors} ${errors === 0 ? 'PASS' : 'FAIL'}`);
}
