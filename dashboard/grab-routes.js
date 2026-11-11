// Bridge 0.8.0: POST /library/grab — "a file the owner just grabbed also lands in Cosmos as a clip" (batch 3, grab-into-cosmos;
// CONTRACT "Local bridge routes"). Built like assist-bridge-routes.js: browser-bridge.js has already run its loopback Host
// check and CORS by the time handleRoute sees a request.
//
//   setDeps({ dataDir, grabRoot, addClip, now?, log?, store?, loadAudit? })   main.js passes dataDir, grabRoot and the cosmos addClip
//   handleRoute(req, res, { url, send }) → boolean (true once it has answered)
//     POST /library/grab { path, pageUrl?, pageTitle? }
//        → 200 { ok, duplicate?, indexed }   (indexed: its tags and title are already applied; false right after landing)
//        → 409 Cosmos has no folder yet | 413 too large | 415 type not allowed | 403 wrong origin / not in the grab folder
//          | 401 pair first / bad token | 429 | 400 | 503
//   mount:  url.startsWith('/library/')
//
// The extension posts ONLY after a save it just made on the owner's click finished (browser-bridge/grab.js). Everything the
// body says is a hint: the grab folder (grabRoot) comes from main.js, never from the request; the source host comes from the
// file's own folder segment; a `host` or `grabRoot` field in the body is ignored; pageUrl is reduced to host+path before it
// is stored. Checks, in order: bridge header, token (401 'pair first' while no token file exists, so the route fails closed),
// paired origin, JSON body of at most 4 KB (drained, then 413), 120 grabs an hour (429), then deps.addClip (cosmos.js, the only
// writer of data/cosmos). The app never fetches a URL.
//
// Each call writes at most ONE audit record({door:'browser', tool, tier, ok, ms}) when its answer is sent: tool 'library.grab'
// (tier note) once the token checked out; every refusal before that shares the name 'library.refused' and a budget of 20
// records an hour. No path, file name, host or URL is ever in a record.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pairing = require('./bridge-pair');

const MAX_BODY = 4 * 1024;
const HOUR = 3600e3;
const CAP = 120;   // grabs per hour
const TIERS = { 'library.grab': 'note', 'library.refused': 'read' };
const REFUSED_CAP = 20;   // audit records per hour for requests that never proved the token
const STATUSES = new Set([400, 403, 404, 409, 413, 415, 422, 500, 503]);

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e).slice(0, 200);

let deps = null;
let store = null;
let auditLib = null;
let hits = [];
let refusedHits = [];

function setDeps(d) {
  deps = d && d.dataDir ? { now: Date.now, log: () => {}, ...d } : null;
  store = null; auditLib = null;
  hits = [];
  refusedHits = [];
  if (deps) store = deps.store || pairing.forDataDir(deps.dataDir);
}

async function loadAudit() {
  if (auditLib) return auditLib;
  const mine = deps;   // a load that began before setDeps() ran again must not cache its module into the new state
  const m = await (mine.loadAudit ? mine.loadAudit() : import(pathToFileURL(path.join(__dirname, 'assist-audit.mjs')).href));
  if (deps === mine) auditLib = m;
  return m;
}

// Answers only from 'end': an oversize body is drained, then answered 413 — never req.destroy().
function readBody(req, max, cb) {
  const chunks = []; let size = 0, over = false, done = false;
  const finish = (err, obj) => { if (!done) { done = true; cb(err, obj); } };
  req.on('data', (c) => {
    size += c.length;
    if (size > max) { over = true; chunks.length = 0; return; }
    if (!over) chunks.push(c);
  });
  req.on('end', () => {
    if (over) return finish('too big');
    let obj;
    try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return finish('bad json'); }
    finish(null, obj);
  });
  req.on('error', () => finish('read error'));
}

function refusedBudget() {
  if (!deps) return false;
  const t = deps.now();
  refusedHits = refusedHits.filter((x) => t - x < HOUR);
  if (refusedHits.length >= REFUSED_CAP) return false;
  refusedHits.push(t);
  return true;
}

function underCap() {
  const t = deps.now();
  hits = hits.filter((x) => t - x < HOUR);
  if (hits.length >= CAP) return false;
  hits.push(t);
  return true;
}

// Exactly one record per call; a missing or failing audit module never breaks the route.
function audit(tool, ok, ms) {
  if (!deps) return;
  const dataDir = deps.dataDir;
  const fields = { door: 'browser', tool, tier: TIERS[tool] || 'read', ok, ms, at: deps.now(), pid: process.pid };
  loadAudit().then((lib) => { const fn = lib && (lib.record || (lib.default && lib.default.record)); if (typeof fn === 'function') return fn(dataDir, fields); })
    .catch(() => { /* the audit log is best effort */ });
}

function handleRoute(req, res, { url, send: rawSend }) {
  if (typeof url !== 'string' || !url.startsWith('/library/')) return false;
  const t0 = Date.now();
  let tool = null;   // set once the token has checked out
  let answered = false;
  const send = (code, obj) => {
    if (answered) return;
    answered = true;
    rawSend(code, obj);
    if (tool) return audit(tool, code < 400, Date.now() - t0);
    if (refusedBudget()) audit('library.refused', false, Date.now() - t0);
  };
  if (!deps) { send(503, { ok: false, error: 'not ready' }); req.resume(); return true; }

  const origin = String(req.headers.origin || '');
  if (req.headers['x-hq-bridge'] !== '1') { send(403, { ok: false, error: 'missing bridge header' }); req.resume(); return true; }
  if (!(url === '/library/grab' && req.method === 'POST')) { send(404, { ok: false, error: 'not found' }); req.resume(); return true; }

  const token = store.get();
  if (!token) { send(401, { ok: false, error: 'pair first' }); req.resume(); return true; }
  if (!store.isPairedOrigin(origin)) { send(403, { ok: false, error: 'wrong origin' }); req.resume(); return true; }
  const given = req.headers['x-hq-token'];
  if (typeof given !== 'string' || !pairing.sameSecret(given, token)) { send(401, { ok: false, error: 'bad token' }); req.resume(); return true; }

  tool = 'library.grab';
  readBody(req, MAX_BODY, (err, body) => {
    if (err) return send(err === 'too big' ? 413 : 400, { ok: false, error: err === 'too big' ? 'too large' : err });
    grabAnswer(body).then((r) => send(r.status, r.body), (e) => send(500, { ok: false, error: msg(e) }));
  });
  return true;
}

async function grabAnswer(body) {
  const bad = (error) => ({ status: 400, body: { ok: false, error } });
  if (!isObj(body)) return bad('send an object');
  const p = body.path;
  if (typeof p !== 'string' || p === '' || p.length > 1024) return bad('path is required');
  for (const k of ['pageUrl', 'pageTitle']) if (body[k] !== undefined && typeof body[k] !== 'string') return bad(k + ' must be text');
  if (!underCap()) return { status: 429, body: { ok: false, error: 'too many requests' } };
  if (typeof deps.addClip !== 'function' || typeof deps.grabRoot !== 'string' || deps.grabRoot === '') {
    return { status: 503, body: { ok: false, error: 'Cosmos is not available' } };
  }
  let r;
  try {
    // only these four fields cross: nothing else the request said (a host, a root, a name) reaches Cosmos
    r = await deps.addClip({
      abs: p,
      grabRoot: deps.grabRoot,
      pageUrl: typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 2048) : '',
      pageTitle: typeof body.pageTitle === 'string' ? body.pageTitle.slice(0, 500) : '',
    });
  } catch (e) { deps.log('grab-routes: addClip threw: ' + msg(e)); return { status: 500, body: { ok: false, error: 'Cosmos could not add that file.' } }; }
  if (r && r.ok === true) {
    return { status: 200, body: { ok: true, ...(r.duplicate === true ? { duplicate: true } : {}), indexed: r.indexed === true } };
  }
  const status = r && STATUSES.has(r.status) ? r.status : 500;
  const error = r && typeof r.error === 'string' && r.error !== '' ? r.error.slice(0, 200) : 'Cosmos could not add that file.';
  return { status, body: { ok: false, error } };
}

module.exports = { setDeps, handleRoute, MAX_BODY, CAP };
