// data/.refresh.lock — keeps the app's own Scan and a Claude session's raw collector pass from running at once.
// The collector writes raw-metrics.json with a plain writeFileSync, so two passes together could hand assemble a half-written file.
// Lock content: { pid, by: 'app' | 'mcp', startedAt }. A lock is STALE when its pid is gone or it is older than 15 minutes
// (Windows reuses pids, so the age is the ceiling). Both sides are best-effort: a lock that can't be written never blocks anyone.
//
// create({ dataDir, now?, pid?, isAlive?, staleMs? }) →
//   take(by)                  → true when this caller now holds the lock (a stale one is reclaimed); false when a fresh one is held
//   setPid(by, pid)           → true; the holder points the lock at the child process that really does the work (so a closed session
//                               does not make a running pass look dead). Only the current holder `by` can.
//   release(by, { pid? })     → true when removed; only the holder (matching `by`, and `pid` when given) can release
//   held()                    → null | { pid, by, startedAt, ageMs }   the fresh holder, if any (reads only; never reclaims)
// refusalText(held)           → the tray / tool wording for a refusal while `held` holds the lock
// Never throws.
const fs = require('fs');
const path = require('path');

const LOCK_NAME = '.refresh.lock';
const STALE_MS = 15 * 60e3;
const HOLDERS = ['app', 'mcp'];

function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

function refusalText(h) {
  if (h && h.by === 'mcp') return 'a raw pass started from a Claude session is still running — try again in a minute';
  if (h && h.by === 'app') return 'a scan is already running';
  return 'another pass is running — try again in a minute';
}

function create({ dataDir, now = Date.now, pid = process.pid, isAlive = defaultIsAlive, staleMs = STALE_MS } = {}) {
  const file = dataDir ? path.join(String(dataDir), LOCK_NAME) : null;   // no folder given: every call is a harmless no-op

  // { rec, fresh } | { rec: null, fresh: false, missing } — never throws
  function inspect() {
    if (!file) return { rec: null, fresh: false, missing: true };
    let raw, st;
    try { raw = fs.readFileSync(file, 'utf8'); st = fs.statSync(file); }
    catch (e) { return { rec: null, fresh: false, missing: !!(e && e.code === 'ENOENT'), error: !(e && e.code === 'ENOENT') }; }
    let rec = null;
    try { rec = JSON.parse(raw); } catch { rec = null; }
    if (!rec || typeof rec !== 'object' || !HOLDERS.includes(rec.by)) {
      // empty or half-written: another process may be between its create and its write — fresh for a few seconds, stale after
      return { rec: null, fresh: now() - st.mtimeMs < 5000, missing: false, torn: true };
    }
    const started = Date.parse(rec.startedAt);
    const age = Number.isFinite(started) ? now() - started : Infinity;
    const fresh = age < staleMs && age > -60e3 && isAlive(rec.pid);
    return { rec, fresh, ageMs: age };
  }

  function take(by) {
    if (!HOLDERS.includes(by)) return false;
    if (!file) return true;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const body = JSON.stringify({ pid, by, startedAt: new Date(now()).toISOString() });
      for (let attempt = 0; attempt < 2; attempt++) {
        try { fs.writeFileSync(file, body, { flag: 'wx' }); return true; }
        catch (e) {
          if (!e || e.code !== 'EEXIST') return true;      // the lock is a belt: if the disk will not take it, do not block the caller
          const s = inspect();
          if (s.fresh) return false;
          return reclaim(body);
        }
      }
      return false;
    } catch { return true; }                                // e.g. the data folder cannot exist: fail open
  }

  // Replacing a stale lock is one taker at a time (a short-lived `.refresh.lock.reclaim` created with wx): two takers that both saw the
  // same stale lock must not both unlink and create — the slower one would delete the faster one's live lock. Inside, the lock is
  // looked at again; a lock that is fresh by then belongs to the faster taker and is left alone.
  function reclaim(body) {
    const gate = file + '.reclaim';
    let have = false;
    for (let attempt = 0; attempt < 2 && !have; attempt++) {
      try { fs.writeFileSync(gate, String(pid), { flag: 'wx' }); have = true; }
      catch (e) {
        if (!e || e.code !== 'EEXIST') return true;                                  // the disk will not take it: fail open like the lock itself
        let age = 0;
        try { age = now() - fs.statSync(gate).mtimeMs; } catch { continue; }          // vanished: try once more
        if (age < 10e3 && age > -10e3) return false;                                  // another taker is reclaiming right now
        try { fs.unlinkSync(gate); } catch { /* someone else cleared it */ }          // a crashed reclaimer's leftover
      }
    }
    if (!have) return false;
    try {
      if (inspect().fresh) return false;
      try { fs.unlinkSync(file); } catch { /* already gone */ }
      try { fs.writeFileSync(file, body, { flag: 'wx' }); return true; }
      catch (e) { return !!e && e.code !== 'EEXIST'; }                                // EEXIST = a third taker was first
    } finally { try { fs.unlinkSync(gate); } catch { /* best effort */ } }
  }

  function setPid(by, newPid) {
    try {
      const s = inspect();
      if (!s.rec || s.rec.by !== by || !Number.isInteger(newPid) || newPid <= 0) return false;
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ ...s.rec, pid: newPid }));
      fs.renameSync(tmp, file);
      return true;
    } catch { return false; }
  }

  function release(by, opts) {
    try {
      const s = inspect();
      if (!s.rec || s.rec.by !== by) return false;
      if (opts && opts.pid != null && s.rec.pid !== opts.pid) return false;
      fs.unlinkSync(file);
      return true;
    } catch { return false; }
  }

  function held() {
    try {
      const s = inspect();
      if (!s.rec || !s.fresh) return null;
      return { pid: s.rec.pid, by: s.rec.by, startedAt: s.rec.startedAt, ageMs: s.ageMs };
    } catch { return null; }
  }

  return { take, setPid, release, held, file };
}

module.exports = { create, refusalText, LOCK_NAME, STALE_MS };
