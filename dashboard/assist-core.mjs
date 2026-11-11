// The assistant's rulebook, pure half (spec: "assistant-rulebook"). No fs, no network, no clock: every time arrives as an argument.
// Every MCP tool call (and, next, every bridge route call) has a TIER; a tier carries limits; the limits are counted from the one shared
// audit log (dashboard/assist-audit.mjs) because every Claude session runs its own MCP process.
//
//   TIERS                                  ['read','note','run','stage'] — there is no act tier
//   LIMITS                                 the numbers below, one table (note.perHourPerTool, with noteTools as a per-tool override of it)
//   decide(ctx, recentEntries, now)        → { allow: true } | { allow: false, reason, retryAt? }   (pure)
//        ctx = { door, tool, tier, cwd, waiting?, running? }   waiting = actions staged and not yet approved, running = null | { by }
//   auditEntry(fields)                     → the names-only log line, a fixed key set (never args, text, titles or paths)
//   isUnderWindowsDir(cwd)                 the nightly-run belt
//   sinceWindow(since, now)                'today' | '24h' | '7d' → { since, fromMs }
//   summarize(entries, { now, since })     → counts by tool / tier / door, the last 20 calls, the last scan trigger

export const TIERS = Object.freeze(['read', 'note', 'run', 'stage']);
export const DOORS = Object.freeze(['mcp', 'browser']);
export const HOUR_MS = 3600e3;
export const LIMITS = Object.freeze({
  note: Object.freeze({ perHourPerTool: 30 }),
  noteTools: Object.freeze({ hq_brief_dismiss: 10 }),   // a per-tool override of note.perHourPerTool (a note that changes the Brief gets the tighter hand)
  stage: Object.freeze({ perHour: 10, waitingMax: 20 }),
  run: Object.freeze({ oneAtATime: true, cooldownMs: 10 * 60e3 }),
});
export const AUDIT_VERSION = 1;
export const RECENT_MAX = 20;

const num = (v) => (v instanceof Date ? v.getTime() : Number(v));
const iso = (ms) => new Date(ms).toISOString();
// a tool name is echoed into reasons and log lines: letters, digits and _ . : - only, capped
export const safeName = (v) => String(v == null ? '' : v).replace(/[^\w.:-]/g, '').slice(0, 64) || 'unknown';

// The nightly `claude -p` runs start with their working folder under the Windows folder (C:/WINDOWS/system32).
export function isUnderWindowsDir(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  return /^[a-z]:\/windows(\/|$)/i.test(cwd.replace(/\\/g, '/'));
}

const deny = (reason, retryAtMs) => (retryAtMs != null && Number.isFinite(retryAtMs) ? { allow: false, reason, retryAt: iso(retryAtMs) } : { allow: false, reason });

const at = (e) => Date.parse(e && e.at);
const mins = (ms) => Math.max(1, Math.ceil(ms / 60e3));

export function decide(ctx, recentEntries, now) {
  const { door, tool, tier, cwd } = ctx || {};
  const t = num(now);
  const name = safeName(tool);
  if (!TIERS.includes(tier)) return deny(`'${name}' is not on the rulebook (it has no tier) — refused`);
  if (tier === 'read') return { allow: true };
  // the belt: a write, a run or a stage from a nightly run's working folder is refused; reads stay open
  if (isUnderWindowsDir(cwd)) {
    return deny(`'${name}' is a ${tier} tool and this session's working folder is under the Windows folder (where the nightly runs start) — refused; read tools still work`);
  }
  const done = (Array.isArray(recentEntries) ? recentEntries : []).filter((e) => e && e.ok === true && Number.isFinite(at(e)));
  const inHour = (e) => at(e) > t - HOUR_MS;

  if (tier === 'note') {
    const mine = done.filter((e) => e.tier === 'note' && e.tool === name && inHour(e));
    const cap = Object.prototype.hasOwnProperty.call(LIMITS.noteTools, name) ? LIMITS.noteTools[name] : LIMITS.note.perHourPerTool;
    if (mine.length >= cap) {
      const oldest = Math.min(...mine.map(at));
      return deny(`'${name}' is limited to ${cap} an hour — try again later`, oldest + HOUR_MS);
    }
    return { allow: true };
  }

  if (tier === 'stage') {
    if (Number.isFinite(ctx.waiting) && ctx.waiting >= LIMITS.stage.waitingMax) {
      return deny(`${ctx.waiting} staged actions are already waiting for the owner's approval (the most is ${LIMITS.stage.waitingMax}) — approve or cancel some first`);
    }
    const mine = done.filter((e) => e.tier === 'stage' && inHour(e));
    if (mine.length >= LIMITS.stage.perHour) {
      const oldest = Math.min(...mine.map(at));
      return deny(`staging is limited to ${LIMITS.stage.perHour} an hour — try again later`, oldest + HOUR_MS);
    }
    return { allow: true };
  }

  // run: one at a time, then a cooldown after the last one that started
  if (ctx.running) {
    return ctx.running.by === 'app'
      ? deny("the app's own scan is running — a raw pass would race it; try again when it ends (a stuck lock clears after 15 minutes at most)")
      : deny('already running — a raw collector pass started from a Claude session has not finished (the lock clears when that pass ends, or after 15 minutes at most)');
  }
  const last = done.filter((e) => e.tier === 'run' && e.tool === name).map(at).sort((a, b) => b - a)[0];
  if (last != null && t - last < LIMITS.run.cooldownMs) {
    return deny(`'${name}' ran ${mins(t - last)} minute(s) ago — one every ${LIMITS.run.cooldownMs / 60e3} minutes at most`, last + LIMITS.run.cooldownMs);
  }
  return { allow: true };
}

// The log line. Fixed keys; `reason` only when there is one. Nothing the caller passed in beyond these fields can reach the file.
export function auditEntry(f) {
  const x = f || {};
  const t = x.at == null ? NaN : num(typeof x.at === 'string' ? Date.parse(x.at) : x.at);
  const ms = Number.isFinite(Number(x.ms)) ? Math.min(3600e3, Math.max(0, Math.round(Number(x.ms)))) : 0;
  const pid = Number.isInteger(x.pid) && x.pid > 0 ? x.pid : 0;
  const e = {
    v: AUDIT_VERSION,
    at: Number.isFinite(t) ? iso(t) : null,
    door: DOORS.includes(x.door) ? x.door : 'unknown',
    tool: safeName(x.tool),
    tier: TIERS.includes(x.tier) ? x.tier : 'none',
    ok: x.ok === true,
    ms,
    pid,
  };
  if (typeof x.reason === 'string' && x.reason.trim()) e.reason = x.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
  return e;
}

export function sinceWindow(since, now) {
  const t = num(now);
  if (since === '24h') return { since: '24h', fromMs: t - 24 * HOUR_MS };
  if (since === '7d') return { since: '7d', fromMs: t - 7 * 24 * HOUR_MS };
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return { since: 'today', fromMs: d.getTime() };
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

// hq_activity's numbers. Entries that don't parse as a call are not counted here (the reader reports them as skippedLines).
export function summarize(entries, { now, since } = {}) {
  const w = sinceWindow(since, now);
  const inWin = (Array.isArray(entries) ? entries : []).filter((e) => e && Number.isFinite(at(e)) && at(e) >= w.fromMs && at(e) <= num(now) + 60e3);
  inWin.sort((a, b) => at(a) - at(b));
  const counts = { byTool: {}, byTier: {}, byDoor: {} };
  for (const e of inWin) { bump(counts.byTool, e.tool); bump(counts.byTier, e.tier); bump(counts.byDoor, e.door); }
  const pick = (e) => { const r = { at: e.at, door: e.door, tool: e.tool, tier: e.tier, ok: e.ok === true, ms: e.ms || 0 }; if (e.reason) r.reason = e.reason; return r; };
  const recent = inWin.slice(-RECENT_MAX).reverse().map(pick);
  // the last scan trigger is looked up in the whole log, not just the window: 'when did a session last start a pass' outlives 'today'
  const scans = (Array.isArray(entries) ? entries : []).filter((e) => e && e.tool === 'hq_scan_trigger' && Number.isFinite(at(e)) && at(e) <= num(now) + 60e3).sort((a, b) => at(a) - at(b));
  const lastScan = scans.length ? scans[scans.length - 1] : null;
  return {
    since: w.since,
    counts,
    recent,
    lastScanTrigger: lastScan ? { at: lastScan.at, ok: lastScan.ok === true, ...(lastScan.reason ? { reason: lastScan.reason } : {}) } : null,
  };
}
