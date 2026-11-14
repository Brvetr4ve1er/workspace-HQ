// The Console layer's render values. ONE new top-level key, cslv (renderVals has a hard ceiling of 1015 top-level keys):
//   cslv = { cslOn, cslSkin, cslScan, cslSwitchLabel, cslLine }
//     cslSkin   what the root's data-hq-skin attribute carries: 'console' only while the layer is on AND the skin is chosen, '' otherwise
//               (an EMPTY attribute, never a missing one, never a node: tpl/shell.tpl.js binds data-hq-skin="{{ cslv.cslSkin }}")
//     cslScan   scanlines are on (only ever true under the skin; the CSS overlay itself is switched by the layer's <html> attribute)
//
// Two helpers for vals/shell.js so its two edits stay one line each (both are called with the component as `this`):
//   consoleThemeOpts.call(this, S, tabStyle)  the Appearance chips: Dark · Light · Follow system, plus 'Console' ONLY while the layer is on.
//                                             The three base chips light up only when Console is not the chosen skin.
//   consoleSettings.call(this, S, sw)         the generic settings rows: 'Console layer', and 'CRT scanlines' only while the skin is on
import { consoleEffective, CONSOLE_SKIN } from '../logic/console-layer.mjs';
import { CSL_TITLE, CSL_LINE, CSL_CHIP, CSL_SCAN_TITLE, CSL_SCAN_LINE } from '../logic/console-skin.js';

export function consoleSkinVals(ctx) {
  const cl = consoleEffective(ctx.S.consoleLayer);
  return {
    cslv: {
      cslOn: cl.on, cslSkin: cl.skin ? CONSOLE_SKIN : '', cslScan: cl.scan,
      cslSwitchLabel: CSL_TITLE + ': ' + (cl.on ? 'on' : 'off'), cslLine: CSL_LINE,
    },
  };
}

export function consoleThemeOpts(S, tabStyle) {
  const cl = consoleEffective(S.consoleLayer);
  const chips = [['dark', 'Dark'], ['light', 'Light'], ['os', 'Follow system']].map(([id, label]) => ({ label, go: () => this.cslChooseBase(id), style: tabStyle(S.themePref === id && !cl.skin) }));
  if (cl.on) chips.push({ label: CSL_CHIP, go: () => this.cslChooseSkin(), style: tabStyle(cl.skin) });
  return chips;
}

export function consoleSettings(S, sw) {
  const cl = consoleEffective(S.consoleLayer);
  const rows = [sw(CSL_TITLE, CSL_LINE, cl.on, () => this.cslToggleOn())];
  if (cl.on && cl.skin) rows.push(sw(CSL_SCAN_TITLE, CSL_SCAN_LINE, cl.scan, () => this.cslToggleScan()));
  return rows;
}
