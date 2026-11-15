// Settings > Memory card (only while the Console layer is on) - the renderer side. Main owns the numbers (dashboard/memory-card.js ->
// hq:memory:read: per KIND of data the app keeps, a file count, a byte total and the newest write time, plus the chat-index snapshot's age; never a
// file or folder name); this mixin only asks, holds the last answer and says why a read failed. It NEVER writes, erases or exports anything.
// Component.prototype mixin (src/app.js: memoryCardLogic): same `this` as the class methods.
//
// State is ONE object, `mcd` (a missing `mcd` reads as the initial one):
//   { slots: null | [{ kind, label, files, bytes, newestMs, partial }], snapshot: null | { newestMs, kept, max, ok }, at: null | ms, capped: bool,
//     loaded: main has answered once, busy: a read is in flight, error: main's own words for the last failed read (the last answer stays) }
//
// A read happens when Settings OPENS with the Console layer on (mcdEnsure: once per opening, deferred so no state is set while rendering; closing
// Settings or turning the layer off re-arms it) and when the owner presses Refresh. Never at boot, never while the layer is off.
export const MCD_OFFLINE = 'The memory card needs the desktop app';
export const MCD_TITLE = 'Memory card · what the app keeps on this PC';
export const MCD_NOTE = 'Read-only: this only counts what the app keeps (by kind, never by name). Nothing here can erase or export anything.';
export const MCD_COULD_NOT = 'could not look';

export const mcdInit = () => ({ slots: null, snapshot: null, at: null, capped: false, loaded: false, busy: false, error: '' });

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 200);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
const word = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');

/** The Console layer's master switch, read from state (consoleLayer is a persisted object; anything but { on: true } is off). */
export const mcdLayerOn = (S) => !!(S && isObj(S.consoleLayer) && S.consoleLayer.on === true);

/** main's answer made safe: { ok: true, data } or { ok: false, error }. A slot needs a kind; every number is finite and >= 0 or null (= could not look). */
export function cleanRead(r) {
  if (!isObj(r)) return { ok: false, error: 'no answer' };
  if (typeof r.error === 'string' && r.error) return { ok: false, error: r.error.slice(0, 200) };
  if (!Array.isArray(r.slots)) return { ok: false, error: 'no answer' };
  const slots = r.slots.filter((s) => isObj(s) && typeof s.kind === 'string' && s.kind).slice(0, 16).map((s) => ({
    kind: s.kind.slice(0, 40), label: word(s.label, 40) || s.kind.slice(0, 40),
    files: num(s.files), bytes: num(s.bytes), newestMs: num(s.newestMs), partial: s.partial === true,
  }));
  const sn = isObj(r.snapshot) ? r.snapshot : null;
  const t = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  return {
    ok: true,
    data: {
      slots,
      snapshot: sn ? { newestMs: num(sn.newestMs), kept: num(sn.kept), max: num(sn.max), ok: sn.ok !== false } : { newestMs: null, kept: null, max: null, ok: false },
      at: Number.isFinite(t) ? t : null,
      capped: r.capped === true,
    },
  };
}

export const memoryCardLogic = {
  mcdCan() {
    const api = this.hq && this.hq.memory;
    return !!(api && typeof api.read === 'function');
  },
  mcdState() { return (this.state && this.state.mcd) || mcdInit(); },
  _mcdPatch(p) { this.setState({ mcd: { ...this.mcdState(), ...p } }); },

  /** Called from the section's render values while it is on screen: one read per opening of Settings. */
  mcdEnsure() {
    if (this._mcdAsked || !this.mcdCan() || !mcdLayerOn(this.state)) return;
    this._mcdAsked = true;
    setTimeout(() => this.mcdLoad(), 0);   // never set state while rendering
  },
  /** Settings closed (or the layer turned off): the next opening reads fresh. */
  mcdRearm() { this._mcdAsked = false; },

  /** One read of hq.memory.read(); a failed read keeps the last answer on screen and says why. Refresh is this call and nothing else. */
  async mcdLoad() {
    if (!this.mcdCan() || !mcdLayerOn(this.state) || this._mcdReading) return false;
    this._mcdReading = true;
    this._mcdPatch({ busy: true });
    let r;
    try { r = await this.hq.memory.read(); } catch (e) { r = { error: msg(e) }; } finally { this._mcdReading = false; }
    const c = cleanRead(r);
    if (c.ok) { this._mcdPatch({ ...c.data, loaded: true, busy: false, error: '' }); return true; }
    this._mcdPatch({ busy: false, error: c.error });
    return false;
  },
};
