// "Is this call from the main window's own page?" for IPC handlers that act on the machine (plan batch 9, dish "dev command as an argv array").
//
//   fromMain(event, getWin, { allowUrl? }) -> boolean
//
// True only when ALL of these hold:
//   - event.sender is the main window's webContents (the cast palette uses the same preload and is a different webContents: refused);
//   - event.senderFrame is that window's MAIN frame (a subframe, or a frame that is already gone, is refused);
//   - the frame's address is an app page: a file: address (the app loads its own files; the default `allowUrl`).
// Never throws. Six older handlers keep their own copy of the first check; this one adds the frame and the address.
const defaultAllowUrl = (url) => typeof url === 'string' && url.startsWith('file:');

function fromMain(event, getWin, { allowUrl = defaultAllowUrl } = {}) {
  try {
    const w = typeof getWin === 'function' ? getWin() : null;
    if (!w || (typeof w.isDestroyed === 'function' && w.isDestroyed())) return false;
    const wc = w.webContents;
    if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
    if (!event || event.sender !== wc) return false;
    const frame = event.senderFrame;
    const main = wc.mainFrame;
    if (!frame || !main) return false;
    // the same frame object in Electron 32; ids are the fallback so a different wrapper for the same frame is still the main frame
    const same = frame === main || (Number.isInteger(frame.processId) && Number.isInteger(frame.routingId) && frame.processId === main.processId && frame.routingId === main.routingId);
    if (!same) return false;
    return !!allowUrl(frame.url);
  } catch { return false; }
}

module.exports = { fromMain, defaultAllowUrl };
