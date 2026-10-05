// Deep links into the main window ("open Projects sorted by uncommitted", "open
// project X") for satellites: mini HUD count buttons, tray items. IPC-CONTRACT
// "Pending — v5 clean pass": hq:open-at(route) → bool · push hq:navigate(route).
//   route = { tab, sub?, projectId?, sort? }
//   tab/sub /^[a-z]{2,16}$/ · projectId /^[\w.-]{1,80}$/ · sort ∈ SORTS
// cleanRoute: strings only (no coercion); null/undefined optionals count as absent;
// unknown keys are dropped; a PRESENT-but-invalid optional (projectId '../x',
// sort 'zzz') refuses the whole route rather than silently landing somewhere else.
// Shows + focuses the main window (creating it if needed); if the page is still
// loading, the push waits for did-finish-load. The v3 renderer ignores the push.
//
// init({ ipcMain, getWin, createWindow }) → { openAt(route) → bool }
// - createWindow(show) (main.js) assigns main's `win` and returns nothing, so the
//   window is re-read through getWin() after creating it. getWin() is also read
//   lazily per call: the init hook runs before the first createWindow. A window
//   created by the call always waits for did-finish-load (no isLoading() race).
// - several open-at calls during one load coalesce: exactly one hq:navigate, with
//   the latest route. The pending push is NOT dropped on did-fail-load — main's
//   reload-after-write aborts the in-flight load (-3) and the next one finishes.
const SORTS = ['worst', 'dirty', 'recent', 'name'];
const SEG_RE = /^[a-z]{2,16}$/;
const ID_RE = /^[\w.-]{1,80}$/;

function cleanRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const { tab, sub, projectId, sort } = route;
  if (typeof tab !== 'string' || !SEG_RE.test(tab)) return null;
  const out = { tab };
  if (sub != null) { if (typeof sub !== 'string' || !SEG_RE.test(sub)) return null; out.sub = sub; }
  if (projectId != null) { if (typeof projectId !== 'string' || !ID_RE.test(projectId)) return null; out.projectId = projectId; }
  if (sort != null) { if (typeof sort !== 'string' || !SORTS.includes(sort)) return null; out.sort = sort; }
  return out;
}

function init({ ipcMain, getWin, createWindow }) {
  const pending = new WeakMap();   // webContents → latest route awaiting did-finish-load

  const live = (w) => !!w && !w.isDestroyed() && !!w.webContents && !w.webContents.isDestroyed();
  const push = (wc, route) => { try { if (!wc.isDestroyed()) wc.send('hq:navigate', route); } catch { /* torn down */ } };

  function openAt(raw) {
    const route = cleanRoute(raw);
    if (!route) return false;
    let w = getWin();
    let fresh = false;   // a window created by THIS call has not finished its first load, whatever isLoading() says yet
    if (!live(w)) {
      fresh = true;
      try { const made = createWindow(true); w = getWin() || made; }
      catch (e) { console.error('[nav-bridge] createWindow failed', e); return false; }
      if (!live(w)) return false;
    }
    try {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    } catch { /* focus is best-effort; the push still lands */ }
    const wc = w.webContents;
    if (fresh || wc.isLoading()) {
      const waiting = pending.has(wc);
      pending.set(wc, route);   // coalesce: the latest route wins
      if (!waiting) wc.once('did-finish-load', () => { const r = pending.get(wc); pending.delete(wc); if (r) push(wc, r); });
    } else {
      pending.delete(wc);   // a route left over from a load that never finished is now stale
      push(wc, route);
    }
    return true;
  }

  ipcMain.handle('hq:open-at', (_e, route) => openAt(route));
  return { openAt };
}

module.exports = { init, cleanRoute, SORTS };
