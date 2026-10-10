'use strict';
// COLLECT realm — main-side init (IPC-CONTRACT.md: hq:media:*). Paste a link,
// see the media a direct link or a public page actually exposes, save the
// source file with byte-count + SHA-256 verification.
//
// Program invariant: new main-side features live in NEW files; main.js gets
// one init() hook line (same shape as session-api.js).
//
// Security posture (details in each module):
// - ALL network work is here, never in the renderer: url-safety.js refuses
//   non-http(s), embedded credentials, local hostnames and every private /
//   loopback / link-local / metadata range (v4 + v6), and net.js pins the
//   socket to the validated address so DNS rebinding cannot slip past;
//   every redirect hop is re-validated.
// - The renderer only ever receives verified image bytes as data: URLs
//   (v3 CSP img-src 'self' data:), never a remote URL to load.
// - open-file / show-in-folder accept ids, not paths: only files this module
//   saved (library records, finished jobs) can be opened.
// - No platform bypass exists: Tumblr/Reddit are authorization-required
//   boundaries, Instagram/Facebook unavailable, YouTube/X/TikTok unsupported.
// - Stores live in <userData>/media-collector/ (atomic writes, corrupt-file
//   quarantine) — NOT in data/, so no CONTRACT.md shape changes.
// - Every invoke handler settles: errors cross the boundary as {error}.
//
// Fail closed: the engine's requires (htmlparser2 among them) happen INSIDE
// init(). If anything there throws — e.g. `npm install` was not re-run after
// pulling — WorkspaceHQ still boots; only COLLECT degrades, and its realm
// shows the fix via the single diagnostic channel below.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const str = (v, max = 4096) => String(v == null ? '' : v).slice(0, max);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function init(opts) {
  try { return start(opts); }
  catch (err) {
    const missing = err && err.code === 'MODULE_NOT_FOUND';
    (opts.log || console).error('[media] collector failed to start:', err && err.message);
    const error = { code: 'SOURCE_UNAVAILABLE', message: 'The media collector failed to start.', detail: String(err && err.message || err).split('\n')[0].slice(0, 200), next: missing ? 'Run `npm install` in dashboard/ and restart WorkspaceHQ.' : 'Restart WorkspaceHQ; if it persists, check the main-process log.', extra: null };
    try { opts.ipcMain.handle('hq:media:info', () => ({ error })); } catch {}
    return null;
  }
}

function start({ ipcMain, app, send, getWin, log = console }) {
  const { shell, dialog, clipboard } = require('electron');
  const { createSettings } = require('./settings');
  const { createLibrary } = require('./library');
  const { DownloadManager } = require('./download-manager');
  const { resolve } = require('./resolver');
  const { previewImage } = require('./preview');
  const { list: listSources } = require('./sources');
  const { toPublic, UmcError } = require('./errors');
  const { USER_AGENT } = require('./net');
  let downloads; try { downloads = app.getPath('downloads'); } catch { downloads = path.join(os.homedir(), 'Downloads'); }
  const dir = path.join(app.getPath('userData'), 'media-collector');
  fs.mkdirSync(dir, { recursive: true });
  const settings = createSettings(dir, log, downloads);
  const library = createLibrary(dir, log);
  const dm = new DownloadManager({ settings, library, log });
  dm.on('queue', (q) => send('hq:media:queue', q));
  dm.on('job', (j) => send('hq:media:job', j));

  let resolveAc = null;
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
    try { return await fn(...args); }
    catch (err) { log.warn('[media]', ch, err && err.code ? `${err.code} ${err.detail || ''}` : (err && err.message)); return { error: toPublic(err) }; }
  });
  const scanCtx = () => { const s = settings.get(); return { respectRobots: s.respectRobots, maxPageBytes: s.maxPageBytes, maxCandidates: s.maxCandidates, probeLimit: s.probeLimit, timeoutMs: 15000, probeBudgetMs: 12000 }; };

  h('hq:media:info', () => ({ version: '0.1.0', dataDir: dir, userAgent: USER_AGENT }));
  h('hq:media:resolve', async (url) => {
    if (resolveAc) resolveAc.abort();
    const ac = new AbortController(); resolveAc = ac;
    try { return await resolve(str(url), { ...scanCtx(), signal: ac.signal }); }
    finally { if (resolveAc === ac) resolveAc = null; }
  });
  h('hq:media:resolve-cancel', () => { if (resolveAc) { resolveAc.abort(); resolveAc = null; } return true; });
  h('hq:media:preview', (url) => previewImage(str(url), { timeoutMs: 12000 }));
  h('hq:media:sources', () => listSources());

  // queue — candidates are re-validated here, never trusted from the page
  h('hq:media:queue-add', (cands) => {
    if (!Array.isArray(cands)) throw new UmcError('INVALID_URL', 'bad payload');
    return dm.add(cands.slice(0, 500).map(sanitizeCandidate).filter(Boolean));
  });
  h('hq:media:queue-list', () => dm.list());
  h('hq:media:queue-cancel', (id) => dm.cancel(str(id, 64)));
  h('hq:media:queue-pause', (id) => dm.pause(str(id, 64)));
  h('hq:media:queue-resume', (id) => dm.resume(str(id, 64)));
  h('hq:media:queue-retry', (id) => dm.retry(str(id, 64)));
  h('hq:media:queue-remove', (id) => dm.remove(str(id, 64)));
  h('hq:media:queue-conflict', (id, choice) => dm.resolveConflict(str(id, 64), ['skip', 'rename', 'replace'].includes(choice) ? choice : 'skip'));
  h('hq:media:queue-pause-all', () => { dm.pauseAll(); return true; });
  h('hq:media:queue-resume-all', () => { dm.resumeAll(); return true; });
  h('hq:media:queue-clear', () => { dm.clearFinished(); return true; });

  // library
  h('hq:media:library-list', (o) => { const q = obj(o); return library.list({ q: str(q.q, 200), sort: str(q.sort, 20), dir: q.dir === 'asc' ? 'asc' : 'desc', kind: str(q.kind, 10) || 'all' }); });
  h('hq:media:library-update', (id, patch) => { const p = obj(patch); return library.update(str(id, 64), { note: typeof p.note === 'string' ? p.note : undefined, tags: Array.isArray(p.tags) ? p.tags : undefined }); });
  h('hq:media:library-remove', (id) => library.remove(str(id, 64)));
  h('hq:media:library-restore', (id) => library.restore(str(id, 64)));
  h('hq:media:library-clear', () => { library.clear(); return true; });

  // settings
  h('hq:media:settings-get', () => settings.get());
  h('hq:media:settings-set', (patch) => settings.set(obj(patch)));
  h('hq:media:choose-destination', async () => {
    const win = getWin && getWin();
    const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.get().destination });
    if (r.canceled || !r.filePaths[0]) return null;
    const { errors, value } = settings.set({ destination: r.filePaths[0] });
    if (errors.destination) throw new UmcError('ACCESS_DENIED', errors.destination);
    return value.destination;
  });

  // shell verbs — ids only; paths come from records this module wrote
  const knownPath = (id) => {
    const it = library.get(id); if (it) return it.localPath;
    const j = dm.get(id); if (j && j.status === 'done' && j.finalPath) return j.finalPath;
    return null;
  };
  h('hq:media:open-file', async (id) => { const p = knownPath(str(id, 64)); if (!p || !fs.existsSync(p)) return false; return !(await shell.openPath(p)); });
  h('hq:media:show-in-folder', (id) => { const p = knownPath(str(id, 64)); if (!p || !fs.existsSync(p)) return false; shell.showItemInFolder(p); return true; });
  h('hq:media:open-destination', async () => !(await shell.openPath(settings.ensureDestination())));
  h('hq:media:open-data-dir', async () => !(await shell.openPath(dir)));
  h('hq:media:open-external', async (url) => {
    let u; try { u = new URL(str(url)); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    await shell.openExternal(u.href); return true;
  });
  h('hq:media:clipboard', () => str(clipboard.readText(), 8192));

  return { settings, library, dm };
}

// A candidate from the renderer keeps only the fields the queue needs; the
// URL is re-validated by the network layer anyway.
function sanitizeCandidate(c) {
  if (!c || typeof c !== 'object' || typeof c.sourceUrl !== 'string') return null;
  const s = (v, m = 300) => (typeof v === 'string' ? v.slice(0, m) : '');
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    id: s(c.id, 64), sourceUrl: s(c.sourceUrl, 4096), pageUrl: c.pageUrl ? s(c.pageUrl, 4096) : null, host: s(c.host, 253),
    kind: ['image', 'video', 'audio'].includes(c.kind) ? c.kind : 'unknown', mime: s(c.mime, 100) || null, mimeTrusted: c.mimeTrusted === 'bytes' ? 'bytes' : 'none',
    filenameHint: s(c.filenameHint, 200), extHint: s(c.extHint, 8), width: n(c.width), height: n(c.height), duration: c.duration == null ? null : s(String(c.duration), 32),
    bytes: n(c.bytes), quality: s(c.quality, 40) || 'unknown', via: Array.isArray(c.via) ? c.via.slice(0, 10).map((v) => s(v, 40)) : [],
    attribution: { title: s(c.attribution && c.attribution.title, 200), pageTitle: s(c.attribution && c.attribution.pageTitle, 200), pageHost: s(c.attribution && c.attribution.pageHost, 253) },
    acceptRanges: !!c.acceptRanges, validators: c.validators && typeof c.validators === 'object' ? { etag: s(c.validators.etag, 200) || null, lastModified: s(c.validators.lastModified, 100) || null } : null,
  };
}

module.exports = { init, sanitizeCandidate };
