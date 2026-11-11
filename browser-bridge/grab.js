// WorkspaceHQ Bridge 0.8.0 — "Find the best version" + download on click, service-worker half. Classic script (importScripts).
// It remembers which image or video was right-clicked and asks the popup to open on it, and — only when the owner presses
// Save on ONE row — saves that file with chrome.downloads into Downloads/WorkspaceHQ/grabs/<host>/. Nothing is requested
// before that click: no scan, no HEAD, no download. There is no "save all" message anywhere; one message = one job.
//
// MV3 workers die when idle, so the right-click target AND the download queue live in chrome.storage.session (never in
// module state): a worker restart picks the queue up again (install() re-pumps it, and a download event or the hq-grab
// alarm wakes the worker while a job is pending).
//
//   HQGrab.install()            top level of background.js: wires contextMenus.onClicked and downloads.onChanged, resumes the queue
//   HQGrab.registerMenu()       inside chrome.runtime.onInstalled: creates the 'Find the best version' item (image, video)
//   HQGrab.onMenuClick(info, tab) → stores { tabId, srcUrl, pageUrl, mediaType, at } in storage.session, then opens the
//                                 popup where chrome.action.openPopup() is allowed; otherwise the badge shows '…'
//   HQGrab.takeTarget()         → the stored target (or null), clearing the '…' hold so the badge goes back to normal
//   HQGrab.enqueue({entry, pageUrl}, sender) → { ok, job? , message? }   the 'grab:save' message: ONE entry, from our own popup only
//   HQGrab.pump() / idle()      → run / await the queue. Per job: HEAD-check a guessed upgrade of the image's own host (only
//                                 then), download the best candidate, fall back down the list on failure; at least 1 s between
//                                 any two requests to a site
//   HQGrab.create(deps)         → the same API over injected { chrome, now, sleep, fetch } (tests)
(function (root) {
  'use strict';
  var MENU_ID = 'hq-grab', TARGET_KEY = 'hq_grab_target', HOLD_KEY = 'hq_badge_hold', HOLD_TEXT = '…', TARGET_TTL_MS = 10 * 60 * 1000;
  var QUEUE_KEY = 'hq_grab_queue', ALARM = 'hq-grab', MIN_GAP_MS = 1000, MAX_PENDING = 10, KEEP_JOBS = 20, HEAD_TIMEOUT_MS = 8000, MAX_VARIANTS = 40;

  function create(deps) {
    deps = deps || {};
    var C = function () { return deps.chrome || root.chrome; };
    var now = function () { return deps.now ? deps.now() : Date.now(); };
    var sleep = function (ms) { return deps.sleep ? deps.sleep(ms) : new Promise(function (r) { setTimeout(r, ms); }); };
    var doFetch = function () { return deps.fetch || (root.fetch ? root.fetch.bind(root) : null); };
    var R = function () { return deps.rules || root.HQGrabRules; };

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


    // ---- download on click: the queue (chrome.storage.session, written only here) ---------------------------------------
    var chain = Promise.resolve(), running = null;

    async function readQueue() {
      var q = null;
      try { q = (await C().storage.session.get(QUEUE_KEY))[QUEUE_KEY]; } catch (e) { q = null; }
      if (!q || !Array.isArray(q.jobs)) q = { v: 1, seq: 0, lastNetAt: 0, jobs: [] };
      return q;
    }
    // every write goes through one chain: a read-modify-write never interleaves with another one
    function update(fn) {
      var p = chain.then(async function () { var q = await readQueue(); var r = await fn(q); await put(QUEUE_KEY, q); return r; });
      chain = p.then(function () {}, function () {});
      return p;
    }
    function patch(id, fields) { return update(function (q) { var j = q.jobs.filter(function (x) { return x.id === id; })[0]; if (j) Object.assign(j, fields); }); }
    function isPending(j) { return j.state === 'queued' || j.state === 'saving'; }
    function viewOf(j) { var v = { id: j.id, key: j.key, host: j.host, kind: j.kind, state: j.state, tried: j.tried, message: j.message || '' }; if (j.cosmos && j.cosmos !== 'none') v.cosmos = j.cosmos; return v; }

    function fromPopup(sender) {
      var rt = C().runtime;
      if (!sender || !rt || sender.id !== rt.id || sender.tab) return false;
      var popupUrl = rt.getURL ? rt.getURL('popup.html') : '';
      return !!popupUrl && typeof sender.url === 'string' && sender.url.indexOf(popupUrl) === 0;
    }
    function cleanEntry(e) {
      var variants = Array.isArray(e.variants) ? e.variants.slice(0, MAX_VARIANTS) : [];
      return {
        url: e.url, kind: e.kind === 'video' ? 'video' : 'image',
        variants: variants.filter(function (v) { return v && typeof v.url === 'string'; }).map(function (v) { var o = { url: v.url }; if (v.w > 0) o.w = +v.w; if (v.x > 0) o.x = +v.x; return o; }),
      };
    }

    // The 'grab:save' message. ONE entry per message: an array, or anything else, is refused. Nothing here touches the network.
    async function enqueue(msg, sender) {
      if (!fromPopup(sender)) return { ok: false, message: "Can't save from here" };
      if (!msg || !msg.entry || typeof msg.entry !== 'object' || Array.isArray(msg.entry) || typeof msg.entry.url !== 'string') return { ok: false, message: "Can't save this one" };
      var rules = R(), entry = cleanEntry(msg.entry);
      var check = rules.saveCheck(entry, String(msg.pageUrl || ''));
      if (!check.ok) return { ok: false, message: check.message };
      var cands = rules.saveCandidates(entry);
      if (!cands.length) return { ok: false, message: "Can't save this one" };
      var key = rules.normalizeUrl(entry.url), host = rules.hostOf(entry.url), job = null, full = false, pageUrl = String(msg.pageUrl || '').slice(0, 2048), pageTitle = String(msg.pageTitle || '').slice(0, 200);
      await update(function (q) {
        var dup = q.jobs.filter(function (j) { return j.key === key && isPending(j); })[0];
        if (dup) { job = dup; return; }
        if (q.jobs.filter(isPending).length >= MAX_PENDING) { full = true; return; }
        job = { id: 'g' + (++q.seq), key: key, host: host, kind: entry.kind, candidates: cands, idx: 0, tried: 0, state: 'queued', downloadId: null, attemptAt: 0, attemptIdx: -1, message: '', pageUrl: pageUrl, pageTitle: pageTitle, at: now() };
        q.jobs.push(job);
        while (q.jobs.length > KEEP_JOBS) { var i = q.jobs.findIndex(function (j) { return !isPending(j); }); if (i < 0) break; q.jobs.splice(i, 1); }
      });
      if (full) return { ok: false, message: 'Too many saves waiting — try again in a moment' };
      pump().catch(function () {});
      return { ok: true, job: viewOf(job) };
    }

    // At least MIN_GAP_MS between any two requests (a HEAD check or a download), also across a worker restart
    async function gate() {
      var q = await readQueue();
      var wait = Math.min(MIN_GAP_MS, (q.lastNetAt || 0) + MIN_GAP_MS - now());
      if (wait > 0) await sleep(wait);
      await update(function (q2) { q2.lastNetAt = now(); });
    }

    // 'ok' = it is there, 'bad' = it is not (so the next size is tried), 'unknown' = the browser would not let us look
    async function headCheck(url) {
      var f = doFetch();
      if (!f) return 'unknown';
      try {
        var init = { method: 'HEAD', credentials: 'omit', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer' };
        try { if (root.AbortSignal && root.AbortSignal.timeout) init.signal = root.AbortSignal.timeout(HEAD_TIMEOUT_MS); } catch (e) { /* no timeout */ }
        var res = await f(url, init);
        if (!res || res.type === 'opaqueredirect' || !res.ok) return 'bad';
        var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (ct && !/^(image|video)\//i.test(ct) && !/octet-stream/i.test(ct)) return 'bad';
        return 'ok';
      } catch (e) { return 'unknown'; }
    }

    // → { state: 'complete'|'interrupted', canceled? } once Chrome says the download ended (also if it already had)
    function settle(id) {
      return new Promise(function (resolve) {
        var done = false, dl = C().downloads;
        function finish(r) { if (done) return; done = true; try { dl.onChanged.removeListener(listener); } catch (e) { /* ignore */ } resolve(r); }
        function listener(delta) {
          if (!delta || delta.id !== id) return;
          var st = delta.state && delta.state.current;
          if (st === 'complete') finish({ state: 'complete' });
          else if (st === 'interrupted') finish({ state: 'interrupted', canceled: !!(delta.error && delta.error.current === 'USER_CANCELED') });
        }
        try { dl.onChanged.addListener(listener); } catch (e) { /* the search below still answers */ }
        Promise.resolve(dl.search({ id: id })).then(function (items) {
          var it = items && items[0];
          if (!it) return finish({ state: 'interrupted', canceled: true });   // removed from the list by the owner
          if (it.state === 'complete') finish({ state: 'complete' });
          else if (it.state === 'interrupted') finish({ state: 'interrupted', canceled: it.error === 'USER_CANCELED' });
        }).catch(function () { finish({ state: 'interrupted' }); });
      });
    }

    // a download started just before the worker died, whose id never reached the queue
    async function findStarted(url, since) {
      try {
        var items = await C().downloads.search({ url: url });
        var hit = (items || []).filter(function (d) { return d.startTime && Date.parse(d.startTime) >= since - 2000; })[0];
        return hit ? hit.id : null;
      } catch (e) { return null; }
    }

    // A GUESSED size that finished but is a web page (a 200 soft-404, or a HEAD that could not run): not a picture, so it is deleted
    // and the next size is tried. Only guesses are second-guessed; a file the page itself offered is saved as served.
    async function guessIsPage(downloadId, cand) {
      if (!cand || !cand.guess) return false;
      try {
        var items = await C().downloads.search({ id: downloadId });
        var mime = items && items[0] && items[0].mime;
        if (!mime || /^(image|video)\//i.test(mime) || /octet-stream/i.test(mime)) return false;
        try { if (C().downloads.removeFile) await C().downloads.removeFile(downloadId); } catch (e) { /* the file stays; the next size is still tried */ }
        return true;
      } catch (e) { return false; }
    }

    // ---- 0.8.0: a saved file also lands in Cosmos (only after a save the owner's click made has finished) ----------------------------
    var COSMOS_ROUTE = '/library/grab', COSMOS_TIMEOUT_MS = 30000, COSMOS_RETRY_MS = 20000, COSMOS_GIVE_UP_MS = 24 * 60 * 60 * 1000;
    var COSMOS_DEFAULTS = { endpoint: 'http://127.0.0.1:47821', token: '' };
    var COSMOS_WORDS = { 400: 'it could not read the request', 401: 'pair the Bridge first', 403: 'pair the Bridge first', 404: 'it could not find the file', 409: 'set it up first', 413: 'too large for a clip', 415: 'not a picture or video it keeps', 422: 'the file changed while it was copied', 429: 'too many grabs this hour' };
    function needsPost(j) { return j.state === 'saved' && j.cosmos === 'pending' && !!j.savedPath; }
    // the file's name must be read BEFORE the patch that clears downloadId: after that the id is gone
    async function savedFileOf(downloadId) {
      try { var items = await C().downloads.search({ id: downloadId }); var f = items && items[0] && items[0].filename; return typeof f === 'string' ? f : ''; }
      catch (e) { return ''; }
    }
    async function cosmosCfg() { var r = await C().storage.local.get('hq_cfg'); return Object.assign({}, COSMOS_DEFAULTS, (r && r.hq_cfg) || {}); }
    // one POST per saved job, through the endpoint guard (loopback only, and the app must prove it holds the token before the path leaves).
    // A failure never fails the save: it only sets the Cosmos words on the job. 'pending' (the app closed, a 5xx) is tried again later; a
    // re-post is harmless because the app names a clip by its hash.
    async function postCosmos(id, force) {
      var q = await readQueue(), job = q.jobs.filter(function (j) { return j.id === id; })[0];
      if (!job || !needsPost(job)) return;
      if (!force && now() - (job.cosmosAt || 0) < COSMOS_RETRY_MS) return;
      if (now() - (job.at || 0) > COSMOS_GIVE_UP_MS) { await patch(id, { cosmos: 'refused: Cosmos was not reachable' }); return; }
      await patch(id, { cosmosAt: now() });
      var result = 'pending';
      try {
        var c = await cosmosCfg();
        if (!c.token) result = 'refused: pair the Bridge first';
        else {
          var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: job.savedPath, pageUrl: job.pageUrl || '', pageTitle: job.pageTitle || '' }) };
          try { if (root.AbortSignal && root.AbortSignal.timeout) init.signal = root.AbortSignal.timeout(COSMOS_TIMEOUT_MS); } catch (e) { /* no timeout */ }
          var guard = deps.guard || root.HQGuard;
          var res = await guard.guardedFetch(c, COSMOS_ROUTE, init, deps.appFetch ? { fetch: deps.appFetch } : undefined);
          var body = null;
          try { body = await res.json(); } catch (e) { body = null; }
          if (res.status === 200 && body && body.ok === true) result = body.duplicate === true ? 'duplicate' : 'added';
          else if (COSMOS_WORDS[res.status]) result = 'refused: ' + COSMOS_WORDS[res.status];
        }
      } catch (e) {
        if (e && e.code === 'not-on-pc') result = 'refused: the endpoint is not on this PC';
      }
      if (result !== 'pending') await patch(id, { cosmos: result });
    }
    async function retryCosmos() {
      var q = await readQueue(), due = q.jobs.filter(needsPost);
      for (var n = 0; n < due.length; n++) await postCosmos(due[n].id, false);
    }

    async function runJob(id) {
      var rules = R();
      for (var guard = 0; guard < 40; guard++) {
        var q = await readQueue(), job = q.jobs.filter(function (j) { return j.id === id; })[0];
        if (!job || !isPending(job)) return;
        var cands = job.candidates, i = job.idx;
        if (job.downloadId != null) {
          var r = await settle(job.downloadId);
          if (r.state === 'complete') {
            if (await guessIsPage(job.downloadId, cands[i])) { await patch(id, { downloadId: null, idx: i + 1, tried: Math.min(i + 1, cands.length) }); continue; }
            var savedPath = await savedFileOf(job.downloadId);
            await patch(id, { state: 'saved', tried: i + 1, downloadId: null, message: '', savedPath: savedPath, cosmos: savedPath ? 'pending' : 'none' });
            await postCosmos(id, true);
            return;
          }
          if (r.canceled) { await patch(id, { state: 'failed', tried: i + 1, downloadId: null, message: 'saving was canceled' }); return; }
          await patch(id, { downloadId: null, idx: i + 1, tried: Math.min(i + 1, cands.length) });
          continue;
        }
        if (i >= cands.length) { await patch(id, { state: 'failed', tried: cands.length, message: '' }); return; }
        var cand = cands[i];
        if (job.state === 'queued') await patch(id, { state: 'saving' });
        if (job.attemptAt && job.attemptIdx === i) {
          var found = await findStarted(cand.url, job.attemptAt);
          if (found != null) { await patch(id, { downloadId: found }); continue; }
        }
        // the only HEAD there is: a guessed bigger version on the image's own host, after the click that queued this job
        if (cand.guess && rules.hostOf(cand.url) === job.host) {
          await gate();
          if ((await headCheck(cand.url)) === 'bad') { await patch(id, { idx: i + 1, tried: Math.min(i + 1, cands.length) }); continue; }
        }
        await gate();
        await patch(id, { attemptAt: now(), attemptIdx: i });
        try {
          var dlId = await C().downloads.download({ url: cand.url, filename: rules.grabPath(job.host, cand.url, job.kind), conflictAction: 'uniquify', saveAs: false });
          if (dlId == null) throw new Error('no download id');
          await patch(id, { downloadId: dlId });
        } catch (e) { await patch(id, { idx: i + 1, tried: Math.min(i + 1, cands.length) }); }
      }
      await patch(id, { state: 'failed', message: 'could not save' });
    }

    async function syncAlarm() {
      var al = C().alarms;
      if (!al) return;
      try {
        var q = await readQueue();
        if (q.jobs.some(isPending)) al.create(ALARM, { delayInMinutes: 0.5 }); else al.clear(ALARM);
      } catch (e) { /* optional */ }
    }

    function pump() {
      if (running) return running;
      running = (async function () {
        try {
          await syncAlarm();   // a pending save wakes a restarted worker 30 s later if this one dies first
          for (var n = 0; n < 200; n++) {
            var q = await readQueue(), job = q.jobs.filter(isPending)[0];
            if (!job) break;
            await runJob(job.id);
          }
          await retryCosmos();
        } finally { running = null; await syncAlarm(); }
      })();
      return running;
    }
    function idle() { return running || Promise.resolve(); }

    function install() {
      try { C().contextMenus.onClicked.addListener(function (info, tab) { onMenuClick(info, tab).catch(function () {}); }); } catch (e) { /* no contextMenus */ }
      // a worker that was restarted mid-save: a download event (or the hq-grab alarm) wakes it, and the queue carries on from storage
      try { C().downloads.onChanged.addListener(function () { pump().catch(function () {}); }); } catch (e) { /* no downloads API */ }
      pump().catch(function () {});
    }

    return { install: install, registerMenu: registerMenu, onMenuClick: onMenuClick, takeTarget: takeTarget, enqueue: enqueue, pump: pump, idle: idle, MENU_ID: MENU_ID, QUEUE_KEY: QUEUE_KEY, ALARM: ALARM, MIN_GAP_MS: MIN_GAP_MS };
  }

  var api = create({});
  api.create = create;
  root.HQGrab = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
