// Which renderer the main window loads, as a pure function. main.js createWindow() passes
// the environment and a reader for data/.ui-version, and loads the page that comes back,
// so dashboard/ui-version.test.mjs covers every case without Electron.
//
//   resolveUiVersion({ env, readFlag }) → 'v2' | 'v3' | 'v4' | 'v5'
//     env.HQ_UI_VERSION   one launch's override; used only when it is exactly v2..v5
//     readFlag()          returns data/.ui-version's text (may throw: missing/unreadable)
//     The flag file's trimmed text is used only when it is exactly v2..v5. A missing or
//     unreadable file, an empty one, or any other value (V3, v6, junk) loads v5.
//   rendererPage(repoRoot, uiv) → absolute index.html path: always dashboard-v5/index.html.
//     The v2–v4 renderers (legacy/) were removed 2026-10-28 (feature cleanup); a flag that still
//     asks for one loads v5, and isLegacy(uiv) lets main.js say so in its log. Restore them with
//     git checkout cleanup-base-2026-10-28 -- legacy dashboard/ui-version.js tools/rollback-core.mjs
const path = require('node:path');

const UI_VERSION_RE = /^v[2-5]$/;
const DEFAULT_UI = 'v5';

function resolveUiVersion({ env = {}, readFlag } = {}) {
  const override = env.HQ_UI_VERSION || '';
  if (UI_VERSION_RE.test(override)) return override;
  try {
    const v = String(readFlag()).trim();   // trim also drops a BOM and CR/LF around the value
    return UI_VERSION_RE.test(v) ? v : DEFAULT_UI;
  } catch { return DEFAULT_UI; }
}

function isLegacy(uiv) { return UI_VERSION_RE.test(uiv) && uiv !== DEFAULT_UI; }

function rendererPage(repoRoot, _uiv) {
  return path.join(repoRoot, 'dashboard-v5', 'index.html');
}

module.exports = { UI_VERSION_RE, DEFAULT_UI, resolveUiVersion, isLegacy, rendererPage };
