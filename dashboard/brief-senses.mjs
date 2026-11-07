// Operator Brief senses (spec: the Brief sees CI, deploys, pull requests and the session you left). PURE: no IO, no clock,
// no LLM — every function gets `now` (ms) and its data through ctx, so the same inputs always give the same items.
//
// brief-core.mjs registers SENSE_RULES in its RULES list and calls SENSE_FNS[rule](ctx) exactly like its own rule
// functions: (ctx) → item fields | null. An item here is { key, severity, text, why, source, age, action, others }
// where `others` is the "and N more" number (brief-core copies it to the item's additive `count` field).
//
// ctx fields read (all optional; absent = that rule is silent):
//   now        ms
//   github     data/github.json                       { state, at, partial, repos[], waiting[] }
//   vercel     data/accounts.json › vercel            { state, at, partial, projects[] }
//   pcDetail   { scannedAt, rebootPending }           (from data/pc-health.json › scanned_at / detail.rebootPending)
//   money      the money view                          { hasAccounts, accounts[] }
//   projects   the scan's projects                     [{ id, name, path, metrics.git_safety.dirty }]
//   scanMs     the latest scan's time, ms
//   docsRoot   absolute folder that relative scan paths hang off (omit: only the Hub's project link can match)
//   sessions   Claude Code sessions of the last day    [{ id, projectId, hqProjectId, cwd, lastAt }]
//   hubProjects the Hub's code projects                [{ id, path, hqProjectId, linkState }]
//   sessionTurns { [sessionId]: [{ toolName }] }       the last turns of sessions that matched a dirty project
// Names reach the copy (this is the main window); chat titles never do.

export const SENSE_RULES = ['prod-deploy-error', 'ci-red', 'session-left-dirty', 'review-waiting', 'reboot-pending', 'money-empty'];

const H = 3600e3, D = 24 * H;
export const SIDECAR_MAX_MS = 72 * H;      // older than this: silent + an errors[] entry
export const CI_RECENT_MS = 14 * D;        // a repo pushed longer ago than this keeps its red quietly
export const SESSION_ENDED_MS = 3 * 60e3;  // no activity for this long = the session ended
export const DIRTY_MIN = 10;               // uncommitted files that count without an edit call (mirrors brief-core)
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
export const TURNS_LIMIT = 8;              // how many of a session's last indexed turns brief-sources looks at
export const TURNS_FETCH_MAX = 3;          // sessions whose turns are fetched per compute

const arr = (x) => (Array.isArray(x) ? x : []);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const msOf = (t) => { const n = typeof t === 'string' ? Date.parse(t) : NaN; return Number.isFinite(n) ? n : null; };
const name = (s, fallback) => { const t = [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, 60).join('').trim(); return t || fallback; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const andMore = (n, what) => (n > 0 ? ' and ' + plural(n, 'more ' + what, 'more ' + what + 's') : '');
function ago(ms, now) {
  if (ms === null) return 'age unknown';
  const d = Math.max(0, now - ms);
  return d < H ? Math.max(1, Math.round(d / 60e3)) + ' min ago' : d < D ? Math.round(d / H) + ' h ago' : Math.floor(d / D) + ' d ago';
}

// ---- freshness -------------------------------------------------------------------------------------------------------
// { ok, problem }: absent (null/undefined) is silent with no problem; anything else unusable carries a short reason.
export function sidecarState(doc, now) {
  if (doc === null || doc === undefined) return { ok: false, problem: null, atMs: null };
  if (!isObj(doc)) return { ok: false, problem: 'is unreadable', atMs: null };
  const atMs = msOf(doc.at !== undefined ? doc.at : doc.scannedAt !== undefined ? doc.scannedAt : doc.scanned_at);
  if (doc.state !== undefined && doc.state !== 'ok') return { ok: false, problem: 'is not in state ok', atMs };
  if (doc.partial === true) return { ok: false, problem: 'is partial', atMs };
  if (atMs === null) return { ok: false, problem: 'has no timestamp', atMs };
  if (num(now) - atMs > SIDECAR_MAX_MS) return { ok: false, problem: 'is older than 72 h', atMs };
  return { ok: true, problem: null, atMs };
}
// the errors[] entry for a sidecar the brief had to skip (null when it is fine or simply absent)
export function sidecarError(source, label, doc, now) {
  const s = sidecarState(doc, now);
  return s.problem ? { source, error: label + ' ' + s.problem + ' — its checks were skipped' } : null;
}

// ---- session matching ------------------------------------------------------------------------------------------------
const normPath = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const isAbs = (p) => /^[a-z]:\//i.test(p) || p.startsWith('/');
function projectPath(p, docsRoot) {
  const raw = normPath(isObj(p) ? p.path : '');
  if (!raw) return null;
  if (isAbs(raw)) return raw;
  const root = normPath(docsRoot);
  return root && isAbs(root) ? root + '/' + raw.replace(/^\.?\//, '') : null;
}
const underPath = (cwd, base) => !!cwd && !!base && (cwd === base || cwd.startsWith(base + '/'));

// the one scanned project a session belongs to, or null (no match / ambiguous)
function matchProject(session, ctx) {
  const projects = arr(ctx.projects).filter(isObj);
  const hubP = arr(ctx.hubProjects).find((h) => isObj(h) && h.id === session.projectId);
  const linked = hubP && (hubP.linkState === 'confirmed' || hubP.linkState === 'auto') ? (hubP.hqProjectId || session.hqProjectId) : null;
  if (linked) {
    const hit = projects.filter((p) => String(p.id) === String(linked));
    if (hit.length === 1) return hit[0];
    if (hit.length > 1) return null;
  }
  const cwd = normPath(session.cwd);
  const hits = projects.filter((p) => underPath(cwd, projectPath(p, ctx.docsRoot)));
  return hits.length === 1 ? hits[0] : null;
}
const dirtyOf = (p) => num(isObj(p) && isObj(p.metrics) && isObj(p.metrics.git_safety) ? p.metrics.git_safety.dirty : 0);
const idOf = (p) => String(p.id);

// One entry per scanned project whose most recent session ended before the latest scan:
//   [{ project, session, lastMs, dirty }]   — sessions that are still running, or ended after the scan, produce nothing.
// `need` marks the entries whose verdict hangs on the session's edit calls (1..DIRTY_MIN-1 files): those are the only
// ones brief-sources fetches turns for.
export function sessionCandidates(ctx) {
  const now = num(ctx && ctx.now), scanMs = isObj(ctx) && typeof ctx.scanMs === 'number' ? ctx.scanMs : null;
  if (scanMs === null) return [];
  const byProject = new Map();   // project id → { project, latest, running }
  for (const s of arr(ctx.sessions).filter(isObj)) {
    const lastMs = msOf(s.lastAt); if (lastMs === null) continue;
    const p = matchProject(s, ctx); if (!p) continue;
    const e = byProject.get(idOf(p)) || { project: p, session: null, lastMs: -1, running: false };
    if (now - lastMs <= SESSION_ENDED_MS) e.running = true;
    if (lastMs > e.lastMs) { e.session = s; e.lastMs = lastMs; }
    byProject.set(idOf(p), e);
  }
  const out = [];
  for (const e of byProject.values()) {
    if (e.running || !e.session || e.lastMs >= scanMs) continue;
    const dirty = dirtyOf(e.project);
    if (dirty < 1) continue;
    out.push({ project: e.project, session: e.session, lastMs: e.lastMs, dirty, need: dirty < DIRTY_MIN });
  }
  return out.sort((a, b) => b.lastMs - a.lastMs);
}
const hasEdit = (turns) => arr(turns).slice(-TURNS_LIMIT).some((t) => isObj(t) && EDIT_TOOLS.includes(t.toolName));
function sessionHits(ctx) {
  return sessionCandidates(ctx).filter((c) => c.dirty >= DIRTY_MIN || hasEdit(isObj(ctx.sessionTurns) ? ctx.sessionTurns[c.session.id] : null));
}
// project ids the session rule names, so brief-core's low 'dirty' rule can skip them
export function sessionDirtyProjectIds(ctx) { try { return new Set(sessionHits(ctx).map((c) => idOf(c.project))); } catch { return new Set(); } }

// ---- the six rules ---------------------------------------------------------------------------------------------------
const go = (tab, sub) => ({ kind: 'go', tab, sub });

export const SENSE_FNS = {
  'prod-deploy-error': ({ vercel, now }) => {
    const st = sidecarState(vercel, now); if (!st.ok) return null;
    const bad = arr(vercel.projects).filter((p) => isObj(p) && isObj(p.prod) && typeof p.prod.state === 'string' && p.prod.state.trim().toLowerCase() === 'error');
    if (!bad.length) return null;
    const top = bad.reduce((a, b) => ((msOf(b.prod.at) || 0) > (msOf(a.prod.at) || 0) ? b : a));
    return { key: 'prod-deploy-error:' + name(top.name, 'project') + ':' + (top.prod.at || ''), severity: 'high',
      text: name(top.name, 'A project') + ' failed to deploy to production' + andMore(bad.length - 1, 'project'),
      why: 'The live site is still on the last good deploy — open the failed one and read its log.', source: 'vercel',
      age: 'accounts.json ' + ago(st.atMs, now), action: go('projects', 'accounts'), others: bad.length - 1 };
  },

  'ci-red': ({ github, now }) => {
    const st = sidecarState(github, now); if (!st.ok) return null;
    const hits = arr(github.repos).filter((r) => isObj(r) && r.ci === 'failure' && !r.archived && !r.fork
      && msOf(r.pushedAt) !== null && now - msOf(r.pushedAt) <= CI_RECENT_MS);
    if (!hits.length) return null;
    const top = hits.reduce((a, b) => (msOf(b.pushedAt) > msOf(a.pushedAt) ? b : a));
    return { key: 'ci-red:' + (top.full || top.name || '?') + ':' + top.pushedAt, severity: 'med',
      text: 'CI is failing on ' + name(top.name || top.full, 'a repo') + andMore(hits.length - 1, 'repo'),
      why: 'The last push to it did not pass its checks.', source: 'github', age: 'github.json ' + ago(st.atMs, now),
      action: go('projects', 'github'), others: hits.length - 1 };
  },

  'session-left-dirty': (ctx) => {
    const hits = sessionHits(ctx); if (!hits.length) return null;
    const top = hits.reduce((a, b) => (b.dirty > a.dirty || (b.dirty === a.dirty && b.lastMs > a.lastMs) ? b : a));
    const now = num(ctx.now);
    return { key: 'session-left-dirty:' + idOf(top.project) + ':' + top.session.lastAt, severity: 'med',
      text: name(top.project.name, idOf(top.project)) + ': your Claude session there ended ' + ago(top.lastMs, now) + '; the scan after it saw ' + plural(top.dirty, 'uncommitted file') + andMore(hits.length - 1, 'project'),
      why: 'Review what it changed, then commit or stash it.', source: 'claude-code', age: 'session ' + ago(top.lastMs, now),
      action: { kind: 'go', tab: 'projects', projectId: idOf(top.project) }, others: hits.length - 1 };
  },

  'review-waiting': ({ github, now }) => {
    const st = sidecarState(github, now); if (!st.ok) return null;
    const prs = arr(github.waiting).filter((w) => isObj(w) && w.draft !== true);
    if (!prs.length) return null;
    const newest = prs.map((w) => msOf(w.updatedAt)).filter((m) => m !== null).sort((a, b) => b - a)[0];
    return { key: 'review-waiting:' + (newest === undefined ? 'unknown' : new Date(newest).toISOString()), severity: 'low',
      text: prs.length === 1 ? 'A pull request is waiting on you' : prs.length + ' pull requests are waiting on you',
      why: 'Someone — or a bot — is waiting for your review.', source: 'github', age: 'github.json ' + ago(st.atMs, now),
      action: go('projects', 'github'), others: prs.length - 1 };
  },

  'reboot-pending': ({ pcDetail, now }) => {
    if (!isObj(pcDetail) || pcDetail.rebootPending !== true) return null;
    const st = sidecarState({ at: pcDetail.scannedAt }, now); if (!st.ok) return null;
    return { key: 'reboot-pending:' + new Date(st.atMs).toISOString().slice(0, 10), severity: 'low',
      text: 'This PC is waiting for a restart', why: 'Updates are installed but not applied until it restarts.', source: 'pc-health',
      age: 'pc-health ' + ago(st.atMs, now), action: go('system', 'machine'), others: 0 };
  },

  'money-empty': ({ money }) => {
    if (!isObj(money) || money.hasAccounts !== false || arr(money.accounts).length) return null;
    return { key: 'money-empty:never', severity: 'low', text: "Money isn't set up yet — one minute",
      why: 'Add an account and Money starts telling you your breathing room.', source: 'money', age: 'live',
      action: go('money', 'today'), others: 0 };
  },
};
