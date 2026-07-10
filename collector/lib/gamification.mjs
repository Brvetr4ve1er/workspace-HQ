import { clamp, round } from './util.mjs';

// Canonical level lookup: highest tier whose min_xp is <= xp.
// Moved from assemble.mjs (GCFG.level_curve.tiers -> tiers param). projects.mjs
// imports this same function (dropping its Task-4 local copy).
export function levelFor(xp, tiers) {
  let cur = tiers[0];
  for (const t of tiers) if (xp >= t.min_xp) cur = t;
  const next = tiers.find((t) => t.min_xp > cur.min_xp) || null;
  return {
    level: cur.level, title: cur.title,
    xp_into_level: xp - cur.min_xp,
    xp_to_next: next ? next.min_xp - xp : 0,
  };
}

// Portfolio health index + scan streak. Pure. riskCounts is computed by the
// orchestrator (also used for the git_risk trend) and passed in. TODAY -> today.
export function rollup({ projects, quests, riskCounts, prev, today }) {
  const avgCompletion = projects.reduce((a, p) => a + p.completion.pct, 0) / (projects.length || 1);
  const buildOk = projects.filter((p) => ['green', 'runs'].includes(p.metrics.code_health.build)).length;
  const buildScore = (buildOk / (projects.length || 1)) * 100;
  const testCovScore = (projects.filter((p) => p.metrics.code_health.tests?.passing).length / (projects.length || 1)) * 100;
  // risk_security.flags are objects {type,severity,...} only when the LLM enricher ran;
  // guard against the carried string entries. Crucially, fold in raw DETECTED secrets so
  // ~30 found credentials stop scoring 0 risk (the long-standing "frozen health" bug).
  const secHigh = projects.reduce((a, p) => a + (p.metrics.risk_security.flags || []).filter((f) => f && f.severity === 'high').length, 0);
  const secMed = projects.reduce((a, p) => a + (p.metrics.risk_security.flags || []).filter((f) => f && f.severity === 'medium').length, 0);
  const secretsFound = projects.reduce((a, p) => a + (p.metrics.risk_security.secrets_found || 0), 0);
  const riskScore = clamp(secHigh * 20 + secMed * 8 + Math.min(secretsFound * 4, 60), 0, 100);
  const gitSafetyScore = clamp(100 - (riskCounts.high * 25 + riskCounts.medium * 10), 0, 100);
  const healthIndex = round(0.30 * avgCompletion + 0.25 * gitSafetyScore + 0.20 * buildScore + 0.15 * (100 - riskScore) + 0.10 * testCovScore);

  // streak
  let scanDays = 1, longest = 1;
  if (prev?.account?.streak) {
    const prevDate = prev.account.streak.last_scan;
    const gap = (Date.parse(today) - Date.parse(prevDate)) / 86400000;
    if (gap <= 1.5) { scanDays = (prev.account.streak.scan_days || 1) + 1; }
    longest = Math.max(prev.account.streak.longest_scan_days || 1, scanDays);
  }

  // buildOk is also consumed by the green_machine achievement in the orchestrator.
  return { avgCompletion, buildOk, buildScore, testCovScore, riskScore, gitSafetyScore, healthIndex, scanDays, longest };
}
