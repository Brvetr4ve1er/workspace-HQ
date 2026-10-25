// Claude Hub H4 — local bridge routes for the extension's claude.ai live sync (spec 2026-10-13 §5.3, §11).
// Contract: docs/sync/CONTRACT.md "Local bridge routes — Claude Hub live sync". The Hub does the parsing, de-dup and
// tombstone checks; this module authenticates, caps, schema-checks and maps Hub answers to HTTP codes.
const MAX_SYNC_BODY = 4 * 1024 * 1024;
const MAX_ITEMS = 50;
const UUID_RE = /^[A-Za-z0-9-]{1,80}$/;
let hub = null;

function setHub(h) { hub = h || null; }
function getHub() { return hub; }
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

function checkItems(body) {
  if (!isObj(body)) return { error: 'body must be an object' };
  if (body.v !== 1) return { error: 'unsupported version (expected v:1)' };
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_ITEMS) return { error: 'items must hold 1–50 entries' };
  for (let i = 0; i < body.items.length; i++) {
    const it = body.items[i];
    if (!isObj(it) || (it.kind !== 'conversation' && it.kind !== 'project')) return { error: 'item ' + i + ': kind must be conversation or project' };
    if (!isObj(it.data) || typeof it.data.uuid !== 'string' || !UUID_RE.test(it.data.uuid)) return { error: 'item ' + i + ': data.uuid missing or malformed' };
    if (it.kind === 'conversation' && !Array.isArray(it.data.chat_messages)) return { error: 'item ' + i + ': chat_messages must be an array' };
  }
  return { items: body.items.map((it) => ({ kind: it.kind, data: it.data })) };
}

// Answers only from 'end' (or 'error'): like browser-bridge.js's ingest path, an oversize body is drained and THEN
// answered 413 — never req.destroy() and never a reply while the extension is still sending (that wedged its queue).
function readBody(req, max, cb) {
  const chunks = []; let size = 0, over = false, done = false;
  const finish = (err, obj) => { if (!done) { done = true; cb(err, obj); } };
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { over = true; chunks.length = 0; return; }   // keep draining, keep nothing
    if (!over) chunks.push(c);
  });
  req.on('end', () => {
    if (over) { finish('too big'); return; }
    let obj;
    try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { finish('bad json'); return; }
    finish(null, obj);
  });
  req.on('error', () => finish('read error'));
}

const hubError = (r) => (r && typeof r === 'object' && typeof r.error === 'string' ? r.error : null);

function handleRoute(req, res, { url, send, token }) {
  if (!url.startsWith('/claude/')) return false;
  const authed = req.headers['x-hq-bridge'] === '1' && (!token || req.headers['x-hq-token'] === token);
  if (req.method === 'GET' && url === '/claude/sync-state') {
    if (!authed) { send(403, { ok: false, error: 'forbidden' }); return true; }
    const h = getHub();
    if (!h) { send(503, { ok: false, error: 'claude hub not ready' }); return true; }
    h.request('syncState', {}, { timeout: 10000 }).then((r) => {
      const e = hubError(r);
      if (e) send(503, { ok: false, error: e.slice(0, 200) }); else send(200, { ok: true, ...r });
    });
    return true;
  }
  if (req.method === 'POST' && url === '/claude/sync') {
    if (!authed) { req.resume(); send(403, { ok: false, error: 'forbidden' }); return true; }
    if (Number(req.headers['content-length'] || 0) > MAX_SYNC_BODY) {   // drained, then answered from 'end'
      let answered = false; const once = () => { if (!answered) { answered = true; send(413, { ok: false, error: 'too big' }); } };
      req.on('end', once); req.on('error', once); req.resume(); return true;
    }
    readBody(req, MAX_SYNC_BODY, (err, body) => {
      if (err) { send(err === 'too big' ? 413 : 400, { ok: false, error: err }); return; }
      const c = checkItems(body);
      if (c.error) { send(400, { ok: false, error: c.error }); return; }
      const h = getHub();
      if (!h) { send(503, { ok: false, error: 'claude hub not ready' }); return; }
      h.request('syncPush', { items: c.items }, { timeout: 30000 }).then((r) => {
        const e = hubError(r);
        if (e) send(e.startsWith('read-only hub') ? 409 : 503, { ok: false, error: e.slice(0, 200) });
        else send(200, { ok: true, report: r });
      });
    });
    return true;
  }
  send(404, { ok: false, error: 'not found' });
  return true;
}

module.exports = { handleRoute, setHub, getHub, checkItems, MAX_SYNC_BODY, MAX_ITEMS, UUID_RE };
