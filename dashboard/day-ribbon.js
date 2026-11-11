// Today ribbon, main side (spec: docs/audits/2026-11-11-batch3-plan.json, dish "today-ribbon"). Gathers what the app already keeps and
// hands it to the pure model (day-core.mjs, loaded with import() like money.js / cosmos.js: Electron 32 cannot require ESM):
//   Claude    the Hub op activityBuckets (5-minute blocks per project; counts and ids only)
//   PC        logs/app-YYYY-MM-DD.log (suspend / resume / start / alive / quit lines), read once per day opened, 5 MB each, the day and its
//             two neighbours so a sleep across midnight is whole
//   browser   data/browser-activity.json (the rolling 3-day window): ONLY ts and focus_ms leave this reader; no domain, host, url, title
//   commits   a bounded local git log per tracked project (%ct only; never a subject or an author)
//
// create({ dataDir, hub, logsDir, projectsOf, git, now, tzOffsetOf, core }) -> { read(dayOffset), summary(), start(), dispose() }
// init({ ipcMain, ...create options }) registers ONE invoke channel, hq:today:read (arg { dayOffset: integer 0..6 }, refused otherwise)
// and starts the 10-minute summary timer.
//
//   hub        { request(op, args, { timeout }) -> Promise } (the Hub host); null = the Claude lane says the Hub is not running
//   logsDir    the app log folder (default: HQ_APP_LOG_DIR when absolute, else <app root>/logs)
//   projectsOf () -> absolute project folders, from the scan's tracked projects (dashboard/project-paths.js rules); at most 40 are read
//   git        (cwd, args, { timeoutMs }) -> Promise<{ ok:true, stdout } | { error }>; the default runs git with no shell and a 3 s timeout
//   now        () -> Date;   tzOffsetOf  (epochMs) -> minutes east of UTC at that instant (default: the machine's own zone)
//
// Rules: nothing is read when this is created or when init runs (the renderer asks once when Home mounts); a read that finds an older
// Hub answers the lane a note ("update the Hub") instead of failing; data/today.json { v:1, day, generatedAt, counts } is written
// atomically (name.<pid>.tmp then rename) every 10 minutes and whenever today is computed, numbers only, so MCP hq_today has an answer
// while the app runs. Every handler answers a value or { error }, never throws at the renderer.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');

const CHANNEL = 'hq:today:read';
const MAX_REPOS = 40;
const GIT_TIMEOUT_MS = 3000;
const GIT_COMMITS = 200;
const GIT_CONCURRENCY = 4;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const BROWSER_EVENTS_MAX = 50000;
const HUB_TIMEOUT_MS = 8000;
const CACHE_MS = 20 * 1000;
const REFRESH_MS = 10 * 60 * 1000;
const BAD_OFFSET = 'dayOffset must be a whole number from 0 to 6';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e || 'unknown problem').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200);

function defaultGit(cwd, args, { timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 256 * 1024, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (err, stdout) => resolve(err ? { error: 'git failed' } : { ok: true, stdout: String(stdout || '') }));
    } catch { resolve({ error: 'git did not start' }); }
  });
}

function defaultLogsDir(env = process.env) {
  const o = env && typeof env.HQ_APP_LOG_DIR === 'string' ? env.HQ_APP_LOG_DIR.trim() : '';
  return o && path.isAbsolute(o) ? o : path.join(__dirname, '..', 'logs');
}

function create({ dataDir, hub = null, logsDir, projectsOf = null, git = defaultGit, now = () => new Date(), tzOffsetOf = (ms) => -new Date(ms).getTimezoneOffset(),
  core = null, fsMod = fs, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  const logs = logsDir === undefined ? defaultLogsDir() : logsDir;
  const todayFile = path.join(dataDir, 'today.json');
  const cache = new Map();      // dayKey -> { at, value }
  const inflight = new Map();   // dayKey -> Promise
  let corePromise = null, timer = null;
  const getCore = () => (core ? Promise.resolve(core) : (corePromise = corePromise || import(pathToFileURL(path.join(__dirname, 'day-core.mjs')).href)));

  // ---- sources -----------------------------------------------------------------------------------------------------------
  async function readClaude(b) {
    if (!hub || typeof hub.request !== 'function') return { error: 'Claude Hub is not running' };
    try {
      const r = await hub.request('activityBuckets', { fromMs: b.startMs, toMs: b.endMs, bucketMin: 5 }, { timeout: HUB_TIMEOUT_MS });
      if (isObj(r) && Array.isArray(r.buckets)) return r;
      if (isObj(r) && typeof r.error === 'string') return { error: r.error };
      return { error: 'the Hub answered in a shape this version cannot read' };
    } catch (e) { return { error: msg(e) }; }   // an older Hub answers "unknown op": the model turns that into "update the Hub"
  }

  function readLog(key, readerNotes) {
    if (!logs) return null;
    const file = path.join(logs, 'app-' + key + '.log');
    let fd = null;
    try {
      fd = fsMod.openSync(file, 'r');
      const size = fsMod.fstatSync(fd).size;
      const len = Math.min(size, LOG_MAX_BYTES);
      const buf = Buffer.alloc(len);
      let got = 0;
      while (got < len) { const n = fsMod.readSync(fd, buf, got, len - got, got); if (!n) break; got += n; }
      if (size > LOG_MAX_BYTES) readerNotes.push('PC lane: an app log is larger than 5 MB, so only its first 5 MB was read');
      return buf.toString('utf8', 0, got);
    } catch { return null; }   // no file (the app did not run that day) or unreadable: the lane says no log
    finally { if (fd !== null) { try { fsMod.closeSync(fd); } catch { /* closed */ } } }
  }
  function readPower(c, key, readerNotes) {
    const texts = [c.shiftDayKey(key, -1), key, c.shiftDayKey(key, 1)].map((k) => readLog(k, readerNotes)).filter((t) => t !== null);
    if (!texts.length) return null;
    return texts.flatMap((t) => c.parsePowerLines(t)).sort((a, b) => a.t - b.t);
  }

  function readBrowser() {
    let raw;
    try { raw = fsMod.readFileSync(path.join(dataDir, 'browser-activity.json'), 'utf8'); } catch { return null; }
    let doc; try { doc = JSON.parse(raw); } catch { return { unreadable: true }; }
    if (!isObj(doc) || !Array.isArray(doc.events)) return { unreadable: true };
    const out = [];
    for (const e of doc.events) {   // only these two numbers survive this function
      if (!isObj(e)) continue;
      const ts = Number(e.ts), focus_ms = Number(e.focus_ms);
      if (Number.isFinite(ts) && Number.isFinite(focus_ms) && focus_ms > 0) out.push({ ts, focus_ms });
      if (out.length >= BROWSER_EVENTS_MAX) break;
    }
    return out;
  }

  async function readCommits(b, limitMs) {
    let paths = null;
    try { paths = typeof projectsOf === 'function' ? projectsOf() : null; } catch { paths = null; }
    if (!Array.isArray(paths)) return null;
    const seen = new Set(), repos = [];
    for (const p of paths) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue;   // tracked project paths only, never a guess
      const abs = path.resolve(p), k = abs.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      repos.push(abs);
      if (repos.length >= MAX_REPOS) break;
    }
    if (!repos.length) return null;
    const args = ['log', '--since=' + new Date(b.startMs).toISOString(), '--until=' + new Date(Math.min(b.endMs, limitMs)).toISOString(), '--format=%ct', '--no-merges', '-n', String(GIT_COMMITS)];
    const times = [];
    let capped = false, failed = 0, next = 0;
    async function worker() {
      while (next < repos.length) {
        const cwd = repos[next++];
        let r;
        try { r = await git(cwd, args, { timeoutMs: GIT_TIMEOUT_MS }); } catch { r = { error: 'git failed' }; }
        if (!isObj(r) || !r.ok || typeof r.stdout !== 'string') { failed++; continue; }
        const lines = r.stdout.split('\n').map((s) => s.trim()).filter((s) => /^\d{9,11}$/.test(s));
        if (lines.length >= GIT_COMMITS) capped = true;
        for (const s of lines) times.push(Number(s) * 1000);
      }
    }
    await Promise.all(Array.from({ length: Math.min(GIT_CONCURRENCY, repos.length) }, worker));
    return { times, capped, failed, repos: repos.length };
  }

  // ---- the day -----------------------------------------------------------------------------------------------------------
  function dayKeyFor(c, dayOffset, nowMs) {
    const todayKey = c.localDayKey(nowMs, tzOffsetOf(nowMs));
    const key = c.shiftDayKey(todayKey, -dayOffset);
    const noonUtc = Date.parse(key + 'T12:00:00Z');
    return { key, tz: tzOffsetOf(noonUtc) };   // the zone in force around that day's noon (a day is read as 24 h)
  }

  function writeToday(c, v) {
    try {
      fsMod.mkdirSync(dataDir, { recursive: true });
      const tmp = todayFile + '.' + process.pid + '.tmp';
      fsMod.writeFileSync(tmp, JSON.stringify({ v: 1, day: v.day, generatedAt: v.generatedAt, counts: c.cleanCounts(v.counts) }, null, 1));
      fsMod.renameSync(tmp, todayFile);
      return true;
    } catch { return false; }   // the ribbon still works; MCP just keeps the older file
  }

  async function compute(c, dayOffset, key, tz) {
    const nowD = now(), nowMs = nowD.getTime();
    const b = c.dayBounds(key, tz);
    const limitMs = Math.min(b.endMs, nowMs);
    const readerNotes = [];
    const [claudeBuckets, commitTimes] = await Promise.all([readClaude(b), readCommits(b, limitMs)]);
    const model = c.buildDay({ dayKey: key, tzOffsetMin: tz, claudeBuckets, powerEvents: readPower(c, key, readerNotes), browserEvents: readBrowser(), commitTimes, now: nowD });
    if (model.error) return { error: model.error };
    const value = { ok: true, dayOffset, generatedAt: nowD.toISOString(), ...model, notes: [...model.notes, ...readerNotes] };
    if (dayOffset === 0) writeToday(c, value);
    return value;
  }

  async function read(dayOffset, { fresh = false } = {}) {
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 6) return { error: BAD_OFFSET };
    try {
      const c = await getCore();
      const nowMs = now().getTime();
      const { key, tz } = dayKeyFor(c, dayOffset, nowMs);
      const hit = cache.get(key);
      if (!fresh && hit && nowMs - hit.at < CACHE_MS) return { ...hit.value, dayOffset };
      if (!fresh && inflight.has(key)) return inflight.get(key).then((v) => (v.ok ? { ...v, dayOffset } : v));
      const p = compute(c, dayOffset, key, tz).then((v) => { if (v.ok) cache.set(key, { at: nowMs, value: v }); return v; }, (e) => ({ error: 'the day could not be built: ' + msg(e) }))
        .finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
      inflight.set(key, p);
      return await p;
    } catch (e) { return { error: 'the day could not be built: ' + msg(e) }; }
  }

  /** Today's counts, computed now and written to data/today.json: { day, generatedAt, counts } | { error } */
  async function summary() {
    const v = await read(0, { fresh: true });
    if (!v.ok) return { error: v.error };
    const c = await getCore();
    return { day: v.day, generatedAt: v.generatedAt, counts: c.cleanCounts(v.counts) };
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => { summary().catch(() => {}); }, REFRESH_MS);   // the first run is one interval after start: nothing is read at boot
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function dispose() { if (timer) { clearIntervalFn(timer); timer = null; } }

  return { read, summary, start, dispose };
}

function init({ ipcMain, ...opts } = {}) {
  const ribbon = create(opts);
  if (ipcMain && typeof ipcMain.handle === 'function') {
    ipcMain.handle(CHANNEL, async (_e, a) => {
      if (!isObj(a) || !Number.isInteger(a.dayOffset)) return { error: BAD_OFFSET };
      return ribbon.read(a.dayOffset);
    });
  }
  ribbon.start();
  return ribbon;
}

module.exports = { create, init, defaultGit, CHANNEL, MAX_REPOS, GIT_TIMEOUT_MS, GIT_COMMITS, CACHE_MS, REFRESH_MS, LOG_MAX_BYTES };
