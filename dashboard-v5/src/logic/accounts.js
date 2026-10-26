// Projects › Vercel & Supabase actions (IPC-CONTRACT 2026-10-26 Connected accounts).
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State keys (K-4: app.js declares initial state; an undefined key is its default here):
//   acBusy     true while hq.accountsRefresh() runs (Refresh → "Refreshing…")
import { FX } from './shared.js';

export const AC_REFRESH_OFF = 'Needs the live app — refreshing accounts is unavailable in this preview';
export const AC_OPEN_OFF = 'Needs the live app — opening Vercel / Supabase is unavailable in this preview';

export const accountsLogic = {
  canAccountsRefresh() { return !!(this.hq && this.hq.accountsRefresh) && this.ps() !== 'nobridge'; },

  // main re-reads both accounts through the owner's own CLI logins and answers the sidecar
  async accountsRefresh() {
    if (this.state.acBusy) return;
    if (!this.canAccountsRefresh()) return this.denied(AC_REFRESH_OFF);
    this.setState({ acBusy: true });
    const r = await this.call(() => this.hq.accountsRefresh(), 'Accounts refresh failed');
    this.setState({ acBusy: false });
    if (!r || !this.store.refreshAccounts(r)) return;
    const say = (name, a) => (a.state === 'ok' ? (a.stale ? name + ' failed (last snapshot kept)' : name + ' ✓') : name + ' · ' + (a.error || a.state));
    const bad = r.vercel.state !== 'ok' || r.vercel.stale;
    this.toast(bad ? 'error' : 'success', say('Vercel', r.vercel) + ' · ' + say('Supabase', r.supabase), { ms: 6000 });
    if (bad) FX().sfx('error');
  },

  // main opens only a Vercel / Supabase link listed in the current snapshot (hq:accounts-open)
  async openAccountLink(url) {
    if (!(this.hq && this.hq.accountsOpen) || this.ps() === 'nobridge') return this.denied(AC_OPEN_OFF);
    await this.call(() => this.hq.accountsOpen(url), 'Couldn’t open that link');
  },
};
