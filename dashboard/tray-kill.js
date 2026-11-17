// The tray's "Stop all running dev servers" action (batch 10, the follow-up to batch 9's Kill servers fix).
//   makeKillServers({ getDev, after, log? }) -> () => number    (the number of server trees killed)
//
// It is the dev-command module's own killAll(): every child this run started AND every verified leftover of an earlier run (pid and start time),
// and a tree that would not die stays tracked. The tray used to run its own taskkill loop over the in-memory map, which knew nothing about leftovers.
// getDev is read at click time (the module is created after the tray). after() is the refresh the tray always did (pushMachine + updateTray); it runs
// even when killAll throws or the module is not there yet, so the menu never keeps a stale count. A failure is logged as a fixed word, never a path.
function makeKillServers({ getDev, after, log = () => {} } = {}) {
  return function killServers() {
    let n = 0;
    try {
      const dev = typeof getDev === 'function' ? getDev() : null;
      if (dev && typeof dev.killAll === 'function') { const k = dev.killAll(); n = Number.isFinite(k) ? k : 0; } else log('[tray] kill servers: not available');
    } catch { log('[tray] kill servers: failed'); }
    try { if (typeof after === 'function') after(n); } catch { log('[tray] kill servers: refresh failed'); }
    return n;
  };
}
module.exports = { makeKillServers };
