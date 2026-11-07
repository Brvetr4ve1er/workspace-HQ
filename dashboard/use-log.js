// hq:use — which surface gets used (spec: "assistant-rulebook", part B). The day logs held no 'use' events and the preload had no usage
// channel, so nothing told which surface the owner opens. The renderer calls use(surface, action); this writes ONE line into the existing day
// log through appLog.event('use', { surface, action }) — ids from fixed allowlists only, never a name, id or free text.
//
// create({ appLog, now? }) → { mark(surface, action) }   mark → { ok: true } | { error }
// init({ ipcMain, appLog, now? }) → the same object; registers ipcMain.handle('hq:use', (e, surface, action) => mark(surface, action))
// At most 30 accepted a minute (sliding window); anything outside the allowlists, or over the cap, is refused and never logged.
const SURFACES = Object.freeze(['brief-panel', 'sessions-board', 'sessions-strip', 'delivery-card', 'money-start', 'money-quick', 'palette-money-line', 'reach']);
const ACTIONS = Object.freeze(['open', 'act', 'resume', 'copy', 'log']);
const PER_MINUTE = 30;
const WINDOW_MS = 60e3;

function create({ appLog, now = Date.now } = {}) {
  const surfaces = new Set(SURFACES), actions = new Set(ACTIONS);
  let stamps = [];
  function mark(surface, action) {
    const act = action === undefined ? 'open' : action;
    if (typeof surface !== 'string' || typeof act !== 'string' || !surfaces.has(surface) || !actions.has(act)) return { error: 'unknown surface or action' };
    const t = now();
    stamps = stamps.filter((s) => t - s < WINDOW_MS);
    if (stamps.length >= PER_MINUTE) return { error: 'too many usage marks — slow down' };
    stamps.push(t);
    try { if (appLog && typeof appLog.event === 'function') appLog.event('use', { surface, action: act }); } catch { /* the log must never break a click */ }
    return { ok: true };
  }
  return { mark };
}

function init({ ipcMain, appLog, now } = {}) {
  const u = create({ appLog, now });
  if (ipcMain && typeof ipcMain.handle === 'function') ipcMain.handle('hq:use', (_e, surface, action) => u.mark(surface, action));
  return u;
}

module.exports = { create, init, SURFACES, ACTIONS, PER_MINUTE };
