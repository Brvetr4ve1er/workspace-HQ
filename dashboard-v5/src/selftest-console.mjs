// Console layer: the states the selftest walks (selftest.js loops them beside Today's and Cosmos's, in both themes).
//
//   consoleInitState()      the consoleLayer state a row never inherits from the previous row (everything off); the caller spreads it first
//   consoleStates() -> [name, 'home', null, { consoleLayer }, {}][]     the Cosmos/Drift row shape: row[3] is the state patch, row[4] any other patch
//   consoleSeen(doc, win)   what a row looks like in the page, as plain data: { skin, scan, links, nodes, probe }
//   consoleProblems(name, seen, registered?) -> string[]   what is wrong, in words ([] = the row is right)
//       registered  { listeners, timers, frames } the layer's later dishes are expected to hold in the on-states (default all zero: this dish
//                   registers nothing). Later dishes raise these numbers WITH their own registrations; the OFF row never changes: all zeros.
//
// The rows (the whole contract of the master switch in four lines):
//   console-off            default: layer off, nothing loads: probe all zeros, no link, no data-hq-console node, root data-hq-skin empty
//   console-on-no-skin     the layer is on, the skin is not chosen: the stylesheet is in the page, the root attribute is still empty
//   console-skin           on + Console chosen: data-hq-skin="console", no scanlines
//   console-skin-scan      on + Console + CRT scanlines: data-hq-scan="on" on <html>
//   console-off-stored     a stored skin/scan with the layer OFF does nothing at all (zero cost again): same as console-off
// No IO, no timers, no listeners: plain Node can drive it (src/selftest-console.test.mjs is not part of this dish; console-layer.test.mjs pins it).
import { normaliseConsoleLayer, CONSOLE_LINK_ID, CONSOLE_SCAN_ATTR, CONSOLE_SKIN } from './logic/console-layer.mjs';

export const consoleInitState = () => ({ consoleLayer: normaliseConsoleLayer(null) });

const L = (o) => normaliseConsoleLayer(o);

/** @returns {Array<[string, string, null, object, object]>} */
export function consoleStates() {
  const row = (name, layer) => [name, 'home', null, { consoleLayer: L(layer) }, {}];
  return [
    row('console-off', {}),
    row('console-on-no-skin', { on: true }),
    row('console-skin', { on: true, skin: true }),
    row('console-skin-scan', { on: true, skin: true, scan: true }),
    row('console-off-stored', { on: false, skin: true, scan: true }),
  ];
}

/** Reads the page into plain data. doc/win are the page's own (or fakes in a test); nothing is changed. */
export function consoleSeen(doc, win) {
  const root = doc.querySelector('[data-hq-theme]');
  const html = doc.documentElement;
  return {
    skin: root ? root.getAttribute('data-hq-skin') : undefined,
    scan: html ? html.getAttribute(CONSOLE_SCAN_ATTR) : null,
    links: doc.querySelectorAll('link#' + CONSOLE_LINK_ID).length,
    nodes: doc.querySelectorAll('[data-hq-console]').length,
    probe: win && typeof win.__hqLayerProbe === 'function' ? win.__hqLayerProbe() : null,
  };
}

const ZERO = Object.freeze({ links: 0, listeners: 0, timers: 0, frames: 0 });
const EXPECT = {
  'console-off': { on: false, skin: '', scan: false },
  'console-on-no-skin': { on: true, skin: '', scan: false },
  'console-skin': { on: true, skin: CONSOLE_SKIN, scan: false },
  'console-skin-scan': { on: true, skin: CONSOLE_SKIN, scan: true },
  'console-off-stored': { on: false, skin: '', scan: false },
};
export const CONSOLE_ROW_NAMES = Object.freeze(Object.keys(EXPECT));

export function consoleProblems(name, seen, registered = {}) {
  const want = EXPECT[name];
  if (!want) return ['no expectation for the row "' + name + '"'];
  const out = [];
  const s = seen || {};
  const p = s.probe;
  if (!p || typeof p !== 'object') return ['window.__hqLayerProbe is missing or answered nothing (it must exist even while the layer is off)'];
  for (const k of ['links', 'listeners', 'timers', 'frames']) if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) out.push('the probe field ' + k + ' is not a number');
  if (out.length) return out;
  const exp = want.on
    ? { links: 1, listeners: registered.listeners | 0, timers: registered.timers | 0, frames: registered.frames | 0 }
    : ZERO;
  for (const k of Object.keys(exp)) if (p[k] !== exp[k]) out.push('probe.' + k + ' is ' + p[k] + ', want ' + exp[k]);
  if (s.links !== (want.on ? 1 : 0)) out.push('the page holds ' + s.links + ' #' + CONSOLE_LINK_ID + ' link(s), want ' + (want.on ? 1 : 0));
  if (!want.on && s.nodes !== 0) out.push('the layer is off but ' + s.nodes + ' node(s) carry data-hq-console');
  if (s.skin !== want.skin) out.push('the root data-hq-skin is ' + JSON.stringify(s.skin) + ', want ' + JSON.stringify(want.skin) + (want.skin === '' ? ' (an EMPTY attribute, not a missing one)' : ''));
  if ((s.scan === 'on') !== want.scan) out.push('<html data-hq-scan> is ' + JSON.stringify(s.scan) + ', scanlines should be ' + (want.scan ? 'on' : 'absent'));
  return out;
}
