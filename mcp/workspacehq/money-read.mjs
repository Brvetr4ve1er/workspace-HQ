// hq_money_today for the workspacehq MCP server: Money in WORDS ONLY (is it set up, is the room ok or tight, days to
// payday, how many bills are late or due soon, how many slips wait). Never an amount, an account, a payee, a note, a bill
// name or a jar: see dashboard/money/words.mjs, which builds the answer key by key.
//
// OFF BY DEFAULT. data/money/access.json ({ v:1, on, at }, written only by the app: dashboard/money-access.js, from the
// Settings switch) is read FIRST; absent, unreadable, the wrong shape, or `on` anything but the boolean true all mean off,
// and while it is off state.json is not even opened.
//
// READ-ONLY and file-mediated (works with the app closed): the only fs calls are reads. It never writes, renames or
// quarantines anything; a corrupt state.json answers an error and is left for the app to repair.
//
//   readMoneyToday({ dataDir, now?, fsMod? })
//     → { enabled:true, setUp, room, roomWhy, daysToPayday, billsLate, billsDueSoon, slipsWaiting, generatedAt }
//     | { enabled:false, error }     the switch is off
//     | { error }                    state.json unreadable
//   readAccess(dataDir, fsMod?) → { on: boolean }   (the strict reading of access.json, exported for tests and the Reach row)
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeState, defaultState } from '../../dashboard/money/store.mjs';
import { buildView } from '../../dashboard/money/view.mjs';
import { words } from '../../dashboard/money/words.mjs';

export const REFUSAL = 'Claude sessions may not read Money: the owner has not turned it on in Settings';
export const ACCESS_NAME = 'access.json';
export const STATE_NAME = 'state.json';

// the one switch: only the boolean true opens it ('true', 1, "on" and a missing file all stay closed)
export function readAccess(dataDir, fsMod = fs) {
  let raw;
  try { raw = fsMod.readFileSync(path.join(dataDir, 'money', ACCESS_NAME), 'utf8'); } catch { return { on: false }; }
  try {
    const v = JSON.parse(raw);
    return { on: !!v && typeof v === 'object' && !Array.isArray(v) && v.on === true };
  } catch { return { on: false }; }
}

export function readMoneyToday({ dataDir, now = new Date(), fsMod = fs } = {}) {
  if (!dataDir || !readAccess(dataDir, fsMod).on) return { enabled: false, error: REFUSAL };
  const file = path.join(dataDir, 'money', STATE_NAME);
  let raw;
  try { raw = fsMod.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') raw = null;   // Money was never started: honest "not set up", not an error
    else return { error: 'data/money/state.json could not be read' };
  }
  let state;
  if (raw === null) state = defaultState();
  else {
    let v;
    try { v = JSON.parse(raw); } catch { v = undefined; }
    // valid JSON of the wrong shape is as unreadable as garbage (the app quarantines both; this reader leaves the file alone)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'data/money/state.json is unreadable — open WorkspaceHQ to repair it (the app quarantines a corrupt file)' };
    try { state = sanitizeState(v); } catch { return { error: 'data/money/state.json is unreadable — open WorkspaceHQ to repair it (the app quarantines a corrupt file)' }; }
  }
  const at = now instanceof Date ? now : new Date(now);
  return words(buildView(state, at), { generatedAt: at.toISOString() });
}
