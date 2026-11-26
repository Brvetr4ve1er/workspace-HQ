// MAPS HQ on the local bridge (CONTRACT "Local bridge routes — the map (/world/*)"). browser-bridge.js has already
// run its loopback Host check before handleRoute sees a request; this module never sets CORS headers, so only a page
// served from this same origin (the map itself) can read an answer.
//
//   setDeps({ dataDir, worldRoot, openAt, now?, log? })   main.js passes them; worldRoot = maps-hq/dist
//   handleRoute(req, res, { url, send }) → boolean (true once it has answered)
//     GET  /world/ and /world/<file>   the built map (static, no data in it; no key needed)
//     GET  /world/state                → 200 {ok, world} | 401 bad key | 429 | 503
//     POST /world/open {target}        → 200 {ok, note?} | 400 | 401 | 403 cross-site | 404 unknown target | 413 | 429 | 503
//   worldUrl() → 'http://127.0.0.1:<port>/world/#k=<key>'   the address the owner opens once and keeps
//
// The key: data/.world-key (64 hex, created once with mode 0600, gitignored). The page reads it from the URL
// fragment (never sent to a server), keeps it in its own storage and sends it as X-HQ-World. A process that can
// read data/ can read every file the map is built from anyway, so the key guards against other web pages, not
// against local code. /world/open only opens the app's own window at a route; it never runs, writes or sends.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { projectWorld, NEVER_RULES, NEVER_SOURCES } = require('./world-project');
const { sameSecret } = require('./bridge-pair');
const assist = require('./assist-bridge-routes');

const PORT = 47821;
const KEY_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[\w.-]{1,80}$/;
const REF_RE = /^[0-9a-f]{12}$/;
const MAX_BODY = 4 * 1024;
const HOUR = 3600e3;
const CAPS = { state: 600, open: 60 };   // per hour; the page polls once a minute
const STATIC_MAX = 16 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
// The map's tiles come from OpenFreeMap unless the owner points it at their own PMTiles file (see maps-hq/README).
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "worker-src 'self' blob:", "child-src 'self' blob:",
  "connect-src 'self' https://tiles.openfreemap.org https://api.protomaps.com https://protomaps.github.io",
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
let deps = null;
let hits = { state: [], open: [] };

function setDeps(d) {
  deps = d && d.dataDir ? { now: Date.now, log: () => {}, ...d } : null;
  hits = { state: [], open: [] };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const keyFile = () => path.join(deps.dataDir, '.world-key');
// Created once; a damaged file is never silently replaced (the owner's saved address would stop working unseen).
function ensureKey() {
  const f = keyFile();
  try {
    const k = fs.readFileSync(f, 'utf8').trim();
    return KEY_RE.test(k) ? k : null;
  } catch (e) {
    if (e.code !== 'ENOENT') return null;
  }
  const k = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(deps.dataDir, { recursive: true });
    fs.writeFileSync(f, k + '\n', { flag: 'wx', mode: 0o600 });
    return k;
  } catch (e) {
    if (e.code === 'EEXIST') { try { const k2 = fs.readFileSync(f, 'utf8').trim(); return KEY_RE.test(k2) ? k2 : null; } catch { return null; } }
    return null;
  }
}

function worldUrl() {
  if (!deps) return null;
  const k = ensureKey();
  return k ? `http://127.0.0.1:${PORT}/world/#k=${k}` : null;
}

function underCap(kind) {
  const t = deps.now();
  hits[kind] = hits[kind].filter((x) => t - x < HOUR);
  if (hits[kind].length >= CAPS[kind]) return false;
  hits[kind].push(t);
  return true;
}

function readBody(req, max, cb) {
  const chunks = []; let size = 0, over = false, done = false;
  const finish = (err, obj) => { if (!done) { done = true; cb(err, obj); } };
  req.on('data', (c) => { size += c.length; if (size > max) { over = true; chunks.length = 0; return; } if (!over) chunks.push(c); });
  req.on('end', () => {
    if (over) return finish('too big');
    try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { finish('bad json'); }
  });
  req.on('error', () => finish('read error'));
}

// A browser always sends Sec-Fetch-Site; a page on another site gets 'cross-site'. The key already stops a blind
// cross-site POST (a custom header forces a preflight this server never answers), this is the second lock.
function crossSite(req) {
  const s = req.headers['sec-fetch-site'];
  if (s && s !== 'same-origin' && s !== 'none') return true;
  const o = req.headers.origin;
  if (!o) return false;
  return !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):47821$/.test(String(o));
}

// ---- static: the built map ---------------------------------------------------------------------------------------
function serveStatic(req, res, url, send) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(404, { ok: false, error: 'not found' }); return; }
  const root = deps.worldRoot;
  if (!root) { send(503, { ok: false, error: 'the map is not built (npm run build in maps-hq)' }); return; }
  let rel;
  try { rel = decodeURIComponent(url.slice('/world'.length)); } catch { send(400, { ok: false, error: 'bad path' }); return; }
  if (rel === '' ) { res.writeHead(301, { Location: '/world/' }); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p.startsWith('.') || p.includes('\\') || p.includes('\0'))) { send(404, { ok: false, error: 'not found' }); return; }
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!TYPES[ext]) { send(404, { ok: false, error: 'not found' }); return; }
  let realRoot, file;
  try {
    realRoot = fs.realpathSync(root);
    file = fs.realpathSync(path.join(realRoot, ...parts));
  } catch { send(404, { ok: false, error: 'not found' }); return; }
  if (file !== realRoot && !file.startsWith(realRoot + path.sep)) { send(404, { ok: false, error: 'not found' }); return; }
  let st;
  try { st = fs.statSync(file); } catch { send(404, { ok: false, error: 'not found' }); return; }
  if (!st.isFile() || st.size > STATIC_MAX) { send(404, { ok: false, error: 'not found' }); return; }
  const headers = {
    'Content-Type': TYPES[ext], 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  };
  if (ext === '.html') { headers['Content-Security-Policy'] = CSP; headers['X-Frame-Options'] = 'DENY'; }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}

// ---- data ----------------------------------------------------------------------------------------------------------
function stateAnswer() {
  const d = deps.dataDir;
  const latest = readJson(path.join(d, 'latest.json'));
  if (!isObj(latest)) return { status: 200, body: { ok: true, world: null, reason: 'no scan yet' } };
  const world = projectWorld({
    latest,
    brief: readJson(path.join(d, 'brief.json')),
    delivery: readJson(path.join(d, 'delivery.json')),
    pins: readJson(path.join(d, 'world', 'pins.json')),
    now: deps.now(),
  });
  return { status: 200, body: { ok: true, world } };
}

// target = {kind:'brief', ref} | {kind:'project', id} | {kind:'quest', id}
//  → { route, note? } | null. Every route is one the app's own nav already takes; nothing is looked up from the body
//    except to find it again in main's own files.
function routeFor(target) {
  if (!isObj(target)) return null;
  if (target.kind === 'brief' && typeof target.ref === 'string' && REF_RE.test(target.ref)) {
    const item = assist.findByRef(readJson(path.join(deps.dataDir, 'brief.json')), target.ref);
    if (!item || NEVER_SOURCES.has(item.source) || NEVER_RULES.has(item.rule) || /^money-/.test(String(item.rule))) return null;
    return assist.routeOf(item.action);
  }
  if ((target.kind === 'project' || target.kind === 'quest') && typeof target.id === 'string' && ID_RE.test(target.id)) {
    const latest = readJson(path.join(deps.dataDir, 'latest.json'));
    if (!isObj(latest)) return null;
    if (target.kind === 'project') {
      const p = (Array.isArray(latest.projects) ? latest.projects : []).find((x) => isObj(x) && x.id === target.id);
      return p ? { route: { tab: 'projects', projectId: p.id } } : null;
    }
    const q = (Array.isArray(latest.quests) ? latest.quests : []).find((x) => isObj(x) && x.id === target.id);
    if (!q) return null;
    return { route: { tab: 'tasks' } };
  }
  return null;
}

function openAnswer(body) {
  const target = routeFor(isObj(body) ? body.target : null);
  if (!target) return { status: 404, body: { ok: false, error: 'not on the map any more' } };
  let opened;
  try { opened = deps.openAt(target.route); } catch { opened = false; }
  if (opened === false) return { status: 503, body: { ok: false, error: 'the app window is not available' } };
  return { status: 200, body: { ok: true, ...(target.note ? { note: target.note } : {}) } };
}

function handleRoute(req, res, { url, send }) {
  if (url !== '/world' && !url.startsWith('/world/')) return false;
  if (!deps) { send(503, { ok: false, error: 'not ready' }); req.resume(); return true; }
  const api = url === '/world/state' || url === '/world/open';
  if (!api) { req.resume(); serveStatic(req, res, url, send); return true; }

  const key = ensureKey();
  const given = req.headers['x-hq-world'];
  if (!key) { send(503, { ok: false, error: 'the map key is unreadable' }); req.resume(); return true; }
  if (typeof given !== 'string' || !sameSecret(given, key)) { send(401, { ok: false, error: 'bad key' }); req.resume(); return true; }

  if (url === '/world/state') {
    if (req.method !== 'GET') { send(404, { ok: false, error: 'not found' }); req.resume(); return true; }
    req.resume();
    if (!underCap('state')) { send(429, { ok: false, error: 'too many requests' }); return true; }
    let r;
    try { r = stateAnswer(); } catch (e) { r = { status: 503, body: { ok: false, error: 'the map data is unreadable' } }; }
    send(r.status, r.body);
    return true;
  }
  if (req.method !== 'POST') { send(404, { ok: false, error: 'not found' }); req.resume(); return true; }
  if (crossSite(req)) { send(403, { ok: false, error: 'cross-site' }); req.resume(); return true; }
  readBody(req, MAX_BODY, (err, body) => {
    if (err) return send(err === 'too big' ? 413 : 400, { ok: false, error: err });
    if (!underCap('open')) return send(429, { ok: false, error: 'too many requests' });
    let r;
    try { r = openAnswer(body); } catch { r = { status: 503, body: { ok: false, error: 'the map data is unreadable' } }; }
    send(r.status, r.body);
  });
  return true;
}

module.exports = { setDeps, handleRoute, worldUrl, ensureKey, routeFor, CSP, CAPS, PORT };
