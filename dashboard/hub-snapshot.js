// dashboard/hub-snapshot.js
// Main side of the daily chat-index snapshot (batch 6, "protect the memory"). Off the boot path: the first check is 5
// minutes after start, then every 30 minutes. It asks the Claude Hub (a separate system-Node process) to write ONE
// verified copy of hub.sqlite per calendar day into a folder OUTSIDE the repo, keeps the last 7, and writes one day-log
// line. A failure is a day-log line and nothing else: never a Brief row, a toast or a throw.
//
//   init({ hub, appLog, repoRoot, env, now, ... }) -> { tick, stop, dir }
//
// Loaded like the other engines: the pure rules (refuseDestination, planRetention) come from claude-hub/snapshot.mjs
// with import() (Electron 32 cannot require ESM; that module loads node:sqlite lazily, so it loads fine here).
// The Hub does the copy (hub op `snapshot`, VACUUM INTO); this file never opens the database.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WARMUP_MS = 5 * 60 * 1000;        // never in the first 5 minutes after start
const CHECK_MS = 30 * 60 * 1000;        // checked every 30 minutes
const KEEP = 7;
const SNAPSHOT_TIMEOUT_MS = 120 * 1000; // a timeout is just a failed snapshot
const HEALTH_TIMEOUT_MS = 5000;
const MAX_FAILURES_PER_DAY = 3;         // a broken day writes at most three lines, not one per check

const p2 = (n) => String(n).padStart(2, '0');
// the calendar day in the owner's local time
const dayOf = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const fileFor = (day) => 'hub-' + day + '.sqlite';

function defaultDir(env, home) {
  if (env && env.HQ_HUB_SNAPSHOT_DIR) return path.resolve(String(env.HQ_HUB_SNAPSHOT_DIR));
  const local = (env && env.LOCALAPPDATA) || path.join(home, 'AppData', 'Local');
  return path.join(local, 'WorkspaceHQ', 'hub-snapshots');
}

// the log carries a short code, never the Hub's error text (it can hold a path)
function reasonCode(err) {
  const s = String(err || '');
  if (s === 'timeout') return 'timeout';
  if (s === 'hub not running' || s === 'hub stopped') return 'hub-down';
  if (/refused/i.test(s)) return 'refused';
  if (/did not verify/i.test(s)) return 'verify-failed';
  if (/ENOSPC|disk full/i.test(s)) return 'disk-full';
  return 'hub-error';
}

function init({
  hub, appLog, repoRoot, env = process.env, now = Date.now, homedir = os.homedir(),
  fsImpl = fs, lib = null, schedule = true, timers = { setTimeout, setInterval, clearTimeout, clearInterval },
} = {}) {
  const startedAt = now();
  const dir = defaultDir(env, homedir);
  const log = (fields) => { try { appLog && typeof appLog.event === 'function' && appLog.event('hub-snapshot', fields); } catch { /* the log never breaks the app */ } };
  let libP = null;
  const getLib = () => (lib ? Promise.resolve(lib) : (libP = libP || import(pathToFileURL(path.join(__dirname, 'claude-hub', 'snapshot.mjs')).href)));
  let busy = false, stopped = false, failDay = null, failures = 0, warm = null, every = null;

  async function tick() {
    if (busy || stopped) return { skipped: 'busy' };
    busy = true;
    try {
      const t = now();
      if (t - startedAt < WARMUP_MS) return { skipped: 'warm-up' };
      if (!hub || typeof hub.request !== 'function') return { skipped: 'no-hub' };
      const day = dayOf(t), name = fileFor(day), dest = path.join(dir, name);
      if (fsImpl.existsSync(dest)) return { skipped: 'done-today' };
      if (failDay !== day) { failDay = day; failures = 0; }
      if (failures >= MAX_FAILURES_PER_DAY) return { skipped: 'gave-up-today' };

      // only when the Hub is idle: a snapshot is one synchronous copy inside the Hub process, other ops wait for it
      let h;
      try { h = await hub.request('health', {}, { timeout: HEALTH_TIMEOUT_MS }); } catch { h = null; }
      if (!h || h.error || h.state !== 'ready') return { skipped: 'hub-not-ready' };
      const bf = h.backfill;
      if (bf && Number(bf.total) > 0 && Number(bf.done) < Number(bf.total)) return { skipped: 'backfill' };

      const fail = (reason) => { failures++; log({ ok: false, reason }); return { ok: false, reason }; };

      let L;
      try { L = await getLib(); } catch { return fail('lib'); }
      const refused = L.refuseDestination(dest, { repoRoot });
      if (refused) return fail('refused');
      try { fsImpl.mkdirSync(dir, { recursive: true }); } catch { return fail('folder'); }

      const t0 = now();
      let r;
      try { r = await hub.request('snapshot', { dest }, { timeout: SNAPSHOT_TIMEOUT_MS }); } catch (e) { r = { error: String(e && e.message || e) }; }
      const ms = now() - t0;
      if (!r || r.error || !r.ok) return fail(reasonCode(r && r.error));
      if (!fsImpl.existsSync(dest)) return fail('missing');

      // retention: the newest KEEP dated names stay, older hub-YYYY-MM-DD.sqlite are removed, nothing else is touched
      let kept = 1;
      try {
        const plan = L.planRetention(fsImpl.readdirSync(dir), KEEP);
        for (const old of plan.remove) { try { fsImpl.rmSync(path.join(dir, old), { force: true }); } catch { /* next time */ } }
        kept = plan.keep.length;
      } catch { /* the snapshot itself is fine */ }
      log({ ok: true, bytes: Number(r.bytes) || 0, ms, kept });
      return { ok: true, bytes: Number(r.bytes) || 0, ms, kept };
    } catch (e) {
      failures++; log({ ok: false, reason: 'unexpected' });
      return { ok: false, reason: 'unexpected' };
    } finally { busy = false; }
  }

  function stop() {
    stopped = true;
    try { warm && timers.clearTimeout(warm); every && timers.clearInterval(every); } catch { /* closing */ }
    warm = every = null;
  }

  if (schedule) {
    // the first check lands just after the warm-up; after that, every 30 minutes. unref: this never keeps the app alive.
    warm = timers.setTimeout(() => {
      tick();
      every = timers.setInterval(tick, CHECK_MS);
      if (every && every.unref) every.unref();
    }, WARMUP_MS + 1000);
    if (warm && warm.unref) warm.unref();
  }
  return { tick, stop, dir: () => dir };
}

module.exports = { init, dayOf, fileFor, reasonCode, defaultDir, WARMUP_MS, CHECK_MS, KEEP, SNAPSHOT_TIMEOUT_MS, MAX_FAILURES_PER_DAY };
