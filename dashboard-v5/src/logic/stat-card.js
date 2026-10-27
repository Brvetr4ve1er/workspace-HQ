// Save stat card PNG (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card): the renderer draws the card,
// hq.statCardSave asks main where to put it. The same measured stats feed the level-up card.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
import { FX } from './shared.js';
import { drawStatCard, CARD_W, CARD_H, CARD_FONT } from './stat-card-draw.mjs';

export const statCardLogic = {
  // the measured numbers both the level-up card and the PNG show
  statCardStats() {
    const snap = this.M.at(0), wk = this.span(7, 0), uncThen = this.series('unc', wk[0]), unc = this.series('unc', 0);
    return [['Tasks done (all time)', String(snap.doneTasks.length + this.state.completed.length)], ['Commits, last ' + wk.length + ' scans', String(this.sum(wk, (o) => this.series('commits', o)))],
      ['Scan streak', snap.account.streak + (snap.account.streak === 1 ? ' day' : ' days')], ['Uncommitted, then → now', uncThen + ' → ' + unc]].map((s) => ({ k: s[0], v: s[1] }));
  },
  async exportStatCard() {
    if (!this.hq || !this.hq.statCardSave) return this.denied('Needs the live app — saving a file is unavailable in this preview');
    if (this.state.statCardSaving) return;
    this.setState({ statCardSaving: true });
    let r;
    try {
      const L = this.state.levelUp || this.M.levelOf(this.state.xp);
      try { await document.fonts.load('700 64px ' + CARD_FONT); await document.fonts.load('400 26px ' + CARD_FONT); } catch (e) { /* falls back to the system mono */ }
      const c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H;
      drawStatCard(c.getContext('2d'), { level: L.l, title: L.t, stats: this.statCardStats(), date: this.M.fmtD(new Date()) });
      r = await this.hq.statCardSave(c.toDataURL('image/png'));
    } catch (e) { r = { error: String((e && e.message) || e) }; }
    this.setState({ statCardSaving: false });
    if (r && r.canceled) return;
    if (!r || !r.ok) { this.toast('error', 'Stat card not saved · ' + ((r && r.error) || 'no answer')); FX().sfx('error'); return; }
    this.toast('success', 'Stat card saved · ' + r.path); FX().sfx('done');
  },
};
