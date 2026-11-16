// The Brief panel heading Home: act on an item (navigate or scan) and dismiss one (spec
// docs/superpowers/specs/2026-11-05-operator-design.md). The ranking itself is main-side (dashboard/brief-core.mjs);
// the panel never decides what matters, it only shows and clears what main computed.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
export const briefLogic = {
  // one action per item: go somewhere in the app, or start a scan. Nothing here acts outside the app.
  brfAct(action) {
    if (!action || typeof action !== 'object') return;
    if (action.kind === 'scan') { this._brfMark(); return this.scanNow(); }
    if (action.kind === 'go') { this._brfMark(); return action.projectId ? this.openProject(action.projectId) : this.go(action.tab, action.sub); }
  },
  // act marks (batch 6): a row button (go or scan) is one; Dismiss is not (batch 8) ('brief-panel','act'); a mark never blocks or fails the click
  _brfMark() { try { if (typeof this.useMark === 'function') this.useMark('brief-panel', 'act'); } catch { /* a usage mark is a bonus */ } },
  async brfDismiss(key) {
    if (this._brfBusy) return false;   // double click while the dismiss is in flight: one write, not two
    this._brfBusy = true;
    this.setState({ brfBusy: true });   // the field above is the guard; this mirror greys the buttons out
    try {
      const r = await this.store.dismissBrief(key);
      if (r && r.error) { this.toast('error', 'Not dismissed · ' + r.error); return false; }
      return true;   // Dismiss sets a row aside: it is not an effect, so it sends no act mark (batch 8)
    } catch (e) {
      this.toast('error', 'Not dismissed · ' + ((e && e.message) || e));
      return false;
    } finally { this._brfBusy = false; this.setState({ brfBusy: false }); }
  },
};
