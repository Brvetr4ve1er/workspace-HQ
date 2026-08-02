// foresight.mjs — PURE presentation adapters over derive.mjs's Foresight
// outputs (momentum / anomalies / achievementNudges). No imports, no DOM, no
// Date.now(): `now` and the achievement label table are injected, which is what
// keeps this headless-testable under node --test (same firewall as derive.mjs).
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A slope is "moving" only past ±0.5 XP/scan — below that it's sampling noise
// on a 44-point series and calling it a trend would be a lie.
//
// UNITS — read this before renaming anything back. derive.momentum() fits the
// slope over TREND SAMPLES (one sample per scan), so `xpSlope` is XP-per-scan
// and `etaDays` is really "scans to the next level" wearing a days-shaped name.
// Scans are not daily (the live series is 44 samples over 58 days ≈ 0.76
// scans/day), so calling that number "days" understates the calendar wait by
// ~25%. derive.mjs is the struct lane's file and its field names are contract;
// this adapter is the fe lane's, so the honest unit is applied HERE: the
// exported field is slopePerScan and the ETA reads "~N scans". Anything that
// wants calendar days must first divide by the observed scans-per-day rate —
// which nothing computes today, so nothing may claim days.
export function forecastLine(m) {
  const slope = num(m?.xpSlope);
  const trend = slope > 0.5 ? 'rising' : slope < -0.5 ? 'falling' : 'flat';
  const eta = num(m?.etaDays, 0);   // derive's name; the value is per-scan
  let etaLabel = '—';
  if (eta > 0) {
    const n = Math.ceil(eta);
    etaLabel = `~${n} scan${n === 1 ? '' : 's'}`;
  }
  return {
    trend,
    slopePerScan: Math.round(slope * 10) / 10,
    etaLabel,
    etaISO: m?.etaNextLevel || null,
  };
}

const UNITS = [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]];
function humanBytes(b) {
  const n = num(b);
  for (const [unit, size] of UNITS) {
    if (n >= size) return `${Math.round((n / size) * 10) / 10} ${unit}`;
  }
  return `${Math.round(n)} B`;
}

const KIND_ORDER = ['clone', 'duplicate', 'empty'];

export function anomalyGroups(a) {
  const items = Array.isArray(a?.items) ? a.items : [];
  const groups = [];
  for (const kind of KIND_ORDER) {
    const mine = items.filter((i) => i?.kind === kind);
    if (mine.length) groups.push({ kind, count: mine.length, items: mine });
  }
  return { total: items.length, reclaimableLabel: humanBytes(a?.reclaimableBytes), groups };
}

// labelFor is injected (the real ACH map lives in ui/components.js, which this
// module must not import — importing DOM-adjacent code would break purity).
export function nudgeRows(nudges, labelFor) {
  const out = [];
  for (const n of (Array.isArray(nudges) ? nudges : [])) {
    const meta = (typeof labelFor === 'function' ? labelFor(n?.id) : null) || {};
    const have = num(n?.have), need = num(n?.need);
    out.push({
      id: n?.id,
      label: meta.name || n?.id,
      icon: meta.icon || '',
      have, need,
      pct: need > 0 ? clamp(Math.round((have / need) * 100), 0, 100) : 0,
    });
  }
  return out.sort((x, y) => y.pct - x.pct);
}
