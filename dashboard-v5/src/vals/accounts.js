// Projects › Vercel & Supabase render values: the connected-accounts snapshot
// (data/accounts.json via store.ACCOUNTS) — Vercel projects with their production and latest
// deploys, recent deploys, Supabase projects, or an honest "connect it" card per account.
import { AC_REFRESH_OFF } from '../logic/accounts.js';

const DEPLOY_ROWS = 10;

export function accountsVals(ctx) {
  const { S, H, sub } = ctx;
  const A = H.ACCOUNTS || { vercel: { state: 'none', totals: {}, projects: [], deploys: [] }, supabase: { state: 'none', totals: {}, projects: [] } };
  const V = A.vercel, B = A.supabase;
  const link = (url) => (url ? () => this.openAccountLink(url) : null);
  const why = (name, a, login, install) => ({
    none: 'No ' + name + ' snapshot yet. Refresh reads it through the ' + name + ' CLI — read-only.',
    'no-cli': 'The ' + name + ' CLI isn’t installed. ' + install + ', then run ' + login + ' and Refresh.',
    'signed-out': 'Not signed in to ' + name + '. Run ' + login + ' in a terminal, then Refresh.',
    error: name + ' couldn’t be read' + (a.error ? ' · ' + a.error : '') + '. Refresh to try again.',
  }[a.state] || '');
  const depRow = (d) => (d ? { ...d, open: link(d.url), copy: () => this.copy(d.url, 'Copied · ' + d.url), meta: [d.project, d.target, d.branch, d.when].filter(Boolean).join(' · ') } : null);
  const canRefresh = this.canAccountsRefresh();
  const vOk = V.state === 'ok', bOk = B.state === 'ok';
  return {
    isAccounts: sub === 'accounts',
    acRefresh: () => this.accountsRefresh(), acRefreshLabel: S.acBusy ? 'Refreshing…' : '↻ Refresh', acRefreshOff: !!S.acBusy || !canRefresh,
    acRefreshTip: canRefresh ? 'Re-read Vercel and Supabase (read-only, through their CLIs)' : AC_REFRESH_OFF,
    // Vercel
    vcOk: vOk, vcNotOk: !vOk, vcWhy: why('Vercel', V, 'vercel login', 'Install it with npm i -g vercel'),
    vcHead: vOk ? [V.user ? '@' + V.user : '', 'read ' + (V.when || 'just now')].filter(Boolean).join(' · ') : '',
    vcStale: vOk && V.stale, vcStaleText: 'Last refresh failed' + (V.staleReason ? ' · ' + V.staleReason : '') + ' — showing the snapshot from ' + (V.when || 'earlier'),
    vcStats: vOk ? [
      { k: 'Projects', v: String(V.totals.projects), color: 'var(--text)' },
      { k: 'Failing in production', v: String(V.totals.prodFailing), color: V.totals.prodFailing ? 'var(--red)' : 'var(--green)' },
      { k: 'Building now', v: String(V.totals.building), color: V.totals.building ? 'var(--blue)' : 'var(--text)' },
    ] : [],
    vcProjects: V.projects.map((p) => ({ ...p, prodRow: depRow(p.prod), hasProd: !!p.prod, noProd: !p.prod, latestRow: depRow(p.latest),
      latestDiffers: !!(p.latest && (!p.prod || p.latest.url !== p.prod.url)), sub: [p.framework, p.repo ? 'GitHub ' + p.repo : 'no Git link'].filter(Boolean).join(' · '),
      openDash: link(p.dashboard), hasDash: !!p.dashboard })),
    vcNoProjects: vOk && V.projects.length === 0,
    vcDeploys: V.deploys.slice(0, DEPLOY_ROWS).map(depRow), vcHasDeploys: vOk && V.deploys.length > 0,
    // Supabase
    sbOk: bOk, sbNotOk: !bOk, sbWhy: why('Supabase', B, 'supabase login', 'Install it (supabase.com/docs/guides/cli)'),
    sbHead: bOk ? 'read ' + (B.when || 'just now') : '',
    sbStale: bOk && B.stale, sbStaleText: 'Last refresh failed' + (B.staleReason ? ' · ' + B.staleReason : '') + ' — showing the snapshot from ' + (B.when || 'earlier'),
    sbProjects: B.projects.map((p) => ({ ...p, color: p.ok ? 'var(--green)' : 'var(--orange)', open: link(p.dashboard), hasDash: !!p.dashboard })),
    sbNoProjects: bOk && B.projects.length === 0,
  };
}
