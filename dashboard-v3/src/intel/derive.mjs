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
