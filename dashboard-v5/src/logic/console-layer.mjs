// The Console layer: ONE persisted pref, ONE place that attaches anything. Pure logic with injected IO: no storage, no clock, and nothing
// at import time (the DOM, the timers and the frame loop are all handed in by attach(env)).
//
// ---- the pref (consoleLayer, an object in the renderer prefs; renderer-only, main never sees it) --------------------------------------
//   { on:false, skin:false, scan:false, palette:'', debug:false, shelf:false, look:'' }       EVERYTHING off by default
//       look ('' | 'workbench' | 'lantern') is a second look (batch 8 Workbench, batch 11 Lantern: ink, bone and brass). A look is mutually exclusive with the Console skin and with the other look: a
//       stored object that somehow carries a skin and a look keeps the skin (the older choice) and drops the look; withConsoleLayer(raw, { look }) turns the skin off
//       and withConsoleLayer(raw, { skin:true }) clears the look. Scanlines belong to the skin only, so they never run under the look.
//   normaliseConsoleLayer(raw) -> a fresh, complete object. Missing, garbage, partial: the defaults. Only a strict `true` turns a flag on;
//       palette is a short lowercase id ('' = none); unknown keys are dropped. Later dishes add their keys HERE, with a test.
//   consoleEffective(raw)      what the rest of the app may act on: nothing at all while `on` is false (the stored sub-flags are kept
//       on disk so turning the layer back on restores the owner's choices, but they do nothing), and scanlines only under the skin.
//   withConsoleLayer(raw, patch) -> a new normalised object (never the caller's)       withSkin(raw, bool) -> the same with the skin set
//
// ---- zero cost when off (enforced by console-layer.test.mjs and the cdp scenarios) --------------------------------------------------
//   This file is the ONLY place the layer attaches a stylesheet, a listener, a timer or a frame. Every later dish registers through:
//       layerOn(target, type, fn, opts)   one listener on target                    -> off()
//       layerTimer(fn, ms, { once })      a repeating timer (once:true = one shot)   -> off()
//       layerFrame(fn)                    one animation frame                        -> off()
//       layerAttr(name, value)            an attribute on <html> (data-hq-* only; null removes it)
//       layerSheet(name, href)            one extra stylesheet link (id hq-<name>-css) while attached, counted in the probe's links; href null removes it
//   Each counts what it creates. While the layer is DETACHED every one of them registers nothing and returns a no-op, so OFF is
//   structurally zero. attach(env) injects <link id="hq-console-css" data-hq-console="css" href="./styles/console.css">; detach()
//   removes the link, every listener, timer and frame and every attribute, without a reload. Both are idempotent.
//   layerProbe() -> { links, listeners, timers, frames } (numbers, a fresh frozen object every call); exposeProbe(win) installs it as
//   the read-only window.__hqLayerProbe. The probe counts LAYER-registered things only: the app's two permanent keydown listeners
//   (app.js _onKey and the legacy egg listener) are outside it. Attributes are not counted (an attribute is not a node).
//
// attach(env): env = { doc, win?, href?, setTimeout?, clearTimeout?, setInterval?, clearInterval?, requestAnimationFrame?,
//   cancelAnimationFrame? }; the timers default to win's, then to globalThis's. Tests pass a fake doc and fake timers.

export const CONSOLE_DEFAULTS = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false, look: '' });
export const CONSOLE_KEYS = Object.freeze(Object.keys(CONSOLE_DEFAULTS));
export const CONSOLE_LINK_ID = 'hq-console-css';
export const CONSOLE_CSS_HREF = './styles/console.css';
export const CONSOLE_SKIN = 'console';   // the value data-hq-skin carries while the skin is on ('' otherwise)
export const CONSOLE_SCAN_ATTR = 'data-hq-scan';
export const WORKBENCH_LOOK = 'workbench';   // the value data-hq-look carries while the Workbench look is on ('' otherwise)
export const WORKBENCH_HREF = './styles/workbench.css';
export const LANTERN_LOOK = 'lantern';   // the value data-hq-look carries while the Lantern look is on (batch 11; ink, bone and brass, a tarot card per project)
export const LANTERN_HREF = './styles/lantern.css';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const flag = (x) => x === true;
export const CONSOLE_PALETTES = Object.freeze(['ember', 'tide', 'signal']);   // ember and tide are the hidden accent palettes (cheat codes); signal is the warm red one, chosen from a Settings chip; anything else is none
// the accent palettes each look carries (a stored palette a look does not carry stays on disk and does nothing under it): the Workbench look takes the red one, Lantern none
export const LOOK_PALETTES = Object.freeze({ [WORKBENCH_LOOK]: Object.freeze(['signal']), [LANTERN_LOOK]: Object.freeze([]) });
export const WORKBENCH_PALETTES = LOOK_PALETTES[WORKBENCH_LOOK];   // kept as an alias
export const CONSOLE_PALETTES_HREF = './styles/palettes.css';
export const CONSOLE_DELIGHTS_HREF = './styles/delights.css';   // small delights: the attract scene's and the back room lamp's only motion, attached with the layer (a second counted link)
const paletteId = (x) => { const s = typeof x === 'string' ? x.trim().toLowerCase() : ''; return CONSOLE_PALETTES.includes(s) ? s : ''; };

const lookId = (x) => (x === WORKBENCH_LOOK || x === LANTERN_LOOK ? x : '');

export function normaliseConsoleLayer(raw) {
  const s = isObj(raw) ? raw : {};
  const skin = flag(s.skin);
  return { on: flag(s.on), skin, scan: flag(s.scan), palette: paletteId(s.palette), debug: flag(s.debug), shelf: flag(s.shelf), look: skin ? '' : lookId(s.look) };
}

export function consoleEffective(raw) {
  const n = normaliseConsoleLayer(raw);
  if (!n.on) return { ...CONSOLE_DEFAULTS };
  // under a look only the palettes that look carries do anything (Workbench: the red one; Lantern: none); the rest are kept on disk but inert
  const palette = n.look && !LOOK_PALETTES[n.look].includes(n.palette) ? '' : n.palette;
  return { ...n, palette, scan: n.skin && n.scan };
}

export function withConsoleLayer(raw, patch) {
  const p = isObj(patch) ? patch : {};
  const next = { ...normaliseConsoleLayer(raw), ...p };
  if (p.skin === true && !('look' in p)) next.look = '';        // choosing the skin leaves the look
  else if (lookId(p.look) && !('skin' in p)) next.skin = false;   // choosing the look leaves the skin
  return normaliseConsoleLayer(next);
}
export const withSkin = (raw, skin) => withConsoleLayer(raw, { skin: skin === true });
export const withLook = (raw, look) => withConsoleLayer(raw, { look: lookId(look) });

// ---- the layer ----------------------------------------------------------------------------------------------------------------------
const noop = () => {};

export function createConsoleLayer() {
  let env = null, link = null, attached = false;
  let listeners = [], timers = [], frames = [], attrs = [];
  const sheets = new Map();   // name -> { el, href }: the extra stylesheets (the accent palettes' one)

  const fn = (name) => (env && typeof env[name] === 'function' ? env[name] : (env && env.win && typeof env.win[name] === 'function' ? env.win[name].bind(env.win) : (typeof globalThis[name] === 'function' ? globalThis[name].bind(globalThis) : null)));
  const rootEl = () => (env && env.doc ? env.doc.documentElement : null);

  function attach(e) {
    if (attached) return true;
    if (!isObj(e) || !e.doc || typeof e.doc.createElement !== 'function') return false;   // honest: nothing to attach to, nothing attached
    env = e;
    const doc = e.doc;
    try {
      const stale = typeof doc.getElementById === 'function' ? doc.getElementById(CONSOLE_LINK_ID) : null;
      if (stale && typeof stale.remove === 'function') stale.remove();
      link = doc.createElement('link');
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('id', CONSOLE_LINK_ID);
      link.setAttribute('href', typeof e.href === 'string' && e.href ? e.href : CONSOLE_CSS_HREF);
      link.setAttribute('data-hq-console', 'css');
      (doc.head || doc.documentElement).appendChild(link);
    } catch (err) { link = null; env = null; return false; }
    attached = true;
    return true;
  }

  function detach() {
    const was = attached;
    attached = false;
    for (const l of listeners) { try { l.target.removeEventListener(l.type, l.fn, l.opts); } catch (e) { /* the target is gone with its page */ } }
    const root = rootEl();
    for (const a of attrs) { try { if (root) root.removeAttribute(a); } catch (e) { /* the page is gone */ } }
    const clearT = fn('clearInterval'), clearO = fn('clearTimeout'), cancelF = fn('cancelAnimationFrame');
    for (const t of timers) { try { (t.once ? clearO : clearT)(t.id); } catch (e) { /* already gone */ } }
    for (const f of frames) { try { cancelF(f.id); } catch (e) { /* already gone */ } }
    listeners = []; timers = []; frames = []; attrs = [];
    for (const sh of sheets.values()) { try { if (typeof sh.el.remove === 'function') sh.el.remove(); else if (sh.el.parentNode) sh.el.parentNode.removeChild(sh.el); } catch (e) { /* already gone */ } }
    sheets.clear();
    if (link) { try { if (typeof link.remove === 'function') link.remove(); else if (link.parentNode) link.parentNode.removeChild(link); } catch (e) { /* already gone */ } }
    link = null; env = null;
    return was;
  }

  function layerOn(target, type, handler, opts) {
    if (!attached || !target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') return noop;
    target.addEventListener(type, handler, opts);
    const rec = { target, type, fn: handler, opts };
    listeners.push(rec);
    return () => {
      const i = listeners.indexOf(rec);
      if (i < 0) return;
      listeners.splice(i, 1);
      try { target.removeEventListener(type, handler, opts); } catch (e) { /* gone */ }
    };
  }

  function layerTimer(handler, ms, opts) {
    if (!attached || typeof handler !== 'function') return noop;
    const once = !!(opts && opts.once);
    const set = fn(once ? 'setTimeout' : 'setInterval'), clear = fn(once ? 'clearTimeout' : 'clearInterval');
    if (!set || !clear) return noop;
    const rec = { id: null, once };
    const drop = () => { const i = timers.indexOf(rec); if (i >= 0) timers.splice(i, 1); };
    rec.id = set(() => { if (once) drop(); handler(); }, Math.max(0, +ms || 0));
    timers.push(rec);
    return () => { if (timers.indexOf(rec) < 0) return; drop(); try { clear(rec.id); } catch (e) { /* gone */ } };
  }

  function layerFrame(handler) {
    if (!attached || typeof handler !== 'function') return noop;
    const raf = fn('requestAnimationFrame'), cancel = fn('cancelAnimationFrame');
    if (!raf || !cancel) return noop;
    const rec = { id: null };
    const drop = () => { const i = frames.indexOf(rec); if (i >= 0) frames.splice(i, 1); };
    rec.id = raf((ts) => { drop(); handler(ts); });
    frames.push(rec);
    return () => { if (frames.indexOf(rec) < 0) return; drop(); try { cancel(rec.id); } catch (e) { /* gone */ } };
  }

  // an attribute on <html> (the scanline switch is one): data-hq-* only, set while attached, removed by detach(); value null/'' removes it
  function layerAttr(name, value) {
    if (!attached || typeof name !== 'string' || !/^data-hq-[a-z0-9-]+$/.test(name)) return false;
    const root = rootEl();
    if (!root || typeof root.setAttribute !== 'function') return false;
    if (value === null || value === undefined || value === '' || value === false) { root.removeAttribute(name); attrs = attrs.filter((a) => a !== name); return true; }
    root.setAttribute(name, String(value));
    if (!attrs.includes(name)) attrs.push(name);
    return true;
  }

  // one extra stylesheet link, counted like the main one; href null/'' removes it. Only while attached (a detached layer creates nothing).
  function layerSheet(name, href) {
    if (!attached || typeof name !== 'string' || !/^[a-z0-9-]{1,24}$/.test(name) || !env || !env.doc || typeof env.doc.createElement !== 'function') return false;
    const old = sheets.get(name);
    if (!href) {
      if (old) { try { if (typeof old.el.remove === 'function') old.el.remove(); else if (old.el.parentNode) old.el.parentNode.removeChild(old.el); } catch (e) { /* already gone */ } sheets.delete(name); }
      return true;
    }
    if (old && old.href === String(href)) return true;
    if (old) { try { if (typeof old.el.remove === 'function') old.el.remove(); } catch (e) { /* already gone */ } sheets.delete(name); }
    try {
      const el = env.doc.createElement('link');
      el.setAttribute('rel', 'stylesheet');
      el.setAttribute('id', 'hq-' + name + '-css');
      el.setAttribute('href', String(href));
      el.setAttribute('data-hq-console', 'css');
      (env.doc.head || env.doc.documentElement).appendChild(el);
      sheets.set(name, { el, href: String(href) });
    } catch (e) { return false; }
    return true;
  }

  const probe = () => Object.freeze({ links: (link ? 1 : 0) + sheets.size, listeners: listeners.length, timers: timers.length, frames: frames.length });
  return { attach, detach, layerOn, layerTimer, layerFrame, layerAttr, layerSheet, layerProbe: probe, isAttached: () => attached };
}

// the app's one layer
const layer = createConsoleLayer();
export const attach = layer.attach;
export const detach = layer.detach;
export const layerOn = layer.layerOn;
export const layerTimer = layer.layerTimer;
export const layerFrame = layer.layerFrame;
export const layerAttr = layer.layerAttr;
export const layerSheet = layer.layerSheet;
export const layerProbe = layer.layerProbe;
export const isAttached = layer.isAttached;

// window.__hqLayerProbe: a read-only function (not writable, not configurable) that answers numbers only. Safe to call twice.
export function exposeProbe(win, probe = layerProbe) {
  if (!win || typeof win !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(win, '__hqLayerProbe')) return true;
  try { Object.defineProperty(win, '__hqLayerProbe', { value: () => ({ ...probe() }), writable: false, configurable: false, enumerable: false }); return true; } catch (e) { return false; }
}
