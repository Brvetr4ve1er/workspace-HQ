// Render values for Save to vault (Claude Hub H5): the thread view's button and the dialog (tpl/extras.tpl.js).
export const basisNote = (model, basis) => 'Drafted by the local model (' + (model || 'unknown model') + ') from ' + basis + ' chat message' + (basis === 1 ? '' : 's') + '. Check and edit it — nothing is written until you press Save.';

export function claudeVaultVals(ctx) {
  const { S, LIVE } = ctx;
  const v = S.vault || null, phase = v ? v.phase : null;
  const lib = LIVE && LIVE.claudeLib, conv = lib && lib.thread && lib.thread.conversation;
  const api = !!this.vaultApi(), can = this.canWrite();
  return {
    clVault: () => (conv && conv.id ? this.openVaultPreview(conv.id) : undefined),
    clVaultOff: !api || !conv || !conv.id || !can,
    clVaultTip: !api ? 'Save to vault is not wired in this window' : !can ? this.writeReason() : 'Draft a vault note from this chat with the local model — nothing is written until you press Save',
    vaultOpen: !!v,
    vaultDrafting: phase === 'drafting', vaultReady: phase === 'ready' || phase === 'saving', vaultSaving: phase === 'saving',
    vaultSaved: phase === 'saved', vaultFailed: phase === 'error',
    vaultError: (v && v.error) || '', vaultRel: (v && v.rel) || '', vaultDraft: (v && v.draft) || '',
    onVaultEdit: (e) => this.onVaultEdit(e),
    vaultBasis: v && (phase === 'ready' || phase === 'saving' || phase === 'saved') ? basisNote(v.model, v.basis) : '',
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
