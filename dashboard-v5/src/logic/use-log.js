// Usage marks (hq.use) and the Reach rows' loader. Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// useMark(surface, action = 'open')  tells main a surface was used (hq:use → one 'use' line in the day log; allowlisted ids only, see
//   dashboard/use-log.js). It sends AT MOST ONCE per arrival on a screen, and does nothing where hq.use is absent (a browser tab, an old
//   preload, a test rig). Call it from the vals of a surface ONLY inside that surface's own visibility guard (vals run for every tab on every
//   render), e.g. `if (S.tab === 'home' && live) this.useMark('brief-panel')`.
// useSpace(tab)  marks 'space-<tab>' for an arrival ON A SPACE (src/app.js componentDidUpdate calls it when the tab changes, never for a move
//   between sub-views of the same space); a tab outside the nav ids is refused. Counts only: the Go palette orders typed-query ties by them.
// useArrive()  — call from the navigation `moved` branch (src/app.js componentDidUpdate): a new screen starts a new arrival, so a surface
//   marked on Home is marked again after the owner leaves and comes back. useMark also notices a screen change by itself, so the order of
//   render and didUpdate does not matter (no double send).
// An 'act' mark is one real click that took effect (batch 6, act marks): it is NOT deduped per arrival and does not wait for the window to be
//   seen (a click means someone is there), so ten Dismiss clicks are ten acts. main still caps the channel at 30 a minute. Opens are unchanged.
// A mark is counted only while the window can be SEEN (document.visibilityState === 'visible'): a window that loads hidden (--hidden, a login
//   item, the tray) or reloads after a scan with nobody there is not an arrival. A mark made while hidden waits and is sent on the first real
//   show, if the owner is still on the same screen. Without a document (a test rig) the page counts as visible.
//
// Reach (Settings): rchEnsure() loads the rows once per opening of Settings, rchLoad() reads hq.reach.read(), rchCopy(text) copies a command,
// rchAct(spec) runs a row's action button (batch 6).
// State keys are rch-prefixed: rchRows, rchAt, rchBusy, rchError.
import { NAV } from '../live/catalog.mjs';

// the spaces a 'space-<id>' mark may name: the nav's own ids (dashboard/use-log.js builds the same eleven from cast-modes.js; a parity test pins both)
const SPACE_MARKS = new Set(NAV.map((n) => n.id));

const screenKey = (self) => {
  const S = self.state || {};
  return JSON.stringify([S.tab || '', S.route || null, (S.sub && S.tab && S.sub[S.tab]) || '']);
};

const pageVisible = () => {
  try { return typeof document === 'undefined' || typeof document.visibilityState !== 'string' || document.visibilityState === 'visible'; } catch { return true; }
};

export const useLogLogic = {
  _useSync() {
    const key = screenKey(this);
    if (this._useScreen !== key) { this._useScreen = key; this._useSeen = new Set(); this._usePending = null; }
    return this._useSeen || (this._useSeen = new Set());
  },
  useMark(surface, action = 'open') {
    const send = this.hq && this.hq.use;
    if (typeof send !== 'function') return false;          // nothing to send to: not marked either, so a later bridge still counts the arrival
    if (action === 'act') return this._useSend(send, surface, action);   // every real click counts: no seen-set, no hidden-window wait
    const seen = this._useSync();
    const id = surface + '/' + action;
    if (seen.has(id)) return false;
    if (!pageVisible()) { this._useWait(id, surface, action); return false; }   // not seen yet: no mark, it waits for the first show
    seen.add(id);
    return this._useSend(send, surface, action);
  },
  _useSend(send, surface, action) {
    try {
      const r = send.call(this.hq, surface, action);
      if (r && typeof r.catch === 'function') r.catch(() => {});   // a usage mark never raises anything at the owner
    } catch { /* same */ }
    return true;
  },
  useArrive() { this._useSync(); },
  useSpace(tab) { return typeof tab === 'string' && SPACE_MARKS.has(tab) ? this.useMark('space-' + tab) : false; },
  _useWait(id, surface, action) {
    (this._usePending || (this._usePending = new Map())).set(id, [surface, action]);
    if (this._useListening || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    this._useListening = true;
    document.addEventListener('visibilitychange', () => {
      if (!pageVisible()) return;
      const waiting = this._usePending; this._usePending = null;
      if (waiting) for (const [sf, ac] of waiting.values()) this.useMark(sf, ac);   // _useSync inside drops them when the screen changed meanwhile
    });
  },

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
  // a Reach row's action button (vals/reach.js ACTIONS: { api, arg }): calls hq.reach[api](arg); a refused answer says why in a toast, a cancelled
  // dialog says nothing, and only an answer that took effect is an 'act' mark and a re-read of the rows
  async rchAct(spec) {
    const api = this.hq && this.hq.reach;
    const fn = spec && api && typeof api[spec.api] === 'function' ? api[spec.api] : null;
    if (!fn || this._rchActing) return false;
    this._rchActing = true;
    this.setState({ rchBusy: true });
    let r = null, threw = '';
    try { r = await fn.call(api, spec.arg); } catch (e) { threw = String((e && e.message) || e).slice(0, 200); }
    this._rchActing = false;
    this.setState({ rchBusy: false });
    const ok = !threw && !!r && !r.error && r.ok !== false;
    if (ok) {
      if (typeof r.note === 'string' && r.note) this.toast('success', r.note.slice(0, 160));
      else if (typeof r.folderName === 'string' && r.folderName) this.toast('success', 'Saved: ' + r.folderName.slice(0, 80));
      else if (typeof spec.done === 'string' && spec.done) this.toast('success', spec.done.slice(0, 160));
      try { this.useMark('reach', 'act'); } catch { /* a usage mark is a bonus */ }
      await this.rchLoad();
    } else if (threw || (r && r.error && !r.canceled)) this.toast('error', (threw || String(r.error)).slice(0, 160));
    else if (r && r.ok === false && typeof r.reason === 'string' && r.reason) this.toast('info', 'Nothing was sent · ' + r.reason.slice(0, 120));   // e.g. notifications are not supported on this PC: said, not a mark
    return ok;
  },
  rchCopy(text) {
    this.copy(text, 'Copied');
    this.useMark('reach', 'copy');
  },
};
