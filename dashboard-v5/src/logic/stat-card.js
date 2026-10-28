// The measured numbers the level-up card shows. (The stat card PNG export that also used them was
// removed in the 2026-10-28 cleanup; restore it from tag cleanup-base-2026-10-28.)
// Component.prototype mixin (src/app.js): same `this` as the class methods.

export const statCardLogic = {
  statCardStats() {
    const snap = this.M.at(0), wk = this.span(7, 0), uncThen = this.series('unc', wk[0]), unc = this.series('unc', 0);
    return [['Tasks done (all time)', String(snap.doneTasks.length + this.state.completed.length)], ['Commits, last ' + wk.length + ' scans', String(this.sum(wk, (o) => this.series('commits', o)))],
      ['Scan streak', snap.account.streak + (snap.account.streak === 1 ? ' day' : ' days')], ['Uncommitted, then → now', uncThen + ' → ' + unc]].map((s) => ({ k: s[0], v: s[1] }));
  },
};
