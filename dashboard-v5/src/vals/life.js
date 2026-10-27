// Life render values: screen time, notes / vaults. (Social moved to its own tab 2026-10-27: vals/social.js.)
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function lifeVals(ctx) {
  const { H, LIVE, sub, tabStyle } = ctx;
  // ---- life ----
  const sites = H.SITES.slice(0, 12).map((s) => ({ name: s[0], mins: s[1], label: (s[1] >= 60 ? Math.floor(s[1] / 60) + 'h ' : '') + (s[1] % 60) + 'm', w: Math.round(s[1] / Math.max(1, H.SITES[0] ? H.SITES[0][1] : 1) * 100), cat: s[2], color: s[2] === 'Project' ? 'var(--green)' : 'var(--blue)' }));
  const siteMins = this.sum(H.SITES, (s) => s[1]), otherMins = this.sum(H.SITES.filter((s) => s[2] !== 'Project'), (s) => s[1]);
  const lifeRanges = [['window', 'Last 3 days']].map(([id, l]) => ({ label: l, go: () => this.setState({ lifeRange: id }), style: tabStyle(true) }));
  const vaults = H.VAULTS.map((vv) => ({ name: vv.name, active: vv.active, stale: vv.stale, total: vv.total, aw: vv.total ? Math.round(vv.active / vv.total * 100) : 0, sw: vv.total ? Math.round(vv.stale / vv.total * 100) : 0, sync: vv.sync, open: () => this.lifeVaultOpen(vv.name, 'open'), search: () => this.lifeVaultOpen(vv.name, 'search') }));
  return {
    isScreen: sub === 'screen', isNotes: sub === 'notes', sites, hasSites: sites.length > 0, noSites: sites.length === 0, lifeRanges,
    screenTotal: Math.floor(siteMins / 60) + 'h ' + (siteMins % 60) + 'm', screenShare: siteMins ? Math.round(otherMins / siteMins * 100) + '%' : '—', screenShareLabel: 'on sites not linked to a project',
    vaults, learnings: H.LEARN.map((l) => ({ t: l[0], p: l[1], d: l[2] })),
  };
}
