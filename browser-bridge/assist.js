// WorkspaceHQ Bridge 0.7.0 — pairing and "Needs you". Classic script: importScripts() in the service worker (pairing, the
// 5-minute 'hq-assist' tick, the toolbar badge) and <script> in the popup (the Needs-you section). Needs endpoint-guard.js.
//
// Pairing is run by the service worker, never the popup: an action popup closes when it loses focus, and the app's
// dialog takes focus. The worker proposes a token, the owner allows it in the app, and the worker adopts the token only
// once GET /health?nonce proves the app holds it — so a lost answer or a closed popup does no harm.
//
//   HQAssist.startPair()          → { status: 'paired' | 'pairing' | 'denied' | 'busy' | 'app' | 'unreachable' | 'not-on-pc', message }
//   HQAssist.promote()            → { state: 'none' | 'paired' | 'waiting' | 'expired' }   (popup open, alarm)
//   HQAssist.tick({ popup? })     → model for needsModel(): { state, brief?, unseen, detail? }; sets the badge
//   HQAssist.markSeen(refs)       → the popup calls it after rendering, which clears the badge
//   HQAssist.openRef(ref)         → { ok, note?, error? }   (POST /assist/open)
//   HQAssist.needsModel(res, now) → { state, title, rows[≤3], overflowLine, note, incomplete }  (pure)
//   HQAssist.renderNeeds(doc, host, model, { open }) — text only (textContent); no innerHTML
//   HQAssist.create(deps)         → the same API over injected { chrome, fetch, now, crypto, guard } (tests)
(function (root) {
  'use strict';
  var DEFAULTS = { endpoint: 'http://127.0.0.1:47821', token: '' };
  var PENDING_KEY = 'hq_pair_pending', CODE_KEY = 'hq_pair_code', SEEN_KEY = 'hq_seen_refs', HOLD_KEY = 'hq_badge_hold', LAST_KEY = 'hq_assist_last';
  var PENDING_MS = 2 * 60 * 1000;
  var STALE_MIN = 60;
  var PAIR_FETCH_MS = 70 * 1000;
  var SEEN_MAX = 200;
  var RED = '#c0392b', AMBER = '#d98e04', CODE_COLOR = '#2f6fdb';
  var ALARM = 'hq-assist';

  function create(deps) {
    deps = deps || {};
    var C = function () { return deps.chrome || root.chrome; };
    var G = function () { return deps.guard || root.HQGuard; };
    var now = function () { return deps.now ? deps.now() : Date.now(); };
    var doFetch = function (u, o) { return (deps.fetch || root.fetch.bind(root))(u, o); };
    var genv = function () { return { fetch: deps.fetch, now: deps.now, crypto: deps.crypto, storage: deps.chrome ? (deps.chrome.storage && deps.chrome.storage.session) : undefined }; };
    var sess = function () { var s = C().storage && C().storage.session; return s || null; };

    async function cfg() { var r = await C().storage.local.get('hq_cfg'); return Object.assign({}, DEFAULTS, r.hq_cfg || {}); }
    async function localGet(k) { return (await C().storage.local.get(k))[k]; }
    async function localSet(k, v) { var o = {}; o[k] = v; await C().storage.local.set(o); }
    async function sessGet(k) { var s = sess(); if (!s) return undefined; try { return (await s.get(k))[k]; } catch (e) { return undefined; } }
    async function sessSet(k, v) { var s = sess(); if (!s) return; try { var o = {}; o[k] = v; await s.set(o); } catch (e) { /* optional */ } }
    async function sessDel(k) { var s = sess(); if (!s) return; try { await s.remove(k); } catch (e) { /* optional */ } }

    // ---- badge -----------------------------------------------------------------------------------------------
    async function paint(text, color) {
      try {
        await C().action.setBadgeText({ text: text });
        if (text && color) await C().action.setBadgeBackgroundColor({ color: color });
      } catch (e) { /* no action API in this context */ }
    }
    // priority: the pairing code (while pending) > '…' (a grab target waits) > the unseen count
    async function refreshBadge(count, tone) {
      var code = await sessGet(CODE_KEY);
      if (code) return paint(code, CODE_COLOR);
      var hold = await sessGet(HOLD_KEY);
      if (hold) return paint(hold, CODE_COLOR);
      if (!count) return paint('', null);
      return paint(count > 99 ? '99+' : String(count), tone === 'high' ? RED : AMBER);
    }

    // ---- pairing -----------------------------------------------------------------------------------------------
    function newCode() {
      var g = (deps.crypto || root.crypto), b = new Uint32Array(1);
      do { g.getRandomValues(b); } while (b[0] >= 4294960000);   // a multiple of 10000: every 4-digit code equally likely
      return String(b[0] % 10000).padStart(4, '0');
    }
    async function clearPending() { await C().storage.local.remove(PENDING_KEY); await sessDel(CODE_KEY); }

    async function promote() {
      var p = await localGet(PENDING_KEY);
      if (!p || !p.token) return { state: 'none' };
      if (now() - p.startedAt > PENDING_MS) { await clearPending(); await refreshBadge(0); return { state: 'expired' }; }
      var c = await cfg(), chk = G().checkEndpoint(c.endpoint);
      if (!chk.ok) return { state: 'waiting' };
      var v = await G().verifyApp(chk.base, p.token, genv());
      if (!v.ok) return { state: 'waiting' };
      // the app proved it holds this token: it is now the token
      await localSet('hq_cfg', Object.assign({}, c, { token: p.token }));
      await clearPending();
      await refreshBadge(0);
      return { state: 'paired' };
    }

    async function startPair() {
      var c = await cfg(), chk = G().checkEndpoint(c.endpoint);
      if (!chk.ok) return { status: 'not-on-pc', message: chk.reason };
      var existing = await localGet(PENDING_KEY);
      if (existing && now() - existing.startedAt <= PENDING_MS) {
        return { status: 'pairing', message: 'Pairing — check the code in the WorkspaceHQ window', code: existing.code };
      }
      var code = newCode(), token = G().randomHex(32, genv());
      await localSet(PENDING_KEY, { token: token, code: code, startedAt: now() });
      await sessSet(CODE_KEY, code);
      await refreshBadge(0);
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, PAIR_FETCH_MS) : null;
      var res;
      try {
        res = await doFetch(chk.base + '/pair', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HQ-Bridge': '1' },
          body: JSON.stringify({ code: code, token: token }), signal: ctl ? ctl.signal : undefined,
        });
      } catch (e) {
        // the answer may simply have been lost: keep the pending token; the next popup open or alarm checks the proof
        return { status: 'unreachable', message: 'No answer from WorkspaceHQ. If you allowed it in the app, reopen this popup.', code: code };
      } finally { if (timer) clearTimeout(timer); }
      if (res.status === 200) {
        var pr = await promote();
        return pr.state === 'paired'
          ? { status: 'paired', message: 'Paired with WorkspaceHQ' }
          : { status: 'pairing', message: 'Pairing — check the code in the WorkspaceHQ window', code: code };
      }
      await clearPending(); await refreshBadge(0);   // the old token, if any, stays active
      if (res.status === 403) return { status: 'denied', message: 'Pairing was not allowed in WorkspaceHQ. Your previous pairing is unchanged.' };
      if (res.status === 429) return { status: 'busy', message: 'WorkspaceHQ is already asking, or too many tries — wait a few minutes.' };
      return { status: 'app', message: 'WorkspaceHQ could not save the pairing (HTTP ' + res.status + ').' };
    }

    async function pairState() {
      var p = await localGet(PENDING_KEY), c = await cfg();
      if (p && now() - p.startedAt <= PENDING_MS) return { state: 'pairing', code: p.code };
      return { state: c.token ? 'paired' : 'unpaired' };
    }

    // ---- the Brief on the toolbar -----------------------------------------------------------------------------
    function isStale(b) { return b.ageMinutes == null || b.ageMinutes > STALE_MIN; }
    function refsOf(brief) {
      var out = [];
      (brief.items || []).forEach(function (i) { out.push(i); });
      (brief.overflow || []).forEach(function (i) { out.push(i); });
      return out;
    }

    async function tick() {
      await promote();
      var ps = await pairState();
      var res;
      if (ps.state === 'pairing') res = { state: 'pairing', code: ps.code };
      else if (ps.state === 'unpaired') res = { state: 'unpaired' };
      else res = await fetchBrief();
      if (res.state === 'ok') {
        var seen = (await localGet(SEEN_KEY)) || [];
        var unseen = refsOf(res.brief).filter(function (i) { return seen.indexOf(i.ref) < 0; });
        res.unseen = unseen.map(function (i) { return i.ref; });
        res.newRefs = res.unseen;
        var stale = isStale(res.brief);
        // the popup marks refs seen itself after it has rendered them (markSeen), so its 'new' tags survive the render
        await refreshBadge(stale ? 0 : unseen.length, unseen.some(function (i) { return i.severity === 'high'; }) ? 'high' : 'med');
      } else {
        res.unseen = [];
        await refreshBadge(0);   // offline, not paired, no brief: no badge
      }
      await sessSet(LAST_KEY, { at: now(), state: res.state });
      return res;
    }

    async function fetchBrief() {
      var c = await cfg(), r;
      try { r = await G().guardedFetch(c, '/assist/brief', { method: 'GET' }, genv()); }
      catch (e) { return { state: 'offline', detail: String((e && e.message) || e), code: e && e.code }; }
      if (r.status === 401 || r.status === 403) return { state: 'unpaired', detail: 'WorkspaceHQ did not accept this pairing' };
      if (r.status === 429) return { state: 'busy' };
      if (r.status !== 200) return { state: 'offline', detail: 'HTTP ' + r.status };
      var body = null;
      try { body = await r.json(); } catch (e) { /* not JSON */ }
      if (!body || body.ok !== true) return { state: 'offline', detail: 'unreadable answer' };
      if (!body.brief) return { state: 'nobrief' };
      return { state: 'ok', brief: body.brief };
    }

    async function markSeen(refs) {
      var cur = (await localGet(SEEN_KEY)) || [];
      var merged = cur.filter(function (r) { return refs.indexOf(r) < 0; }).concat(refs).slice(-SEEN_MAX);
      await localSet(SEEN_KEY, merged);
      await refreshBadge(0);
    }

    async function openRef(ref) {
      var c = await cfg(), r;
      try {
        r = await G().guardedFetch(c, '/assist/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: ref }) }, genv());
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      var body = null;
      try { body = await r.json(); } catch (e) { /* not JSON */ }
      if (r.status === 200 && body && body.ok) return { ok: true, note: body.note || '' };
      if (r.status === 404) return { ok: false, error: 'That item is gone — the Brief changed. Reopen this popup.' };
      return { ok: false, error: (body && body.error) || 'HTTP ' + r.status };
    }

    return { startPair: startPair, promote: promote, tick: tick, markSeen: markSeen, openRef: openRef, pairState: pairState, refreshBadge: refreshBadge, ALARM: ALARM };
  }

  // ---- pure view model ---------------------------------------------------------------------------------------
  function hhmm(iso, tz) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var h = tz === 'utc' ? d.getUTCHours() : d.getHours(), m = tz === 'utc' ? d.getUTCMinutes() : d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  // the projection flags 'stale' at 30 min; the toolbar only goes quiet at 60 (or when the age is unknown)
  function isStale(b) { return b.ageMinutes == null || b.ageMinutes > STALE_MIN; }
  function needsModel(res, opts) {
    var tz = opts && opts.tz;
    var m = { state: res.state, title: '', rows: [], overflowLine: '', note: '', incomplete: '' };
    switch (res.state) {
      case 'offline': m.title = res.code === 'not-on-pc' || res.code === 'impostor' ? res.detail : 'Open WorkspaceHQ on this PC'; return m;
      case 'unpaired': m.title = 'Not paired — pair to see the Brief here'; return m;
      case 'pairing': m.title = 'Pairing — check the code in the WorkspaceHQ window'; return m;
      case 'busy': m.title = 'WorkspaceHQ is busy — try again in a minute'; return m;
      case 'nobrief': m.title = 'No Brief yet — open WorkspaceHQ once'; return m;
      case 'ok': break;
      default: m.title = 'Open WorkspaceHQ on this PC'; return m;
    }
    var b = res.brief, fresh = res.newRefs || res.unseen || [];
    var at = hhmm(b.generatedAt, tz);
    m.rows = (b.items || []).slice(0, 3).map(function (i) {
      var nav = i.nav || {};
      return {
        ref: i.ref, sevWord: i.sevWord || i.severity, severity: i.severity, text: i.text, age: i.age || '',
        isNew: fresh.indexOf(i.ref) >= 0,
        scan: nav.kind === 'scan' || /^scan/.test(i.rule || ''),
      };
    });
    m.overflowLine = b.overflowLine || '';
    if (b.errorSources && b.errorSources.length) m.incomplete = 'Brief incomplete · ' + b.errorSources.join(' · ');
    var stale = isStale(b);
    if (stale) m.note = 'This Brief is ' + (b.ageMinutes != null ? b.ageMinutes + ' min' : 'old') + ' old — open WorkspaceHQ to refresh it';
    var stood = b.standing && b.standing.count > 0 && typeof b.standing.line === 'string' ? b.standing.line : '';   // stepped aside after 3 days, still there
    if (!m.rows.length) m.title = (stood ? 'Nothing new · ' + stood : 'Nothing needs you') + (at ? ' · from the ' + at + ' brief' : '');
    return m;
  }

  function renderNeeds(doc, host, model, handlers) {
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    if (host.replaceChildren) host.replaceChildren(); else while (host.firstChild) host.removeChild(host.firstChild);
    if (model.title) host.appendChild(el('div', 'needs-title', model.title));
    model.rows.forEach(function (r) {
      var row = el('div', 'needs-row'); row.dataset.sev = r.severity || '';
      var head = el('div', 'needs-head');
      head.appendChild(el('span', 'needs-sev', r.sevWord || ''));
      head.appendChild(el('span', 'needs-age', r.age));
      if (r.isNew) head.appendChild(el('span', 'needs-new', 'new'));
      row.appendChild(head);
      row.appendChild(el('div', 'needs-text', r.text));
      if (r.scan) row.appendChild(el('div', 'needs-hint', 'start scans in the app (uses Claude)'));
      var btn = el('button', 'mini', 'Open in app'); btn.type = 'button';
      btn.addEventListener('click', function () { if (handlers && handlers.open) handlers.open(r.ref); });
      row.appendChild(btn);
      host.appendChild(row);
    });
    if (model.overflowLine) host.appendChild(el('div', 'needs-more', model.overflowLine));
    if (model.incomplete) host.appendChild(el('div', 'needs-note', model.incomplete));
    if (model.note) host.appendChild(el('div', 'needs-note', model.note));
  }

  var api = create({});
  api.create = create; api.needsModel = needsModel; api.renderNeeds = renderNeeds;
  api.isStale = isStale; api.constants = { PENDING_MS: PENDING_MS, STALE_MIN: STALE_MIN, RED: RED, AMBER: AMBER };
  root.HQAssist = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
