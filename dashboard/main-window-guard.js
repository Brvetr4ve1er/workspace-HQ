// The main window stays on its own page (batch 9 reviewer fixes). The preload (window.hq) is attached to whatever the main frame shows, so the
// window must never leave the app's page: a dropped .html file, a link or a script redirect would otherwise hand every gated channel to that page.
//
//   pin(win, pagePath)   names the page the window loaded to main-gate.js (so the gate accepts only that exact address, query and hash ignored)
//                        and refuses every navigation or redirect of the main frame away from it, and every new window.
//
// The same page again (a reload, a hash change) is allowed. Nothing here opens anything.
const { pathToFileURL } = require('node:url');
const gate = require('./main-gate');

function pin(win, pagePath, { gateApi = gate } = {}) {
  if (!win || !win.webContents || typeof pagePath !== 'string' || !pagePath) return false;
  const href = pathToFileURL(pagePath).href;
  gateApi.setAppPage(href);
  const wc = win.webContents;
  const stay = (event, url) => { if (!gateApi.samePage(url, href)) { try { event.preventDefault(); } catch { /* nothing to cancel */ } } };
  wc.on('will-navigate', (event, url) => stay(event, url));
  wc.on('will-redirect', (event, url) => stay(event, url));
  if (typeof wc.setWindowOpenHandler === 'function') wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  return true;
}

module.exports = { pin };
