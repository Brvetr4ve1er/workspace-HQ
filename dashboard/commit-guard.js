// The commit guard. hq:do-commit runs `git add -A`, so whatever is in the change
// set is committed. Plain `git status --porcelain` collapses an untracked folder
// to `dir/`, which let `dir/.env` through the old renderer-side check. Here the
// change set is listed file by file:
//   git status --porcelain -z -uall --no-renames   ∪   git diff --cached --name-only -z
// and any .env-style path is refused (.env.example / .sample / .template allowed).
// IPC-CONTRACT "Pending — v5 clean pass": hq:commit-preview(projPath) →
//   { files:[{path, status, env}], stat, envHits:[path], branch } | { error }
// Do NOT change session-api.js captureBaseline: its plain --porcelain is what the
// session-attribution baseline relies on.
//
// init({ ipcMain, resolveProjectPath }) ; exports envHits(cwd) for hq:do-commit.
// SKELETON (F1): preview refuses, envHits finds nothing; F6 implements both
// (commit-guard.test.mjs incl. a temp-repo integration test).
function isEnvPath() { return false; }
function envHits() { return []; }

function init({ ipcMain }) {
  ipcMain.handle('hq:commit-preview', () => ({ error: 'commit preview not available yet' }));
}

module.exports = { init, isEnvPath, envHits };
