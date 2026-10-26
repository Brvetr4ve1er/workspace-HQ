// GITHUB shaping — pure. Turns the raw GraphQL answers that collector/github.mjs fetches
// through the owner's own `gh` login into the data/github.json sidecar (CONTRACT 2026-10-26):
// every repo the account owns (private included) with CI + open PR/issue counts, the pull
// requests and issues that wait on the owner, the owner's own open PRs, and which repos are
// cloned on this machine. No I/O, no login hard-coded: the viewer login comes from the answer.

export const SIDECAR_V = 1;
export const MAX_AGE_MS = 10 * 60e3; // a scan reuses a snapshot younger than this (search budget is 30/min)
export const LIST_MAX = 30;          // rows per list; the counts stay exact

// one call: the viewer, every repo they own (newest push first) with default-branch CI
export const REPOS_QUERY = `query{viewer{login repositories(first:100,ownerAffiliations:OWNER,orderBy:{field:PUSHED_AT,direction:DESC}){totalCount nodes{nameWithOwner name url isPrivate isFork isArchived pushedAt stargazerCount forkCount description primaryLanguage{name} issues(states:OPEN){totalCount} pullRequests(states:OPEN){totalCount} defaultBranchRef{name target{... on Commit{committedDate messageHeadline statusCheckRollup{state}}}}}}}}`;

const PR_FIELDS = `... on PullRequest{number title url updatedAt isDraft repository{nameWithOwner} author{login} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}`;
const ISSUE_FIELDS = `... on Issue{number title url updatedAt repository{nameWithOwner} author{login}}`;

// one call: the four lists, each a GitHub search scoped to the viewer's login
export function searchQuery(login) {
  const s = (alias, q, fields) => `${alias}:search(query:${JSON.stringify(q)},type:ISSUE,first:${LIST_MAX}){issueCount nodes{${fields}}}`;
  return `query{${[
    s('review', `is:pr is:open archived:false review-requested:${login}`, PR_FIELDS),
    s('assigned', `is:pr is:open archived:false assignee:${login}`, PR_FIELDS),
    s('onMine', `is:pr is:open archived:false user:${login} -author:${login}`, PR_FIELDS),
    s('authored', `is:pr is:open archived:false author:${login}`, PR_FIELDS),
    s('issues', `is:issue is:open archived:false assignee:${login}`, ISSUE_FIELDS),
  ].join(' ')}}`;
}

const str = (v) => (typeof v === 'string' ? v : '');
const int = (v) => (Number.isInteger(v) ? v : 0);
const nodes = (c) => (c && Array.isArray(c.nodes) ? c.nodes.filter((n) => n && typeof n === 'object') : []);
const ci = (rollup) => {
  const s = rollup && typeof rollup.state === 'string' ? rollup.state.toLowerCase() : '';
  return ['success', 'failure', 'error', 'pending', 'expected'].includes(s) ? (s === 'expected' ? 'pending' : s) : null;
};

// "https://github.com/a/b.git", "git@github.com:a/b.git", "ssh://git@github.com/a/b" → "a/b" (lower case); else null
export function normRemote(url) {
  const u = str(url).trim();
  const m = u.match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? (m[1] + '/' + m[2]).toLowerCase() : null;
}

function pr(n, kind) {
  const last = nodes(n.commits)[0];
  return { kind, repo: str(n.repository && n.repository.nameWithOwner), number: int(n.number), title: str(n.title), url: str(n.url),
    updatedAt: str(n.updatedAt), author: str(n.author && n.author.login), draft: !!n.isDraft, ci: ci(last && last.commit && last.commit.statusCheckRollup) };
}

const byNewest = (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);

// viewer = REPOS_QUERY data.viewer; search = searchQuery data (null when that call failed);
// clones = [{ path, remote }] for the git folders found on this machine
export function shape({ viewer, search, clones = [], nowMs, partial = false, errors = [] }) {
  const login = str(viewer && viewer.login);
  const local = new Map();
  for (const c of Array.isArray(clones) ? clones : []) {
    const key = c && normRemote(c.remote);
    if (key && !local.has(key)) local.set(key, str(c.path));
  }
  const repos = nodes(viewer && viewer.repositories).map((n) => {
    const head = n.defaultBranchRef && n.defaultBranchRef.target;
    const full = str(n.nameWithOwner);
    return { full, name: str(n.name), url: str(n.url), private: !!n.isPrivate, fork: !!n.isFork, archived: !!n.isArchived,
      pushedAt: str(n.pushedAt), stars: int(n.stargazerCount), forks: int(n.forkCount), desc: str(n.description),
      lang: str(n.primaryLanguage && n.primaryLanguage.name), openPrs: int(n.pullRequests && n.pullRequests.totalCount),
      openIssues: int(n.issues && n.issues.totalCount), branch: str(n.defaultBranchRef && n.defaultBranchRef.name),
      lastCommit: head ? { at: str(head.committedDate), title: str(head.messageHeadline) } : null,
      ci: ci(head && head.statusCheckRollup), local: local.get(full.toLowerCase()) || null };
  });
  // a PR that is both review-requested and assigned is listed once, as the stronger ask
  const seen = new Set(), waiting = [];
  for (const [alias, kind] of [['review', 'review'], ['assigned', 'assigned'], ['onMine', 'on-your-repo']]) {
    for (const n of nodes(search && search[alias])) {
      const p = pr(n, kind), k = p.repo + '#' + p.number;
      if (!seen.has(k)) { seen.add(k); waiting.push(p); }
    }
  }
  waiting.sort(byNewest);
  // a PR already waiting on the owner (e.g. an agent's PR that asks them to review) isn't repeated as theirs
  const mine = nodes(search && search.authored).map((n) => pr(n, 'mine')).filter((p) => !seen.has(p.repo + '#' + p.number)).sort(byNewest);
  const issues = nodes(search && search.issues).map((n) => ({ repo: str(n.repository && n.repository.nameWithOwner), number: int(n.number),
    title: str(n.title), url: str(n.url), updatedAt: str(n.updatedAt), author: str(n.author && n.author.login) })).sort(byNewest);
  const live = repos.filter((r) => !r.archived);
  return {
    v: SIDECAR_V, state: 'ok', at: new Date(nowMs).toISOString(), login, partial: !!partial || !search, errors: errors.slice(0, 5),
    totals: {
      repos: int(viewer && viewer.repositories && viewer.repositories.totalCount) || repos.length,
      private: repos.filter((r) => r.private).length, archived: repos.length - live.length,
      stars: repos.reduce((s, r) => s + r.stars, 0), openPrs: live.reduce((s, r) => s + r.openPrs, 0),
      openIssues: live.reduce((s, r) => s + r.openIssues, 0), ciFailing: live.filter((r) => r.ci === 'failure' || r.ci === 'error').length,
      cloned: repos.filter((r) => r.local).length, waiting: search ? waiting.length : null,
    },
    repos, waiting, mine, issues,
  };
}

// state: 'no-gh' (GitHub CLI not installed) · 'signed-out' (gh auth login needed) · 'error'
export function failed(state, message, nowMs, previous) {
  const out = { v: SIDECAR_V, state, at: new Date(nowMs).toISOString(), error: str(message).slice(0, 300) };
  // a failed refresh keeps the last good snapshot visible, marked stale, instead of blanking the view
  if (previous && previous.state === 'ok') return { ...previous, stale: true, staleReason: out.error || state, checkedAt: out.at };
  return out;
}
