// NEXUS boot — registers the realms, starts the shell, logs one scriptable
// line the smoke/parity harness asserts on. (This file began life as the M0
// step-0 ESM spike; nested relative imports over loadFile() are proven.)
import { bus } from './bus.js';
import { data } from './data.js';
import { register, ordered } from './registry.js';
import { startShell, switchRealm, refreshBadges } from './shell.js';
import { THEMES, applyTheme, currentTheme } from './themes.js';
import { setSessions } from '../realms/summoning/session-store.js';

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
import { manifest as medbayM } from '../realms/medbay/manifest.js';
import { view as medbayV } from '../realms/medbay/view.js';
import { manifest as observatoryM } from '../realms/observatory/manifest.js';
import { view as observatoryV } from '../realms/observatory/view.js';
import { manifest as watchtowerM } from '../realms/watchtower/manifest.js';
import { view as watchtowerV } from '../realms/watchtower/view.js';
import { manifest as summoningM } from '../realms/summoning/manifest.js';
import { view as summoningV } from '../realms/summoning/view.js';
import { manifest as chronicleM } from '../realms/chronicle/manifest.js';
import { view as chronicleV } from '../realms/chronicle/view.js';
import { manifest as atlasM } from '../realms/atlas/manifest.js';
import { view as atlasV } from '../realms/atlas/view.js';
import { manifest as conjureM } from '../realms/conjure/manifest.js';
import { view as conjureV } from '../realms/conjure/view.js';
import { initPalette } from './palette.js';
import { initActions } from './actions.mjs';

register(roundtableM, roundtableV);
register(forgeM, forgeV);
register(huntsM, huntsV);
register(grimoireM, grimoireV);
register(landsM, landsV);
register(legacyM, legacyV);
register(medbayM, medbayV);
register(observatoryM, observatoryV);
register(watchtowerM, watchtowerV);
register(summoningM, summoningV);
// Charter realms 11-13 — order fields (chronicle 11, atlas 12, conjure 13) place
// them after the existing rail; registration order here is irrelevant since the
// registry sorts by manifest.order.
register(chronicleM, chronicleV);
register(atlasM, atlasV);
register(conjureM, conjureV);

// Restore the scrubbed scan + active realm across win.reload() (main reloads
// on scan/commit/etc.) so a data refresh doesn't snap the user home.
// (Guard the raw value: Number(null) is 0, which would wrongly select the
// oldest scan when the key is absent — check for the key first.)
const _rawIdx = sessionStorage.getItem('hq-scan-idx');
if (_rawIdx !== null && Number.isInteger(Number(_rawIdx))) data.select(Number(_rawIdx));
startShell(sessionStorage.getItem('hq-active-realm') || 'roundtable');

// App-lifetime session-presence subscriber: keeps the Summoning rail badge
// live even while that realm is unmounted (the view's own sub covers on-screen
// detail; setSessions is an idempotent replace, so no double-count).
if (window.hq?.onClaudeSessions) {
  window.hq.onClaudeSessions((list) => { setSessions(list); refreshBadges(); });
  Promise.resolve(window.hq.getSessions?.()).then((l) => { if (Array.isArray(l)) { setSessions(l); refreshBadges(); } }).catch(() => {});
}

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

// command palette (Ctrl/Cmd+K) — core chrome; installs one window keydown and
// builds its overlay lazily on first open. Idempotent, so safe here at boot.
initPalette();

// action registry — the one audited dispatch path (buttons/palette/Oracle all
// route through it). Seeded with real effects; guards make a missing preload
// method a no-op. switchRealm + ordered are already imported above.
initActions({ switchRealm, ordered, hq: window.hq });

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
