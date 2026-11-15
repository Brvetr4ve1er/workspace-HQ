// The Console layer's renderer side: the master switch, the Console skin chip and the scanline switch. Component.prototype mixin (src/app.js):
// same `this` as the class methods. State is ONE flat key, consoleLayer (logic/console-layer.mjs normalises it: { on, skin, scan, palette,
// debug, shelf }, everything off by default). The wording lives here so Settings, the tests and the cdp scenarios say the same words.
//
//   cslInitState(prefs)   -> { consoleLayer }   the initial state from loadPrefs() (app.js initState spreads it)
//   cslSavePatch(S)       -> { consoleLayer }   what the prefs save writes (app.js componentDidUpdate merges it in; the key joins the change list)
//   cslSync(env?)         attaches the layer (stylesheet link + the scanline attribute) when the switch is on, detaches it when off, no reload;
//                         app.js calls it once after mount and whenever consoleLayer changed. It also installs window.__hqLayerProbe (numbers).
//   cslLeaveSkin(S)       -> {} or { consoleLayer } with the skin cleared. Spread into ANY setState that sets a base theme: toggleTheme() (the
//                         shell button and the palette's "Toggle light / dark" both call it) and the Dark / Light / Follow system chips use it,
//                         so leaving Console never leaves the skin stuck on. themePref itself stays dark|light|os and themeName() never says console.
//   cslToggleOn() · cslToggleScan() · cslChooseSkin() · cslChooseBase(id)   the Settings actions
//
// Nothing here touches the DOM except cslSync, and cslSync goes through the layer (logic/console-layer.mjs), the only file allowed to attach.
import { attach, detach, layerAttr, layerSheet, exposeProbe, normaliseConsoleLayer, consoleEffective, withConsoleLayer, withSkin, CONSOLE_SCAN_ATTR, CONSOLE_PALETTES_HREF, CONSOLE_DELIGHTS_HREF } from './console-layer.mjs';

export const CSL_TITLE = 'Console layer';
export const CSL_LINE = 'Opt-in look and a few extras. Off = nothing loads.';
export const CSL_CHIP = 'Console';
export const CSL_SCAN_TITLE = 'CRT scanlines';
export const CSL_SCAN_LINE = 'A faint static line pattern over the window. It never moves and never blocks a click.';

export const cslInitState = (prefs) => ({ consoleLayer: normaliseConsoleLayer(prefs && prefs.consoleLayer) });
export const cslSavePatch = (S) => ({ consoleLayer: normaliseConsoleLayer(S && S.consoleLayer) });

const browserEnv = () => (typeof window !== 'undefined' && typeof document !== 'undefined' ? { doc: document, win: window } : null);

export const consoleSkinLogic = {
  cslSync(env) {
    const e = env || browserEnv();
    if (!e) return false;
    if (e.win) exposeProbe(e.win);
    const cl = consoleEffective(this.state && this.state.consoleLayer);
    if (!cl.on) { detach(); return false; }
    if (!attach(e)) return false;
    layerAttr(CONSOLE_SCAN_ATTR, cl.scan ? 'on' : null);
    layerSheet('delights', CONSOLE_DELIGHTS_HREF);   // small delights: its one stylesheet rides with the layer (counted in the probe's links); detach() removes it
    layerSheet('palettes', cl.palette ? CONSOLE_PALETTES_HREF : null);   // the accent palettes' stylesheet exists only while a palette is chosen (cheat codes)
    return true;
  },
  cslLeaveSkin(S) {
    const cl = normaliseConsoleLayer(S && S.consoleLayer);
    return cl.skin ? { consoleLayer: withSkin(cl, false) } : {};
  },
  cslToggleOn() {
    this.setState((s) => { const cl = normaliseConsoleLayer(s.consoleLayer); return { consoleLayer: withConsoleLayer(cl, { on: !cl.on }) }; });
  },
  cslToggleScan() {
    this.setState((s) => { const cl = normaliseConsoleLayer(s.consoleLayer); return cl.on && cl.skin ? { consoleLayer: withConsoleLayer(cl, { scan: !cl.scan }) } : {}; });
  },
  cslChooseSkin() {
    this.setState((s) => (normaliseConsoleLayer(s.consoleLayer).on ? { consoleLayer: withSkin(s.consoleLayer, true) } : {}));
  },
  cslChooseBase(id) {
    this.setState((s) => ({ themePref: id, ...this.cslLeaveSkin(s) }));
  },
};
