// Life > Notes > Vault desk render values. EVERY value rides under ONE top-level key, vdkv (renderVals stays one key higher, not a block of vdk*
// keys); the template reads {{ vdkv.on }} and friends. The answer arrives finished from main (dashboard/vault-desk.js -> hq:vault-desk:read: plain
// text, already masked, names only); logic/vault-desk.js reads it on arrival and this module only shapes it (logic/vault-desk-view.mjs).
//
// renderVals runs every surface on every machine push, so while the owner is on another screen this returns a frozen constant. The key set of
// vdkv is the same in every state, so the template never meets an undefined. Honest states: no bridge - loading - error with no answer held
// (Retry) - ready - ready with a later error (the last answer stays, the error is said above it) - no folder - no note.
import { vdkWhere, vdkStateWords, vdkLineInfo, VDK_OFF } from '../logic/vault-desk-view.mjs';

const BLANK = Object.freeze({
  on: false, offline: false, offlineText: '', loading: false, error: false, errorText: '', ready: false, where: '', stateWords: '', hasStateWords: false,
  hasNote: false, emptyNote: false, emptyNoteText: '', noteTitle: '', noteText: '', truncated: false, truncatedText: '', hasRecent: false, recent: [], recentLabel: '',
  line: '', canType: false, canSend: false, sending: false, sendLabel: 'Add', lineNote: '', onLine: null, onKey: null, send: null,
  canOpen: false, open: null, refresh: null, refreshLabel: 'Refresh', refreshOff: true,
});
const OFF_V = Object.freeze({ vdkv: BLANK });

export const VDK_NOTE = 'Today’s note is shown as plain text, with anything that looks like a password hidden. A line you add goes to the end of the note and nothing else in it changes.';

export function vaultDeskVals(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  if (!(S.tab === 'life' && !S.route && S.sub && S.sub.life === 'notes')) return OFF_V;
  const can = typeof this.vdkCan === 'function' ? this.vdkCan() : false;
  const V = S.vdk || {};
  const held = V.data || null;
  const busy = !!V.busy, err = typeof V.error === 'string' ? V.error : '';
  const refresh = () => (typeof this.vdkRead === 'function' ? this.vdkRead() : null);
  const refreshLabel = busy ? 'Reading…' : err && !held ? 'Retry' : 'Refresh';
  const base = { ...BLANK, on: true, refresh, refreshLabel, refreshOff: busy, lineNote: VDK_NOTE };
  if (!can) return { vdkv: { ...base, offline: true, offlineText: VDK_OFF + ' — notes are read by the app, not this window.', refreshOff: true } };
  if (!held) return { vdkv: { ...base, loading: !err, error: !!err, errorText: err } };

  const line = typeof V.draft === 'string' ? V.draft : '';
  const info = vdkLineInfo(line);
  const sending = !!V.sending;
  const writable = held.state === 'ready';
  const words = vdkStateWords(held);
  const open = () => (typeof this.vdkOpen === 'function' ? this.vdkOpen() : null);
  return {
    vdkv: {
      ...base, ready: true, error: !!err, errorText: err, where: vdkWhere(held), stateWords: words, hasStateWords: !!words,
      hasNote: writable && held.text.length > 0, emptyNote: writable && held.text.length === 0, emptyNoteText: 'Today’s note is empty. A line you add goes in it.', noteTitle: held.noteName ? 'Today · ' + held.noteName : 'Today', noteText: held.text,
      truncated: held.truncated, truncatedText: 'The note is longer than 20 KB; only the start is shown here.',
      recent: held.recent.map((name, i) => ({ key: i + '|' + name, name })), hasRecent: held.recent.length > 0,
      recentLabel: held.recent.length === 1 ? 'Most recent note' : 'The ' + held.recent.length + ' most recent notes',
      line, canType: writable && !sending, canSend: writable && !sending && !info.empty && !info.long, sending, sendLabel: sending ? 'Adding…' : 'Add',
      onLine: (e) => this.vdkDraft(e), onKey: (e) => this.vdkKey(e), send: () => this.vdkCapture(),
      canOpen: held.canOpen, open,
    },
  };
}
