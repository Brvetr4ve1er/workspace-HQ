// WorkspaceHQ social bridge — the SOCIAL BINDING's app-side half.
//
// Two concerns, both localhost-only, both riding the same tendril router in
// browser-bridge.js (same 127.0.0.1 bind, same X-HQ-Bridge header + optional
// X-HQ-Token gate — a web page can't forge those, only the extension can):
//
//   INGEST (extension -> app):  the `socialTendril` descriptor plugs into the
//     existing /ingest/<route> machinery. The extension POSTs scraped
//     feed/mention/notification/metrics events; they land in
//     data/social/inbox.json (rolling 7-day window) for the MCP read tools.
//
//   OUTBOX (app <-> extension):  handleRoute() serves the reverse channel the
//     tendril model doesn't cover:
//       GET  /social/outbox          -> staged actions awaiting YOUR approval
//       POST /social/outbox/claim    -> approved send: staged -> sending, BEFORE the adapter runs
//       POST /social/outbox/result   -> extension reports a send outcome (sending -> sent|failed)
//       POST /social/outbox/cancel   -> popup "Skip": staged -> canceled, never publishes
//       POST /social/outbox/release  -> owner, by hand: a stale claim (sending, no result
//                                       for CLAIM_STALE_MIN) -> staged again; never publishes
//       POST /social/accounts        -> extension registers connected accounts
//
// THE GATE: MCP only ever writes actions with status:"staged". This module NEVER
// promotes staged->sent on its own — it only records the outcome the extension
// reports AFTER a human clicked Approve & Send in the popup. There is no
// server-side or MCP approve path by design. Don't add one without updating
// docs/sync/CONTRACT.md's write-gate invariant.
//
// ATOMICITY: every outbox route reads, checks, mutates and writes synchronously
// inside one readBody 'end' callback (sync fs, no await), so two requests that
// race on the same action serialize on the event loop — exactly one of a claim
// and a Skip wins. Keep it synchronous. (The MCP server is another process with
// its own read-then-write; CONTRACT.md 2026-10-07 spells out what that leaves.)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_RESULT_BODY = 64 * 1024;
// A claim with no result for this long may be released back to 'staged' by the
// owner (POST /social/outbox/release). Never automatically.
const CLAIM_STALE_MIN = 10;
const CLAIM_STALE_MS = CLAIM_STALE_MIN * 60 * 1000;

// What gets published — the same six fields the popup shows and socialSend
// compares. content_hash = sha256 hex of this canonical JSON; the extension
// (browser-bridge/social.js socialContentHash) must compute the identical string.
const PAYLOAD_KEYS = ['platform', 'op', 'text', 'reply_to', 'target', 'title'];
function contentHash(a) {
  const canon = JSON.stringify(PAYLOAD_KEYS.map((k) => (a[k] == null ? '' : String(a[k]))));
  return crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
}
const clamp = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// A request body readBody parsed: valid JSON can still be null / an array / a scalar, and
// `body.id` on null throws inside the request's 'end' handler (an uncaught main-process error).
const isBodyObj = (b) => !!b && typeof b === 'object' && !Array.isArray(b);
const NOT_OBJ = { ok: false, error: 'body must be a JSON object' };

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// tmp + rename so the MCP server / popup never read a half-written outbox.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---- INGEST tendril -------------------------------------------------------
// One social event, sanitized. `metrics` events carry a numbers snapshot; the
// content kinds carry author/text/url + engagement counts. Unknown shapes are
// dropped (return null) exactly like the browser tendril.
function sanitizeSocial(e) {
  if (!e || typeof e !== 'object') return null;
  const platform = String(e.platform || '').toLowerCase();
  const kind = String(e.kind || '').toLowerCase();
  if (!platform || !['feed', 'mention', 'notification', 'metrics'].includes(kind)) return null;
  const ts = Number(e.ts) || Date.now();
  const base = { platform: clamp(platform, 20), kind, id: clamp(String(e.id || ''), 200), ts };
  if (kind === 'metrics') {
    const m = e.metrics || {};
    base.metrics = { followers: num(m.followers), following: num(m.following), posts: num(m.posts), likes: num(m.likes), impressions: num(m.impressions) };
    return base;
  }
  const c = e.counts || {};
  base.author = clamp(e.author || '', 120);
  base.text = clamp(e.text || '', 2000);
  base.url = clamp(e.url || '', 500);
  base.uri = clamp(e.uri || '', 300);
  base.counts = { likes: num(c.likes), reposts: num(c.reposts), replies: num(c.replies) };
  return base;
}

const socialTendril = {
  name: 'social',
  route: 'social',
  legacyRoutes: [],
  sidecarPath: path.join('social', 'inbox.json'),
  windowDays: 7,
  maxEvents: 4000,
  // metrics: at most one snapshot per platform per hour (bounds growth);
  // content: identity is platform+kind+id.
  dedupe: (e) => (e.kind === 'metrics'
    ? `${e.platform}|metrics|${Math.floor(e.ts / 3600000)}`
    : `${e.platform}|${e.kind}|${e.id}`),
  sanitize: sanitizeSocial,
};

// ---- OUTBOX + accounts routes ---------------------------------------------
// Returns true if it consumed the request (sent a response), false otherwise
// so the caller falls through to its own routing. `send`, `token` and
// `dataDir` are handed in by browser-bridge.js's request handler.
function handleRoute(req, res, { url, send, token, dataDir }) {
  const authed = req.headers['x-hq-bridge'] === '1' && (!token || req.headers['x-hq-token'] === token);
  const outboxFile = path.join(dataDir, 'social', 'outbox.json');
  const accountsFile = path.join(dataDir, 'social', 'accounts.json');

  // The extension polls this for work to do. It only ever sees STAGED actions —
  // the human approves+sends from the popup; this never hands out a "send now".
  if (req.method === 'GET' && url === '/social/outbox') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    const d = readJsonOr(outboxFile, { actions: [] });
    const staged = (Array.isArray(d.actions) ? d.actions : []).filter((a) => a && a.status === 'staged');
    send(200, { ok: true, actions: staged });
    return true;
  }

  // Extension reports the outcome of a post the human approved+sent.
  if (req.method === 'POST' && url === '/social/outbox/result') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      if (!isBodyObj(body)) { send(400, NOT_OBJ); return; }
      const id = clamp(String(body.id || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
      // A Skip / hq_social_cancel can land while an approved send is already in flight (the
      // extension's staged re-check is check-then-act). If that send then reports success,
      // the post IS live: keep 'canceled' (terminal, never re-listed, never 'sent') but record
      // where it went instead of dropping the URL. First report only. CONTRACT.md 2026-10-06.
      if (a.status === 'canceled' && body.ok && !a.sent_after_cancel) {
        a.sent_after_cancel = true;
        a.sent_at = new Date().toISOString();
        a.result = { url: clamp(body.url || '', 500), uri: clamp(body.uri || '', 300) };
        d.updated = a.sent_at;
        try { writeAtomic(outboxFile, JSON.stringify(d, null, 2)); }
        catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
        send(200, { ok: true, id, status: 'canceled', sent_after_cancel: true });
        return;
      }
      // Otherwise only an in-flight action can be settled: 'sending' (claimed by an
      // extension >= 0.3.0) or 'staged' (a 0.2.0 extension that wasn't reloaded publishes
      // without claiming; also a late report for a claim the owner released). Anything
      // else is a double-report / tampering — ignored, file untouched.
      if (a.status !== 'sending' && a.status !== 'staged') { send(200, { ok: true, ignored: true, status: a.status }); return; }
      if (body.ok) {
        a.status = 'sent';
        a.sent_at = new Date().toISOString();
        a.result = { url: clamp(body.url || '', 500), uri: clamp(body.uri || '', 300) };
      } else {
        a.status = 'failed';
        a.error = clamp(body.error || 'send failed', 300);
      }
      d.updated = new Date().toISOString();
      try { writeAtomic(outboxFile, JSON.stringify(d, null, 2)); }
      catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
      send(200, { ok: true, id, status: a.status });
    });
    return true;
  }

  // Approve & Send, step 1: the extension claims the post BEFORE any adapter runs.
  // Flips ONE staged action to 'sending' (stamping claimed_at) and hands back the
  // app's copy — the only copy the extension may publish. With content_hash, the
  // claim also requires the payload to still be what the human saw. Anything not
  // staged, or a changed payload, is refused with 409 and the file is left
  // untouched. A claim publishes nothing; it only takes the post off the card so
  // a Skip / second click can't race the send.
  if (req.method === 'POST' && url === '/social/outbox/claim') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      if (!isBodyObj(body)) { send(400, NOT_OBJ); return; }
      const id = clamp(String(body.id || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const hasHash = body.content_hash != null && body.content_hash !== '';
      if (hasHash && !(typeof body.content_hash === 'string' && /^[0-9a-f]{64}$/i.test(body.content_hash))) {
        send(400, { ok: false, error: 'content_hash must be a sha256 hex string' }); return;
      }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
      if (a.status !== 'staged') { send(409, { ok: false, error: 'not staged', id, status: a.status }); return; }
      if (hasHash && contentHash(a) !== body.content_hash.toLowerCase()) {
        send(409, { ok: false, error: 'content changed', id, status: a.status }); return;
      }
      a.status = 'sending';
      a.claimed_at = new Date().toISOString();
      d.updated = a.claimed_at;
      try { writeAtomic(outboxFile, JSON.stringify(d, null, 2)); }
      catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
      send(200, { ok: true, id, status: 'sending', claimed_at: a.claimed_at, action: { ...a } });
    });
    return true;
  }

  // Owner escape hatch for a claim that never got a result (service worker died
  // mid-send, app down when the result came back): after CLAIM_STALE_MIN the owner
  // may put it back to 'staged' by hand. It only returns the post to the approval
  // card — a human must Approve & Send again. Nothing calls this on a timer.
  // CONTRACT.md 2026-10-07: check the platform first, the stuck send may be live.
  if (req.method === 'POST' && url === '/social/outbox/release') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      if (!isBodyObj(body)) { send(400, NOT_OBJ); return; }
      const id = clamp(String(body.id || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
      if (a.status !== 'sending') { send(409, { ok: false, error: 'not sending', id, status: a.status }); return; }
      const claimed = Date.parse(a.claimed_at || '');
      // An unreadable claimed_at (hand edit) has no age to wait out: releasable now.
      if (Number.isFinite(claimed) && Date.now() - claimed < CLAIM_STALE_MS) {
        send(409, { ok: false, error: 'claim still fresh', id, status: a.status, claimed_at: a.claimed_at, release_after: new Date(claimed + CLAIM_STALE_MS).toISOString() });
        return;
      }
      a.status = 'staged';
      delete a.claimed_at;
      a.released_at = new Date().toISOString();
      d.updated = a.released_at;
      try { writeAtomic(outboxFile, JSON.stringify(d, null, 2)); }
      catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
      send(200, { ok: true, id, status: 'staged', released_at: a.released_at });
    });
    return true;
  }

  // Popup "Skip": the human declines a staged post. Flips ONE staged action to
  // 'canceled' and does nothing else — no adapter, no extension message, no
  // sent_at/result. 'canceled' is terminal: GET /social/outbox stops listing it
  // and /result never makes it 'sent' (a late success is recorded as
  // sent_after_cancel, see /result above). Anything not staged is
  // refused with 409 and the file is left untouched — a claimed ('sending') post
  // as 'already publishing': the send already won, a Skip can't race it. The MCP
  // twin is hq_social_cancel (mcp/workspacehq/server.mjs); both obey the same gate.
  if (req.method === 'POST' && url === '/social/outbox/cancel') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      const id = clamp(String((body && body.id) || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
      if (a.status === 'sending') { send(409, { ok: false, error: 'already publishing', id, status: a.status }); return; }
      if (a.status !== 'staged') { send(409, { ok: false, error: 'not staged', id, status: a.status }); return; }
      a.status = 'canceled';
      a.canceled_at = new Date().toISOString();
      d.updated = a.canceled_at;
      try { writeAtomic(outboxFile, JSON.stringify(d, null, 2)); }
      catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
      send(200, { ok: true, id, status: 'canceled' });
    });
    return true;
  }

  // Extension registers which accounts are connected (snapshot, overwritten).
  if (req.method === 'POST' && url === '/social/accounts') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      if (!isBodyObj(body)) { send(400, NOT_OBJ); return; }   // never wipe the snapshot on junk
      const list = Array.isArray(body.accounts) ? body.accounts : [];
      const accounts = list.slice(0, 50).filter(isBodyObj).map((a) => ({   // a null row threw here too
        platform: clamp(String(a.platform || '').toLowerCase(), 20),
        handle: clamp(a.handle || '', 120),
        display: clamp(a.display || '', 120),
        connected_at: new Date().toISOString(),
      })).filter((a) => a.platform && a.handle);
      try { writeAtomic(accountsFile, JSON.stringify({ updated: new Date().toISOString(), accounts }, null, 2)); }
      catch (e) { send(500, { ok: false, error: 'write failed: ' + String((e && e.code) || e) }); return; }
      send(200, { ok: true, count: accounts.length });
    });
    return true;
  }

  return false;
}

// Bounded body reader — accumulate raw chunks, decode once (multibyte-safe).
function readBody(req, cb) {
  const chunks = []; let size = 0, tooBig = false;
  req.on('data', (c) => { chunks.push(c); size += c.length; if (size > MAX_RESULT_BODY) tooBig = true; });
  req.on('end', () => {
    if (tooBig) return cb('too big');
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch { cb('bad json'); }
  });
  req.on('error', () => cb('read error'));
}

module.exports = { socialTendril, handleRoute, contentHash, CLAIM_STALE_MIN };
