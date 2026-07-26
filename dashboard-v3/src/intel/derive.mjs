// derive.mjs — pure derivations. No DOM, no globals, no Date.now().
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// Weighted "what should I do right now". Higher weight wins. Ported from
// tools/now-brief.mjs's next-action heuristic, made pure + testable.
// Only 'commit' and 'quest' actions are produced today; 'capture'/'scan'/
// 'rest' are deferred to a later increment. `bundle` and `now` are
// intentionally forward-declared in the signature for that later increment
// (time-of-day-aware recommendations) and are currently unused.
export function oracle(bundle, selected, now) {
  const sel = selected || {};
  const cands = [];

  for (const p of sel.projects || []) {
    const unc = num(p.metrics?.git_safety?.dirty);
    if (unc > 0) cands.push({
      action: 'commit', weight: 40 + Math.min(unc, 60),
      label: `Commit ${p.name} (${unc} uncommitted)`,
      reason: `${unc} uncommitted files at risk`,
      target: { realmId: 'forge', projectId: p.id },
    });
    const sec = num(p.metrics?.risk_security?.secrets_found);
    if (sec > 0) cands.push({
      action: 'quest', weight: 90 + sec,
      label: `Rotate ${sec} exposed secret${sec > 1 ? 's' : ''} — ${p.name}`,
      reason: 'exposed secrets are a live breach risk',
      target: { realmId: 'forge', projectId: p.id },
    });
  }
  for (const q of sel.quests || []) {
    if (q.status !== 'open') continue;
    const w = q.tier === 'red' ? 70 : q.tier === 'orange' ? 45 : 20;
    cands.push({ action: 'quest', weight: w, label: q.title,
      reason: `${q.tier} quest`, target: { realmId: 'hunts', questId: q.id } });
  }
  // nothing actionable → null; a time-of-day 'rest' recommendation is deferred to a later increment
  if (!cands.length) return null;

  cands.sort((a, b) => b.weight - a.weight);
  return cands[0];
}

// Per-project risk rows, one per concern, ranked by blast radius so the
// worst thing across the whole portfolio always sorts to the top.
export function triage(selected) {
  const rows = [];
  for (const p of (selected?.projects || [])) {
    const sec = num(p.metrics?.risk_security?.secrets_found);
    const dirty = num(p.metrics?.git_safety?.dirty);
    const stale = num(p.activity?.days_since_commit);
    const concerns = [];
    if (sec > 0)     concerns.push({ kind:'security',    blastRadius: 100 + sec,                    detail:`${sec} exposed secret${sec>1?'s':''}` });
    if (dirty > 0)   concerns.push({ kind:'uncommitted', blastRadius: 50 + Math.min(dirty, 40),      detail:`${dirty} uncommitted files` });
    if (stale >= 14) concerns.push({ kind:'stale',       blastRadius: 20 + Math.min(stale, 60) / 2,  detail:`${stale} days since a commit` });
    if (p.signals?.has_tests === false) concerns.push({ kind:'no-tests', blastRadius: 15, detail:'no tests' });
    if (p.signals?.has_ci === false)    concerns.push({ kind:'no-ci',    blastRadius: 10, detail:'no CI' });
    for (const c of concerns) rows.push({ projectId: p.id, name: p.name, ...c });
  }
  return rows.sort((a, b) => b.blastRadius - a.blastRadius);
}

// Portfolio-wide inventory rollup: clone/duplicate/empty-dir counts plus
// reclaimable disk space, normalized into a flat display-ready item list.
export function anomalies(selected) {
  const inv = selected?.inventory || {};
  const items = [];
  for (const c of (inv.clones || []))     items.push({ label: c?.name || 'clone',      kind: 'clone' });
  for (const d of (inv.duplicates || [])) items.push({ label: d?.detail || 'duplicate', kind: 'duplicate' });
  for (const e of (inv.empty || []))      items.push({ label: typeof e === 'string' ? e : (e?.name || 'empty'), kind: 'empty' });
  const reclaimableBytes = (selected?.projects || []).reduce((s, p) => s + num(p.disk?.reclaimable_bytes), 0);
  return { clones: (inv.clones||[]).length, duplicates: (inv.duplicates||[]).length, empty: (inv.empty||[]).length, reclaimableBytes, items };
}

// Least-squares XP slope over trend samples, projected forward to an ETA
// for the next level using the account's xp_to_next threshold.
export function momentum(trends, account, now) {
  const xs = (trends?.xp || []).map((pt, i) => [i, num(pt?.v)]);
  const n = xs.length;
  let xpSlope = 0;
  if (n >= 2) {
    const mx = xs.reduce((s, [x]) => s + x, 0) / n;
    const my = xs.reduce((s, [, y]) => s + y, 0) / n;
    let numr = 0, den = 0;
    for (const [x, y] of xs) { numr += (x - mx) * (y - my); den += (x - mx) ** 2; }
    xpSlope = den ? numr / den : 0;
  }
  const toNext = num(account?.xp_to_next);
  let etaDays = null, etaNextLevel = null;
  if (xpSlope > 0 && toNext > 0) {
    etaDays = toNext / xpSlope;                                  // slope is per-sample (~per-day scan)
    etaNextLevel = new Date(new Date(now).getTime() + etaDays * 86400000).toISOString();
  }
  return { xpSlope, etaDays, etaNextLevel };
}
