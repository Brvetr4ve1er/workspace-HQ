// Launch-only guard for main.js: true when dashboard/data.js is already newer
// (mtime) than every input build-data.mjs bakes from — the "Workspace Status"
// sidecars in the vault, the data/*.json stores, and build-data.mjs itself
// (edit-and-reload repo: a bake-script edit must re-bake). Any doubt — missing
// bundle, unreadable sidecar dir, an input not strictly older — means false,
// i.e. bake. Mtimes only, never content: built_at makes every bake's bytes
// differ. The common hidden autostart (no scan since the last bake) then pays
// no blocking child process before the window exists.
// Program invariant: new main-side logic lives in a NEW file; main.js wires it.
const fs = require('node:fs');
const path = require('node:path');

// keep in sync with what build-data.mjs reads
const DATA_INPUTS = ['project-notes.json', 'weekly-recap.json', 'spellbook.json', 'spell-telemetry.json', 'acted-on.json', 'pc-health.json', 'github.json', 'accounts.json', 'notebooklm.json'];
const SIDECAR_RE = /^Workspace Status \d{4}-\d{2}-\d{2}\.json$/;

function dataJsFresh({ dataJs, reportsDir, dataDir, bakeScript, fsMod = fs }) {
  let baked;
  try { baked = fsMod.statSync(dataJs).mtimeMs; } catch { return false; }   // no bundle yet → bake
  // >= not >: an input stamped the same ms as the bundle may not have been read — bake
  const newer = (p) => { try { return fsMod.statSync(p).mtimeMs >= baked; } catch { return false; } };   // a missing input can't be newer
  if (bakeScript && newer(bakeScript)) return false;
  try {
    for (const f of fsMod.readdirSync(reportsDir)) if (SIDECAR_RE.test(f) && newer(path.join(reportsDir, f))) return false;
  } catch { return false; }   // unreadable sidecar dir → don't guess, bake (build-data tolerates it)
  for (const f of DATA_INPUTS) if (newer(path.join(dataDir, f))) return false;
  return true;
}

module.exports = { dataJsFresh, DATA_INPUTS };
