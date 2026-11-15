// "New version inserted" card: the states the selftest walks (selftest.js loops them on Home, in both themes).
//
//   versionCardStates() -> { name, tab, patch, shown }[]
//     name   the combo label, always 'vcd-...'
//     tab    where the row is shown: Home (the card is a fixed overlay, so any screen would do)
//     patch  the component state this row sets: vcShow (the machine started the card), consoleLayer (the layer pref), reduceMotion, settingsOpen.
//            EVERY row sets all four, so a row never inherits the previous row's layer or dialog.
//     shown  whether the card must be in the page for this row
//   checkRow(row, dom) -> string[]   dom = { present: bool, text: string }; the problems, [] when the page matches the row
//   VCD_STATE_KEYS                   the keys a row writes: selftest.js puts them back after the loop (vcShow is also part of its CLEAR set)
//
// No IO, no globals: the module only shapes data (the test runs it in plain Node). Placeholder text only.
import { VC_CAPTION } from './logic/version-card.mjs';
import { BUILD_STAMP } from './live/build-stamp.mjs';

export const VCD_STATE_KEYS = Object.freeze(['vcShow', 'consoleLayer', 'reduceMotion', 'settingsOpen']);
export const VCD_LAYER_ON = Object.freeze({ on: true, skin: false, scan: false, palette: '', debug: false, shelf: false });
export const VCD_LAYER_OFF = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });

const row = (name, over, shown) => ({
  name, tab: 'home', shown,
  patch: Object.assign({ vcShow: false, consoleLayer: { ...VCD_LAYER_OFF }, reduceMotion: false, settingsOpen: false }, over),
});

export function versionCardStates() {
  return [
    row('vcd-idle', {}, false),                                                                                  // the usual page: no node at all
    row('vcd-showing', { vcShow: true, consoleLayer: { ...VCD_LAYER_ON } }, true),                              // the card, mid-animation
    row('vcd-showing-skin', { vcShow: true, consoleLayer: { ...VCD_LAYER_ON, skin: true } }, true),            // over the Console skin
    row('vcd-layer-off', { vcShow: true }, false),                                                               // started, then the layer went off: nothing
    row('vcd-reduced', { vcShow: true, consoleLayer: { ...VCD_LAYER_ON }, reduceMotion: true }, false),        // reduce motion: nothing
    row('vcd-over-dialog', { vcShow: true, consoleLayer: { ...VCD_LAYER_ON }, settingsOpen: true }, false),    // never on top of a dialog
  ];
}

export function checkRow(r, dom) {
  const out = [];
  const present = !!(dom && dom.present), text = String((dom && dom.text) || '');
  if (r.shown) {
    if (!present) out.push(r.name + ': the card is not in the page');
    if (present && !text.includes(VC_CAPTION)) out.push(r.name + ': the caption "' + VC_CAPTION + '" is missing');
    if (present && !text.includes(BUILD_STAMP)) out.push(r.name + ': the stamp ' + BUILD_STAMP + ' is missing');
  } else if (present) out.push(r.name + ': a card node is in the page when it must not be');
  return out;
}
