// Safe read for a persisted JSON store that gets MODIFIED and written back.
// Moved out of main.js (2026-10-31) so the quarantine rule is testable without
// Electron — behavior unchanged, same callers. A read-modify-write on an
// unparseable file would OVERWRITE (destroy) it with the empty default —
// silently erasing the user's accreted history (quests, notes, ideas,
// learnings, spell telemetry). Instead: quarantine the bad file to
// <file>.corrupt so nothing is lost, and hand back a FRESH empty
// (makeEmpty() — never a shared reference).
//   ENOENT        -> empty (a first run with no file yet is correct)
//   real IO error -> rethrow (never mask a disk/permission failure by resetting)
//   unparseable / wrong shape -> quarantine + log + empty (recoverable, not gone)
const fs = require('node:fs');
const path = require('node:path');

function readJsonStore(file, makeEmpty, ok) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return makeEmpty(); throw e; }
  try {
    const v = JSON.parse(raw);
    if (ok && !ok(v)) throw new Error('unexpected shape');
    return v;
  } catch (e) {
    try { fs.renameSync(file, file + '.corrupt'); } catch { /* best effort — never throw from a read */ }
    console.error(`[store] corrupt ${path.basename(file)} quarantined to ${path.basename(file)}.corrupt — ${e.message}`);
    return makeEmpty();
  }
}
const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// data/spell-telemetry.json: the one write-back store that used to bypass the
// quarantine rule — a corrupt file was silently replaced on the next cast
// (favorites, cast log, mastery rollup, confirmed hashes all gone), and
// valid-but-wrong-shape JSON (e.g. `[]`) crashed recordCast mid-finish. The
// validator pins exactly the shape every main.js writer assumes.
const emptyTelemetry = () => ({ version: 1, confirmed_hashes: {}, favorites: [], casts: [], rollup: {} });
const telemetryOk = (v) => isPlainObj(v) && Array.isArray(v.casts) && Array.isArray(v.favorites) && isPlainObj(v.rollup) && isPlainObj(v.confirmed_hashes);

module.exports = { readJsonStore, isPlainObj, emptyTelemetry, telemetryOk };
