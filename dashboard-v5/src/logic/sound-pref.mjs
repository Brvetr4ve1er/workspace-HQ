// Sound preference migration (batch 6, dish quiet-light). Pure: no storage, no DOM, no clock.
//
// Sound used to default ON and fire on every tab and click. It now defaults OFF and says so once: a prefs object saved by an older build
// (no `soundV` marker) has its sound reset to false a single time, then the marker is PERSISTED at once so a later explicit choice sticks.
//
//   SOUND_V = 2                           the marker version this migration writes
//   SOUND_PATCH = { sound:false, soundV:2 }   what the app saves (Object.assign into the freshly-read prefs) when migrateSound says changed
//   migrateSound(prefs) → { prefs, changed }
//       prefs      a COPY with sound as a strict boolean (never the caller's object, never mutated)
//       changed    true when the owner's disk copy must be written now (savePrefs(Object.assign(loadPrefs(), SOUND_PATCH)))
//
//   no prefs / not an object  → sound false + marker, changed
//   no marker (any sound)     → sound false + marker, changed   (a saved true is the OLD default, not a choice)
//   marker >= 2               → left alone: true stays true, false stays false, a missing sound reads false, changed false
//
// Why persist at once: app.js re-reads prefs from disk at save time and writes back only its own key list (sound, petOn, ...). A marker kept only
// in memory would be lost, so when the owner later switched sound on the save would write sound:true WITHOUT the marker and the next launch would
// migrate it back to false. The persisted marker survives in the freshly-read prefs the later save merges into.
export const SOUND_V = 2;
export const SOUND_PATCH = Object.freeze({ sound: false, soundV: SOUND_V });

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

export function migrateSound(prefs) {
  const src = isObj(prefs) ? prefs : {};
  const v = Number(src.soundV);
  const marked = Number.isFinite(v) && v >= SOUND_V;
  if (marked) return { prefs: { ...src, sound: src.sound === true }, changed: false };
  return { prefs: { ...src, ...SOUND_PATCH }, changed: true };
}
