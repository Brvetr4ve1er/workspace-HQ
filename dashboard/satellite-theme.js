// v5 clean pass S0 — one theme source for every satellite window.
// Satellites (cast, record panel, snip overlay) link
// ../dashboard-v5/styles/tokens.css and load this file first; it puts
// data-hq-theme ('dark' | 'light') and data-hq-reduce on <html> from main's
// shared ui-prefs (hq.uiPrefs.get + push), so a theme change in the main
// window repaints every satellite live. tokens.css keys its palette off
// [data-hq-theme] / [data-hq-theme="light"].
// prefs shape (ui-prefs.js): { theme: 'dark'|'light'|'os', resolved: 'dark'|'light', reduceMotion }
(function (root) {
  'use strict';

  function applyPrefs(el, p) {
    if (!el || !p || typeof p !== 'object') return false;
    el.setAttribute('data-hq-theme', p.resolved === 'light' ? 'light' : 'dark');
    if (p.reduceMotion) el.setAttribute('data-hq-reduce', '1');
    else el.removeAttribute('data-hq-reduce');
    return true;
  }

  // bridge = window.hq (any preload exposing uiPrefs {get, on}); el = <html>.
  // A push that lands before the initial get's reply wins over that (stale) reply.
  function follow(bridge, el, prefersLight) {
    el.setAttribute('data-hq-theme', prefersLight ? 'light' : 'dark');   // until main answers
    const api = bridge && bridge.uiPrefs;
    if (!api) return () => {};
    let pushed = false, off = null;
    try { if (typeof api.on === 'function') off = api.on((p) => { pushed = true; applyPrefs(el, p); }); } catch (e) { /* no push channel */ }
    try {
      if (typeof api.get === 'function') {
        Promise.resolve(api.get()).then((p) => { if (!pushed) applyPrefs(el, p); }, () => {});
      }
    } catch (e) { /* get threw synchronously — keep the media-query guess */ }
    return typeof off === 'function' ? off : () => {};
  }

  const api = { applyPrefs, follow };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && root.document.documentElement) {
    let light = false;
    try { light = !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches); } catch (e) { /* no media queries */ }
    follow(root.hq, root.document.documentElement, light);
  }
})(typeof window !== 'undefined' ? window : null);
