// Synthetic scan/sidecar builders shared by the v5 data-layer tests (and the
// golden render tests built on them). Placeholder names only — the real scans
// are personal and the repo is public: "Project A" at C:/dev/a, never a real path.
//
//   proj(id, o)        one scan project (latest.json `projects[]` shape)
//   scan(id, projects, o)  one full scan (latest.json shape)
//   spellbook(spells, o)   spellbook sidecar · spell(id, o) one entry
//   telemetry(casts, o)    spell-telemetry sidecar
//   pcHealth(organs, o)    pc-health sidecar · organ(id, o) one entry

export const proj = (id, o = {}) => ({
  id, name: 'Project ' + id.toUpperCase(), path: o.path ?? 'C:/dev/' + id, stack: ['Node'], dev_cmd: o.dev ?? null, canonical_branch: 'main',
  completion: { pct: o.pct ?? 50, basis: 'heuristic' }, level: 2, xp: 200,
  activity: { state: o.state ?? 'active', days_since_commit: o.days ?? 2 },
  metrics: {
    git_safety: { has_git: o.git ?? true, has_remote: true, remote: 'github.com/x/' + id, branch: o.branch ?? 'main', commits: o.commits ?? 10, dirty: o.dirty ?? 0, ahead: o.ahead ?? 0, behind: 0, last_commit_subject: 'feat: thing', ...(o.gitRisk ? { risk: o.gitRisk } : {}), ...(o.gitFlags ? { flags: o.gitFlags } : {}) },
    code_health: { build: 'unknown', tests: { present: true, count: 3 }, files: 20, loc: 900, recent_files: ['a.js'] },
    risk_security: { secrets_found: o.secrets ?? 0, flags: o.riskFlags ?? (o.secrets ? [{ type: 'secret', severity: 'high', detail: 'Likely API key', location: '.env:3' }] : []) },
  },
  disk: { reclaimable_bytes: o.reclaim ?? 0 },
  ...(o.suggestions ? { suggestions: o.suggestions } : {}),
  ...(o.side ? { side_quests: o.side } : {}),
});

export const scan = (id, projects, o = {}) => ({
  scan: { id, date: id + 'T03:00:00Z' }, projects,
  account: { level: 3, title: 'Builder', xp: o.xp ?? 400, health_index: 50, streak: { scan_days: 2 } },
  quests: o.quests || [], side_quests: o.side || [], achievements: o.ach || [], changes_since_prev: o.changes || [], archived_projects: o.archived || [], recent_learnings: [],
  inventory: o.inv || {}, browser: o.browser,
});

export const spell = (id, o = {}) => ({
  id, name: o.name ?? id.split(':').pop(), kind: o.kind ?? 'castable', source: o.source ?? id.split(':')[0],
  command: o.command ?? 'node', args: o.args ?? [], cwd: o.cwd ?? 'C:/dev/a', school: o.school, icon: o.icon,
  description: o.desc ?? '', content_hash: o.hash ?? 'h-' + id, ...(o.confirm ? { confirm: true } : {}), ...(o.invalid ? { invalid: true } : {}), ...(o.chain ? { chain: o.chain } : {}),
});
export const spellbook = (spells, o = {}) => ({ counts: { total: o.total ?? spells.length, by_source: o.bySource ?? {}, familiars: o.familiars ?? 0 }, spells });
export const telemetry = (casts = [], o = {}) => ({ casts, favorites: o.favorites || [], confirmed_hashes: o.confirmed || {} });

export const organ = (id, o = {}) => ({ id, label: o.label ?? id.toUpperCase(), value: o.value ?? 10, unit: o.unit ?? '%', status: o.status ?? 'grace', diagnosis: o.diagnosis, teaching: o.teaching, fixes: o.fixes });
export const pcHealth = (organs, o = {}) => ({ scanned_at: o.at ?? '2026-10-03T03:00:00Z', host: o.host ?? { name: 'test-pc' }, organs });
