// warroom-model.mjs — PURE. Turns triage() rows into the SITROOM board model
// (HP %, severity key, vector groups, radar blips). No DOM, no imports.
const SEV = { security:'red', uncommitted:'orange', stale:'yellow', 'no-tests':'dim', 'no-ci':'dim' };

// Per-kind ABSOLUTE blast ceilings, mirroring derive.triage()'s formulas:
//   security      100 + secrets            -> 105 at the 5-secret mark
//   uncommitted    50 + min(dirty, 40)     -> 90 hard cap
//   stale          20 + min(days, 60) / 2  -> 50 hard cap
//   no-tests       15 (fixed)   no-ci  10 (fixed)
// The HP bar divides by THESE, never by the observed top row. A blast-relative
// denominator is not comparable across snapshots — rotating the worst secret
// makes every other bar jump with no change in the world, which is a false
// signal in an app with a time-machine scrubber. It also just re-encoded
// `kind` (already shown by badge, border, glow and order). Anchoring to the
// per-kind maximum keeps each bar snapshot-stable and makes it discriminate
// WITHIN its category. derive.test.mjs locks these ceilings.
const KIND_MAX = { security:105, uncommitted:90, stale:50, 'no-tests':15, 'no-ci':10 };
const KIND_MAX_FALLBACK = 105;   // unknown kind: treat as the worst-case ceiling
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function buildBoardModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { threats: [], vectors: [], radar: [] };
  const maxBlast = list[0]?.blastRadius || 1;   // rows arrive blast-sorted desc
  const threats = list.map((r) => ({
    projectId: r.projectId, name: r.name, kind: r.kind, detail: r.detail,
    blastRadius: r.blastRadius,
    hpPct: clamp(Math.round((r.blastRadius / (KIND_MAX[r.kind] || KIND_MAX_FALLBACK)) * 100), 4, 100),
    sev: SEV[r.kind] || 'dim',
  }));
  const byProj = new Map();
  threats.forEach((t, i) => { (byProj.get(t.projectId) || byProj.set(t.projectId, []).get(t.projectId)).push(i); });
  const vectors = [...byProj.entries()].filter(([, idx]) => idx.length >= 2).map(([projectId, idx]) => ({ projectId, idx }));
  const n = threats.length;
  // Radar radius is PORTFOLIO-relative (this row's blast vs. the worst row's),
  // deliberately NOT hpPct: hpPct is per-kind absolute, so a `no-ci` row scores
  // 100 there and would land dead center. On a radar, center = closest = worst,
  // so the mapping runs 0.95 (calm, at the rim) down to 0.35 (worst, at the eye).
  const radar = threats.map((t, idx) => ({
    idx,
    angle: (idx / n) * Math.PI * 2,
    radius: 0.95 - 0.6 * clamp(t.blastRadius / maxBlast, 0.04, 1),
    sev: t.sev,
  }));
  return { threats, vectors, radar };
}
