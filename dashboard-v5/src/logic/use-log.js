// Usage marks (hq.use) and the Reach rows' loader. Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// useMark(surface, action = 'open')  tells main a surface was used (hq:use → one 'use' line in the day log; allowlisted ids only, see
//   dashboard/use-log.js). It sends AT MOST ONCE per arrival on a screen, and does nothing where hq.use is absent (a browser tab, an old
//   preload, a test rig). Call it from the vals of a surface ONLY inside that surface's own visibility guard (vals run for every tab on every
//   render), e.g. `if (S.tab === 'home' && live) this.useMark('brief-panel')`.
// useArrive()  — call from the navigation `moved` branch (src/app.js componentDidUpdate): a new screen starts a new arrival, so a surface
//   marked on Home is marked again after the owner leaves and comes back. useMark also notices a screen change by itself, so the order of
//   render and didUpdate does not matter (no double send).
//
// Reach (Settings): rchEnsure() loads the rows once per opening of Settings, rchLoad() reads hq.reach.read(), rchCopy(text) copies a command.
// State keys are rch-prefixed: rchRows, rchAt, rchBusy, rchError.
const screenKey = (self) => {
  const S = self.state || {};
  return JSON.stringify([S.tab || '', S.route || null, (S.sub && S.tab && S.sub[S.tab]) || '']);
};

export const useLogLogic = {
  _useSync() {
    const key = screenKey(this);
    if (this._useScreen !== key) { this._useScreen = key; this._useSeen = new Set(); }
    return this._useSeen || (this._useSeen = new Set());
  },
  useMark(surface, action = 'open') {
    const send = this.hq && this.hq.use;
    if (typeof send !== 'function') return false;          // nothing to send to: not marked either, so a later bridge still counts the arrival
    const seen = this._useSync();
    const id = surface + '/' + action;
    if (seen.has(id)) return false;
    seen.add(id);
    try {
      const r = send.call(this.hq, surface, action);
      if (r && typeof r.catch === 'function') r.catch(() => {});   // a usage mark never raises anything at the owner
    } catch { /* same */ }
    return true;
  },
  useArrive() { this._useSync(); },

  rchEnsure() {
    if (this._rchAsked) return;
    this._rchAsked = true;
    this.useMark('reach', 'open');
    setTimeout(() => this.rchLoad(), 0);                    // never set state while rendering
  },
  rchRearm() { this._rchAsked = false; },                   // Settings closed: the next opening reads fresh rows
  async rchLoad() {
    const api = this.hq && this.hq.reach;
    if (!api || typeof api.read !== 'function' || this._rchBusy) return false;
    this._rchBusy = true;
    this.setState({ rchBusy: true });
    try {
      const r = await api.read();
      if (!r || r.error || !Array.isArray(r.rows)) this.setState({ rchError: (r && r.error) || 'no answer', rchBusy: false });
      else this.setState({ rchRows: r.rows, rchAt: r.at || null, rchError: '', rchBusy: false });
      return true;
    } catch (e) {
      this.setState({ rchError: String((e && e.message) || e).slice(0, 200), rchBusy: false });
      return false;
    } finally { this._rchBusy = false; }
  },
  rchCopy(text) {
    this.copy(text, 'Copied');
    this.useMark('reach', 'copy');
  },
};
