// Projects › GitHub render values: the account snapshot (data/github.json via store.GITHUB),
// what waits on the owner, their own PRs, and every repo with CI and where it is cloned.
import { GH_FILTERS, GH_REFRESH_OFF } from '../logic/github.js';

const GH_ROWS = 12;   // waiting / mine / issues rows shown; the count says how many more

export function githubVals(ctx) {
  const { S, H, sub, tabStyle } = ctx;
  const G = H.GITHUB || { state: 'none', totals: {}, repos: [], waiting: [], mine: [], issues: [] };
  const ok = G.state === 'ok', T = G.totals || {};
  const f = GH_FILTERS.some(([id]) => id === S.ghFilter) ? S.ghFilter : 'all';
  const keep = { all: () => true, failing: (r) => r.ciBad, open: (r) => r.prs > 0, local: (r) => r.cloned, remote: (r) => !r.cloned }[f];
  const live = G.repos.filter((r) => !r.archived);
  const counted = { all: live.length, failing: live.filter((r) => r.ciBad).length, open: live.filter((r) => r.prs > 0).length, local: live.filter((r) => r.cloned).length, remote: live.filter((r) => !r.cloned).length };
  const tags = (r) => [r.private ? 'private' : '', r.fork ? 'fork' : '', r.lang].filter(Boolean).join(' · ');
  const repoRow = (r) => ({ ...r, tags: tags(r), where: r.cloned ? 'Cloned · ' + r.local : 'Not cloned on this PC', whereColor: r.cloned ? 'var(--muted)' : 'var(--faint)',
    counts: [r.prs ? r.prs + ' open PR' + (r.prs === 1 ? '' : 's') : '', r.issues ? r.issues + ' issue' + (r.issues === 1 ? '' : 's') : '', r.stars ? '★ ' + r.stars : ''].filter(Boolean).join(' · '),
    open: () => this.openGithub(r.url), copy: () => this.copy(r.url, 'Copied · ' + r.url) });
  const rows = (list) => list.slice(0, GH_ROWS).map((p) => ({ ...p, meta: [p.repo, p.num, p.who ? 'by ' + p.who : '', p.when].filter(Boolean).join(' · '),
    tag: p.draft ? p.kind + ' · draft' : p.kind, open: () => this.openGithub(p.url), copy: () => this.copy(p.url, 'Copied · ' + p.url) }));
  const more = (list) => (list.length > GH_ROWS ? '+' + (list.length - GH_ROWS) + ' more on GitHub' : '');
  const canRefresh = this.canGithubRefresh();
  // what the account card says when there is no usable snapshot
  const why = { none: 'No GitHub snapshot yet. Refresh reads your account through the GitHub CLI (gh) — read-only.',
    'signed-out': 'Not signed in to GitHub. Run gh auth login in a terminal, then Refresh.',
    'no-gh': 'The GitHub CLI (gh) isn’t installed. Install it from cli.github.com, run gh auth login, then Refresh.',
    error: 'GitHub couldn’t be read' + (G.error ? ' · ' + G.error : '') + '. Refresh to try again.' }[G.state] || '';
  return {
    isGithub: sub === 'github', ghOk: ok, ghNotOk: !ok, ghWhy: why,
    ghLogin: G.login ? '@' + G.login : '', ghWhen: ok ? 'Read ' + (G.when || 'just now') : '',
    ghStale: ok && G.stale, ghStaleText: 'Last refresh failed' + (G.staleReason ? ' · ' + G.staleReason : '') + ' — showing the snapshot from ' + (G.when || 'earlier'),
    ghPartial: ok && G.partial, ghPartialText: 'Pull requests and issues didn’t load this time — the repo list is current. Refresh to try again.',
    ghRefresh: () => this.githubRefresh(), ghRefreshLabel: S.ghBusy ? 'Refreshing…' : '↻ Refresh', ghRefreshOff: !!S.ghBusy || !canRefresh, ghRefreshTip: canRefresh ? 'Re-read your GitHub account (read-only, through gh)' : GH_REFRESH_OFF,
    ghStats: ok ? [
      { k: 'Repos', v: String(T.repos) + (T.private ? ' · ' + T.private + ' private' : ''), color: 'var(--text)' },
      { k: 'Waiting on you', v: T.waiting == null ? '—' : String(T.waiting), color: T.waiting ? 'var(--orange)' : 'var(--text)' },
      { k: 'CI failing', v: String(T.ciFailing), color: T.ciFailing ? 'var(--red)' : 'var(--green)' },
      { k: 'Open PRs', v: String(T.openPrs), color: 'var(--text)' },
      { k: 'Cloned here', v: T.cloned + ' / ' + live.length, color: 'var(--text)' },
    ] : [],
    ghWaiting: rows(G.waiting), ghHasWaiting: ok && G.waiting.length > 0, ghWaitingMore: more(G.waiting),
    ghNoWaiting: ok && !G.partial && G.waiting.length === 0,
    ghMine: rows(G.mine), ghHasMine: ok && G.mine.length > 0, ghMineMore: more(G.mine),
    ghIssues: rows(G.issues), ghHasIssues: ok && G.issues.length > 0, ghIssuesMore: more(G.issues),
    ghFilters: GH_FILTERS.map(([id, label]) => ({ label: label + ' · ' + counted[id], go: () => this.setGhFilter(id), style: tabStyle(f === id) })),
    ghRepos: live.filter(keep).map(repoRow), ghNoRepoMatch: ok && live.length > 0 && !live.some(keep),
    ghArchivedNote: T.archived ? T.archived + ' archived repo' + (T.archived === 1 ? '' : 's') + ' not listed' : '', ghHasArchived: ok && T.archived > 0,
  };
}
