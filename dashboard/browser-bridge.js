// WorkspaceHQ browser bridge — localhost ingest for the Chrome extension.
//
// Mirrors the Obsidian sync-hub pattern: the app runs a small local endpoint,
// the "WorkspaceHQ Bridge" extension pushes active-tab focus to it, and we
// persist it to data/browser-activity.json. The collector folds that file into
// latest.json (the "Working On Now" insight) and Claude can read it directly.
//
// Security posture (a personal, localhost-only tool):
//   - binds 127.0.0.1 only — never reachable off-machine.
//   - POST /ingest requires the custom `X-HQ-Bridge: 1` header. A malicious web
//     page can't send a custom header without a CORS preflight, and we only
//     approve preflight for extension origins — so pages are blocked while the
//     extension (which has host-permission, bypassing CORS) gets through.
//   - optional: drop a token in data/.bridge-token to also require X-HQ-Token.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 47821;
const HOST = '127.0.0.1';
const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;   // keep 3 days of visits
const MAX_EVENTS = 4000;
const MAX_BODY = 512 * 1024;

const clampStr = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
function sanitize(e) {
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

function startBridge({ dataDir, onLive } = {}) {
  const ACTIVITY = path.join(dataDir, 'browser-activity.json');
  const TOKEN_FILE = path.join(dataDir, '.bridge-token');
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* token optional */ }

  function ingest(payload) {
    let doc = { updated: null, live: null, events: [] };
    try { doc = JSON.parse(fs.readFileSync(ACTIVITY, 'utf8')); } catch { /* fresh file */ }
    if (!Array.isArray(doc.events)) doc.events = [];

    const incoming = Array.isArray(payload.events) ? payload.events : [];
    let stored = 0;
    for (const raw of incoming) {
      const e = sanitize(raw);
      if (e && e.focus_ms >= 0) { doc.events.push(e); stored++; }
    }
    const now = Date.now();
    doc.events = doc.events.filter((e) => e.ts && now - e.ts < WINDOW_MS);
    if (doc.events.length > MAX_EVENTS) doc.events = doc.events.slice(doc.events.length - MAX_EVENTS);
    doc.live = payload.live ? sanitize(payload.live) : null;
    doc.updated = new Date(now).toISOString();

    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(ACTIVITY, JSON.stringify(doc));
    if (typeof onLive === 'function') { try { onLive(doc.live); } catch { /* renderer maybe gone */ } }
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

    if (req.method === 'POST' && url === '/ingest') {
      if (req.headers['x-hq-bridge'] !== '1') return send(403, { ok: false, error: 'missing bridge header' });
      if (token && req.headers['x-hq-token'] !== token) return send(401, { ok: false, error: 'bad token' });
      let body = '', tooBig = false;
      req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { tooBig = true; req.destroy(); } });
      req.on('end', () => {
        if (tooBig) return send(413, { ok: false, error: 'too big' });
        let payload; try { payload = JSON.parse(body || '{}'); } catch { return send(400, { ok: false, error: 'bad json' }); }
        try { send(200, ingest(payload)); } catch (e) { send(500, { ok: false, error: String((e && e.message) || e) }); }
      });
      return;
    }
    send(404, { ok: false, error: 'not found' });
  });

  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') console.warn(`[bridge] port ${PORT} busy — another WorkspaceHQ instance? Bridge disabled.`);
    else console.error('[bridge] server error:', e);
  });
  server.listen(PORT, HOST, () => console.log(`[bridge] listening on http://${HOST}:${PORT}${token ? ' (token required)' : ''}`));

  return {
    port: PORT,
    stop: () => { try { server.close(); } catch { /* already down */ } },
    readActivity: () => { try { return JSON.parse(fs.readFileSync(ACTIVITY, 'utf8')); } catch { return null; } },
  };
}

module.exports = { startBridge, BRIDGE_PORT: PORT };
