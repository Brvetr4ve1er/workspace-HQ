// Small delights: the states the selftest walks (selftest.js loops them beside the Brief's own rows, in both themes).
//
//   delightsStates() -> [name, 'home', briefLive, dlxState, extra][]            (the Today / Cosmos row shape)
//     briefLive  a LIVE.brief value ({ brief, error, loaded }): the Brief on screen. The attract slot needs it empty at 0/0/0
//     dlxState   the dlx* component state this row sets, spread over delightsInitState() by the caller (a row never inherits the previous row's room)
//     extra      any other state patch: always the consoleLayer object (on or off), so a row never inherits the previous row's switch
//   DLX_FIXED_MS   the fixed clock the season row needs: the caller sets logic._dlxClock = () => DLX_FIXED_MS (a February day, so the kite shows)
//   delightsInitState  re-exported so the caller has one import
//
// The caller also sets logic._dlxHold = true for the walk so dlxSync never replaces a row's own state with the controller's answer, and puts it back
// afterwards. Placeholder text only; no IO: the module only shapes data.
import { delightsInitState } from './logic/delights.mjs';
export { delightsInitState };

export const DLX_FIXED_MS = new Date(2026, 1, 10, 9, 0, 0).getTime();   // local time: the month is stable on any machine

const GEN = '2026-11-10T09:00:00.000Z';
const item = (key, severity, text) => ({ key, rule: key.split(':')[0], severity, text, why: 'Placeholder reason.', source: 'scan', age: 'scan 1 h ago', action: { kind: 'scan' }, count: 0 });
const briefOf = (items) => ({ brief: { v: 1, generatedAt: GEN, items, more: 0, overflow: [], standing: [], errors: [] }, error: '', loaded: true });
const EMPTY = briefOf([]);
const BUSY = briefOf([item('secrets:placeholder-a:2', 'high', 'Project A has 2 secrets in plain sight')]);

const ON = { consoleLayer: { on: true, skin: false, scan: false, palette: '', debug: false, shelf: false } };
const OFF = { consoleLayer: { on: false, skin: false, scan: false, palette: '', debug: false, shelf: false } };

export function delightsStates() {
  return [
    ['dlx-off', 'home', EMPTY, {}, OFF],                                   // layer off: nothing of this dish is on screen
    ['dlx-armed', 'home', EMPTY, {}, ON],                                  // layer on, empty Brief: the ornament and the (invisible) attract anchor
    ['dlx-attract-playing', 'home', EMPTY, { dlxRun: true, dlxLoops: 3 }, ON],
    ['dlx-busy-brief', 'home', BUSY, {}, ON],                              // the Brief has an item: ornament only, no attract slot
    ['dlx-room', 'home', EMPTY, { dlxRoom: true }, ON],                    // the back room open over Home
    ['dlx-room-layer-off', 'home', EMPTY, { dlxRoom: true }, OFF],         // a stale open flag with the layer off: nothing draws
  ];
}
