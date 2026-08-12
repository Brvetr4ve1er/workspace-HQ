// v4 boot — registers the 6 surfaces, starts the shell, logs one scriptable
// line the smoke/selftest harness asserts on. Adapted from v3's boot.js MINUS
// its extras (themes, lexicon, chrome.js, fx, ambient, palette, actions/notify
// wiring) — Phase C wires the substrate; Phase A keeps the boot path minimal
// so the selftest gate has the fewest ways to fail.
import { bus } from './bus.js';
import { data } from './data.js';
import { startShell, switchSurface, surfaces } from './shell.js';
import { view as workView } from '../surfaces/work/view.js';
import { placeholderView } from '../surfaces/placeholder.js';

// The 6-surface rail (design §Surfaces). Only WORK has a real view module
// this milestone; the other five mount an honest one-line placeholder.
const SURFACES = [
  { id: 'work',      label: 'WORK',      glyph: '◎', view: workView },
  { id: 'projects',  label: 'PROJECTS',  glyph: '▣', view: placeholderView('PROJECTS') },
  { id: 'system',    label: 'SYSTEM',    glyph: '⧉', view: placeholderView('SYSTEM') },
  { id: 'mind',      label: 'MIND',      glyph: '✦', view: placeholderView('MIND') },
  { id: 'automate',  label: 'AUTOMATE',  glyph: '⚙', view: placeholderView('AUTOMATE') },
  { id: 'lookback',  label: 'LOOKBACK',  glyph: '↺', view: placeholderView('LOOKBACK') },
];

// Restore the active surface across win.reload() (main reloads on scan/commit)
// so a data refresh doesn't snap the user home. Unknown stored ids fall back
// to 'work' via switchSurface's registry lookup — but guard here anyway so the
// boot log's active= claim stays true.
const stored = sessionStorage.getItem('hq-v4-surface');
const startId = SURFACES.some((s) => s.id === stored) ? stored : 'work';
startShell(SURFACES, startId);

// Debug/harness handle — screenshot/verify harnesses drive surface switches
// through this instead of synthesizing clicks.
window.V4 = { switchSurface, surfaces };

const dataOk = Array.isArray(data.scans) && data.scans.length > 0;
console.log(
  `V4 boot surfaces=${surfaces().length} active=${startId} ` +
  `data=${dataOk ? `OK(${data.scans.length})` : 'FAIL'} bus=${bus.ok ? 'OK' : 'FAIL'}`
);

// --selftest: cycle every surface, counting mount errors. force=true so all
// six mounts actually execute (the active surface would otherwise early-return).
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
  switchSurface('work', true);   // leave the app in default state
  console.log(`V4 SELFTEST surfaces=${seen.length} errors=${errors} ${errors === 0 ? 'PASS' : 'FAIL'}`);
}
