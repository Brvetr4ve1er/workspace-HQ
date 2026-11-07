// WorkspaceHQ Bridge 0.7.0 — "Find the best version", service-worker half. Classic script (importScripts). A VIEWER: it
// remembers which image or video was right-clicked and asks the popup to open on it. Nothing is downloaded or fetched, there
// is no downloads permission and no download stage; saving waits for the owner's yes (see grab-rules.js VIEWER_NOTE).
//
// MV3 workers die when idle, so the target lives in chrome.storage.session (never in module state).
//
//   HQGrab.install()            top level of background.js: wires contextMenus.onClicked (a worker restart re-adds it)
//   HQGrab.registerMenu()       inside chrome.runtime.onInstalled: creates the 'Find the best version' item (image, video)
//   HQGrab.onMenuClick(info, tab) → stores { tabId, srcUrl, pageUrl, mediaType, at } in storage.session, then opens the
//                                 popup where chrome.action.openPopup() is allowed; otherwise the badge shows '…'
//   HQGrab.takeTarget()         → the stored target (or null), clearing the '…' hold so the badge goes back to normal
//   HQGrab.create(deps)         → the same API over injected { chrome, now } (tests)
(function (root) {
  'use strict';
  var MENU_ID = 'hq-grab', TARGET_KEY = 'hq_grab_target', HOLD_KEY = 'hq_badge_hold', HOLD_TEXT = '…', TARGET_TTL_MS = 10 * 60 * 1000;

  function create(deps) {
    deps = deps || {};
    var C = function () { return deps.chrome || root.chrome; };
    var now = function () { return deps.now ? deps.now() : Date.now(); };

    async function put(k, v) { var o = {}; o[k] = v; await C().storage.session.set(o); }

    function registerMenu() {
      return new Promise(function (resolve) {
        var done = function () { resolve(); };
        try {
          C().contextMenus.removeAll(function () {
            try { C().contextMenus.create({ id: MENU_ID, title: 'Find the best version', contexts: ['image', 'video'] }, done); } catch (e) { done(); }
          });
        } catch (e) { done(); }
      });
    }

    async function onMenuClick(info, tab) {
      if (!info || info.menuItemId !== MENU_ID) return false;
      var tabId = tab && tab.id != null ? tab.id : -1;
      await put(TARGET_KEY, { tabId: tabId, srcUrl: String(info.srcUrl || ''), pageUrl: String(info.pageUrl || (tab && tab.url) || ''), mediaType: info.mediaType === 'video' ? 'video' : 'image', at: now() });
      await put(HOLD_KEY, HOLD_TEXT);
      try { await C().action.setBadgeText({ text: HOLD_TEXT }); } catch (e) { /* no action API */ }
      try { await C().action.openPopup(); }
      catch (e) { /* not allowed here: the badge keeps '…' and the next popup open shows the target */ }
      return true;
    }

    async function takeTarget() {
      var got = (await C().storage.session.get(TARGET_KEY))[TARGET_KEY] || null;
      try { await C().storage.session.remove(HOLD_KEY); } catch (e) { /* optional */ }
      if (!got) return null;
      if (now() - got.at > TARGET_TTL_MS) { try { await C().storage.session.remove(TARGET_KEY); } catch (e) { /* optional */ } return null; }
      return got;
    }

    function install() {
      try { C().contextMenus.onClicked.addListener(function (info, tab) { onMenuClick(info, tab).catch(function () {}); }); } catch (e) { /* no contextMenus */ }
    }

    return { install: install, registerMenu: registerMenu, onMenuClick: onMenuClick, takeTarget: takeTarget, MENU_ID: MENU_ID };
  }

  var api = create({});
  api.create = create;
  root.HQGrab = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
