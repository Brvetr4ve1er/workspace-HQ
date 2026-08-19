// screen-core.mjs — the SCREEN TIME derivations, pure. No DOM, no globals, no
// Date.now(). Ported from v3 realms/watchtower/view.js's private helpers and
// lifted out of the view so they are testable under `node --test` (house style:
// live-core.mjs, changes-core.mjs).
//
// EVERY number this module produces comes from browsing time the Bridge
// extension already captured into each scan (`scan.browser`). There is no new
// data contract and no IPC: this is derivation over the snapshot series.
//
// TIME-MACHINE HONESTY: rollups read only scans at-or-before the selected
// index, so viewing an older snapshot shows what was true then — never a
// future-leaking total.
import { categorize } from './categories.mjs';

const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const isDistractingCat = (c) => c === 'social' || c === 'video';

// Scans up to (and including) the selection that actually captured browsing —
// older scans predate the Bridge and carry no browser block at all. Entries
// cross the extension seam, so a null / domain-less entry is filtered once here
// instead of being guarded at every call site.
export function browserScans(scans, selectedIndex) {
  const list = Array.isArray(scans) ? scans : [];
  const end = Number.isFinite(selectedIndex) ? selectedIndex : list.length - 1;
  return list
    .slice(0, Math.max(0, end + 1))
    .filter((s) => s && s.browser && s.browser.captured && Array.isArray(s.browser.by_domain) && s.browser.by_domain.length)
    .map((s) => ({ ...s, browser: { ...s.browser, by_domain: s.browser.by_domain.filter((d) => d && typeof d.domain === 'string') } }))
    .filter((s) => s.browser.by_domain.length);
}

// Total focus time over one scan's domains; `pick` narrows to a subset.
export const domSum = (B, pick) =>
  (B && Array.isArray(B.by_domain) ? B.by_domain : [])
    .reduce((t, d) => t + (pick && !pick(d) ? 0 : num(d.focus_ms)), 0);

// Per-domain rollup across the captured scans. `series`/`visitsSeries` are
// indexed per scan-with-browser (0 where the domain didn't surface that day),
// so a sparkline and the per-day history read the same array.
export function rollup(scansB) {
  const byDom = new Map();
  scansB.forEach((s, i) => {
    for (const d of s.browser.by_domain) {
      const r = byDom.get(d.domain) || {
        domain: d.domain, total: 0, days: 0, visits: 0, lastTs: 0, title: '',
        series: new Array(scansB.length).fill(0),
        visitsSeries: new Array(scansB.length).fill(0),
      };
      r.total += num(d.focus_ms);
      r.days += 1;
      r.series[i] = num(d.focus_ms);
      r.visits += num(d.visits);
      r.visitsSeries[i] = num(d.visits);
      const lt = num(d.last_ts);                       // >= so a later scan wins ties → newest title
      if (lt >= r.lastTs) { r.lastTs = lt; if (d.title) r.title = d.title; }
      byDom.set(d.domain, r);
    }
  });
  return [...byDom.values()].sort((a, b) => (b.total - a.total) || a.domain.localeCompare(b.domain));
}

// domain → owning project name, from the by_project attribution the Bridge
// already records. Chronological walk means the most recent capture's mapping
// wins (deterministic — scansB is ordered).
export function projectMap(scansB) {
  const m = new Map();
  for (const s of scansB) {
    for (const p of (s.browser.by_project || [])) {
      for (const dom of (p?.domains || [])) {
        if (dom && p.project_name) m.set(dom, p.project_name);
      }
    }
  }
  return m;
}

// social+video share of one scan's visible time, 0-100. Numerator and
// denominator both read by_domain so the ratio compares like with like.
export function distractPct(B) {
  const all = domSum(B);
  return all ? Math.round((domSum(B, (d) => isDistractingCat(categorize(d.domain))) / all) * 100) : 0;
}

export const distractTier = (pct) => (pct < 35 ? 'low' : pct < 65 ? 'mid' : 'high');

// Direction of a captured-scan-over-scan change; null when there is no prior
// capture to compare against (single-day history) — the view renders no chip
// rather than inventing a baseline.
export function trend(cur, prev) {
  if (prev == null) return null;
  const d = cur - prev;
  return { d, glyph: d > 0 ? '▲' : d < 0 ? '▼' : '●', dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}

// percent-change label for a time delta; 'new' when it climbed from nothing.
export function trendPct(t, prev) {
  if (!t) return '';
  if (t.d === 0) return '±0';
  if (!prev) return t.d > 0 ? 'new' : '—';
  const p = Math.round((t.d / prev) * 100);
  return (p > 0 ? '+' : '') + p + '%';
}

// Consecutive scan-over-scan INCREASES in social time ending at the selected
// snapshot (strict growth; video rides the meter, not the streak).
export function socialStreak(scansB) {
  const per = scansB.map((s) => domSum(s.browser, (d) => categorize(d.domain) === 'social'));
  let streak = 0;
  for (let i = 1; i < per.length; i++) streak = per[i] > per[i - 1] ? streak + 1 : 0;
  return streak;
}

// Day-of-week buckets, Monday-first. Scans are daily, so each captured scan
// contributes its whole visible time to its weekday. Parsed as UTC so the
// bucket never drifts with the local timezone.
export function weekBuckets(scansB) {
  const b = new Array(7).fill(0);
  for (const s of scansB) {
    const id = s?.scan?.id;
    const t = Date.parse(String(id) + 'T00:00:00Z');
    if (!Number.isFinite(t)) continue;
    b[(new Date(t).getUTCDay() + 6) % 7] += domSum(s.browser);   // getUTCDay: 0=Sun
  }
  return b;
}

// The four headline facts of the rollup, so the view does no arithmetic.
export function summarize(scansB, roll) {
  const rows = Array.isArray(roll) ? roll : [];
  return {
    grandMs: rows.reduce((t, r) => t + num(r.total), 0),
    sites: rows.length,
    days: Array.isArray(scansB) ? scansB.length : 0,
    busiest: rows[0] ? rows[0].domain : null,
  };
}

// Per-platform detail facts (peak day, first appearance) for the expanded card.
export function platformDetail(r) {
  const series = Array.isArray(r?.series) ? r.series : [];
  let peak = 0, peakIdx = 0;
  series.forEach((v, i) => { if (num(v) > peak) { peak = num(v); peakIdx = i; } });
  return { peak, peakIdx, firstIdx: series.findIndex((v) => num(v) > 0) };
}
