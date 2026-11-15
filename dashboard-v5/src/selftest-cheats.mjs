// Cheat codes — the states the selftest walks (selftest.js loops them beside Today's and Cosmos's, in both themes).
//
//   cheatsStates() -> [name, tab, statePatch, extra][]
//     tab         the screen the row is drawn on ('home': the overlay is fixed, it shows on every screen; the found list is in Settings,
//                 reached by settingsOpen in the patch)
//     statePatch  the component state this row sets: { consoleLayer, cheatsFound, ... } (cheatsInitState() spread FIRST by the caller, so
//                 a row never inherits the previous row's layer, palette or found list)
//     extra       { ring: number[] } invented render durations the caller puts into the timing ring with logic.cheatsSeedRing(ring) AFTER
//                 the state is set (the ring only exists while the layer and the debug flag are both on); { reduce: true } rows are
//                 drawn with reduceMotion on
//
//   cheatsInitState()   the all-off state every row starts from (layer off, nothing found)
//   CHEATS_RING_SAMPLES  the invented durations (ms)
//
// Import-light on purpose (nothing imported) and no IO: the test drives it in plain Node. Invented values only (public repo).

export const CHEATS_RING_SAMPLES = Object.freeze([2.1, 2.4, 2.2, 3.9, 2.6, 2.3, 14.8, 2.5, 2.2, 3.1, 2.7, 2.4]);

const LAYER_OFF = Object.freeze({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false });
export const cheatsInitState = () => ({ consoleLayer: { ...LAYER_OFF }, cheatsFound: [], settingsOpen: false });

/** @returns {Array<[string, string, object, object]>} */
export function cheatsStates() {
  const on = (o) => ({ ...LAYER_OFF, on: true, ...(o || {}) });
  const row = (name, patch, extra) => [name, 'home', patch, extra || {}];
  return [
    row('cheats-off', {}),
    row('cheats-off-found-two', { cheatsFound: ['bit', 'dance'] }),
    row('cheats-on-nothing-found', { consoleLayer: on(), settingsOpen: true }),
    row('cheats-on-found-two', { consoleLayer: on(), cheatsFound: ['cartridge', 'bit'], settingsOpen: true }),
    row('cheats-on-found-all', { consoleLayer: on(), cheatsFound: ['cartridge', 'plastic', 'ember', 'tide', 'timing', 'bit', 'dance'], settingsOpen: true }),
    row('cheats-ember', { consoleLayer: on({ palette: 'ember' }), cheatsFound: ['cartridge', 'ember'] }),
    row('cheats-tide', { consoleLayer: on({ palette: 'tide' }), cheatsFound: ['cartridge', 'tide'] }),
    row('cheats-ember-skin', { consoleLayer: on({ skin: true, palette: 'ember' }), cheatsFound: ['cartridge', 'plastic', 'ember'] }),
    row('cheats-debug-empty', { consoleLayer: on({ debug: true }), cheatsFound: ['cartridge', 'timing'] }),
    row('cheats-debug-measured', { consoleLayer: on({ debug: true }), cheatsFound: ['cartridge', 'timing'] }, { ring: CHEATS_RING_SAMPLES.slice() }),
    row('cheats-debug-tide', { consoleLayer: on({ debug: true, palette: 'tide' }), cheatsFound: ['cartridge', 'tide', 'timing'] }, { ring: CHEATS_RING_SAMPLES.slice() }),
    row('cheats-debug-reduced', { consoleLayer: on({ debug: true }), cheatsFound: ['cartridge', 'timing'], reduceMotion: true }, { ring: CHEATS_RING_SAMPLES.slice(), reduce: true }),
    row('cheats-debug-flag-layer-off', { consoleLayer: { ...LAYER_OFF, debug: true }, cheatsFound: ['timing'] }),
  ];
}
