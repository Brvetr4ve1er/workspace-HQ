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
//   - every ingest route requires the custom `X-HQ-Bridge: 1` header. A
//     malicious web page can't send a custom header without a CORS preflight,
//     and we only approve preflight for extension origins — so pages are
//     blocked while extensions (host-permission, bypassing CORS) get through.
//   - optional: drop a token in data/.bridge-token to also require X-HQ-Token.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 47821;
const HOST = '127.0.0.1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 4000;
const MAX_BODY = 512 * 1024;

// ---- shared machinery (every tendril goes through these) ----

const clampStr = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// tmp + rename so readers (collector, Claude) never see a half-written file.
// Windows quirk: a reader/AV holding the destination makes rename throw EPERM.
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (e.code !== 'EPERM' || attempt >= 3) throw e;
      sleepSync(50);
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
    windowDays: 3,
    maxEvents: MAX_EVENTS,
    dedupe: (e) => `${e.ts}|${e.domain}|${e.path}|${e.focus_ms}`,
    sanitize: sanitizeBrowser,
    // onLive comes from startBridge({ onLive }) — main.js owns the ticker.
  },
];

function startBridge({ dataDir, onLive, port = PORT } = {}) {
  const TOKEN_FILE = path.join(dataDir, '.bridge-token');
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* token optional */ }

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

  function ingest(rt, payload) {
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
    writeAtomic(rt.file, JSON.stringify(doc));
    if (typeof rt.onLive === 'function') { try { rt.onLive(doc.live); } catch { /* renderer maybe gone */ } }
    return { ok: true, stored, total: doc.events.length };
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    const isExt = origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
    if (isExt) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HQ-Bridge, X-HQ-Token');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (req.method === 'OPTIONS') { res.writeHead(isExt ? 204 : 403); res.end(); return; }

    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && url === '/health') {
      return send(200, { ok: true, app: 'workspacehq', bridge: '0.1.0', needsToken: !!token });
    }

    if (req.method === 'POST' && (routes.has(url) || url.startsWith('/ingest/'))) {
      const rt = routes.get(url);
      if (!rt) return send(404, { ok: false, error: 'unknown tendril' });
      if (req.headers['x-hq-bridge'] !== '1') return send(403, { ok: false, error: 'missing bridge header' });
      if (token && req.headers['x-hq-token'] !== token) return send(401, { ok: false, error: 'bad token' });
      let body = '', tooBig = false;
      req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } });
      req.on('end', () => {
        if (tooBig) return send(413, { ok: false, error: 'too big' });
        let payload; try { payload = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
        try { send(200, ingest(rt, payload)); } catch (e) { send(500, { ok: false, error: String((e && e.message) || e) }); }
      });
      return;
    }
    send(404, { ok: false, error: 'not found' });
  });

  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') console.warn(`[bridge] port ${port} busy — another WorkspaceHQ instance? Bridge disabled.`);
    else console.error('[bridge] server error:', e);
  });
  server.listen(port, HOST, () => console.log(`[bridge] listening on http://${HOST}:${port}${token ? ' (token required)' : ''}`));

  const browserFile = path.join(dataDir, TENDRILS.find((t) => t.name === 'browser').sidecarPath);
  return {
    port,
    stop: () => { try { server.close(); } catch { /* already down */ } },
    readActivity: () => readJsonOr(browserFile, null),
  };
}

module.exports = { startBridge, BRIDGE_PORT: PORT };
