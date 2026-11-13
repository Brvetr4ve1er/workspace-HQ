// Security space: the actions and the shared words. Component.prototype mixin (src/app.js): same `this` as the class methods; every
// method is sec-prefixed. Follows Cosmos (logic/cosmos.js) and Machine drift (logic/drift.js) file for file.
//
//  - Main owns the data (dashboard/security.js, hq:security:* channels, main window only). The renderer sends INTENTS: an edit of one
//    account's flags, a manual account, a tick of a walkthrough step, a vault path, a Recycle-Bin move of one LISTED file, a copy.
//  - The space reads ON ARRIVAL (secArrive), never at boot, and not at all while another tab is open.
//  - THE UNLOCK INPUT IS UNCONTROLLED. The master passphrase is read from the DOM element at click time (secSubmitUnlock), handed to
//    store.unlockSecurity as an argument, and the element's value is cleared in the same tick the call is made, and again on cancel,
//    close and after an error. It is never put in this.state, a vals key, sessionStorage, localStorage or a console call. The dialog is
//    state `sec.dlg` of the MAIN window only (satellites load other pages and never render it).
//  - A generated password lives in state `sec.gen.out` only while the Generator is open on screen; it is dropped on arrival and on Clear.
//  - One component state key: `sec` (a missing `sec` reads as secInit(), so the shared edit in src/app.js is `sec: secInit()` or nothing).
import { cryptoRandomInt, generate, DEFAULTS, estimateBits } from './security-generate.mjs';

export const SEC_SURFACE = 'security';
export const SEC_REFRESH_SURFACE = 'security-refresh';
export const SEC_OFFLINE = 'Security needs the desktop app';
export const SEC_SUBTITLE = 'names and flags only · no password is kept in this app';

export const HIDE_WORDING = 'hides this account from the hq_footprint tool only; the map file stays readable on this PC by anything that can read this app’s data folder, a Claude session included';
export const COPY_NOTE = 'cleared from the clipboard after 30 s; that clear cannot reach Windows clipboard history (Win+V) or a cloud clipboard, which may keep a copy, so for a real password prefer KeePassXC’s own generator';
export const CONFLICT_WORDING = 'Syncthing made a conflict copy: open both in KeePassXC and merge (Database > Merge)';
export const EXPORT_WORDING = 'may be a plain password export';

/** Health's "where the plain-export scan looked" line: three labels and a count, never a path. null = the scan has not answered yet. */
export function lookedLine(looked, redirected) {
  const names = Array.isArray(looked) ? looked.filter((x) => typeof x === 'string' && x && x.length <= 40).slice(0, 6) : [];
  if (names.length === 0) return '';
  const n = Number.isFinite(redirected) && redirected > 0 ? Math.floor(redirected) : 0;
  return 'Looked in ' + names.join(', ') + ' (' + n + ' moved ' + (n === 1 ? 'folder' : 'folders') + ' followed)';
}

export const TWOFA_OPTIONS = Object.freeze([['unknown', 'not recorded'], ['ente', 'Ente Auth'], ['sms', 'SMS'], ['passkey', 'passkey'], ['none', 'none']]);

/** One line per flag: what it means in words, and what to do. */
export const FLAG_WORDS = Object.freeze({
  breached: { label: 'in a known breach', todo: 'Change this password now, in KeePassXC, then check the account for anything you do not recognise.' },
  reused: { label: 'password reused', todo: 'Give each account its own password; KeePassXC’s generator makes them.' },
  weak: { label: 'weak password', todo: 'Replace it with a longer, generated one in KeePassXC.' },
  no2fa: { label: 'no 2FA recorded', todo: 'Turn on 2FA where the site offers it, then set the method in the side card.' },
  old: { label: 'not changed in over a year', todo: 'Change it the next time you sign in.' },
  'not-in-vault': { label: 'not in the vault', todo: 'No stored login for this account: add it to KeePassXC, or archive it if it is closed.' },
});

/** The walkthrough, in its fixed order. how: 'owner' = you tick it, 'app' = the app checks it and says what it checked. */
export const STEPS = Object.freeze([
  { id: 'email-2fa', how: 'owner', title: 'Turn on 2FA for your main email account', help: 'It recovers every other account, so it comes first.' },
  { id: 'install-keepassxc', how: 'app', title: 'Install KeePassXC yourself', help: 'From keepassxc.org. This app never installs or downloads anything.' },
  { id: 'create-vault', how: 'app', title: 'Create your vault with one memorised passphrase', help: 'In KeePassXC, then tell this app where the .kdbx file is.' },
  { id: 'emergency-sheet', how: 'owner', title: 'Print the emergency sheet and fill it in by hand', help: 'The sheet has blank lines only. Keep it somewhere you trust.' },
  { id: 'import-browser', how: 'owner', title: 'Import your browser passwords into KeePassXC', help: 'KeePassXC does the import (Database > Import > CSV). Then remove the plain file.' },
  { id: 'phone-keepassdx', how: 'owner', title: 'Install KeePassDX on the phone and turn on fingerprint unlock', help: 'Unlock once with the passphrase first.' },
  { id: 'syncthing', how: 'owner', title: 'Share the vault folder between PC and phone with Syncthing', help: 'Device to device, no cloud.' },
  { id: 'ente-auth', how: 'owner', title: 'Install Ente Auth on the phone and the PC', help: 'It keeps your 2FA codes apart from the password file.' },
  { id: 'import-authenticator', how: 'owner', title: 'Move your authenticator codes into Ente Auth', help: 'Use the export QR of your current authenticator app.' },
  { id: 'first-refresh', how: 'app', title: 'Press Refresh once to build the map', help: 'The app reads the vault through keepassxc-cli with the passphrase you type.' },
]);

/** The emergency sheet: labels with BLANK lines. It never holds data, so a printed copy cannot leak what the app knows. */
export const SHEET_LINES = Object.freeze([
  'Where the vault file is', 'Master passphrase (write it by hand)', 'Main email address', 'Email recovery codes',
  'Ente Auth account email', 'Ente Auth recovery key', 'Phone unlock method', 'Date written',
]);

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 200);

export const secInit = () => ({
  sel: null, dlg: null, form: null, formErr: '', slider: null,
  gen: { kind: DEFAULTS.kind, words: DEFAULTS.wordCount, chars: DEFAULTS.charLength, sets: { ...DEFAULTS.sets }, out: null, note: '', err: '' },
  sheet: false, pathErr: '', note: '', busy: false,
});

const step = (S, id) => (S && isObj(S.walkthrough) && isObj(S.walkthrough[id]) ? S.walkthrough[id] : null);
const ticked = (settings, id) => { const w = step(settings, id); return !!(w && w.done === true); };
const dayOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');
const nf = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/**
 * The walkthrough's state for the vals. Pure. `d` = { settings, status, cliFound, vaultExists, map, exports } from the slice.
 * Every step says WHO decided it: an app-checked step says what the app checked, an owner step says 'you ticked this' or that it is not ticked.
 */
export function secSteps(d) {
  const x = isObj(d) ? d : {};
  const settings = isObj(x.settings) ? x.settings : {};
  const status = isObj(x.status) ? x.status : {};
  const map = isObj(x.map) ? x.map : null;
  const exp = Array.isArray(x.exports) ? x.exports : null;
  return STEPS.map((s, i) => {
    let done = false, check = '', extra = '';
    if (s.how === 'owner') {
      done = ticked(settings, s.id);
      check = done ? 'you ticked this' : 'not ticked yet';
    } else if (s.id === 'install-keepassxc') {
      done = x.cliFound === true;
      check = done ? 'checked by the app: keepassxc-cli was found' : 'checked by the app: keepassxc-cli was not found';
    } else if (s.id === 'create-vault') {
      const p = typeof settings.vaultPath === 'string' && settings.vaultPath ? settings.vaultPath : '';
      done = !!p && x.vaultExists === true;
      check = !p ? 'checked by the app: no vault file chosen yet' : x.vaultExists === true ? 'checked by the app: the chosen vault file exists' : 'checked by the app: the chosen file does not exist';
    } else if (s.id === 'first-refresh') {
      const at = map && typeof map.refreshedAt === 'string' ? map.refreshedAt : '';
      done = !!at;
      check = done ? 'checked by the app: refreshed on ' + (dayOf(at) || 'a recorded day') : 'checked by the app: not refreshed yet';
    }
    if (s.id === 'import-browser') extra = exp === null ? 'The app has not scanned for plain exports yet.' : exp.length === 0 ? 'No plain export left (checked by file name, top level of Downloads, Desktop and Documents).' : nf(exp.length, 'file', 'files') + ' ' + (exp.length === 1 ? 'is' : 'are') + ' still there and ' + EXPORT_WORDING + ': see Health.';
    if (s.id === 'syncthing') { const c = status.conflicts; extra = Number.isFinite(c) ? (c === 0 ? 'No conflict copy next to the vault file.' : nf(c, 'conflict copy', 'conflict copies') + ' next to the vault file: see Health.') : 'Conflict copies have not been looked for yet.'; }
    return { id: s.id, n: i + 1, title: s.title, help: s.help, how: s.how, owner: s.how === 'owner', done, check, extra };
  });
}

export const securityLogic = {
  secCan() {
    const api = this.hq && this.hq.security;
    return !!(api && typeof api.read === 'function');
  },
  secState() { return (this.state && this.state.sec) || secInit(); },
  _secPatch(p) { this.setState({ sec: { ...this.secState(), ...p } }); },
  _secEl(name) { return (this._secEls && this._secEls[name]) || null; },
  /** A stable callback ref per field name: the element is read at click time and never copied into state. */
  secRef(name) {
    const refs = this._secRefs || (this._secRefs = {});
    return refs[name] || (refs[name] = (el) => { (this._secEls || (this._secEls = {}))[name] = el || null; });
  },
  /** Reads the typed value from the field, hands it to the store, and empties the field in the same tick. Returns the store's promise, or null when the field is empty. */
  _secSend(st, breaches) {
    const el = this._secEl('pass');
    const typed = el && typeof el.value === 'string' ? el.value : '';
    if (!typed) return null;
    const pending = st.unlockSecurity(typed, breaches);
    this._secClearPass();
    return pending;
  },
  _secClearPass() { const el = this._secEl('pass'); if (el) { try { el.value = ''; } catch { /* the field is gone */ } } },

  /** Called when the Security tab opens (app.js): one mark, one read, one export scan. The generated password never survives an arrival. */
  async secArrive() {
    if (typeof this.useMark === 'function') { try { this.useMark(SEC_SURFACE, 'open'); } catch { /* a usage mark is a bonus */ } }
    this._secClearPass();
    const cur = this.secState();
    if (cur.dlg || cur.gen.out || cur.sheet) this._secPatch({ dlg: null, sheet: false, gen: { ...cur.gen, out: null, note: '', err: '' } });
    const st = this.store;
    if (!st || typeof st.refreshSecurity !== 'function') return { error: SEC_OFFLINE };
    let r;
    try { r = await st.refreshSecurity(false); } catch (e) { r = { error: msg(e) }; }
    try { if (typeof st.scanSecurityExports === 'function') await st.scanSecurityExports(); } catch { /* the scan failing is shown by the slice */ }
    return r;
  },

  // ---- the map -----------------------------------------------------------------------------------
  secSelect(id) { const cur = this.secState(); this._secPatch({ sel: cur.sel === id ? null : id, form: null, formErr: '' }); },
  secCloseCard() { this._secPatch({ sel: null }); },
  secSlide(e) {
    const v = e && e.target ? Number(e.target.value) : NaN;
    this._secPatch({ slider: Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null });
  },
  secShowAll() { this._secPatch({ slider: null }); },
  async secEdit(id, patch) {
    const st = this.store;
    if (!st || typeof st.editSecurity !== 'function') return { error: SEC_OFFLINE };
    const r = await st.editSecurity(id, patch);
    if (r && r.error) this.toast('error', r.error);
    return r;
  },
  secOpenForm(kind) { this._secPatch({ form: kind === 'identity' ? 'identity' : 'account', formErr: '', sel: null }); },
  secCloseForm() { this._secPatch({ form: null, formErr: '' }); },
  async secSubmitForm() {
    const cur = this.secState(), st = this.store;
    if (!cur.form || cur.busy) return null;
    if (!st) return { error: SEC_OFFLINE };
    const val = (n) => { const el = this._secEl(n); return el && typeof el.value === 'string' ? el.value.trim() : ''; };
    this._secPatch({ busy: true, formErr: '' });
    let r;
    try {
      if (cur.form === 'identity') r = await st.addSecurityIdentity({ kind: val('idkind') === 'phone' ? 'phone' : 'email', value: val('idvalue') });
      else r = await st.addSecurityManual({ title: val('title'), host: val('host') });
    } catch (e) { r = { error: msg(e) }; }
    if (r && r.ok === true) {
      for (const n of ['title', 'host', 'idvalue']) { const el = this._secEl(n); if (el) el.value = ''; }
      this._secPatch({ busy: false, form: null, formErr: '', note: cur.form === 'identity' ? 'Identity added.' : 'Account added.' });
    } else this._secPatch({ busy: false, formErr: (r && r.error) || 'That did not save' });
    return r;
  },

  // ---- unlock: the uncontrolled passphrase input ---------------------------------------------------
  secOpenUnlock() { if (this.secState().dlg) return; this._secPatch({ dlg: { busy: false, error: '', breaches: true } }); },
  secCancelUnlock() {
    this._secClearPass();
    const d = this.secState().dlg;
    if (d && d.busy) return;            // a refresh is running: the dialog stays until main answers
    this._secPatch({ dlg: null });
  },
  secToggleBreaches(e) {
    const d = this.secState().dlg;
    if (!d) return;
    this._secPatch({ dlg: { ...d, breaches: !!(e && e.target ? e.target.checked : !d.breaches) } });
  },
  async secSubmitUnlock() {
    const d = this.secState().dlg, st = this.store;
    if (!d || d.busy) return null;
    if (!st || typeof st.unlockSecurity !== 'function') { this._secPatch({ dlg: { ...d, error: SEC_OFFLINE } }); return { error: SEC_OFFLINE }; }
    const pending = this._secSend(st, d.breaches);   // the typed value lives only inside _secSend
    if (pending) this._secClearPass();   // the field empties the moment the passphrase is sent, not when KeePassXC answers (spec: "cleared as soon as it is sent")
    if (!pending) { this._secPatch({ dlg: { ...d, error: 'Type the master passphrase first.' } }); return { error: 'empty' }; }
    this._secPatch({ dlg: { ...d, busy: true, error: '' } });
    try { if (typeof this.useMark === 'function') this.useMark(SEC_REFRESH_SURFACE, 'act'); } catch { /* a usage mark is a bonus */ }
    let r;
    try { r = await pending; } catch (e) { r = { error: msg(e) }; }
    this._secClearPass();
    if (r && r.ok === true) {
      const notes = Array.isArray(r.notes) && r.notes.length ? ' · ' + r.notes.join(' · ') : '';
      this._secPatch({ dlg: null, note: 'Refreshed' + (r.breachChecked ? ', breach check done' : ', breach check off or not finished') + notes });
      return r;
    }
    this._secPatch({ dlg: { ...(this.secState().dlg || d), busy: false, error: (r && r.error) || 'The refresh did not finish' } });
    return r || { error: 'no answer' };
  },

  // ---- health, setup ---------------------------------------------------------------------------------
  async secTrashExport(name, dir) {
    const st = this.store;
    if (!st || typeof st.trashSecurityExport !== 'function') return { error: SEC_OFFLINE };
    const r = await st.trashSecurityExport(name, dir);
    if (r && r.ok === true) this.toast('success', 'Moved to the Recycle Bin. Empty the bin yourself when you are sure.');
    else this.toast('error', (r && r.error) || 'Could not move that file');
    return r;
  },
  async secTick(stepId) {
    const st = this.store;
    if (!st || typeof st.setSecurityWalkthrough !== 'function') return { error: SEC_OFFLINE };
    const meta = STEPS.find((s) => s.id === stepId);
    if (!meta || meta.how !== 'owner') return { error: 'only you can tick that step' };
    const cur = this.LIVE && this.LIVE.security && this.LIVE.security.settings;
    const done = ticked(cur, stepId);
    const r = await st.setSecurityWalkthrough(stepId, !done);
    if (r && r.error) this.toast('error', r.error);
    return r;
  },
  async secSavePath() {
    const st = this.store, el = this._secEl('vaultpath');
    if (!st || typeof st.setSecuritySettings !== 'function') return { error: SEC_OFFLINE };
    const p = el && typeof el.value === 'string' ? el.value.trim() : '';
    this._secPatch({ pathErr: '' });
    const r = await st.setSecuritySettings({ vaultPath: p || null });
    if (r && r.ok === true) { this.toast('success', p ? 'Vault path saved.' : 'Vault path cleared.'); } else this._secPatch({ pathErr: (r && r.error) || 'That path was not accepted' });
    return r;
  },
  /** Escape (app.js closeTop calls this first): the unlock dialog closes unless a refresh is running (then Escape is eaten, the dialog stays), else the emergency sheet. true = handled. */
  secEscape() {
    const c = this.secState();
    if (c.dlg) { if (!c.dlg.busy) this.secCancelUnlock(); return true; }
    if (c.sheet) { this.secCloseSheet(); return true; }
    return false;
  },
  secOpenSheet() { this._secPatch({ sheet: true }); },
  secCloseSheet() { this._secPatch({ sheet: false }); },
  secPrint() { try { if (typeof window !== 'undefined' && typeof window.print === 'function') window.print(); } catch { /* printing is the owner's printer's business */ } },
  secGoSelect(id) {
    this.setSub('map');
    this._secPatch({ sel: id, form: null });
  },

  // ---- generator ---------------------------------------------------------------------------------------
  secGenKind(kind) { const g = this.secState().gen; this._secPatch({ gen: { ...g, kind: kind === 'chars' ? 'chars' : 'words', out: null, note: '', err: '' } }); },
  secGenLength(e) {
    const g = this.secState().gen, v = e && e.target ? Number(e.target.value) : NaN;
    if (!Number.isFinite(v)) return;
    this._secPatch({ gen: { ...g, [g.kind === 'chars' ? 'chars' : 'words']: Math.floor(v), out: null, note: '' } });
  },
  secGenSet(name) {
    const g = this.secState().gen;
    if (!['lower', 'upper', 'digits', 'symbols'].includes(name)) return;
    this._secPatch({ gen: { ...g, sets: { ...g.sets, [name]: !g.sets[name] }, out: null, note: '' } });
  },
  secGenOptions() {
    const g = this.secState().gen;
    return g.kind === 'chars' ? { kind: 'chars', length: g.chars, sets: g.sets } : { kind: 'words', length: g.words };
  },
  secGenerate() {
    const g = this.secState().gen;
    let r;
    try { r = generate(this.secGenOptions(), cryptoRandomInt()); } catch (e) { r = { ok: false, error: msg(e) }; }
    this._secPatch({ gen: { ...g, out: r.ok ? { text: r.text, bits: r.bits, kind: r.kind } : null, err: r.ok ? '' : r.error, note: '' } });
    return r;
  },
  secGenClear() { const g = this.secState().gen; this._secPatch({ gen: { ...g, out: null, note: '', err: '' } }); },
  async secGenCopy() {
    const g = this.secState().gen, st = this.store;
    if (!g.out) return { error: 'nothing generated yet' };
    if (!st || typeof st.copySecurity !== 'function') { this._secPatch({ gen: { ...g, note: '', err: SEC_OFFLINE } }); return { error: SEC_OFFLINE }; }
    const r = await st.copySecurity(g.out.text);
    const cur = this.secState().gen;
    this._secPatch({ gen: r && r.ok === true ? { ...cur, note: 'Copied; ' + COPY_NOTE + '.', err: '' } : { ...cur, note: '', err: (r && r.error) || 'Could not copy' } });
    return r;
  },
  secGenBits() { return estimateBits(this.secGenOptions()); },
};
