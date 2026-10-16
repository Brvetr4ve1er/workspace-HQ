// Quest engine: safe auto-completion predicate, per-quest evaluation context, and
// the derive-new-quests pass. Pure; no I/O. Moved verbatim from assemble.mjs
// (renames: prev?.quests->prevQuests, TODAY->today, GCFG.quest_xp_by_tier->questXpByTier).
// User overrides (data/quest-overrides.json) stay in the orchestrator.

export function autoSatisfied(expr, ctx) {
  if (!expr || expr === 'manual') return false;
  try {
    const keys = Object.keys(ctx);
    // allow only comparisons / boolean ops / identifiers / numbers / quoted strings
    if (!/^[\sA-Za-z0-9_'"!=<>&|()."-]*$/.test(expr.replace(/'[^']*'/g, ''))) return false;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `try { return !!(${expr}); } catch { return false; }`);
    return fn(...keys.map((k) => ctx[k]));
  } catch { return false; }
}

export function questCtx(q, prodById, emptyCount) {
  const p = q.project_id ? prodById.get(q.project_id) : null;
  if (!p) return { empty_count: emptyCount, registered: false };
  const g = p.metrics.git_safety;
  return {
    has_git: g.has_git, has_remote: g.has_remote, commits: g.commits,
    dirty: g.dirty, ahead: g.ahead, behind: g.behind, unpushed: g.unpushed,
    build: p.metrics.code_health.build,
  };
}

// Carry previous quests (auto-closing satisfied ones), then derive fresh git/build
// quests from current facts, deduped against carried quests by "concern".
export function deriveQuests({ prevQuests, projects, prodById, emptyCount, today, questXpByTier }) {
  const quests = [];
  let questsCompletedThisScan = 0;

  // 1) carry previous quests, re-evaluate
  for (const q of prevQuests) {
    const nq = { ...q };
    const ctx = questCtx(q, prodById, emptyCount);
    if (nq.status !== 'done' && nq.status !== 'dismissed' && autoSatisfied(q.auto_complete_when, ctx)) {
      nq.status = 'done'; nq.completed = today; questsCompletedThisScan++;
    }
    if (nq.status !== 'done') nq.age_days = q.carried_from ? Math.round((Date.parse(today) - Date.parse(q.carried_from)) / 86400000) : 0;
    quests.push(nq);
  }
  const haveQuest = new Set(quests.map((q) => q.id));

  // 2) derive git/build quests from current facts (dedup against carried quests by "concern")
  const occupied = new Map(); // project_id -> Set(concern)
  for (const q of quests) {
    if (!q.project_id || (q.status !== 'open' && q.status !== 'in_progress')) continue;
    const text = `${q.auto_complete_when || ''} ${JSON.stringify(q.evidence || {})} ${q.title}`;
    const set = occupied.get(q.project_id) || new Set();
    if (/dirty|commit|remote|ahead|push|git|version control/i.test(text)) set.add('git');
    if (/build|crash/i.test(text)) set.add('build');
    occupied.set(q.project_id, set);
  }
  const hasConcern = (pid, c) => occupied.get(pid)?.has(c);
  // Quest ids are stable per project+concern, so once "q-<p>-commit-dirty" was done it could
  // never be raised again even when the tree was dirty for months (the board read "0 open"
  // while Home listed the problem). A done quest whose condition is back is re-raised as a
  // new quest "<id>-r<N>" (created today, reopened_from = the old id); a dismissed quest
  // stays quiet — "dismissed" means "stop asking".
  const sameLine = (id) => quests.filter((q) => q.id === id || q.id.startsWith(id + '-r'));
  function addQuest(q, concern) {
    if (concern && hasConcern(q.project_id, concern)) return; // a carried quest already covers this
    const prior = sameLine(q.id);
    if (prior.length) {
      if (prior.some((p) => p.status === 'dismissed')) return;
      if (prior.some((p) => p.status !== 'done')) return;
      q = { ...q, id: q.id + '-r' + (prior.length + 1), reopened_from: q.id };
      if (haveQuest.has(q.id)) return;
    }
    quests.push(q); haveQuest.add(q.id);
    const set = occupied.get(q.project_id) || new Set();
    if (concern) { set.add(concern); occupied.set(q.project_id, set); }
  }
  for (const p of projects) {
    const g = p.metrics.git_safety;
    const base = { project_id: p.id, status: 'open', created: today, completed: null, carried_from: today, age_days: 0 };
    if (!g.has_git)
      addQuest({ ...base, id: `q-${p.id}-gitinit`, title: `Put ${p.name} under version control`, tier: 'red', xp: questXpByTier.red, insight: `${p.name} has no git repo — zero rollback safety.`, evidence: { has_git: false }, auto_complete_when: 'has_git && commits>0' }, 'git');
    else if (g.commits === 0)
      addQuest({ ...base, id: `q-${p.id}-commit`, title: `Commit + push ${p.name}`, tier: 'red', xp: questXpByTier.red, insight: `git init done but 0 commits.`, evidence: { commits: 0 }, auto_complete_when: 'commits>0 && has_remote' }, 'git');
    else if (!g.has_remote)
      addQuest({ ...base, id: `q-${p.id}-remote`, title: `Add a remote + push ${p.name}`, tier: 'red', xp: questXpByTier.red, insight: `${g.commits} commits but no remote.`, evidence: { has_remote: false }, auto_complete_when: 'has_remote' }, 'git');
    else if (g.dirty > 20)
      addQuest({ ...base, id: `q-${p.id}-commit-dirty`, title: `Commit ${p.name} working tree (${g.dirty} files)`, tier: 'red', xp: questXpByTier.red, insight: `${g.dirty} uncommitted files at risk.`, evidence: { dirty: g.dirty }, auto_complete_when: 'dirty<=2' }, 'git');
    else if (g.unpushed)
      addQuest({ ...base, id: `q-${p.id}-push`, title: `Push ${p.name} (${g.ahead} ahead)`, tier: 'orange', xp: questXpByTier.orange, insight: `${g.ahead} commits unpushed.`, evidence: { ahead: g.ahead }, auto_complete_when: 'unpushed==false && ahead==0' }, 'git');
    if (p.metrics.code_health.build === 'red')
      addQuest({ ...base, id: `q-${p.id}-build`, title: `Fix ${p.name} build`, tier: 'red', xp: questXpByTier.red, insight: p.metrics.code_health.build_note || 'Build is red.', evidence: {}, auto_complete_when: "build!='red'" }, 'build');
  }

  return { quests, questsCompletedThisScan };
}
