// Money in one minute + one line per spend (Money › Today): the start card and the quick line.
// Component.prototype mixin (src/app.js): same `this` as the class methods. State lives in S.mst:
//   card  { cashDA, bankDA, cardUSD, fx, payday }   typed strings — kept when main refuses
//   refused  main's own words for the last refused start        saving  a start is in flight
//   line  the quick-line text · preview {kind,label,reason}|null · previewErr · note (main's last answer) · lineError
//
//  - Every write is ONE intent through store.applyMoney (hq:money:apply): the renderer never builds entities. The
//    preview is a dry intent through store.previewMoneyLine and never touches live.money.
//  - One write at a time: this._mstBusy (a double click sends one intent) and S.mny.busy (the other money writes).
//  - A refusal shows main's words, keeps what was typed and never blanks the view already on screen (store.takeMoney).
//  - No XP: nothing here calls actedOn, and the copy never promises any.
//  - Usage marks ('money-start', 'money-quick', 'palette-money-line') go through useMark when the rulebook dish has landed.
import { FX } from './shared.js';

export const PREVIEW_DELAY_MS = 150;
const START_FIELDS = [['cashDA', 'cashDA'], ['bankDA', 'bankDA'], ['cardUSD', 'cardUSD'], ['fxDaPerUsd', 'fx'], ['paydayDay', 'payday']];

export const moneyStartLogic = {
  mstSet(patch) { this.setState((s) => ({ mst: Object.assign({}, s.mst, patch) })); },
  mstCardField(key, value) {
    this.setState((s) => { const m = Object.assign({}, s.mst); m.card = Object.assign({}, m.card, { [key]: value }); m.refused = ''; return { mst: m }; });
  },
  _mstMark(id, action) {
    try { if (typeof this.useMark === 'function') this.useMark(id, action); } catch (e) { /* a usage mark is a bonus, never a failure */ }
  },

  // the one guarded write. Resolves main's answer ({view,note} | {error}), or null when it was not sent (already told).
  async mstWrite(intent) {
    const m = this.hq && this.hq.money;
    if (!m || !m.apply) { this.denied('Unavailable — money needs the desktop bridge'); return null; }
    if (this._mstBusy || (this.state.mny || {}).busy) { this.toast('info', 'Still saving the last one — try again in a moment'); return null; }
    this._mstBusy = true;
    if (this.mnySet) this.mnySet({ busy: true });
    this.mstSet({ saving: true });
    let r;
    try { r = await this.store.applyMoney(intent); }
    catch (e) { r = { error: (e && e.message) || String(e) }; }
    finally {
      this._mstBusy = false;
      if (this.mnySet) this.mnySet({ busy: false });
      this.mstSet({ saving: false });
    }
    return r || { error: 'That didn’t save' };
  },

  // ---- the start card ----
  async mstStart() {
    const card = (this.state.mst || {}).card || {};
    const intent = { type: 'start' };
    for (const [key, field] of START_FIELDS) { const v = card[field]; if (typeof v === 'string' && v.trim() !== '') intent[key] = v.trim(); }
    const r = await this.mstWrite(intent);
    if (!r) return false;
    if (r.error) {
      this.mstSet({ refused: r.error });   // the typed values stay; the Today view already on screen is untouched
      this.toast('error', r.error);
      FX().sfx('error');
      return false;
    }
    this.mstSet({ card: null, refused: '' });
    if (r.note) this.toast('success', r.note);
    this._mstMark('money-start');
    FX().sfx('done');
    return true;
  },

  // ---- the quick line ----
  mstLineChange(text) {
    this.mstSet({ line: text, lineError: '', note: '' });
    if (this._mstTimer) clearTimeout(this._mstTimer);
    const seq = this._mstSeq = (this._mstSeq || 0) + 1;
    if (!String(text).trim()) { this._mstTimer = null; this.mstSet({ preview: null, previewErr: '' }); return; }
    this._mstTimer = setTimeout(() => { this._mstTimer = null; this.mstPreview(text, seq); }, PREVIEW_DELAY_MS);
  },
  // dry run: main reads the line and says what it would do; nothing is written
  async mstPreview(text, seq) {
    if (!this.store || typeof this.store.previewMoneyLine !== 'function') return;
    let r;
    try { r = await this.store.previewMoneyLine(text); }
    catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (seq !== this._mstSeq) return;   // the owner typed on: this answer is about an older line
    if (r && r.preview) this.mstSet({ preview: r.preview, previewErr: '' });
    else this.mstSet({ preview: null, previewErr: (r && r.error) || '' });
  },
  async mstLogLine() {
    const text = String((this.state.mst || {}).line || '').trim();
    if (!text) return false;
    if (this._mstTimer) { clearTimeout(this._mstTimer); this._mstTimer = null; }
    this._mstSeq = (this._mstSeq || 0) + 1;   // a late preview must not repaint over the answer
    const r = await this.mstWrite({ type: 'log-line', text, from: 'today' });
    if (!r) return false;
    if (r.error) { this.mstSet({ lineError: r.error }); this.toast('error', r.error); FX().sfx('error'); return false; }
    this.mstSet({ line: '', preview: null, previewErr: '', lineError: '', note: r.note || '' });
    if (r.note) this.toast('success', r.note);
    this._mstMark('money-quick', 'log');
    FX().sfx('done');
    return true;
  },
  mstLineClear() {
    if (this._mstTimer) { clearTimeout(this._mstTimer); this._mstTimer = null; }
    this._mstSeq = (this._mstSeq || 0) + 1;
    this.mstSet({ line: '', preview: null, previewErr: '', lineError: '' });
  },

  // Ctrl K: the "Log a spend · <text>" row (logic/palette.js passes amountLine-gated text)
  async mstLogFromPalette(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    const r = await this.mstWrite({ type: 'log-line', text: t, from: 'palette' });
    if (!r) return false;
    if (r.error) { this.toast('error', r.error); FX().sfx('error'); return false; }
    if (r.note) this.toast('success', r.note);
    this._mstMark('palette-money-line', 'log');
    FX().sfx('done');
    return true;
  },
};
