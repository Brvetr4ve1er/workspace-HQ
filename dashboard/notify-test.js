// Test notification (batch 6, dish quiet-light): one button in Settings › Reach that shows ONE desktop notification so the owner can see whether
// the toast path works on this PC. main.js wires it with one line:
//
//   require('./notify-test').init({ ipcMain, notify: trayNotify, getWin: () => win });
//
//   hq:reach:notify-test (invoke, no arguments are read)  →  { ok:true } | { ok:false, reason:'not supported' } | { error }
//
// It touches no setting and reads no settings file. The text is FIXED here (nothing from the renderer reaches the notification), and nothing is
// sent anywhere: the notification is the local OS toast through main's own notify path. Rules:
//   - main window only: a sender that is not getWin().webContents is refused (answer { error }, nothing shown, the 5 s slot is not used)
//   - at most one SHOWN test per 5 s: a second press inside the window is refused with { error } and shows nothing
//   - unsupported (isSupported() false, or notify answering exactly false) → { ok:false, reason:'not supported' }; the slot is not used
//   - a throw from notify answers a fixed { error }, never the message
//
// create({ notify, getWin, isSupported?, now? }) → { run(event), CHANNEL }
//   notify(title, body)  main's trayNotify; isSupported() defaults to electron's Notification.isSupported when electron is loadable, else true
//   now() → ms           the clock (tests)
const CHANNEL = 'hq:reach:notify-test';
const TITLE = 'WorkspaceHQ · test';
const BODY = 'If you can read this, notifications work on this PC.';
const MIN_GAP_MS = 5000;

function defaultSupported() {
  try {
    const { Notification } = require('electron');
    return !!(Notification && typeof Notification.isSupported === 'function' && Notification.isSupported());
  } catch { return true; }   // electron not loadable (a test rig): notify itself decides
}

function create({ notify, getWin, isSupported, now = () => Date.now() } = {}) {
  let lastShown = -Infinity;
  const supported = typeof isSupported === 'function' ? isSupported : defaultSupported;

  const fromMain = (event) => {
    try {
      const w = typeof getWin === 'function' ? getWin() : null;
      if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
      const wc = w.webContents;
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
      return !!event && event.sender === wc;
    } catch { return false; }
  };

  function run(event) {
    if (!fromMain(event)) return { error: 'refused.' };
    if (typeof notify !== 'function') return { ok: false, reason: 'not supported' };
    let ok;
    try { ok = !!supported(); } catch { ok = false; }
    if (!ok) return { ok: false, reason: 'not supported' };
    const t = now();
    if (t - lastShown < MIN_GAP_MS) return { error: 'one test at a time — wait a few seconds.' };
    try {
      if (notify(TITLE, BODY) === false) return { ok: false, reason: 'not supported' };
    } catch { return { error: 'the notification failed.' }; }
    lastShown = t;
    return { ok: true };
  }
  return { run, CHANNEL };
}

function init({ ipcMain, ...opts } = {}) {
  const n = create(opts);
  if (ipcMain && typeof ipcMain.handle === 'function') ipcMain.handle(CHANNEL, (event) => n.run(event));
  return n;
}

module.exports = { CHANNEL, TITLE, BODY, MIN_GAP_MS, create, init };
