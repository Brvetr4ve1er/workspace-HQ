// "Is this call from the main window's own page?" for IPC handlers that act on the machine (plan batch 9, dish "dev command as an argv array").
//
//   fromMain(event, getWin, { allowUrl? }) -> boolean
//
// True only when ALL of these hold:
//   - event.sender is the main window's webContents (the cast palette uses the same preload and is a different webContents: refused);
//   - event.senderFrame is that window's MAIN frame (a subframe, or a frame that is already gone, is refused);
//   - the frame's address is THE app page: once main-window-guard.js has named the page the window loaded (setAppPage), the address must be
//     that exact page (query and hash ignored); until then any file: address passes (tests, and a window that has not loaded yet).
// Never throws. Six older handlers keep their own copy of the first check; this one adds the frame and the address.
let appPage = null;   // the exact file: address of the page the main window loaded, lower-cased and without query or hash
const bare = (url) => String(url).split('#')[0].split('?')[0].toLowerCase();
const samePage = (a, b) => typeof a === 'string' && typeof b === 'string' && bare(a) === bare(b);
const setAppPage = (url) => { appPage = typeof url === 'string' && url.startsWith('file:') ? bare(url) : null; };
const defaultAllowUrl = (url) => typeof url === 'string' && url.startsWith('file:') && (appPage === null || bare(url) === appPage);

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

module.exports = { fromMain, defaultAllowUrl, setAppPage, samePage };
