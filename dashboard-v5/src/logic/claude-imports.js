// AI archive H6 — drop-folder confirm card, "Import ChatGPT export", documents opened in place (spec 2026-10-15 §6.3).
import { importView } from '../live/adapter.mjs';

const gate = (c) => importView(c.LIVE.claudeImport, c.LIVE.claudeHub, { hasBridge: !!(c.hq && c.hq.claudeHub && c.hq.claudeHub.importExport), canWrite: c.canWrite(), writeReason: c.writeReason() });
const started = (c, r) => {
  c.LIVE.claudeImport = { kind: 'import', source: r.kind === 'chatgpt' ? 'chatgpt' : 'claude', phase: 'unzip', done: 0, total: 0 };
  c.toast('info', 'Importing ' + (r.file || 'the export') + ' — the counter shows progress; chats are listed when the import finishes.');
};

export const claudeImportsLogic = {
  async diImportChatGPT() {
    const v = gate(this);
    if (!v.canImport) { this.denied(v.why); return; }
    const r = await this.call(() => this.hq.claudeHub.importExport('chatgpt'), 'Import failed');
    if (r && r.started) { started(this, r); this.forceUpdate(); }
  },
  async diConfirm() {
    const imp = this.LIVE.claudeImports, first = imp && imp.found && imp.found[0];
    if (!first) return;
    const v = gate(this);
    if (!v.canImport) { this.denied(v.why); return; }
    imp.found = imp.found.filter((f) => f.dropId !== first.dropId);   // answered: the watcher's `gone` follows
    const r = await this.call(() => this.hq.claudeHub.importExport('auto', { dropId: first.dropId }), 'Import failed');
    if (r && r.started) started(this, r);
    this.forceUpdate();
  },
  async diDismiss() {
    const imp = this.LIVE.claudeImports, first = imp && imp.found && imp.found[0];
    if (!first || !this.hq || !this.hq.claudeImports) return;
    imp.found = imp.found.filter((f) => f.dropId !== first.dropId);
    const r = await this.call(() => this.hq.claudeImports.dismiss(first.dropId), 'Could not dismiss');
    // null: the call failed and its error toast already showed; false: unknown/expired dropId, nothing was recorded
    if (r === true) this.toast('info', 'Not imported — ' + first.file + ' will not be offered again. Import it any time with the buttons on Claude › Chats.');
    this.forceUpdate();
  },
  cdOpenDoc(id) { if (this.store && this.store.openClaudeDocument) this.store.openClaudeDocument(id); },
  cdCloseDoc() { if (this.store && this.store.closeClaudeDocument) this.store.closeClaudeDocument(); },
};
