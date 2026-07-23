// NEXUS boot — registers the realms, starts the shell, logs one scriptable
// line the smoke/parity harness asserts on. (This file began life as the M0
// step-0 ESM spike; nested relative imports over loadFile() are proven.)
import { bus } from './bus.js';
import { data } from './data.js';
import { register, ordered } from './registry.js';
import { startShell, switchRealm } from './shell.js';
import { THEMES, applyTheme, currentTheme } from './themes.js';

import { manifest as roundtableM } from '../realms/roundtable/manifest.js';
import { view as roundtableV } from '../realms/roundtable/view.js';
import { manifest as forgeM } from '../realms/forge/manifest.js';
import { view as forgeV } from '../realms/forge/view.js';
import { manifest as huntsM } from '../realms/hunts/manifest.js';
import { view as huntsV } from '../realms/hunts/view.js';
import { manifest as grimoireM } from '../realms/grimoire/manifest.js';
import { view as grimoireV } from '../realms/grimoire/view.js';
import { manifest as landsM } from '../realms/lands/manifest.js';
import { view as landsV } from '../realms/lands/view.js';
import { manifest as legacyM } from '../realms/legacy/manifest.js';
import { view as legacyV } from '../realms/legacy/view.js';

register(roundtableM, roundtableV);
register(forgeM, forgeV);
register(huntsM, huntsV);
register(grimoireM, grimoireV);
register(landsM, landsV);
register(legacyM, legacyV);

startShell('roundtable');

// chrome (scrubber/statusbar/SYS/warden plate) and fx (takeover/confetti/sfx/
// card exporter) are ported by dedicated agents; boot tolerates their absence
// so no port ever has to edit this file.
try { const m = await import('./chrome.js'); m.initChrome?.(); }
catch (err) { console.warn('[boot] chrome not ready:', err.message); }
try { const m = await import('../fx.js'); m.initFx?.(); }
catch (err) { console.warn('[boot] fx not ready:', err.message); }

// ambient rail (right) — core chrome, mounts once after the shell exists
const { initAmbient } = await import('./ambient.js');
initAmbient();

// Debug/harness handle — the parity screenshot harness drives realm + theme
// switches through this instead of synthesizing clicks.
window.NEXUS = { switchRealm, applyTheme, THEMES, ordered };

const dataOk = Array.isArray(data.scans) && data.scans.length > 0;
console.log(
  `NEXUS boot realms=${ordered().length} active=roundtable ` +
  `theme=${currentTheme()} data=${dataOk ? `OK(${data.scans.length})` : 'FAIL'} bus=${bus.ok ? 'OK' : 'FAIL'}`
);

// --selftest: cycle every realm under every theme, counting mount errors.
// Exercises the exact mount/unmount × relabel loop the ports must survive.
if (new URLSearchParams(location.search).get('selftest')) {
  let errors = 0;
  const seen = [];
  for (const themeId of Object.keys(THEMES)) {
    try { applyTheme(themeId); } catch (err) { errors++; console.error('[selftest] theme', themeId, err); }
    for (const { manifest } of ordered()) {
      try {
        switchRealm(manifest.id);
        seen.push(`${themeId}/${manifest.id}`);
        const stage = document.getElementById('stage');
        console.log(`SELFTEST-REALM ${themeId}/${manifest.id} nodes=${stage.childElementCount} chars=${stage.innerHTML.length}`);
      } catch (err) { errors++; console.error('[selftest] realm', themeId, manifest.id, err); }
    }
  }
  applyTheme('arcade'); switchRealm('roundtable');   // leave the app in default state
  console.log(`SELFTEST combos=${seen.length} errors=${errors} ${errors === 0 ? 'PASS' : 'FAIL'}`);
}
