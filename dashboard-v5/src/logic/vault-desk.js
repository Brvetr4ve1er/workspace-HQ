// Life > Notes > the Vault desk, renderer side (batch 8). Main owns the note (dashboard/vault-desk.js -> hq:vault-desk:read: today's daily note as
// plain text, masked, with the recent names) and the one write (hq:vault-desk:capture: ONE line appended to today's note). This mixin reads on
// ARRIVAL at Life > Notes (never at boot, never while another view is open), keeps the line the owner is typing, and forwards a capture.
// It never decides where a note lives or what a line becomes. Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State (component state `vdk`): { data: null | answer, error, loaded, busy, draft, sending, last }.
// Usage marks (dashboard/use-log.js): 'vault-desk' open once per arrival; 'vault-desk-capture' act only for a line main reports as added
// (every real capture counts, main caps the channel). A capture that failed marks nothing.
import { vdkClean, VDK_OFF, vdkLineInfo } from './vault-desk-view.mjs';
import { FX } from './shared.js';

export const VDK_SURFACE = 'vault-desk';
export const VDK_CAPTURE_SURFACE = 'vault-desk-capture';
const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');

export const vaultDeskLogic = {
  vdkOn() { const S = this.state || {}; return S.tab === 'life' && !S.route && !!S.sub && S.sub.life === 'notes'; },
  vdkCan() { return !!(this.hq && this.hq.vaultDesk && typeof this.hq.vaultDesk.read === 'function') && (typeof this.ps !== 'function' || this.ps() !== 'nobridge'); },
  _vdkSet(patch) { this.setState((s) => ({ vdk: Object.assign({}, s.vdk, patch) })); },
  _vdkMark(surface, action) { try { if (typeof this.useMark === 'function') this.useMark(surface, action); } catch { /* a mark never blocks the view */ } },

  // arriving on Life > Notes: mark it and read the desk. Anywhere else: nothing.
  vdkArrive() {
    if (!this.vdkOn()) return Promise.resolve(null);
    this._vdkMark(VDK_SURFACE, 'open');
    return this.vdkRead();
  },

  // one read at a time; a later error keeps the answer already shown (and says so)
  async vdkRead() {
    if (!this.vdkCan()) return { error: VDK_OFF };
    if (this._vdkBusy) return null;
    this._vdkBusy = true;
    this._vdkSeq = (this._vdkSeq || 0) + 1;
    const seq = this._vdkSeq;
    this._vdkSet({ busy: true });
    let r;
    try { r = await this.hq.vaultDesk.read(); } catch { r = { error: 'the vault desk could not be read' }; }
    this._vdkBusy = false;
    if (seq !== this._vdkSeq) return null;
    if (r && typeof r === 'object' && !r.error && typeof r.state === 'string') {
      this._vdkSet({ data: vdkClean(r), error: '', loaded: true, busy: false });
      return r;
    }
    const error = (r && typeof r.error === 'string' && r.error.slice(0, 120)) || 'the vault desk could not be read';
    this._vdkSet({ error, loaded: true, busy: false });
    return { error };
  },

  vdkDraft(e) { this._vdkSet({ draft: str(e && e.target ? e.target.value : '', 4000) }); },
  vdkKey(e) {
    if (!e) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.vdkCapture(e.target && typeof e.target.value === 'string' ? e.target.value : undefined); }
  },

  // One capture. A double Enter is one call: the line stays busy until main answers. Every refusal is main's own fixed words.
  async vdkCapture(line) {
    const text = typeof line === 'string' ? line : str(((this.state || {}).vdk || {}).draft, 4000);
    const info = vdkLineInfo(text);
    if (info.empty) return false;
    if (!this.vdkCan() || typeof this.hq.vaultDesk.capture !== 'function') { this.toast('error', VDK_OFF); return false; }
    if (info.long) { this.toast('error', 'That line is too long · ' + info.n + ' characters, the most is 1000'); return false; }
    if (this._vdkSending) return false;
    this._vdkSending = true;
    this._vdkSet({ sending: true });
    try {
      const r = await this.hq.vaultDesk.capture(text);
      if (r && r.error) { this._vdkSet({ draft: text }); this.toast('error', 'Not added · ' + str(r.error, 120)); try { FX().sfx('error'); } catch { /* no sound */ } return false; }
      if (!r || r.ok !== true) { this.toast('error', 'Not added'); return false; }
      this._vdkMark(VDK_CAPTURE_SURFACE, 'act');
      this._vdkSet({ draft: '' });
      this.toast('success', 'Added to today’s note');
      try { FX().sfx('done'); } catch { /* no sound */ }
      this._vdkSending = false;
      await this.vdkRead();   // the note on screen now shows the new line
      return true;
    } catch { this.toast('error', 'Not added'); return false; }
    finally { this._vdkSending = false; this._vdkSet({ sending: false }); }
  },

  // Open in Obsidian goes through the existing hq.vaultOpen (Life > Notes, IPC-CONTRACT hq:vault-open), by the vault's name
  vdkOpen() {
    const d = ((this.state || {}).vdk || {}).data;
    if (!d || !d.canOpen || !d.vaultName) return null;
    return this.lifeVaultOpen(d.vaultName, 'open');
  },
};
