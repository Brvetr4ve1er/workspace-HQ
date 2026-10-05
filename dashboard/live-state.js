// "What is running right now", answerable after a reload. Main reloads the
// window after most writes, so the renderer can't keep running dev servers,
// casts or a scan in memory — it asks here instead. IPC-CONTRACT "Pending —
// v5 clean pass": hq:live-state · push hq:scan-status.
//
// init({ ipcMain, send, devServers, casts, readSpellbook }) where
//   devServers = main.js activeDevServers (Map id → ChildProcess; dev-start stamps proc.__hqStartedAt)
//   casts      = main.js castRegistry (Map spellId → { proc, castId, startedAt, timer, chain?, … })
//                — a running chain holds TWO entries: its own (chain:true, proc:null) and
//                the active member's (registered by doCast under the member's id).
//   send(channel, payload) = main.js castSend (main window, mini HUD, quick-run)
//   readSpellbook() = parsed data/spellbook.json or null — names/icons for the cast rows
// returns { scanBegin() → bool, scanEnd(code, err?) → bool, snapshot() }:
//   scanBegin() is false while a scan is already running (runScan must not start
//   a second pipeline). scanEnd() is FIRST-WINS: it only settles a running scan,
//   so child_process 'error' followed by 'close', or a caller whose scanBegin()
//   returned false, can't clobber the live scan's result. Pair them: every true
//   scanBegin() needs exactly one scanEnd() (try/finally), or the scan reads
//   'running' until restart.
//
// snapshot() is structured-clone-safe (no ChildProcess, no timers):
//   { dev:[{id, since}], casts:[{castId, spellId, name, icon, startedAt, chain}],
//     scan:{state:'idle'|'running'|'done'|'failed', startedAt, endedAt, code} }
// A spell missing from the book (or an unreadable book) keeps the row: name = spellId, icon = null.
function init({ ipcMain, send, devServers, casts, readSpellbook }) {
  const scan = { state: 'idle', startedAt: null, endedAt: null, code: null };
  const emit = (payload) => { try { send?.('hq:scan-status', payload); } catch { /* a window mid-teardown */ } };

  const spellIndex = () => {
    let book = null;
    try { book = readSpellbook?.(); } catch { /* unreadable book → fallback names */ }
    const idx = new Map();
    if (Array.isArray(book?.spells)) for (const s of book.spells) if (s && s.id != null) idx.set(String(s.id), s);
    return idx;
  };

  function snapshot() {
    const dev = [];
    for (const [id, proc] of devServers || []) dev.push({ id, since: proc?.__hqStartedAt ?? null });
    const list = [];
    if (casts && casts.size) {   // read the book only when there is something to name
      const idx = spellIndex();
      for (const [spellId, e] of casts) {
        const s = idx.get(String(spellId));
        list.push({
          castId: e?.castId ?? null, spellId,
          name: (s && s.name) || spellId, icon: (s && s.icon) || null,
          startedAt: e?.startedAt ?? null, chain: !!e?.chain,
        });
      }
    }
    return { dev, casts: list, scan: { ...scan } };
  }

  function scanBegin() {
    if (scan.state === 'running') return false;
    scan.state = 'running';
    scan.startedAt = new Date().toISOString();   // ISO, like castRegistry.startedAt
    scan.endedAt = null;
    scan.code = null;
    emit({ state: 'running', startedAt: scan.startedAt });
    return true;
  }

  function scanEnd(code, err) {
    if (scan.state !== 'running') return false;   // first-wins (see header)
    scan.state = code === 0 ? 'done' : 'failed';
    scan.endedAt = new Date().toISOString();
    scan.code = code ?? null;
    const payload = { state: scan.state, startedAt: scan.startedAt, endedAt: scan.endedAt, code: scan.code };
    if (err) payload.error = String(err.message || err);
    emit(payload);
    return true;
  }

  ipcMain.handle('hq:live-state', () => snapshot());
  return { scanBegin, scanEnd, snapshot };
}

module.exports = { init };
