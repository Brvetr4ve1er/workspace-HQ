// WorkspaceHQ Bridge 0.7.0 — "On this page", popup half of "Find the best version". Classic script (<script> in popup.html,
// after grab-rules.js and grab-scan.js). A VIEWER: it scans the active tab with chrome.scripting (activeTab), lists what the
// page offers, best first, and copies a link. It requests nothing itself — no fetch, no XMLHttpRequest, no <img>, so no
// remote thumbnails — and every page-supplied string is shown through textContent, never as HTML.
//
//   HQGrabPopup.load() → model  { state: 'ok'|'empty'|'streamed'|'restricted'|'error'|'none', message, rows:[row…], clicked }
//        row = { rank, entry, info: describe(), candidates:[{url, guess}], best, clicked }
//   HQGrabPopup.render(doc, host, model, { copy }) — the section's DOM, text only
//   HQGrabPopup.copyText(text) → Promise<boolean>   (navigator.clipboard, falling back to a hidden textarea)
//   HQGrabPopup.create(deps) → same API over injected { chrome, rules, scan, nav, doc, now } (tests)
(function (root) {
  'use strict';
  var TARGET_KEY = 'hq_grab_target', HOLD_KEY = 'hq_badge_hold', TARGET_TTL_MS = 10 * 60 * 1000, MAX_ROWS = 40;

  function create(deps) {
    deps = deps || {};
    var C = function () { return deps.chrome || root.chrome; };
    var R = function () { return deps.rules || root.HQGrabRules; };
    var scanFn = function () { return deps.scan || root.hqGrabScan; };
    var now = function () { return deps.now ? deps.now() : Date.now(); };

    async function readTarget() {
      var s = C().storage && C().storage.session;
      if (!s) return null;
      var got = null;
      try { got = (await s.get(TARGET_KEY))[TARGET_KEY] || null; await s.remove(HOLD_KEY); } catch (e) { return null; }
      try { await C().action.setBadgeText({ text: '' }); } catch (e) { /* the '…' hold is cleared; the next Brief tick repaints the count */ }
      if (got && now() - got.at > TARGET_TTL_MS) return null;
      return got;
    }

    async function pickTab(target) {
      try {
        if (target && target.tabId >= 0) return await C().tabs.get(target.tabId);
        var tabs = await C().tabs.query({ active: true, currentWindow: true });
        return tabs && tabs[0] ? tabs[0] : null;
      } catch (e) { return null; }
    }

    async function load() {
      var rules = R(), target = await readTarget();
      var tab = await pickTab(target);
      if (!tab) return { state: 'none', message: 'No page to read', rows: [], clicked: '' };
      if (rules.isRestricted(tab.url)) return { state: 'restricted', message: rules.RESTRICTED_MESSAGE, rows: [], clicked: '' };
      var clicked = target ? target.srcUrl : '';
      var out;
      try {
        var res = await C().scripting.executeScript({ target: { tabId: tab.id }, func: scanFn(), args: [{ min: rules.MIN_PX }] });
        out = res && res[0] ? res[0].result : null;
      } catch (e) {
        var m = String((e && e.message) || e);
        if (/cannot access|extensions gallery|cannot be scripted|chrome:\/\//i.test(m)) return { state: 'restricted', message: rules.RESTRICTED_MESSAGE, rows: [], clicked: clicked };
        return { state: 'error', message: "Couldn't read this page — " + m.slice(0, 80), rows: [], clicked: clicked };
      }
      if (!out || !out.ok) return { state: 'error', message: "Couldn't read this page", rows: [], clicked: clicked };
      var listed = out.items.filter(function (e) { return !e.streamed; });
      var streamedCount = (out.streamed || 0) + (/^blob:/i.test(clicked) ? 1 : 0);
      // the right-clicked media on top, even when the scanner filtered it (small, or reached some other way)
      if (clicked && /^https?:/i.test(clicked) && !listed.some(function (e) { return rules.normalizeUrl(e.url) === rules.normalizeUrl(clicked) || (e.variants || []).some(function (v) { return rules.normalizeUrl(v.url) === rules.normalizeUrl(clicked); }); })) {
        listed.unshift({ url: clicked, kind: target && target.mediaType === 'video' ? 'video' : 'image', via: 'clicked', w: 0, h: 0, shownW: 0, shownH: 0, label: '', variants: [] });
      }
      var ranked = rules.rankEntries(listed, clicked).slice(0, MAX_ROWS);
      var rows = ranked.map(function (e, i) {
        var cands = rules.candidatesFor(e);
        return { rank: i + 1, entry: e, info: rules.describe(e), candidates: cands, best: cands.length ? cands[0].url : e.url, clicked: i === 0 && !!clicked && !/^blob:/i.test(clicked) };
      });
      if (!rows.length) return { state: streamedCount ? 'streamed' : 'empty', message: streamedCount ? rules.STREAMED_MESSAGE : rules.EMPTY_MESSAGE, rows: [], clicked: clicked, streamed: streamedCount };
      return { state: 'ok', message: '', rows: rows, clicked: clicked, streamed: streamedCount, capped: !!out.capped };
    }

    async function copyText(text) {
      try { if (root.navigator && root.navigator.clipboard) { await root.navigator.clipboard.writeText(String(text)); return true; } } catch (e) { /* fall back */ }
      try {
        var d = deps.doc || root.document;
        var ta = d.createElement('textarea'); ta.value = String(text); d.body.appendChild(ta); ta.select();
        var ok = d.execCommand('copy'); d.body.removeChild(ta); return !!ok;
      } catch (e) { return false; }
    }

    function render(doc, host, model, handlers) {
      var rules = R();
      function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
      if (host.replaceChildren) host.replaceChildren(); else while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(el('div', 'grab-note', rules.VIEWER_NOTE));
      if (model.message) host.appendChild(el('div', 'grab-msg', model.message));
      model.rows.forEach(function (r) {
        var i = r.info, row = el('div', 'grab-row');
        row.dataset.clicked = r.clicked ? '1' : '';
        var line = [i.typeWord, i.size, i.host, i.name].filter(Boolean).join(' · ');
        row.appendChild(el('div', 'grab-line', line));
        if (i.bigger) row.appendChild(el('div', 'grab-bigger', i.bigger));
        if (i.label) row.appendChild(el('div', 'grab-label', i.label));
        if (r.clicked) row.appendChild(el('div', 'grab-tag', 'you clicked this'));
        var cands = el('div', 'grab-cands');
        r.candidates.forEach(function (c) { cands.appendChild(el('div', 'grab-cand' + (c.guess ? ' guess' : ''), (c.guess ? 'guess · ' : '') + c.url)); });
        row.appendChild(cands);
        var btn = el('button', 'mini', 'Copy best link'); btn.type = 'button';
        btn.addEventListener('click', function () { if (handlers && handlers.copy) handlers.copy(r.best, r); });
        row.appendChild(btn);
        host.appendChild(row);
      });
      if (model.rows.some(function (r) { return r.candidates.some(function (c) { return c.guess; }); })) host.appendChild(el('div', 'grab-note', rules.GUESS_NOTE));
      if (model.streamed && model.state === 'ok') host.appendChild(el('div', 'grab-note', rules.STREAMED_MESSAGE));
      if (model.capped) host.appendChild(el('div', 'grab-note', 'Showing the biggest ' + model.rows.length + '.'));
    }

    return { load: load, render: render, copyText: copyText };
  }

  var api = create({});
  api.create = create;
  root.HQGrabPopup = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
