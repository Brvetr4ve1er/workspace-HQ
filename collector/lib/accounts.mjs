// CONNECTED ACCOUNTS shaping — pure (data overhaul Front D3, CONTRACT 2026-10-26).
// Turns what collector/accounts.mjs reads through the owner's own CLIs (Vercel: `vercel api`,
// Supabase: `supabase projects list`) into data/accounts.json. Read-only; no token is stored
// here — each CLI uses its own login. No I/O.

export const SIDECAR_V = 1;
export const MAX_AGE_MS = 10 * 60e3;   // a scan reuses a snapshot younger than this
export const DEPLOYS_MAX = 20;

const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '');
// Vercel states: READY · ERROR · BUILDING · QUEUED · INITIALIZING · CANCELED · BLOCKED (a blocked production deploy, e.g. a protected branch)
const vState = (s) => { const v = str(s).toUpperCase(); return ['READY', 'ERROR', 'BUILDING', 'QUEUED', 'INITIALIZING', 'CANCELED', 'BLOCKED'].includes(v) ? v.toLowerCase() : v ? 'unknown' : ''; };
const BAD = new Set(['error', 'blocked']);
const deployUrl = (u) => { const s = str(u); return s ? (s.startsWith('http') ? s : 'https://' + s) : ''; };

function deploy(d, projectName) {
  if (!d) return null;
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
  return { project: projectName || str(d.name), state: vState(d.readyState || d.state), target: str(d.target) || 'preview',
    url: deployUrl(d.url), at: iso(d.createdAt || d.created), commit: str(meta.githubCommitMessage).split('\n')[0].slice(0, 140),
    branch: str(meta.githubCommitRef) };
}

// user = /v2/user .user · projects = /v9/projects .projects · deployments = /v6/deployments .deployments
// teams = /v2/teams .teams — a project owned by a team lives at vercel.com/<team slug>/<project>
export function shapeVercel({ user, projects, deployments, teams = [], nowMs, errors = [] }) {
  const team = str(user && (user.username || user.name));
  const slugOf = new Map(arr(teams).map((t) => [str(t.id), str(t.slug)]));
  const rows = arr(projects).map((p) => {
    const scope = slugOf.get(str(p.accountId)) || team;
    const latest = arr(p.latestDeployments).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const prod = latest.find((d) => str(d.target) === 'production') || null;
    const link = p.link && typeof p.link === 'object' ? p.link : {};
    const repo = link.type === 'github' && link.org && link.repo ? str(link.org) + '/' + str(link.repo) : null;
    return { name: str(p.name), framework: str(p.framework), repo, dashboard: scope ? `https://vercel.com/${encodeURIComponent(scope)}/${encodeURIComponent(str(p.name))}` : '',
      prod: deploy(prod, str(p.name)), latest: deploy(latest[0] || null, str(p.name)), updatedAt: iso(p.updatedAt) };
  }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  const deploys = arr(deployments).map((d) => deploy(d, str(d.name))).sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, DEPLOYS_MAX);
  return {
    state: 'ok', at: new Date(nowMs).toISOString(), user: team, partial: errors.length > 0, errors: errors.slice(0, 5),
    totals: { projects: rows.length, prodFailing: rows.filter((r) => r.prod && BAD.has(r.prod.state)).length,
      building: rows.filter((r) => r.latest && ['building', 'queued', 'initializing'].includes(r.latest.state)).length },
    projects: rows, deploys,
  };
}

// list = `supabase projects list -o json` (an array of projects)
export function shapeSupabase({ list, nowMs }) {
  const rows = arr(list).map((p) => ({ name: str(p.name), ref: str(p.id || p.ref), region: str(p.region), status: str(p.status).toLowerCase(),
    createdAt: str(p.created_at), dashboard: (p.id || p.ref) ? 'https://supabase.com/dashboard/project/' + encodeURIComponent(str(p.id || p.ref)) : '' }));
  return { state: 'ok', at: new Date(nowMs).toISOString(), totals: { projects: rows.length, unhealthy: rows.filter((r) => r.status && !/^active/.test(r.status)).length }, projects: rows };
}

// state: 'no-cli' · 'signed-out' · 'error'; a failure keeps the last good snapshot, marked stale
export function failedAccount(state, message, nowMs, previous) {
  const out = { state, at: new Date(nowMs).toISOString(), error: str(message).slice(0, 300) };
  if (previous && previous.state === 'ok') return { ...previous, stale: true, staleReason: out.error || state, checkedAt: out.at };
  return out;
}

export const sidecar = (vercel, supabase) => ({ v: SIDECAR_V, vercel, supabase });
