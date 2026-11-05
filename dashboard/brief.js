// Operator Brief, main side (spec docs/superpowers/specs/2026-11-05-operator-design.md; IPC-CONTRACT 2026-11-05).
// Gathers what the pure engine (brief-core.mjs) needs — latest.json, pc-health.json, the money view + money/meta.json,
// Claude Hub health, the scan run — computes the brief, writes data/brief.json atomically (MCP hq_brief reads it),
// serves hq:brief:read / hq:brief:dismiss, and pushes hq:brief to the windows when the facts moved.
// Never throws at a caller: a source that can't be read becomes an `errors` entry and the brief goes on without it.
//
// create({ dataDir, money, hub, liveState, now }) → { compute(), dismiss(key), buildInputs() }   (pure-ish, for tests)
// init({ ipcMain, dataDir, money, hub, liveState, notify, getWins, intervalMs?, watch?, now? }) → { recompute(), stop() }
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'brief-core.mjs')).href));
const RECOMPUTE_MS = 15 * 60e3, DEBOUNCE_MS = 1500, KEY_MAX = 200, DISMISSED_MAX = 200;

const msg = (e) => String((e && e.message) || e).slice(0, 200);
// { value } | { value: null, error } — an absent file is reported with `absent` so each source can phrase it
function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return { value: null, absent: e.code === 'ENOENT', error: e.code === 'ENOENT' ? null : msg(e) }; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { value: null, error: 'unreadable (' + msg(e) + ')' }; }
}
function writeAtomic(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  fs.renameSync(tmp, file);
}

function create({ dataDir, money, hub, liveState, now = () => new Date() }) {
  const briefFile = path.join(dataDir, 'brief.json'), stateFile = path.join(dataDir, 'brief-state.json');
  let last = null, lastSig = null;

  function loadState() {
    const r = readJson(stateFile).value;
    return { dismissed: Array.isArray(r && r.dismissed) ? r.dismissed.filter((k) => typeof k === 'string').slice(-DISMISSED_MAX) : [],
      toasted: r && r.toasted && typeof r.toasted === 'object' && !Array.isArray(r.toasted) ? r.toasted : {} };
  }
  function saveState(st) { try { writeAtomic(stateFile, st); } catch { /* the brief still works; it just forgets */ } }

  async function buildInputs() {
    const errors = [];
    const scanR = readJson(path.join(dataDir, 'latest.json'));
    if (scanR.absent) errors.push({ source: 'scan', error: 'no scan yet (data/latest.json is missing)' });
    else if (scanR.error) errors.push({ source: 'scan', error: 'data/latest.json ' + scanR.error });
    const pcR = readJson(path.join(dataDir, 'pc-health.json'));
    if (pcR.absent) errors.push({ source: 'pc-health', error: 'no PC health check yet' });
    else if (pcR.error) errors.push({ source: 'pc-health', error: 'data/pc-health.json ' + pcR.error });
    let moneyView = null;
    if (money && typeof money.read === 'function') {
      try { const r = await money.read(); if (r && r.error) errors.push({ source: 'money', error: String(r.error) }); else moneyView = (r && r.view) || null; }
      catch (e) { errors.push({ source: 'money', error: msg(e) }); }
    }
    const moneyMeta = readJson(path.join(dataDir, 'money', 'meta.json')).value;   // absent = never exported, which is itself a fact
    let hubH = null;
    if (!hub || typeof hub.request !== 'function') errors.push({ source: 'claude', error: 'Claude Hub is not running' });
    else {
      try {
        const r = await hub.request('health', {}, { timeout: 5000 });
        if (r && typeof r.error === 'string') errors.push({ source: 'claude', error: r.error }); else hubH = r ? { webCount: r.webCount, lastSyncAt: r.lastSyncAt } : null;
      } catch (e) { errors.push({ source: 'claude', error: msg(e) }); }
    }
    let liveScan = null;
    try { liveScan = liveState && typeof liveState.snapshot === 'function' ? liveState.snapshot().scan : null; } catch { liveScan = null; }
    return { scan: scanR.value, liveScan, pc: pcR.value, money: moneyView, moneyMeta, hub: hubH, errors };
  }

  async function compute() {
    const L = await lib();
    const st = loadState();
    const inputs = await buildInputs();
    const brief = L.computeBrief(inputs, { now: now(), dismissed: st.dismissed });
    try { writeAtomic(briefFile, brief); } catch (e) { brief.errors.push({ source: 'brief', error: 'data/brief.json not written — ' + msg(e) }); }
    const sig = JSON.stringify([brief.items, brief.more, brief.errors]);   // generatedAt alone is not a change
    const changed = sig !== lastSig;
    lastSig = sig; last = brief;
    return { brief, changed, state: st };
  }

  async function dismiss(key) {
    if (!last) await compute();
    // only a key the owner can currently see is dismissable — a forged or stale key is a no-op, never a write
    if (typeof key !== 'string' || !key || key.length > KEY_MAX || !last.items.some((i) => i.key === key)) return { brief: last, changed: false };
    const st = loadState();
    if (!st.dismissed.includes(key)) st.dismissed = st.dismissed.concat([key]).slice(-DISMISSED_MAX);
    saveState(st);
    return compute();
  }

  return { compute, dismiss, buildInputs, loadState, saveState, files: { briefFile, stateFile } };
}

function init({ ipcMain, dataDir, money, hub, liveState, notify, getWins, intervalMs = RECOMPUTE_MS, watch = true, now }) {
  const b = create({ dataDir, money, hub, liveState, now });
  const push = (brief) => {
    for (const w of (getWins ? getWins() : [])) { try { if (w && !w.isDestroyed()) w.webContents.send('hq:brief', brief); } catch { /* a window mid-teardown */ } }
  };
  const settle = (r) => { if (r.changed) push(r.brief); return r; };
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { b.compute().then(settle).catch(() => {}); }, DEBOUNCE_MS); if (timer.unref) timer.unref(); };

  ipcMain.handle('hq:brief:read', async () => ({ brief: settle(await b.compute()).brief }));
  ipcMain.handle('hq:brief:dismiss', async (_e, key) => ({ brief: settle(await b.dismiss(key)).brief }));

  const watchers = [];
  const offs = [];
  if (watch) {
    // the facts the brief reads change on disk (scan, PC health, money); its own brief.json writes are ignored, or it would loop
    const watchDir = (dir, names) => { try { const w = fs.watch(dir, (_ev, f) => { if (!f || names.includes(String(f))) schedule(); }); watchers.push(w); return true; } catch { return false; } };
    watchDir(dataDir, ['latest.json', 'pc-health.json', 'money']);
    const moneyDir = path.join(dataDir, 'money');
    if (!watchDir(moneyDir, ['state.json', 'meta.json'])) {
      // data/money/ appears on the first money write: attach then
      const w = fs.watch(dataDir, (_ev, f) => { if (String(f) === 'money' && watchDir(moneyDir, ['state.json', 'meta.json'])) w.close(); });
      watchers.push(w);
    }
  }
  if (liveState && typeof liveState.onChange === 'function') offs.push(liveState.onChange((p) => { if (p && (p.state === 'done' || p.state === 'failed')) schedule(); }));
  const tick = intervalMs > 0 ? setInterval(schedule, intervalMs) : null;
  if (tick && tick.unref) tick.unref();
  schedule();   // one compute at startup, so data/brief.json (and MCP hq_brief) is fresh before any window asks

  return {
    recompute: schedule,
    stop() { clearTimeout(timer); if (tick) clearInterval(tick); for (const w of watchers) { try { w.close(); } catch { /* closed */ } } for (const off of offs) { try { off(); } catch { /* gone */ } } },
    _brief: b, _notify: notify,
  };
}

module.exports = { create, init };
