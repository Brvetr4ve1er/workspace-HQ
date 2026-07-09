// Classify a project's git safety into a risk tier + human-readable flags.
// Pure; no I/O. Moved verbatim from assemble.mjs (deferred bugs pinned by test).
export function gitRisk(g) {
  const flags = [];
  if (!g.has_git) { flags.push('no-git'); return { risk: 'high', flags }; }
  if (g.commits === 0) flags.push('no-commits');
  if (!g.has_remote) flags.push('no-remote');
  if (g.dirty > 20) flags.push('many-dirty');
  if (g.unpushed) flags.push('unpushed');
  let risk = 'low';
  if (g.commits === 0 || !g.has_remote || g.dirty > 20) risk = 'high';
  else if (g.unpushed || (g.dirty >= 6 && g.dirty <= 20) || g.behind > 0) risk = 'medium';
  return { risk, flags };
}
