// "New version inserted": a 1.2 second card, shown once after an update (batch 7, dish version-card), never on an ordinary launch and never
// while the owner is reading. It belongs to the Console layer (opt-in): with the layer OFF it costs nothing, makes no node and no listener,
// and only writes down that this build's stamp was seen.
//
// Three parts, all here so the pure rule can be tested alone:
//   1. decide(inputs)              the rule, pure: 'skip-seen' | 'record' | 'suppress' | 'wait' | 'play'
//   2. createVersionCard(deps)     the small machine that runs the rule and owns the card's life; EVERY listener and timer goes through the
//                                  two functions it is given (deps.listen, deps.timer). It never touches the document itself.
//   3. versionCardLogic            the Component mixin (app.js adds it): wires the machine to the app's state, prefs and console-layer.mjs
//
// The rule, in this order:
//   seen equals stamp                      -> 'skip-seen'  (the card was already dealt with for this build)
//   layer OFF                              -> 'record'     (mark the stamp seen AT LOAD, whatever the visibility, with NO listener: this is what
//                                                           keeps an old version from replaying when the layer is switched on later)
//   reduced motion                         -> 'suppress'   (mark seen, show nothing)
//   page not visible (a --hidden launch loads hidden) or an overlay open
//                                          -> 'wait'       (only with the layer ON and the stamp unseen: ONE visibilitychange listener, through
//                                                           the layer, removed the moment a decision is made)
//   else                                   -> 'play'
// The stamp is marked seen the moment it plays, is recorded or is suppressed, so it plays at most once per stamp. A first-ever run (no
// versionCardSeen) with the layer on plays once; with the layer off it records the stamp.
//
// While the card shows, a key press or a pointer press dismisses it at once (and cancels the 1.2 s timer); those two listeners and the timer
// are registered through the layer ONLY while the card is showing. No sound at all, even when sound is enabled; focus is never moved.
import { loadPrefs, savePrefs } from './shared.js';
import { whatsNewDue } from './whats-new.js';
import { BUILD_STAMP } from '../live/build-stamp.mjs';

export const VC_MS = 1200;
export const VC_CAPTION = 'New version inserted';
export const VC_PREF = 'versionCardSeen';   // the one persisted key (whq3-prefs): the last stamp dealt with
export const VC_ACTIONS = Object.freeze(['skip-seen', 'record', 'suppress', 'wait', 'play']);

/**
 * The rule. Every input is a plain value; nothing is read from the page.
 *   stamp        this build's stamp (live/build-stamp.mjs)
 *   seen         the stamp last dealt with (prefs.versionCardSeen), or anything else when none
 *   visible      the document is visible right now
 *   layerOn      the Console layer's master switch is on
 *   reduced      reduce motion is on (the app's pref or the OS setting)
 *   overlayOpen  a dialog / overlay is open, or a scan reload is running
 */
export function decide({ stamp, seen, visible, layerOn, reduced, overlayOpen } = {}) {
  if (!stamp || typeof stamp !== 'string') return 'skip-seen';   // no stamp, nothing to announce
  if (seen === stamp) return 'skip-seen';
  if (!layerOn) return 'record';
  if (reduced) return 'suppress';
  if (!visible || overlayOpen) return 'wait';
  return 'play';
}

// The state keys that mean "a dialog or overlay is open" (what app.js closeTop walks, minus the menus and the page's own More). The What's-new
// overlay is one of them; the version card also yields to it through whatsNewDue (below).
export const OVERLAY_KEYS = Object.freeze(['levelUp', 'sheet', 'commit', 'confirm', 'onboard', 'vault', 'whatsNewOpen', 'cosReportOpen', 'cosIdx', 'cheatOpen', 'settingsOpen', 'paletteOpen', 'cosLb', 'scrubOpen', 'runsOpen', 'askOpen', 'ambientOverlay', 'focus']);

/** true when any dialog/overlay of the app is open, or a refresh (scan reload) is running */
export function overlayOpenOf(S) {
  if (!S || typeof S !== 'object') return false;
  if (S.refreshing) return true;
  for (const k of OVERLAY_KEYS) if (S[k]) return true;
  return false;
}

/** reduce motion: the app's own pref or the OS setting. The matchMedia lookup is injectable for tests; a missing one counts as "no". */
export function reducedNow(S, mm) {
  if (S && S.reduceMotion) return true;
  try {
    const f = mm === undefined ? (typeof matchMedia === 'function' ? matchMedia : null) : mm;
    return !!(f && f('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

const call = (f) => { if (typeof f === 'function') { try { f(); } catch (e) { console.warn('[version-card]', e); } } };

/**
 * The machine. deps (all required except where noted):
 *   stamp        string
 *   seen()       -> the stored stamp
 *   markSeen(s)  stores it
 *   visible()    -> bool        layerOn() -> bool       reduced() -> bool       overlayOpen() -> bool
 *   listen(target, type, fn) -> remover        (the layer's layerOn)
 *   timer(fn, ms)            -> canceller      (the layer's layerTimer)
 *   doc, win     the targets handed back to listen (the machine never reads them)
 *   show() / hide()   put the card on / take it off the screen
 * Returns { start, stop, status }. start() runs the rule once and, on 'wait', again on each visibility event until it decides.
 */
export function createVersionCard(deps) {
  const d = deps;
  let started = false, watching = false, watchOff = null, showing = false, offs = [], cancel = null, last = null;

  const inputs = () => ({ stamp: d.stamp, seen: d.seen(), visible: d.visible(), layerOn: d.layerOn(), reduced: d.reduced(), overlayOpen: d.overlayOpen() });
  const mark = () => { try { d.markSeen(d.stamp); } catch (e) { console.warn('[version-card] could not record the stamp', e); } };

  const unwatch = () => { watching = false; const o = watchOff; watchOff = null; call(o); };
  const watch = () => {
    if (watching) return;
    watching = true;
    watchOff = d.listen(d.doc, 'visibilitychange', () => { if (watching) evaluate(); });   // guarded: a layer that cannot hand back a remover stays harmless
  };

  const dismiss = () => {
    if (!showing) return;
    showing = false;
    const o = offs; offs = [];
    o.forEach(call);
    const c = cancel; cancel = null;
    call(c);
    d.hide();
  };

  const present = () => {
    showing = true;
    offs = [d.listen(d.win, 'keydown', dismiss), d.listen(d.win, 'pointerdown', dismiss)];
    cancel = d.timer(dismiss, VC_MS);
    d.show();
  };

  function evaluate() {
    const action = decide(inputs());
    last = action;
    if (action === 'wait') { watch(); return action; }
    unwatch();
    if (action === 'record' || action === 'suppress' || action === 'play') mark();
    if (action === 'play') present();
    return action;
  }

  return {
    start() { if (started) return last; started = true; return evaluate(); },
    stop() { unwatch(); dismiss(); },
    status: () => ({ started, watching, showing, last }),
  };
}

// ---- the card's look: pure strings (src/vals/version-card.js binds them) ---------------------------------------------------------------
/** The original cartridge, 160 x 110: a chamfered shell, a label window, grip ridges and contacts, sliding into a dark slot mouth behind it and the console lip drawn over its foot. */
export function cartridgePaths() {
  return {
    shell: 'M42 8 H118 L126 16 V62 H34 V16 Z',
    label: 'M46 20 H114 V46 H46 Z',
    ridges: 'M42 52 H118 M42 56 H118',
    contacts: 'M52 62 V70 H108 V62',
    slotPlate: 'M16 78 H144 V98 Q144 102 140 102 H20 Q16 102 16 98 Z',
    slotMouth: 'M26 68 H134 V78 H26 Z',
  };
}
export const CARD_VIEWBOX = '0 0 160 110';

// Layout stays in the style strings; the keyframes live in the fragment (tpl/version-card.tpl.js), so they exist only while the card shows.
// The overlay fades in and out over exactly the 1.2 s; the cartridge slides in over the first 60 % and rests.
export const cardStyle = () => 'position:fixed;inset:0;z-index:1250;display:flex;align-items:center;justify-content:center;background:var(--scrim);pointer-events:auto;animation:hqvcd-card ' + VC_MS + 'ms linear both';
export const cartStyle = () => 'animation:hqvcd-slide ' + VC_MS + 'ms cubic-bezier(.22,1,.36,1) both';

// ---- the Component mixin -----------------------------------------------------------------------------------------------------------------
let LAYER = null;
/** app.js hands over the console-layer module once (bindVersionCardLayer(consoleLayerModule)); until then the card counts as "layer off" and only records. */
export function bindVersionCardLayer(api) { LAYER = api && typeof api.layerOn === 'function' && typeof api.layerTimer === 'function' ? api : null; }

export const versionCardLogic = {
  vcLayerOn() { const L = this.state && this.state.consoleLayer; return !!LAYER && !!L && L.on === true; },

  vcDeps() {
    return {
      stamp: this._vcStamp,
      seen: () => loadPrefs()[VC_PREF],
      markSeen: (s) => savePrefs(Object.assign(loadPrefs(), { [VC_PREF]: s })),
      visible: () => (typeof document === 'undefined' ? false : document.visibilityState === 'visible'),
      layerOn: () => this.vcLayerOn(),
      reduced: () => reducedNow(this.state),
      overlayOpen: () => {
        const once = this._vcHoldOnce; this._vcHoldOnce = false;   // What's-new opened a moment ago (its setState has not landed): holds the first look only
        let scanning = false;
        try { scanning = typeof this.scanStatus === 'function' && !!(this.scanStatus() || {}).running; } catch (e) { scanning = false; }
        return !!once || scanning || overlayOpenOf(this.state) || whatsNewDue(loadPrefs());   // What's-new, when still due, goes first
      },
      listen: (t, type, fn) => LAYER.layerOn(t, type, fn),
      timer: (fn, ms) => LAYER.layerTimer(fn, ms, { once: true }),   // ONE shot: without once the layer would make a repeating interval
      doc: typeof document === 'undefined' ? null : document,
      win: typeof window === 'undefined' ? null : window,
      show: () => this.setState({ vcShow: true }),
      hide: () => this.setState({ vcShow: false }),
    };
  },

  /** Call once from componentDidMount, after maybeShowWhatsNew(); pass its result so a What's-new that just opened is respected. -> the decision */
  vcStart(whatsNewJustOpened, stamp) {
    if (this._vc) return this._vc.start();
    this._vcStamp = stamp || BUILD_STAMP;
    this._vcHoldOnce = !!whatsNewJustOpened;
    this._vc = createVersionCard(this.vcDeps());
    return this._vc.start();
  },

  /** The layer was switched off (its detach already removed every layer listener and timer): drop the card and the wait. Also called on unmount. */
  vcStop() { if (this._vc) this._vc.stop(); },
};
