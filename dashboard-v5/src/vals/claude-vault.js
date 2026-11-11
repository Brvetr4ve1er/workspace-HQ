// Render values for Save to vault (Claude Hub H5): the thread view's button and the dialog (tpl/extras.tpl.js).
export const basisNote = (model, basis, drafted = 'model') => (drafted === 'template' ? 'Drafted from a template (no model) from ' : 'Drafted by the local model (' + (model || 'unknown model') + ') from ') + basis + ' chat message' + (basis === 1 ? '' : 's') + '. Check and edit it — nothing is written until you press Save.';
export const VTP_BANNER = 'Drafted from a template: no local model was running. Edit it, then Save.';
export const VTP_REDRAFT = 'Draft again with the model';

export function claudeVaultVals(ctx) {
  const { S, LIVE } = ctx;
  const v = S.vault || null, phase = v ? v.phase : null;
  const lib = LIVE && LIVE.claudeLib, conv = lib && lib.thread && lib.thread.conversation;
  const api = !!this.vaultApi(), can = this.canWrite();
  return {
    clVault: () => (conv && conv.id ? this.openVaultPreview(conv.id) : undefined),
    clVaultOff: !api || !conv || !conv.id || !can,
    clVaultTip: !api ? 'Save to vault is not wired in this window' : !can ? this.writeReason() : 'Draft a vault note from this chat — nothing is written until you press Save',
    vaultOpen: !!v,
    vaultDrafting: phase === 'drafting', vaultReady: phase === 'ready' || phase === 'saving', vaultSaving: phase === 'saving',
    vaultSaved: phase === 'saved', vaultFailed: phase === 'error',
    vaultError: (v && v.error) || '', vaultRel: (v && v.rel) || '', vaultDraft: (v && v.draft) || '',
    onVaultEdit: (e) => this.onVaultEdit(e),
    vaultBasis: v && (phase === 'ready' || phase === 'saving' || phase === 'saved') ? basisNote(v.model, v.basis, v.drafted) : '',
    // ONE nested key (renderVals sits near V8's ~1020-property cliff, see src/vals/brief-history.js): the template reads vtp.badge, vtp.tplShow, vtp.tplNote, vtp.redraftShow, vtp.redraftLabel, vtp.redraft
    vtp: (() => {
      const tpl = !!v && v.drafted === 'template' && (phase === 'ready' || phase === 'saving' || phase === 'saved');
      return { badge: tpl ? 'Template' : 'Local model', tplShow: tpl, tplNote: VTP_BANNER, redraftShow: tpl && !v.modelUnavailable && phase === 'ready', redraftLabel: VTP_REDRAFT, redraft: () => this.redraftVault() };
    })(),
    vaultHasExists: !!(v && v.exists),
    vaultExistsNote: v && v.exists ? 'A note for this chat is already in the vault at this path. Saving asks before it replaces anything.' : '',
    vaultAskReplace: !!(v && v.askReplace),
    vaultSaveError: (v && v.saveError) || '', vaultHasSaveError: !!(v && v.saveError),
    vaultSaveOff: phase !== 'ready' || !String((v && v.draft) || '').trim(),
    vaultSaveLabel: phase === 'saving' ? 'Saving…' : 'Save',
    vaultSave: () => this.saveVault(false), vaultReplace: () => this.saveVault(true), vaultKeep: () => this.keepVault(),
    vaultRetry: () => this.retryVault(), vaultClose: () => this.closeVault(),
  };
}
