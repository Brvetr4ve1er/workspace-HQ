// WorkspaceHQ tendril router — localhost ingest for external connectors.
//
// Grew out of the browser bridge (which mirrored the Obsidian sync-hub
// pattern): the app runs a small local endpoint and connectors push into
// per-tendril sidecar files under data/. Each tendril is one row in TENDRILS;
// all of them share the atomic writer, rolling-window prune, size clamps, and
// auth gate below. The browser extension is the first tendril — it keeps its
// legacy POST /ingest route and data/browser-activity.json shape unchanged,
// and the collector folds that file into latest.json (the "Working On Now"
// insight) as before.
//
// Security posture (a personal, localhost-only tool):
//   - binds 127.0.0.1 only — never reachable off-machine.
//   - every request must carry a loopback Host header (see isLocalHost). A DNS
//     rebinding page (attacker.com re-resolving to 127.0.0.1) reaches the bind
//     SAME-ORIGIN — no preflight, custom headers allowed — but it cannot
//     present a loopback Host, so it dies at 403 before any routing.
//   - every ingest route requires the custom `X-HQ-Bridge: 1` header. A
//     malicious web page can't send a custom header without a CORS preflight,
//     and we only approve preflight for extension origins — so pages are
//     blocked while extensions (host-permission, bypassing CORS) get through.
//   - optional: drop a token in data/.bridge-token to also require X-HQ-Token.
//     Residual risk the Host check can't close: any LOCAL process (or any
//     installed extension — until a pairing exists CORS reflects every
//     extension origin) can speak loopback with the right headers; the token
//     is what gates those.
//   - pairing (Bridge 0.7.0): the extension proposes a token, the owner allows it
//     in a native dialog (POST /pair, dashboard/bridge-pair.js), the app writes
//     data/.bridge-token + data/.bridge-pairing.json. The token is read through a
//     getter that follows the file (mtime, at most once a second), so every route
//     requires it at once with no restart; once the pairing file exists CORS
//     reflects only the paired extension origin. GET /health?nonce= answers
//     proof = HMAC-SHA256(token, nonce) so the extension can tell this is the app.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const social = require('./social-bridge');   // SOCIAL BINDING: ingest tendril + outbox routes
const claudeRoutes = require('./claude-bridge-routes');   // Claude Hub H4 live sync: /claude/sync-state, /claude/sync
const assistRoutes = require('./assist-bridge-routes');   // Bridge 0.7.0: POST /pair, GET /assist/brief, POST /assist/open
const pairing = require('./bridge-pair');   // the live token getter, allowCors, the /health proof

const PORT = 47821;
const HOST = '127.0.0.1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 4000;
const BROWSER_WINDOW_DAYS = 3;   // rolling window of browser-activity.json (exported: ORACLE labels its totals with it)
const MAX_BODY = 512 * 1024;

// ---- shared machinery (every tendril goes through these) ----

const clampStr = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Host allowlist — the DNS-rebinding guard (see posture above). Only the three
// loopback spellings, bare or with this server's own port; anything else
// (a foreign name, a missing Host, another port) is rejected before routing.
function isLocalHost(hostHeader, port) {
  const h = String(hostHeader || '').toLowerCase();
  for (const base of ['127.0.0.1', 'localhost', '[::1]']) {
    if (h === base || h === `${base}:${port}`) return true;
  }
  return false;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// tmp + rename so readers (collector, Claude) never see a half-written file.
// Windows quirk: a reader/AV holding the destination makes rename throw EPERM.
// Async + yields between retries: the old Atomics.wait busy-spin froze the whole
// Electron main event loop on every EPERM retry.
async function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, text);
  for (let attempt = 1; ; attempt++) {
    try { await fs.promises.rename(tmp, file); return; }
    catch (e) {
      if (e.code === 'EPERM' && attempt < 3) { await delay(50); continue; }
      throw e;
    }
  }
}

function sanitizeBrowser(e) {
  if (!e || typeof e !== 'object') return null;
  const ts = Number(e.ts);
  const focus_ms = Number(e.focus_ms);
  if (!Number.isFinite(ts) || !e.domain) return null;
  return {
    domain: clampStr(e.domain, 120),
    host: clampStr(e.host || e.domain, 140),
    port: clampStr(String(e.port || ''), 6),
    path: clampStr(e.path || '', 300),
    url: clampStr(e.url || '', 500),
    title: clampStr(e.title || '', 200),
    ts,
    focus_ms: Number.isFinite(focus_ms) ? Math.max(0, Math.round(focus_ms)) : 0,
  };
}

// ---- tendril registry ----
//
// A tendril = one connector feeding one sidecar. Future connectors (NotebookLM
// capture, Watchtower rollups) are one entry here each:
//   name          connector id (logs)
//   route         POST /ingest/<route>
//   legacyRoutes  extra exact paths kept alive for already-deployed clients
//   sidecarPath   sidecar file, relative to dataDir
//   windowDays    rolling window — events older than this are pruned
//   maxEvents     hard cap after pruning (newest kept)
//   dedupe(e)     identity key over a sanitized event; a key already stored
//                 drops the entry (return null to keep everything)
//   sanitize(e)   raw entry -> clamped clean entry, or null to reject
//   onLive?(p)    called with the sanitized `live` payload after each ingest

const TENDRILS = [
  {
    name: 'browser',
    route: 'browser',
    legacyRoutes: ['/ingest'],   // the deployed extension POSTs bare /ingest
    sidecarPath: 'browser-activity.json',
    windowDays: BROWSER_WINDOW_DAYS,
    maxEvents: MAX_EVENTS,
    dedupe: (e) => `${e.ts}|${e.domain}|${e.path}|${e.focus_ms}`,
    sanitize: sanitizeBrowser,
    // onLive comes from startBridge({ onLive }) — main.js owns the ticker.
  },
  social.socialTendril,   // scraped feed/mention/notification/metrics -> data/social/inbox.json
];

function startBridge({ dataDir, onLive, port = PORT } = {}) {
  // The token follows data/.bridge-token (a pairing can create or replace it while the app runs): read per request.
  const tokens = pairing.forDataDir(dataDir);
  const getToken = () => tokens.get();

  // exact path -> runtime; legacy aliases land on the same runtime
  const routes = new Map();
  for (const t of TENDRILS) {
    const rt = {
      tendril: t,
      file: path.join(dataDir, t.sidecarPath),
      onLive: t.name === 'browser' ? onLive : t.onLive,
    };
    routes.set(`/ingest/${t.route}`, rt);
    for (const alias of t.legacyRoutes || []) routes.set(alias, rt);
  }

  async function ingest(rt, payload) {
    const t = rt.tendril;
    const doc = readJsonOr(rt.file, { updated: null, live: null, events: [] });
    if (!Array.isArray(doc.events)) doc.events = [];

    const seen = new Set(t.dedupe ? doc.events.map(t.dedupe) : []);
    const incoming = Array.isArray(payload.events) ? payload.events : [];
    let stored = 0;
    for (const raw of incoming) {
      const e = t.sanitize(raw);
      if (!e) continue;
      const key = t.dedupe ? t.dedupe(e) : null;
      if (key != null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      doc.events.push(e);
      stored++;
    }
    const now = Date.now();
    const windowMs = t.windowDays * DAY_MS;
    doc.events = doc.events.filter((e) => e.ts && now - e.ts < windowMs);
    const max = t.maxEvents || MAX_EVENTS;
    if (doc.events.length > max) doc.events = doc.events.slice(doc.events.length - max);
    doc.live = payload.live ? t.sanitize(payload.live) : null;
    doc.updated = new Date(now).toISOString();

    fs.mkdirSync(path.dirname(rt.file), { recursive: true });
    await writeAtomic(rt.file, JSON.stringify(doc));
    if (typeof rt.onLive === 'function') { try { rt.onLive(doc.live); } catch { /* renderer maybe gone */ } }
    return { ok: true, stored, total: doc.events.length };
  }

  const server = http.createServer((req, res) => {
    // rebinding guard first — before CORS, auth and every route.
    if (!isLocalHost(req.headers.host, port)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad host' }));
      return;
    }
    const origin = req.headers.origin || '';
    const url = (req.url || '/').split('?')[0];
    // before a pairing exists any extension origin may be reflected (it has to be able to propose one);
    // afterwards only the paired origin, plus /pair for a re-pair from another profile.
    const isExt = pairing.allowCors(origin, tokens.pairing(), url);
    if (isExt) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HQ-Bridge, X-HQ-Token');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.method === 'OPTIONS') { res.writeHead(isExt ? 204 : 403); res.end(); return; }

    const token = getToken();
    if (req.method === 'GET' && url === '/health') {
      let nonce = null;
      try { nonce = new URL(req.url, 'http://x').searchParams.get('nonce'); } catch { /* no query */ }
      const proof = nonce ? tokens.proof(nonce) : null;
      return send(200, { ok: true, app: 'workspacehq', bridge: '0.7.0', needsToken: !!token, ...(proof ? { proof } : {}) });
    }

    // SOCIAL BINDING outbox/accounts routes (ingest still flows through /ingest/social
    // below). handleRoute returns true once it has answered the request.
    if (url.startsWith('/social/') && social.handleRoute(req, res, { url, send, token, dataDir })) return;
    if (url.startsWith('/claude/') && claudeRoutes.handleRoute(req, res, { url, send, token })) return;
    // Bridge 0.7.0: /pair and /assist/* (their own token store; main.js hands them {dataDir, dialog, openAt} via setDeps)
    if ((url === '/pair' || url.startsWith('/assist/')) && assistRoutes.handleRoute(req, res, { url, send })) return;

    if (req.method === 'POST' && (routes.has(url) || url.startsWith('/ingest/'))) {
      const rt = routes.get(url);
      if (!rt) return send(404, { ok: false, error: 'unknown tendril' });
      if (req.headers['x-hq-bridge'] !== '1') return send(403, { ok: false, error: 'missing bridge header' });
      if (token && req.headers['x-hq-token'] !== token) return send(401, { ok: false, error: 'bad token' });
      // Accumulate raw Buffer chunks and decode ONCE at end (a per-chunk string
      // concat corrupts multibyte UTF-8 split across a TCP boundary). On
      // overflow drop what's buffered and keep draining — never hold an
      // unbounded body in RAM — and still answer 413 from 'end', never
      // req.destroy() (that wedged the extension's send queue).
      const chunks = []; let size = 0, tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; }   // keep draining, keep nothing
        if (!tooBig) chunks.push(c);
      });
      req.on('end', async () => {
        if (tooBig) return send(413, { ok: false, error: 'too big' });
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
        try { send(200, await ingest(rt, payload)); } catch (e) { send(500, { ok: false, error: String((e && e.message) || e) }); }
      });
      return;
    }
    send(404, { ok: false, error: 'not found' });
  });

  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') console.warn(`[bridge] port ${port} busy — another WorkspaceHQ instance? Bridge disabled.`);
    else console.error('[bridge] server error:', e);
  });
  server.listen(port, HOST, () => console.log(`[bridge] listening on http://${HOST}:${port}${getToken() ? ' (token required)' : ''}`));

  const browserFile = path.join(dataDir, TENDRILS.find((t) => t.name === 'browser').sidecarPath);
  return {
    port,
    stop: () => { try { server.close(); } catch { /* already down */ } },
    readActivity: () => readJsonOr(browserFile, null),
  };
}

module.exports = { startBridge, isLocalHost, BRIDGE_PORT: PORT, BROWSER_WINDOW_DAYS };
