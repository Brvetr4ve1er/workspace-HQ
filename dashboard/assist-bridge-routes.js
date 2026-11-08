// Bridge routes for pairing and the Brief on the toolbar (spec: WorkspaceHQ Bridge 0.7.0, stage 1; CONTRACT
// "Local bridge routes — pairing and the Brief"). Built like claude-bridge-routes.js: browser-bridge.js has already run
// its loopback Host check and CORS by the time handleRoute sees a request.
//
//   setDeps({ dataDir, dialog, openAt, now?, log?, loadProject?, loadAudit?, store? })   main.js passes the first three
//   handleRoute(req, res, { url, send }) → boolean (true once it has answered)
//     POST /pair {code, token}  → 200 {ok} after the owner's Allow | 403 | 429 | 413
//     GET  /assist/brief        → 200 {ok, brief: projection|null} | 401 pair first | 403 wrong origin | 429 | 503
//     POST /assist/open {ref}   → 200 {ok} | 404 unknown ref | 401 | 403 | 413 | 429
//   mount:  url === '/pair' || url.startsWith('/assist/')
//   also exported for browser-bridge.js: tokenGetter(), pairing(), proofFor(nonce), corsAllowed(origin, urlPath).
//
// Every /assist/* route needs the token (401 'pair first' while no token file exists, so they fail closed) AND the
// paired origin. Bodies are at most 8 KB (drained, then 413). The projection (brief-project.mjs) is the only text that
// leaves: this module re-filters it through a field allowlist and never adds keys, names, ids or paths of its own.
// Each call writes at most one audit record({door:'browser', tool, tier, ok, ms}) when its answer is sent: under its own name once
// the token checked out; every refusal before that shares the name 'assist.refused' and a budget of 20 records an hour.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const pairing = require('./bridge-pair');

const MAX_BODY = 8 * 1024;
const HOUR = 3600e3;
const CAPS = { brief: 120, open: 60 };   // per hour
const REF_RE = /^[0-9a-f]{12}$/;
const SEG_RE = /^[a-z]{2,16}$/;
const ID_RE = /^[\w.-]{1,80}$/;
const TIERS = { pair: 'note', 'assist.brief': 'read', 'assist.open': 'read', 'assist.refused': 'read' };
const REFUSED_CAP = 20;   // audit records per hour for requests that never proved the token (a flood must not push real history out)

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
const msg = (e) => String((e && e.message) || e).slice(0, 200);

let deps = null;
let pairer = null;
let store = null;
let projectLib = null;
let auditLib = null;
let hits = { brief: [], open: [] };
let refusedHits = [];

function setDeps(d) {
  deps = d && d.dataDir ? { now: Date.now, log: () => {}, ...d } : null;
  pairer = null; store = null; projectLib = null; auditLib = null;
  hits = { brief: [], open: [] };
  refusedHits = [];
  if (deps) {
    store = deps.store || pairing.forDataDir(deps.dataDir);
    pairer = pairing.create({ dataDir: deps.dataDir, dialog: deps.dialog, now: deps.now, log: deps.log, store });
  }
}

const modUrl = (file) => pathToFileURL(path.join(__dirname, file)).href;
// the brief.js idiom: a cached dynamic import; a failed import is retried next call (the module may land later)
async function loadProject() {
  if (projectLib) return projectLib;
  const m = await (deps.loadProject ? deps.loadProject() : import(modUrl('brief-project.mjs')));
  return (projectLib = m);
}
async function loadAudit() {
  if (auditLib) return auditLib;
  const m = await (deps.loadAudit ? deps.loadAudit() : import(modUrl('assist-audit.mjs')));
  return (auditLib = m);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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

// Only a request that proved the token (or a /pair that succeeded) is audited under its own name. Everything else — an
// unknown path, a missing header, a wrong origin, a bad token — shares one fixed name and a small hourly budget, so a
// web page or local process cannot choose tool names or flood the log.
function refusedBudget() {
  const t = deps.now();
  refusedHits = refusedHits.filter((x) => t - x < HOUR);
  if (refusedHits.length >= REFUSED_CAP) return false;
  refusedHits.push(t);
  return true;
}

function underCap(kind) {
  const t = deps.now();
  hits[kind] = hits[kind].filter((x) => t - x < HOUR);
  if (hits[kind].length >= CAPS[kind]) return false;
  hits[kind].push(t);
  return true;
}

// ---- the projection allowlist ---------------------------------------------------------------------------------
const navOf = (n) => {
  if (!isObj(n)) return null;
  const out = {};
  for (const k of ['kind', 'tab', 'sub']) if (typeof n[k] === 'string' && SEG_RE.test(n[k])) out[k] = n[k];
  return out;
};
function itemOf(it, full) {
  if (!isObj(it) || typeof it.ref !== 'string' || !REF_RE.test(it.ref)) return null;
  const out = {
    ref: it.ref, rule: str(it.rule, 40), severity: ['high', 'med', 'low'].includes(it.severity) ? it.severity : 'low',
    text: str(it.text, 300), count: Number.isFinite(it.count) ? Math.max(0, Math.min(9999, Math.round(it.count))) : 0, isNew: it.isNew === true,
  };
  if (full) { out.sevWord = str(it.sevWord, 20); out.age = str(it.age, 60); out.nav = navOf(it.nav); }
  return out;
}
function cleanProjection(p) {
  if (!isObj(p)) return null;
  const list = (a, full) => (Array.isArray(a) ? a.map((x) => itemOf(x, full)).filter(Boolean) : []);
  const c = isObj(p.counts) ? p.counts : {};
  const n = (x) => (Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);
  return {
    v: 1,
    generatedAt: typeof p.generatedAt === 'string' ? p.generatedAt.slice(0, 40) : null,
    ageMinutes: Number.isFinite(p.ageMinutes) ? Math.max(0, Math.round(p.ageMinutes)) : null,
    stale: p.stale === true,
    counts: { high: n(c.high), med: n(c.med), low: n(c.low) },
    items: list(p.items, true).slice(0, 3),
    overflow: list(p.overflow, false).slice(0, 12),
    overflowLine: str(p.overflowLine, 200),
    more: n(p.more),
    standing: isObj(p.standing) && n(p.standing.count) > 0 ? { count: n(p.standing.count), since: str(p.standing.since, 10), line: str(p.standing.line, 40) } : null,
    errorSources: Array.isArray(p.errorSources) ? p.errorSources.filter((s) => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 12) : [],
  };
}

// ---- ref -> the item's full action (main-side only; the extension never sees keys) -----------------------------
const refOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
function findByRef(brief, ref) {
  if (!isObj(brief)) return null;
  for (const list of [brief.items, brief.overflow]) {
    if (!Array.isArray(list)) continue;
    for (const it of list) if (isObj(it) && typeof it.key === 'string' && refOf(it.key) === ref) return it;
  }
  return null;
}
// → { route, note? } | null. A scan never starts from here: the app shows the Home tab and says where scans start.
function routeOf(action) {
  if (!isObj(action)) return null;
  if (action.kind === 'scan') return { route: { tab: 'home' }, note: 'start scans in the app (uses Claude)' };
  if (action.kind !== 'go' || typeof action.tab !== 'string' || !SEG_RE.test(action.tab)) return null;
  const route = { tab: action.tab };
  if (typeof action.sub === 'string' && SEG_RE.test(action.sub)) route.sub = action.sub;
  if (typeof action.projectId === 'string' && ID_RE.test(action.projectId)) route.projectId = action.projectId;
  return { route };
}

// ---- the handler ------------------------------------------------------------------------------------------------
function handleRoute(req, res, { url, send: rawSend }) {
  const isPair = url === '/pair';
  if (!isPair && !url.startsWith('/assist/')) return false;
  const t0 = Date.now();
  let tool = null;   // set once the token has checked out
  let answered = false;
  const send = (code, obj) => {
    if (answered) return;
    answered = true;
    rawSend(code, obj);
    if (isPair && code < 400) return audit('pair', true, Date.now() - t0);
    if (tool) return audit(tool, code < 400, Date.now() - t0);
    if (refusedBudget()) audit(isPair ? 'pair' : 'assist.refused', false, Date.now() - t0);
  };
  if (!deps) { send(503, { ok: false, error: 'not ready' }); req.resume(); return true; }

  const origin = String(req.headers.origin || '');
  if (req.headers['x-hq-bridge'] !== '1') { send(403, { ok: false, error: 'missing bridge header' }); req.resume(); return true; }

  if (isPair) {
    if (req.method !== 'POST') { send(404, { ok: false, error: 'not found' }); return true; }
    readBody(req, MAX_BODY, (err, body) => {
      if (err) return send(err === 'too big' ? 413 : 400, { ok: false, error: err });
      pairer.handlePair({ origin, body }).then((r) => send(r.status, r.body), () => send(500, { ok: false, error: 'pairing failed' }));
    });
    return true;
  }

  const op = url === '/assist/brief' && req.method === 'GET' ? 'brief' : url === '/assist/open' && req.method === 'POST' ? 'open' : null;
  if (!op) { send(404, { ok: false, error: 'not found' }); req.resume(); return true; }

  const token = store.get();
  if (!token) { send(401, { ok: false, error: 'pair first' }); req.resume(); return true; }
  if (!store.isPairedOrigin(origin)) { send(403, { ok: false, error: 'wrong origin' }); req.resume(); return true; }
  const given = req.headers['x-hq-token'];
  if (typeof given !== 'string' || !pairing.sameSecret(given, token)) { send(401, { ok: false, error: 'bad token' }); req.resume(); return true; }

  tool = 'assist.' + op;
  const drain = () => new Promise((r) => { req.on('end', r); req.on('error', r); req.resume(); });
  if (!underCap(op)) { drain().then(() => send(429, { ok: false, error: 'too many requests' })); return true; }

  if (op === 'brief') {
    drain().then(() => briefAnswer()).then((r) => send(r.status, r.body), (e) => send(503, { ok: false, error: msg(e) }));
    return true;
  }
  readBody(req, MAX_BODY, (err, body) => {
    if (err) return send(err === 'too big' ? 413 : 400, { ok: false, error: err });
    openAnswer(body).then((r) => send(r.status, r.body), (e) => send(500, { ok: false, error: msg(e) }));
  });
  return true;
}

async function briefAnswer() {
  const brief = readJson(path.join(deps.dataDir, 'brief.json'));
  if (!isObj(brief)) return { status: 200, body: { ok: true, brief: null, reason: 'no brief yet' } };
  const state = readJson(path.join(deps.dataDir, 'brief-state.json'));
  let lib;
  try { lib = await loadProject(); } catch { return { status: 503, body: { ok: false, error: 'brief projection not available' } }; }
  const fn = lib && (lib.projectBrief || (lib.default && lib.default.projectBrief));
  if (typeof fn !== 'function') return { status: 503, body: { ok: false, error: 'brief projection not available' } };
  const projected = cleanProjection(fn(brief, { now: deps.now(), firstSeen: isObj(state) && isObj(state.firstSeen) ? state.firstSeen : {} }));
  if (!projected) return { status: 503, body: { ok: false, error: 'brief projection unreadable' } };
  return { status: 200, body: { ok: true, brief: projected } };
}

async function openAnswer(body) {
  const ref = isObj(body) ? body.ref : null;
  if (typeof ref !== 'string' || !REF_RE.test(ref)) return { status: 404, body: { ok: false, error: 'unknown ref' } };
  const item = findByRef(readJson(path.join(deps.dataDir, 'brief.json')), ref);
  const target = item && routeOf(item.action);
  if (!target) return { status: 404, body: { ok: false, error: 'unknown ref' } };
  let opened;
  try { opened = deps.openAt(target.route); } catch (e) { return { status: 503, body: { ok: false, error: 'the app window is not available' } }; }
  if (opened === false) return { status: 503, body: { ok: false, error: 'the app window is not available' } };
  return { status: 200, body: { ok: true, ...(target.note ? { note: target.note } : {}) } };
}

// Exactly one record per call; a missing or failing audit module never breaks a route.
function audit(tool, ok, ms) {
  if (!deps) return;
  const dataDir = deps.dataDir;
  // assist-audit.mjs: record(dataDir, fields) → the written entry; names only, never args or text
  const fields = { door: 'browser', tool, tier: TIERS[tool] || 'read', ok, ms, at: deps.now(), pid: process.pid };
  loadAudit().then((lib) => { const fn = lib && (lib.record || (lib.default && lib.default.record)); if (typeof fn === 'function') return fn(dataDir, fields); })
    .catch(() => { /* the audit log is best effort */ });
}

module.exports = {
  setDeps, handleRoute,
  tokenGetter: () => (deps ? store.get() : ''),
  pairing: () => (deps ? store.pairing() : null),
  proofFor: (nonce) => (deps ? store.proof(nonce) : null),
  corsAllowed: (origin, urlPath) => pairing.allowCors(origin, deps ? store.pairing() : null, urlPath),
  cleanProjection, refOf, findByRef, routeOf, MAX_BODY, CAPS,
};
