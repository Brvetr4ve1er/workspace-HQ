// warroom-model.mjs — PURE. Turns triage() rows into the SITROOM board model
// (HP %, severity key, vector groups, radar blips). No DOM, no imports.
const SEV = { security:'red', uncommitted:'orange', stale:'yellow', 'no-tests':'dim', 'no-ci':'dim' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function buildBoardModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { threats: [], vectors: [], radar: [] };
  const maxBlast = list[0]?.blastRadius || 1;   // rows arrive blast-sorted desc
  const threats = list.map((r) => ({
    projectId: r.projectId, name: r.name, kind: r.kind, detail: r.detail,
    blastRadius: r.blastRadius,
    hpPct: clamp(Math.round((r.blastRadius / maxBlast) * 100), 4, 100),
    sev: SEV[r.kind] || 'dim',
  }));
  const byProj = new Map();
  threats.forEach((t, i) => { (byProj.get(t.projectId) || byProj.set(t.projectId, []).get(t.projectId)).push(i); });
  const vectors = [...byProj.entries()].filter(([, idx]) => idx.length >= 2).map(([projectId, idx]) => ({ projectId, idx }));
  const n = threats.length;
  const radar = threats.map((t, idx) => ({ idx, angle: (idx / n) * Math.PI * 2, radius: 0.35 + 0.6 * (t.hpPct / 100), sev: t.sev }));
  return { threats, vectors, radar };
}
