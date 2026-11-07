// WorkspaceHQ Bridge — endpoint guard. Classic script: importScripts() in the service worker, <script> in the popup.
// Nothing carrying the token may leave until BOTH checks pass:
//   1. the endpoint is this PC: http://127.0.0.1 or http://localhost, any port, no user info, no other path. (The bridge
//      binds 127.0.0.1 only and the manifest's host permissions name only those two.)
//   2. the thing answering is WorkspaceHQ: GET /health?nonce=<32 hex> must return HMAC-SHA256(token, nonce) as hex,
//      verified with WebCrypto against the stored token. When the app is down any process can take the port; only the
//      real app knows the token. The check never sends the token. A pass is cached 60 s in chrome.storage.session.
// Without a token there is no secret to protect, so only check 1 applies.
//
//   HQGuard.checkEndpoint(endpoint) → { ok, base?, reason? }
//   HQGuard.guardedFetch(cfg, path, init?, env?) → Response, or throws an Error (.code 'not-on-pc' | 'impostor' | 'unreachable')
//   HQGuard.verifyApp(base, token, env?) → { ok, reason? }
//   HQGuard.hmacHex(token, message) / HQGuard.randomHex(byteCount)
//   env = { fetch?, storage?, now?, crypto? } — tests inject fakes; defaults are the page's globals.
(function (root) {
  'use strict';
  var CACHE_MS = 60 * 1000;
  var CACHE_KEY = 'hq_guard_ok';
  var PROBE_MS = 4000;
  var NOT_ON_PC = 'endpoint is not on this PC — not sent';

  function checkEndpoint(endpoint) {
    var u;
    try { u = new URL(String(endpoint || '').trim()); } catch (e) { return { ok: false, reason: NOT_ON_PC }; }
    if (u.protocol !== 'http:') return { ok: false, reason: NOT_ON_PC };
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return { ok: false, reason: NOT_ON_PC };
    if (u.username || u.password) return { ok: false, reason: NOT_ON_PC };
    if (u.pathname !== '/' && u.pathname !== '') return { ok: false, reason: NOT_ON_PC };
    return { ok: true, base: u.protocol + '//' + u.host, port: u.port || '80' };
  }

  function subtle(env) {
    var c = (env && env.crypto) || root.crypto;
    if (!c || !c.subtle) throw new Error('WebCrypto is not available');
    return c;
  }
  function toHex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  function hmacHex(token, message, env) {
    var c = subtle(env), enc = new TextEncoder();
    return c.subtle.importKey('raw', enc.encode(String(token)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return c.subtle.sign('HMAC', key, enc.encode(String(message))); })
      .then(toHex);
  }
  function randomHex(n, env) {
    var c = (env && env.crypto) || root.crypto, b = new Uint8Array(n);
    c.getRandomValues(b);
    return toHex(b);
  }
  function sameHex(a, b) {   // no early exit on the first differing character
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  function sessionStore(env) { return (env && env.storage) || (root.chrome && root.chrome.storage && root.chrome.storage.session) || null; }
  function fetchOf(env) { return (env && env.fetch) || root.fetch.bind(root); }
  function nowOf(env) { return env && env.now ? env.now() : Date.now(); }

  function impostor(port) { return 'something else is answering on port ' + port + ' — not sent'; }

  async function verifyApp(base, token, env) {
    var port = String(new URL(base).port || '80');
    var store = sessionStore(env), fp = await hmacHex(token, 'hq-guard-cache', env);
    if (store) {
      try {
        var got = (await store.get(CACHE_KEY))[CACHE_KEY];
        if (got && got.base === base && got.fp === fp && nowOf(env) - got.at < CACHE_MS) return { ok: true, cached: true };
      } catch (e) { /* session storage unavailable: just probe */ }
    }
    var nonce = randomHex(16, env), res;
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, PROBE_MS) : null;
    try {
      res = await fetchOf(env)(base + '/health?nonce=' + nonce, { headers: { 'X-HQ-Bridge': '1' }, signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      return { ok: false, reason: 'WorkspaceHQ is not reachable — open the app', code: 'unreachable' };
    } finally { if (timer) clearTimeout(timer); }
    var body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    var want = await hmacHex(token, nonce, env);
    if (!res.ok || !body || body.app !== 'workspacehq' || !sameHex(String(body.proof || ''), want)) {
      return { ok: false, reason: impostor(port), code: 'impostor' };
    }
    if (store) { try { var o = {}; o[CACHE_KEY] = { base: base, fp: fp, at: nowOf(env) }; await store.set(o); } catch (e) { /* cache is optional */ } }
    return { ok: true };
  }

  function guardError(reason, code) { var e = new Error(reason); e.code = code; return e; }

  // The one door every token-bearing fetch goes through.
  async function guardedFetch(cfg, path, init, env) {
    var chk = checkEndpoint(cfg && cfg.endpoint);
    if (!chk.ok) throw guardError(chk.reason, 'not-on-pc');
    var token = (cfg && cfg.token) || '';
    if (token) {
      var v = await verifyApp(chk.base, token, env);
      if (!v.ok) throw guardError(v.reason, v.code || 'impostor');
    }
    var opts = init || {};
    var headers = Object.assign({ 'X-HQ-Bridge': '1' }, opts.headers || {});
    if (token) headers['X-HQ-Token'] = token;
    return fetchOf(env)(chk.base + path, Object.assign({}, opts, { headers: headers }));
  }

  root.HQGuard = { checkEndpoint: checkEndpoint, verifyApp: verifyApp, guardedFetch: guardedFetch, hmacHex: hmacHex, randomHex: randomHex, sameHex: sameHex, NOT_ON_PC: NOT_ON_PC, impostorMessage: impostor };
})(typeof globalThis !== 'undefined' ? globalThis : self);
