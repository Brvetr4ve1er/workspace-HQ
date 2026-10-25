// Save to vault (Claude Hub H5; spec 2026-10-13 §9 Vault). The local model drafts (preview writes nothing), the owner
// edits, and ONLY the Save / Replace buttons write. Replace is sent only after the dialog asked; a save answered
// {exists:true} returns to that question — never an automatic second write. State: this.state.vault (app.js).
export const claudeVaultLogic = {
  vaultApi() {
    const v = this.hq && this.hq.claudeVault;
    return v && typeof v.preview === 'function' && typeof v.save === 'function' ? v : null;
  },
  async openVaultPreview(id) {
    const api = this.vaultApi();
    if (!api) { this.notWired('Save to vault'); return; }
    if (!this.canWrite()) { this.denied(this.writeReason()); return; }
    if (typeof id !== 'string' || !id) return;
    const ticket = (this._vaultTicket = (this._vaultTicket || 0) + 1);
    this.setState({ vault: { id, phase: 'drafting' } });
    let r;
    try { r = await api.preview(id); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (ticket !== this._vaultTicket || !this.state.vault) return;   // closed or reopened while drafting
    if (!r || typeof r !== 'object' || r.error || typeof r.markdown !== 'string') {
      this.setState({ vault: { id, phase: 'error', error: (r && r.error) || 'no draft came back' } });
      return;
    }
    this.setState({ vault: { id, phase: 'ready', path: r.path, rel: r.rel, draft: r.markdown, exists: !!r.exists, model: r.model || null, basis: Number(r.basis) || 0, askReplace: false, saveError: null } });
  },
  onVaultEdit(e) {
    const v = this.state.vault;
    if (!v || v.phase !== 'ready') return;
    this.setState({ vault: Object.assign({}, v, { draft: String(e && e.target ? e.target.value : '') }) });
  },
  async saveVault(replace = false) {
    const v = this.state.vault, api = this.vaultApi();
    if (!v || v.phase !== 'ready' || !api || !String(v.draft || '').trim()) return;
    if (v.exists && replace !== true) { this.setState({ vault: Object.assign({}, v, { askReplace: true }) }); return; }
    const ticket = this._vaultTicket;
    this.setState({ vault: Object.assign({}, v, { phase: 'saving', askReplace: false, saveError: null }) });
    let r;
    try { r = await api.save(replace === true ? { path: v.path, markdown: v.draft, replace: true } : { path: v.path, markdown: v.draft }); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    if (r === true) this.toast('success', 'Saved to vault: ' + v.rel);
    if (ticket !== this._vaultTicket || !this.state.vault) return;   // closed meanwhile: the toast said what happened
    if (r === true) { this.setState({ vault: Object.assign({}, v, { phase: 'saved', askReplace: false }) }); return; }
    if (r && r.exists) { this.setState({ vault: Object.assign({}, v, { phase: 'ready', exists: true, askReplace: true, saveError: 'A note with this name appeared after the draft was made.' }) }); return; }
    this.setState({ vault: Object.assign({}, v, { phase: 'ready', saveError: (r && r.error) || 'the note was not saved' }) });
  },
  keepVault() { const v = this.state.vault; if (v) this.setState({ vault: Object.assign({}, v, { askReplace: false }) }); },
  retryVault() { const v = this.state.vault; return v ? this.openVaultPreview(v.id) : Promise.resolve(); },
  closeVault() { this._vaultTicket = (this._vaultTicket || 0) + 1; this.setState({ vault: null }); },
};
