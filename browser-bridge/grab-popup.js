// WorkspaceHQ Bridge 0.7.0 — "On this page", popup half of "Find the best version" + save on click. Classic script (<script> in
// popup.html, after grab-rules.js and grab-scan.js). It scans the active tab with chrome.scripting (activeTab) and lists what the
// page offers, best first. It requests nothing itself — no fetch, no XMLHttpRequest, no <img>, so no remote thumbnails — and
// every page-supplied string is shown through textContent, never as HTML. The only thing that leaves this file is ONE
// 'grab:save' runtime message per press of a row's Save button; the service worker (grab.js) does the saving.
//
//   HQGrabPopup.load() → model  { state: 'ok'|'empty'|'streamed'|'restricted'|'error'|'none', message, rows:[row…], clicked, pageUrl }
//        row = { rank, entry, info: describe(), candidates:[{url, guess}], best, clicked }
//   HQGrabPopup.render(doc, host, model, { copy, save }) → { paint(jobs) } — the section's DOM, text only; paint() shows each
//        row's save state (queued, saving, saved to …, could not save) and disables Save while that row is waiting
//   HQGrabPopup.save(row, pageUrl) → { ok, job?, message? }   sends the one message for this one row
//   HQGrabPopup.readJobs() → jobs from chrome.storage.session   (the worker is the only writer)
//   HQGrabPopup.copyText(text) → Promise<boolean>   (navigator.clipboard, falling back to a hidden textarea)
//   HQGrabPopup.create(deps) → same API over injected { chrome, rules, scan, nav, doc, now } (tests)
(function (root) {
  'use strict';
  var TARGET_KEY = 'hq_grab_target', HOLD_KEY = 'hq_badge_hold', QUEUE_KEY = 'hq_grab_queue', TARGET_TTL_MS = 10 * 60 * 1000, MAX_ROWS = 40;

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
      // the right-click is spent by the first popup that reads it: a later open scans the page the owner is on
      try { got = (await s.get(TARGET_KEY))[TARGET_KEY] || null; await s.remove(HOLD_KEY); await s.remove(TARGET_KEY); } catch (e) { return null; }
      try { await C().action.setBadgeText({ text: '' }); } catch (e) { /* the '…' hold is cleared; the next Brief tick repaints the count */ }
      if (got && now() - got.at > TARGET_TTL_MS) return null;
      return got;
    }

    // → { tab, target }. The right-click target counts only while its tab is the one the owner is on; otherwise the active
    // tab is scanned and the target is dropped (its clicked image belongs to another page). Only when the active tab
    // cannot be read at all does the clicked tab stand in for it.
    async function pickTab(target) {
      var active = null;
      try { var tabs = await C().tabs.query({ active: true, currentWindow: true }); active = tabs && tabs[0] ? tabs[0] : null; } catch (e) { active = null; }
      if (!target || !(target.tabId >= 0)) return { tab: active, target: null };
      if (active) return active.id === target.tabId ? { tab: active, target: target } : { tab: active, target: null };
      try { return { tab: await C().tabs.get(target.tabId), target: target }; } catch (e) { return { tab: null, target: null }; }
    }

    async function load() {
      var rules = R(), target = await readTarget();
      var picked = await pickTab(target), tab = picked.tab;
      target = picked.target;
      if (!tab) return { state: 'none', message: 'No page to read', rows: [], clicked: '' };
      if (rules.isRestricted(tab.url)) return { state: 'restricted', message: rules.RESTRICTED_MESSAGE, rows: [], clicked: '' };
      var clicked = target ? target.srcUrl : '', pageUrl = String(tab.url || '');
      var out;
      try {
        var res = await C().scripting.executeScript({ target: { tabId: tab.id }, func: scanFn(), args: [{ min: rules.MIN_PX }] });
        out = res && res[0] ? res[0].result : null;
      } catch (e) {
        var m = String((e && e.message) || e);
        if (/cannot access|extensions gallery|cannot be scripted|chrome:\/\//i.test(m)) return { state: 'restricted', message: rules.RESTRICTED_MESSAGE, rows: [], clicked: clicked, pageUrl: pageUrl };
        return { state: 'error', message: "Couldn't read this page — " + m.slice(0, 80), rows: [], clicked: clicked, pageUrl: pageUrl };
      }
      if (!out || !out.ok) return { state: 'error', message: "Couldn't read this page", rows: [], clicked: clicked, pageUrl: pageUrl };
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
      if (!rows.length) return { state: streamedCount ? 'streamed' : 'empty', message: streamedCount ? rules.STREAMED_MESSAGE : rules.EMPTY_MESSAGE, rows: [], clicked: clicked, streamed: streamedCount, pageUrl: pageUrl };
      return { state: 'ok', message: '', rows: rows, clicked: clicked, streamed: streamedCount, capped: !!out.capped, pageUrl: pageUrl };
    }

    // The one message for one row. The worker re-checks everything (sender, one entry, the site, the file type).
    async function save(row, pageUrl) {
      var e = row && row.entry;
      if (!e || typeof e.url !== 'string') return { ok: false, message: "Can't save this one" };
      var entry = { url: e.url, kind: e.kind === 'video' ? 'video' : 'image', variants: (e.variants || []).map(function (v) { return { url: v.url, w: v.w, x: v.x }; }) };
      try {
        var res = await C().runtime.sendMessage({ type: 'grab:save', entry: entry, pageUrl: String(pageUrl || '') });
        return res && typeof res === 'object' ? res : { ok: false, message: "Couldn't reach the extension — try again" };
      } catch (err) { return { ok: false, message: "Couldn't reach the extension — try again" }; }
    }
    async function readJobs() {
      try { var q = (await C().storage.session.get(QUEUE_KEY))[QUEUE_KEY]; return q && Array.isArray(q.jobs) ? q.jobs : []; } catch (e) { return []; }
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
      host.appendChild(el('div', 'grab-note', rules.SAVE_NOTE));
      var views = [];
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
        var firstGuess = r.candidates.length > 0 && !!r.candidates[0].guess;
        var btn = el('button', 'mini', firstGuess ? 'Copy guessed link' : 'Copy best link'); btn.type = 'button';
        btn.addEventListener('click', function () { if (handlers && handlers.copy) handlers.copy(r.best, r); });
        row.appendChild(btn);
        // Save: one button per row, one press = one message = one file. No "save all" anywhere.
        var can = rules.saveCheck(r.entry, model.pageUrl);
        var stateEl = el('div', 'grab-state'), saveBtn = null;
        if (can.ok) {
          saveBtn = el('button', 'mini', firstGuess ? 'Save guessed size' : 'Save best size'); saveBtn.type = 'button';
          saveBtn.addEventListener('click', function () { if (saveBtn.disabled) return; saveBtn.disabled = true; if (handlers && handlers.save) handlers.save(r); });
          row.appendChild(saveBtn);
        } else stateEl.textContent = can.message;
        row.appendChild(stateEl);
        views.push({ key: rules.normalizeUrl(r.entry.url), stateEl: stateEl, saveBtn: saveBtn, base: can.ok ? '' : can.message });
        host.appendChild(row);
      });
      if (model.rows.some(function (r) { return r.candidates.some(function (c) { return c.guess; }); })) host.appendChild(el('div', 'grab-note', rules.GUESS_NOTE));
      if (model.streamed && model.state === 'ok') host.appendChild(el('div', 'grab-note', rules.STREAMED_MESSAGE));
      if (model.capped) host.appendChild(el('div', 'grab-note', 'Showing the biggest ' + model.rows.length + '.'));
      return {
        // the newest job per row decides its words; Save is enabled again once that job is finished
        paint: function (jobs) {
          views.forEach(function (v) {
            var mine = (jobs || []).filter(function (j) { return j.key === v.key; }), job = mine[mine.length - 1] || null;
            v.stateEl.textContent = job ? rules.stateText(job) : v.base;
            v.stateEl.dataset.state = job ? job.state : '';
            if (v.saveBtn) v.saveBtn.disabled = !!job && (job.state === 'queued' || job.state === 'saving');
          });
        },
      };
    }

    return { load: load, render: render, copyText: copyText, save: save, readJobs: readJobs };
  }

  var api = create({});
  api.create = create;
  root.HQGrabPopup = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
