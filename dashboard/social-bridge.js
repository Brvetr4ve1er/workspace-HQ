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
//       GET  /social/outbox         -> staged actions awaiting YOUR approval
//       POST /social/outbox/result  -> extension reports a send outcome
//       POST /social/outbox/cancel  -> popup "Skip": staged -> canceled, never publishes
//       POST /social/accounts       -> extension registers connected accounts
//
// THE GATE: MCP only ever writes actions with status:"staged". This module NEVER
// promotes staged->sent on its own — it only records the outcome the extension
// reports AFTER a human clicked Approve & Send in the popup. There is no
// server-side or MCP approve path by design. Don't add one without updating
// docs/sync/CONTRACT.md's write-gate invariant.

const fs = require('node:fs');
const path = require('node:path');

const MAX_RESULT_BODY = 64 * 1024;
const clamp = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

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
      const id = clamp(String(body.id || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
      // Only a staged action can be sent — ignore double-reports / tampering.
      if (a.status !== 'staged') { send(200, { ok: true, ignored: true, status: a.status }); return; }
      if (body.ok) {
        a.status = 'sent';
        a.sent_at = new Date().toISOString();
        a.result = { url: clamp(body.url || '', 500), uri: clamp(body.uri || '', 300) };
      } else {
        a.status = 'failed';
        a.error = clamp(body.error || 'send failed', 300);
      }
      d.updated = new Date().toISOString();
      writeAtomic(outboxFile, JSON.stringify(d, null, 2));
      send(200, { ok: true, id, status: a.status });
    });
    return true;
  }

  // Popup "Skip": the human declines a staged post. Flips ONE staged action to
  // 'canceled' and does nothing else — no adapter, no extension message, no
  // sent_at/result. 'canceled' is terminal: GET /social/outbox stops listing it
  // and /result ignores it (status !== 'staged'). Anything not staged is
  // refused with 409 and the file is left untouched. The MCP twin is
  // hq_social_cancel (dashboard-v3/mcp/server.mjs); both obey the same gate.
  if (req.method === 'POST' && url === '/social/outbox/cancel') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    readBody(req, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: String(err) }); return; }
      const id = clamp(String((body && body.id) || ''), 80);
      if (!id) { send(400, { ok: false, error: 'id required' }); return; }
      const d = readJsonOr(outboxFile, { actions: [] });
      const a = (Array.isArray(d.actions) ? d.actions : []).find((x) => x && x.id === id);
      if (!a) { send(404, { ok: false, error: 'unknown action id' }); return; }
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
      const list = Array.isArray(body.accounts) ? body.accounts : [];
      const accounts = list.slice(0, 50).map((a) => ({
        platform: clamp(String(a.platform || '').toLowerCase(), 20),
        handle: clamp(a.handle || '', 120),
        display: clamp(a.display || '', 120),
        connected_at: new Date().toISOString(),
      })).filter((a) => a.platform && a.handle);
      writeAtomic(accountsFile, JSON.stringify({ updated: new Date().toISOString(), accounts }, null, 2));
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

module.exports = { socialTendril, handleRoute };
