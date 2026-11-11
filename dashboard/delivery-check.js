// Client delivery check, main side (spec: batch-2-rest plan, dish "delivery-check"; CONTRACT "Client delivery check").
// "Phone size and Arabic / French / English, against the dev server on this PC": a hidden, sandboxed BrowserWindow loads the
// confirmed 127.0.0.1 address at 390x844 (3x), a probe measures it in an isolated world, the pure engine turns the numbers
// into findings (delivery-check-core.mjs), and one report plus a phone-size screenshot per page is kept under data/delivery/.
// Only a dev server on this PC can be checked: deployed-site checks are not built (owner-gated).
//
// Network defence, in three layers (all counted, none absolute):
//   (a) session.webRequest.onBeforeRequest cancels every request that is not http/ws to a loopback host and counts it by host;
//   (b) session.setProxy points everything else at a black-hole proxy (127.0.0.1:9) with only loopback bypassed, and
//       setWebRTCIPHandlingPolicy('disable_non_proxied_udp') leaves a STUN attempt no UDP route, so what the hook cannot see has no route;
//   (c) every permission is denied, window.open is denied, will-navigate and will-redirect are pinned to the confirmed origin.
// The report says "N outside requests blocked", never "nothing left your PC".
//
// create({ dataDir, resolveProjectPath, devServers, latest, makeWindow, probeUrl, now, fsMod, limits, settleMs, proxyPort })
//   → { detect(projectId), run(projectId, url), read(projectId), forget(projectId) }   (every one resolves a value or { error })
// init({ ipcMain, dataDir, resolveProjectPath, devServers, latest }) → hq:delivery-check:detect|run|read|forget
// Seams for the tests and the native check: makeWindow() → a BrowserWindow-like (webContents, webContents.session, destroy),
// probeUrl(origin, ms) → { ok, title } | null, latest() → the scan, devServers → Map of app-started servers (decides only the
// "started here" note: detect probes whether or not the id is in it).
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

let core = null;
const lib = () => core || (core = import(pathToFileURL(path.join(__dirname, 'delivery-check-core.mjs')).href));
const msg = (e) => String((e && e.message) || e).slice(0, 200);
const PARTITION = 'hq-delivery-check';          // no "persist:" prefix: an in-memory session, gone with the window
const WORLD_ID = 1999;                          // an isolated-world id the page cannot reach
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idHash = (projectId) => crypto.createHash('sha1').update(String(projectId)).digest('hex').slice(0, 16);

// The default window: hidden, in-memory partition, sandboxed, no preload, no Node in the page.
function defaultMakeWindow() {
  const { BrowserWindow } = require('electron');
  return new BrowserWindow({
    show: false, width: 390, height: 844, useContentSize: true, paintWhenInitiallyHidden: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false },
  });
}

// One GET to the loopback address, never more than 64 KB of the body, only to read the <title>. Refuses anything that is not a
// loopback origin by itself (a second gate behind the core's), so a bad seam value can never reach the network.
function defaultProbeUrl(origin, ms) {
  return new Promise((resolve) => {
    let u; try { u = new URL(origin); } catch { return resolve(null); }
    if (u.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ host: u.hostname === '[::1]' ? '::1' : u.hostname, port: u.port || 80, path: '/', timeout: ms, headers: { accept: 'text/html', 'user-agent': 'WorkspaceHQ-delivery-check' } }, (res) => {
      let body = '', size = 0;
      res.setEncoding('utf8');
      res.on('data', (c) => { size += c.length; if (body.length < 65536) body += c; if (size > 65536) res.destroy(); });
      const end = () => { const t = body.match(/<title[^>]*>([^<]{0,200})/i); finish({ ok: true, title: t ? t[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '' }); };
      res.on('end', end); res.on('close', end); res.on('error', end);
    });
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
    setTimeout(() => { try { req.destroy(); } catch { /* gone */ } finish(null); }, ms + 500);
  });
}

function create({ dataDir, resolveProjectPath, devServers = new Map(), latest, makeWindow = defaultMakeWindow, probeUrl = defaultProbeUrl, now = () => new Date(), fsMod = fs, limits = {}, settleMs = 500, proxyPort = 9 } = {}) {
  const root = path.join(dataDir, 'delivery');
  const checksDir = path.join(root, 'checks'), shotsDir = path.join(root, 'shots');
  let running = false;

  const scan = () => {
    try { if (typeof latest === 'function') return latest() || null; } catch { /* fall through */ }
    try { return JSON.parse(fsMod.readFileSync(path.join(dataDir, 'latest.json'), 'utf8')); } catch { return null; }
  };
  const projectOf = (projectId) => {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return null;
    const s = scan();
    return s && Array.isArray(s.projects) ? s.projects.find((p) => p && p.id === projectId) || null : null;
  };
  const reportFile = (projectId) => path.join(checksDir, idHash(projectId) + '.json');
  // shots are named <16 hex>-<n>.png: a project's own are found by that prefix, and only names of that shape are ever deleted
  const SHOT_RE = /^[0-9a-f]{16}-\d{1,2}\.png$/;
  const listShots = () => { try { return fsMod.readdirSync(shotsDir).filter((n) => SHOT_RE.test(n)); } catch { return []; } };
  const removeShots = (prefix) => { for (const n of listShots()) if (!prefix || n.startsWith(prefix)) { try { fsMod.unlinkSync(path.join(shotsDir, n)); } catch { /* gone */ } } };
  const capShots = (L, max) => {
    const files = listShots().map((n) => { let t = 0; try { t = fsMod.statSync(path.join(shotsDir, n)).mtimeMs; } catch { /* keep 0 */ } return { n, t }; }).sort((a, b) => a.t - b.t || (a.n < b.n ? -1 : 1));
    while (files.length > max) { const f = files.shift(); try { fsMod.unlinkSync(path.join(shotsDir, f.n)); } catch { /* gone */ } }
  };
  const writeAtomic = (file, text) => { fsMod.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + process.pid + '.tmp'; fsMod.writeFileSync(tmp, text); fsMod.renameSync(tmp, file); };

  // ---- detect -------------------------------------------------------------------------------------------------------------
  async function detect(projectId) {
    const L = await lib();
    try {
      const project = projectOf(projectId);
      if (!project) return { error: 'that project is not in the current scan.' };
      const devCmd = typeof project.dev_cmd === 'string' && project.dev_cmd.trim() ? project.dev_cmd : '';
      const startedHere = devServers && typeof devServers.has === 'function' ? devServers.has(projectId) : false;
      const probeMs = limits.PROBE_MS || L.LIMITS.PROBE_MS;
      // regardless of devServers: a server started in the owner's own terminal answers the same way
      // each port is asked on 127.0.0.1 and on [::1]: a server may listen on either family only
      for (const base of L.candidateUrls({ devCmd })) {
        for (const origin of [base, L.loopbackTwin(base)]) {
          if (!origin) continue;
          let r = null;
          try { r = await probeUrl(origin, probeMs); } catch { r = null; }
          if (r && r.ok) return { state: 'ready', startedHere, candidates: [{ origin, title: String(r.title || '').slice(0, L.LIMITS.MAX_STR) }], hasCommand: !!devCmd };
        }
      }
      return { state: 'nothing-answering', startedHere, candidates: [], hasCommand: !!devCmd };
    } catch (e) { return { error: 'could not look for the dev server — ' + msg(e) }; }
  }

  // ---- run ----------------------------------------------------------------------------------------------------------------
  async function run(projectId, url) {
    const L = await lib();
    const { PROBE_SOURCE } = require('./delivery-check-probe.js');
    const LIM = Object.assign({}, L.LIMITS, limits);
    let origin = L.loopbackOrigin(url);         // the renderer's value is never trusted: checked again here
    if (!origin) return { error: L.OFF_ORIGIN_TEXT + '.' };
    // a typed "localhost" became 127.0.0.1: when only [::1] answers on that port, use [::1] (nothing answering keeps 127.0.0.1)
    let typedHost = ''; try { typedHost = new URL(String(url).trim()).hostname; } catch { typedHost = ''; }
    if (typedHost === 'localhost') {
      const twin = L.loopbackTwin(origin), ms = limits.PROBE_MS || L.LIMITS.PROBE_MS;
      let a = null, b = null;
      try { a = await probeUrl(origin, ms); } catch { a = null; }
      if (!(a && a.ok) && twin) { try { b = await probeUrl(twin, ms); } catch { b = null; } }
      if (b && b.ok) origin = twin;
    }
    const project = projectOf(projectId);
    if (!project) return { error: 'that project is not in the current scan.' };
    if (running) return { error: 'a check is already running.' };
    running = true;

    const started = Date.now(), deadline = started + LIM.RUN_MS;
    const blockedHosts = new Map();
    let blockedCount = 0, requestsSeen = 0, requestsCut = false, win = null;
    const hash = idHash(projectId);
    const remaining = () => Math.max(1, deadline - Date.now());
    // every await in the run is raced against the one 45 s budget
    const within = (p) => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('time budget used'), { budget: true })), remaining());
      Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });

    try {
      win = makeWindow();
      const wc = win.webContents, ses = wc.session;
      // layer (b) before anything loads: no route for what the hook cannot see
      await within(ses.setProxy({ mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:' + proxyPort, proxyBypassRules: '127.0.0.1,localhost,[::1]' }));
      if (typeof wc.setWebRTCIPHandlingPolicy === 'function') wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      // layer (a)
      ses.webRequest.onBeforeRequest((details, callback) => {
        const verdict = L.blockDecision(details && details.url);
        if (!verdict.allow) { blockedCount++; blockedHosts.set(verdict.host, (blockedHosts.get(verdict.host) || 0) + 1); return callback({ cancel: true }); }
        if (verdict.host) {
          requestsSeen++;
          if (requestsSeen > LIM.MAX_REQUESTS) { requestsCut = true; return callback({ cancel: true }); }
        }
        return callback({});
      });
      // layer (c)
      if (typeof ses.setPermissionRequestHandler === 'function') ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
      if (typeof ses.setPermissionCheckHandler === 'function') ses.setPermissionCheckHandler(() => false);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      const pinned = (ev, target) => { let ok = false; try { ok = new URL(target).origin === origin; } catch { ok = false; } if (!ok && ev && typeof ev.preventDefault === 'function') ev.preventDefault(); };
      wc.on('will-navigate', pinned);
      wc.on('will-redirect', pinned);
      // Electron 32 crashes the whole process when device emulation is switched on for a window that has not loaded anything yet
      // (found by the native check), so an empty page goes first. about:blank asks the network for nothing.
      if (typeof wc.enableDeviceEmulation === 'function') {
        await within(wc.loadURL('about:blank'));
        const P = L.LIMITS.PHONE;
        wc.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: P.width, height: P.height }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: P.scale, viewSize: { width: P.width, height: P.height }, scale: 1 });
      }

      fsMod.mkdirSync(shotsDir, { recursive: true });
      removeShots(hash);                         // this project's earlier shots go first, so the report and the folder agree

      const visit = async (routePath, locale, isEntry, index) => {
        const rec = { path: routePath, locale, isEntry, snap: null, loadError: null, shot: null };
        try {
          await within(wc.loadURL(origin + routePath));
          if (settleMs) await within(sleep(settleMs));
          const raw = await within(wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: '(' + PROBE_SOURCE + ')()' }]));
          rec.snap = L.sanitizeSnapshot(raw);
          if (!rec.snap) rec.loadError = 'the page could not be measured';
          if (rec.snap && typeof wc.capturePage === 'function') {
            try {
              const img = await within(wc.capturePage());
              if (img && !(typeof img.isEmpty === 'function' && img.isEmpty())) {
                const name = hash + '-' + index + '.png';
                fsMod.writeFileSync(path.join(shotsDir, name), img.toPNG());
                rec.shot = name;
              }
            } catch (e) { if (e && e.budget) throw e; /* no screenshot is not a failed check */ }
          }
        } catch (e) {
          if (e && e.budget) throw e;
          rec.loadError = msg(e);
        }
        return rec;
      };

      const routes = [];
      const truncated = { routes: false, requests: false, time: false };
      const entry = await visit('/', null, true, 0);
      if (entry.loadError && !entry.snap) {
        return { error: 'the page at ' + origin + ' did not load — ' + entry.loadError };
      }
      entry.locale = entry.snap ? String(entry.snap.lang || '').toLowerCase().split(/[-_]/)[0] || null : null;
      routes.push(entry);
      const found = entry.snap ? L.discoverLocales(entry.snap) : { routes: [], switch: 'none' };
      const wanted = found.routes.filter((r) => r.path !== '/').slice(0, LIM.MAX_ROUTES);
      truncated.routes = found.routes.length > LIM.MAX_ROUTES;
      try {
        for (let i = 0; i < wanted.length; i++) routes.push(await visit(wanted[i].path, wanted[i].locale, false, i + 1));
      } catch (e) { if (e && e.budget) truncated.time = true; else throw e; }
      truncated.requests = requestsCut;

      const report = L.buildReport({
        origin: origin.replace(/^http:\/\//, ''), at: now(), routes, switch: found.switch,
        blocked: { count: blockedCount, hosts: L.topHosts(blockedHosts) }, requestsSeen, truncated,
        notes: routes.some((r) => r.snap && !r.shot) ? ['Some pages have no screenshot'] : [],
      });
      report.shots = routes.map((r) => r.shot).filter(Boolean);
      try { capShots(L, LIM.MAX_SHOTS); } catch { /* best effort */ }
      try { writeAtomic(reportFile(projectId), JSON.stringify(report, null, 1)); }
      catch (e) { return { error: 'checked, but the report was not saved — ' + msg(e) }; }
      return report;
    } catch (e) {
      if (e && e.budget) return { error: 'the check ran past its ' + Math.round(LIM.RUN_MS / 1000) + ' s limit and was stopped.' };
      return { error: 'the check did not finish — ' + msg(e) };
    } finally {
      running = false;
      try { if (win && !(typeof win.isDestroyed === 'function' && win.isDestroyed())) win.destroy(); } catch { /* already gone */ }
    }
  }

  // ---- read / forget -------------------------------------------------------------------------------------------------------
  async function read(projectId) {
    const L = await lib();
    try {
      if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return null;
      let raw; try { raw = fsMod.readFileSync(reportFile(projectId), 'utf8'); } catch { return null; }
      let v; try { v = JSON.parse(raw); } catch { return null; }
      return L.validateReport(v);
    } catch { return null; }
  }
  async function forget(projectId) {
    try {
      if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return { error: 'unknown project.' };
      try { fsMod.unlinkSync(reportFile(projectId)); } catch { /* none kept */ }
      removeShots(idHash(projectId));
      return { ok: true };
    } catch (e) { return { error: 'could not forget the results — ' + msg(e) }; }
  }

  return { detect, run, read, forget, shotPath: (name) => (SHOT_RE.test(String(name)) ? path.join(shotsDir, name) : null) };
}

function init({ ipcMain, dataDir, resolveProjectPath, devServers, latest }) {
  const c = create({ dataDir, resolveProjectPath, devServers, latest });
  ipcMain.handle('hq:delivery-check:detect', (_e, projectId) => c.detect(projectId));
  ipcMain.handle('hq:delivery-check:run', (_e, projectId, url) => c.run(projectId, url));
  ipcMain.handle('hq:delivery-check:read', (_e, projectId) => c.read(projectId));
  ipcMain.handle('hq:delivery-check:forget', (_e, projectId) => c.forget(projectId));
  return c;
}

module.exports = { create, init, idHash, PARTITION };
