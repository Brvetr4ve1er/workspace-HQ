// v4 boot — registers the 6 surfaces, starts the shell, logs one scriptable
// line the smoke/selftest harness asserts on. Adapted from v3's boot.js MINUS
// its extras (themes, lexicon, chrome.js, fx, ambient, palette, actions/notify
// wiring) — Phase C wires the substrate; Phase A keeps the boot path minimal
// so the selftest gate has the fewest ways to fail.
import { bus } from './bus.js';
import { data } from './data.js';
import { startShell, switchSurface, surfaces } from './shell.js';
import { view as workView } from '../surfaces/work/view.js';
import { view as projectsView } from '../surfaces/projects/view.js';
import { view as systemView } from '../surfaces/system/view.js';
import { view as mindView } from '../surfaces/mind/view.js';
import { view as automateView } from '../surfaces/automate/view.js';
import { view as lookbackView } from '../surfaces/lookback/view.js';

// The 6-surface rail (design §Surfaces). v4.1: all six are real views — the
// five placeholders that shipped in v4.0 are gone (surfaces/placeholder.js
// stays as the stub factory for any FUTURE room, it is no longer mounted).
const SURFACES = [
  { id: 'work',      label: 'WORK',      glyph: '◎', view: workView },
  { id: 'projects',  label: 'PROJECTS',  glyph: '▣', view: projectsView },
  { id: 'system',    label: 'SYSTEM',    glyph: '⧉', view: systemView },
  { id: 'mind',      label: 'MIND',      glyph: '✦', view: mindView },
  { id: 'automate',  label: 'AUTOMATE',  glyph: '⚙', view: automateView },
  { id: 'lookback',  label: 'LOOKBACK',  glyph: '↺', view: lookbackView },
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
