// Projects › GitHub actions (IPC-CONTRACT 2026-10-26 GitHub view).
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State keys (K-4: app.js declares initial state; an undefined key is its default here):
//   ghBusy     true while hq.githubRefresh() runs (Refresh → "Refreshing…")
//   ghFilter   'all' | 'failing' | 'open' | 'local' | 'remote' — the repo list filter (GH_FILTERS)
import { FX } from './shared.js';

export const GH_REFRESH_OFF = 'Needs the live app — refreshing GitHub is unavailable in this preview';
export const GH_OPEN_OFF = 'Needs the live app — opening GitHub is unavailable in this preview';
export const GH_FILTERS = [['all', 'All'], ['failing', 'CI failing'], ['open', 'Has open PRs'], ['local', 'Cloned here'], ['remote', 'Not cloned']];

export const githubLogic = {
  canGithubRefresh() { return !!(this.hq && this.hq.githubRefresh) && this.ps() !== 'nobridge'; },

  // main re-reads the account through the owner's own gh login (a snapshot under a minute
  // old is reused) and answers the sidecar; {error} only when there is no snapshot at all
  async githubRefresh() {
    if (this.state.ghBusy) return;
    if (!this.canGithubRefresh()) return this.denied(GH_REFRESH_OFF);
    this.setState({ ghBusy: true });
    const r = await this.call(() => this.hq.githubRefresh(), 'GitHub refresh failed');
    this.setState({ ghBusy: false });
    if (!r || !this.store.refreshGithub(r)) return;
    if (r.state !== 'ok') { this.toast('error', 'GitHub · ' + (r.error || r.state), { ms: 6000 }); FX().sfx('error'); return; }
    if (r.stale) { this.toast('error', 'GitHub refresh failed · showing the last snapshot · ' + (r.staleReason || ''), { ms: 6000 }); return; }
    const t = r.totals || {};
    this.toast('success', 'GitHub refreshed · ' + (t.repos || 0) + ' repos' + (t.waiting ? ' · ' + t.waiting + ' waiting on you' : '') + (r.partial ? ' · pull requests not loaded' : ''));
  },

  // main opens only a github.com link listed in the current snapshot (hq:github-open)
  async openGithub(url) {
    if (!(this.hq && this.hq.githubOpen) || this.ps() === 'nobridge') return this.denied(GH_OPEN_OFF);
    await this.call(() => this.hq.githubOpen(url), 'Couldn’t open that link');
  },

  setGhFilter(f) { this.setState({ ghFilter: f }); },
};
