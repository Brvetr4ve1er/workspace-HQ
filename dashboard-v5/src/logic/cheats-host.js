// Cheat codes, renderer side (batch 7): the ONE permanent keydown listener, what a fired code does to the app, and the timing overlay's
// bookkeeping. Component.prototype mixin (src/app.js): same `this` as the class methods. The registry itself (codes, matching, what each
// effect decides) is logic/cheats.mjs and is pure; this file only listens and applies.
//
//   LISTENER MODEL: cheatsMount() registers a plain keydown listener on window ONCE, at mount, and cheatsUnmount() removes it. It is the
//   old hq-fx.js listener moved here (it is NOT layer cost: the layer's probe counts only what console-layer.mjs registers). There is
//   never a second one, so switching the layer on or off at runtime cannot double-fire a code or split a tail. Which codes are armed is
//   decided per key press from consoleLayer.on (armedFor), not by adding or removing listeners.
//   TWO TAILS: the legacy eggs ('bit', 'dance' / ArrowUp twice) go through their own matcher with the old semantics, every new code through
//   the strict one. Both are fed every key press.
//   EFFECTS (cheats.mjs runCheat decides, this applies): the consoleLayer patch through setState, one honest toast per new code, the legacy
//   eggs through HQFx.egg(id), and the code's id into state.cheatsFound (ids only; the prefs list saves it).
//   TIMING OVERLAY: only while consoleLayer.on && consoleLayer.debug. Then, and only then, renderVals is wrapped (start of a render) and
//   componentDidUpdate calls cheatsAfterRender() (end of it), pushing the duration into a 30-sample ring. Off = no wrapper, no ring, no
//   store subscription, nothing: cheatsAfterRender() is two property reads.
// Nothing here sets state while rendering, and nothing here uses a timer or a frame.
import { FX } from './shared.js';
import { createMatcher, createLegacyMatcher, runCheat, normaliseFound } from './cheats.mjs';
import { createRing } from './debug-ring.mjs';

const layerOf = (S) => (S && S.consoleLayer && typeof S.consoleLayer === 'object' ? S.consoleLayer : {});
const clock = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());

export const cheatsLogic = {
  /** Register the one permanent keydown listener (idempotent). Call once from componentDidMount. */
  cheatsMount() {
    if (this._chtKeyFn) return;
    this._chtLegacy = createLegacyMatcher();
    this._chtStrict = createMatcher();
    this._chtKeyFn = (e) => this.cheatKey(e);
    window.addEventListener('keydown', this._chtKeyFn);
    this.cheatsDebugSync();
  },

  /** Remove it and everything the overlay needs. Call from componentWillUnmount. */
  cheatsUnmount() {
    if (this._chtKeyFn) { window.removeEventListener('keydown', this._chtKeyFn); this._chtKeyFn = null; }
    this._chtDebugOff();
  },

  /** One key press: both tails are fed; each may fire one code. */
  cheatKey(e) {
    if (!e) return;
    const legacy = this._chtLegacy || (this._chtLegacy = createLegacyMatcher());
    const strict = this._chtStrict || (this._chtStrict = createMatcher());
    const hitLegacy = legacy.feed(e.key, e.target);
    if (hitLegacy) this.cheatsApply(hitLegacy.id);
    const layerOn = !!layerOf(this.state).on;
    const hit = strict.feed(e, e.target, strict.armedFor(layerOn));
    if (hit) this.cheatsApply(hit.id);
  },

  /** Apply one code by id (also what a test or a scenario calls to fire one without typing). */
  cheatsApply(id) {
    const S = this.state || {};
    const L = layerOf(S);
    const r = runCheat(id, { layerOn: !!L.on, skin: !!L.skin, palette: L.palette || '', debug: !!L.debug, found: S.cheatsFound });
    if (r.ok) {
      const patch = r.patch || {};
      const next = {};
      if (Object.keys(patch).length) next.consoleLayer = Object.assign({}, L, patch);   // a code that changes no setting never writes the layer pref
      if (r.newlyFound) next.cheatsFound = r.found;
      if (Object.keys(next).length) this.setState(next);
    }
    if (r.toast) this.toast(r.toast.kind, r.toast.text);
    if (r.ok && r.effect === 'room-open' && typeof this.dlxOpenRoom === 'function') this.dlxOpenRoom();   // small delights: the back room (needs the layer on; records its name itself)
    if (r.egg) { const fx = FX(); if (fx && typeof fx.egg === 'function') fx.egg(r.egg); }
    return r;
  },

  /** The saved list of found ids, cleaned (never throws on garbage). */
  cheatsFoundIds() { return normaliseFound((this.state || {}).cheatsFound); },

  /** First line of componentDidUpdate: end the timing of the render that just finished, then follow the debug flag. */
  cheatsAfterRender() {
    if (this._chtRing && this._chtT0 != null) { this._chtRing.push(clock() - this._chtT0, Date.now()); this._chtT0 = null; }
    this.cheatsDebugSync();
  },

  /** Install or drop the timing wrapper so it matches consoleLayer.on && consoleLayer.debug. Cheap when nothing changed. */
  cheatsDebugSync() {
    const L = layerOf(this.state);
    const want = !!(L.on && L.debug);
    if (want === !!this._chtRing) return;
    if (want) this._chtDebugOn(); else this._chtDebugOff();
  },

  _chtDebugOn() {
    this._chtRing = createRing();
    this._chtT0 = null; this._chtKeys = null; this._chtEmitAt = null;
    const own = Object.prototype.hasOwnProperty.call(this, 'renderVals');
    const orig = this.renderVals;
    this._chtWrap = { own, orig };
    const host = this;
    this.renderVals = function () {
      host._chtT0 = clock();
      const v = orig.apply(this, arguments);
      host._chtKeys = v && typeof v === 'object' ? Object.keys(v).length : null;
      return v;
    };
    if (this.store && typeof this.store.on === 'function') {
      try { this._chtOffStore = this.store.on(() => { this._chtEmitAt = Date.now(); }); } catch (e) { this._chtOffStore = null; }
    }
    if (typeof this.forceUpdate === 'function') this.forceUpdate();   // one more render so the first numbers appear (the wrapper was not in place for the one that opened the overlay)
  },

  _chtDebugOff() {
    const w = this._chtWrap;
    if (w) { if (w.own) this.renderVals = w.orig; else delete this.renderVals; }
    if (typeof this._chtOffStore === 'function') { try { this._chtOffStore(); } catch (e) { /* already gone */ } }
    this._chtWrap = null; this._chtOffStore = null; this._chtRing = null; this._chtT0 = null; this._chtKeys = null; this._chtEmitAt = null;
  },

  /** What the overlay shows, or null while it is off: { count, last, p50, p95, perMin, keys, emitAt, now }. Read-only; safe in a render. */
  cheatsDebugStats() {
    if (!this._chtRing) return null;
    const now = Date.now();
    return Object.assign(this._chtRing.stats(now), { keys: this._chtKeys == null ? null : this._chtKeys, emitAt: this._chtEmitAt == null ? null : this._chtEmitAt, now });
  },

  /** For the selftest and the scenarios: put invented durations into the ring (installs it when the flag is on). */
  cheatsSeedRing(samples, atMs) {
    this.cheatsDebugSync();
    if (!this._chtRing) return false;
    const at = Number.isFinite(atMs) ? atMs : Date.now();
    for (const ms of samples || []) this._chtRing.push(ms, at);
    return true;
  },

  /** The overlay's own close button: the flag goes off, the next update removes the wrapper and the ring. */
  cheatsCloseOverlay() {
    const L = layerOf(this.state);
    this.setState({ consoleLayer: Object.assign({}, L, { debug: false }) });
    return true;
  },
};
