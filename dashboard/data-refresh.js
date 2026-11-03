// The one "an in-app write changed what assemble reads → re-assemble the current
// scan → rebake data.js → reload" runner for quest done / capture / learn /
// archive / revive, plus the latest.json self-write bookkeeping the data watcher
// needs. Replaces the spawnSync chains each main.js handler ran inline, which
// (a) froze the whole main process ~1-2s per action (HANDOFF 2026-08-02 traced
// zero painted frames), (b) discarded assemble's exit code so a failed step
// reloaded the window as if it worked, and (c) — because the latest.json
// watcher echoed the write — baked and reloaded TWICE per action.
// Program invariant: new main-side logic lives in a NEW file; main.js wires it.
const fs = require('node:fs');

// init deps (all injected so node --test covers this without Electron):
//   runNode(script, args) → Promise, rejects with { exitCode } on non-zero
//                           (main.js runNodeAsync)
//   assembleScript / buildScript — collector/assemble.mjs, dashboard/build-data.mjs
//   latest() → parsed data/latest.json or null
//   scanBegin() / scanEnd(code, err) — live-state's one-pipeline-at-a-time guard
//   marker — selfWriteMarker(latest.json); note()d only on full success, so a
//            failed run leaves the watcher's bake+reload fallback armed
//   onDone() — reload + tray refresh, exactly ONCE per run (bursts coalesce)
//   onError(err) — honest surfacing; the window is NOT reloaded on failure
function init({ runNode, assembleScript, buildScript, latest, scanBegin, scanEnd, marker, onDone, onError }) {
  let running = false, again = false, failed = false;
  async function refresh() {
    if (running) { again = true; return 'queued'; }   // fold into the in-flight run
    // a real scan holds the guard: its own assemble (later in its pipeline)
    // reads the fresh overrides and its close handler bakes + reloads
    if (!scanBegin()) return 'scan-running';
    running = true;
    failed = false;   // this run owns the outcome — a stuck-quest retry is consumed here, never re-fired forever
    let err = null;
    try {
      do {
        again = false;   // a write landing after this point re-runs the loop
        const s = latest();
        if (s) await runNode(assembleScript, ['--date', s.scan.id]);
        await runNode(buildScript, []);
      } while (again);
      marker.note();   // our own finished write — the data watcher must not echo it
    } catch (e) { err = e; }
    finally {
      running = false; again = false;
      try { scanEnd(err ? (Number.isInteger(err.exitCode) ? err.exitCode : -1) : 0, err || undefined); } catch { /* live-state is first-wins */ }
    }
    failed = !!err;
    if (err) { try { onError(err); } catch { /* surfacing must not throw */ } return 'failed'; }
    try { onDone(); } catch { /* window mid-teardown */ }
    return 'done';
  }
  // applyDone asks this when nothing changed: a failed refresh left overrides
  // saying 'done' while latest.json still shows the quest open — retry then.
  return { refresh, lastFailed: () => failed };
}

// The latest.json watcher must tell the app's own writes (this runner, runScan's
// pipeline, do-commit's rescan — each bakes + reloads itself) from the external
// scheduled scan's. note() records the file's stat right after a self-run wrote
// it; matches() is true while the file still has exactly that stat.
function selfWriteMarker(file, fsMod = fs) {
  let last = null;
  return {
    note() { try { const st = fsMod.statSync(file); last = { mtimeMs: st.mtimeMs, size: st.size }; } catch { last = null; } },
    matches() {
      if (!last) return false;
      try { const st = fsMod.statSync(file); return st.mtimeMs === last.mtimeMs && st.size === last.size; } catch { return false; }
    },
  };
}

// Debounced latest.json watcher callback (main.js watchData hands fs.watch
// events in). While an in-app writer holds the scan guard its own close handler
// will bake + reload — recheck instead of firing; once it settles, a write whose
// stat the marker recorded was already handled (skip), and anything else — the
// scheduled external scan, the MCP server's own applyDone, or a scan that
// FAILED after writing latest.json — still gets the bake + reload fallback.
function createLatestWatcher({ isScanRunning, marker, onExternal, debounceMs = 800, recheckMs = 800 }) {
  let t = null;
  const fire = () => {
    t = null;
    if (isScanRunning()) { t = setTimeout(fire, recheckMs); return; }
    if (marker.matches()) return;
    onExternal();
  };
  return {
    onEvent(file) {
      if (file !== 'latest.json') return;
      clearTimeout(t);
      t = setTimeout(fire, debounceMs);
    },
    close() { clearTimeout(t); t = null; },
  };
}

module.exports = { init, selfWriteMarker, createLatestWatcher };
