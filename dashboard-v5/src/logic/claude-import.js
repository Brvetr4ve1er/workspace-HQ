// Claude Hub H4 — "Import claude.ai export" (spec 2026-10-13 §5.2, §9). Main opens the file dialog; the Hub imports.
import { importView } from '../live/adapter.mjs';

export const claudeImportLogic = {
  async clImport() {
    const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
    const v = importView(this.LIVE.claudeImport, this.LIVE.claudeHub, { hasBridge, canWrite: this.canWrite(), writeReason: this.writeReason() });
    if (!v.canImport) { this.denied(v.why); return; }
    const r = await this.call(() => this.hq.claudeHub.importExport(), 'Import failed');
    if (r && r.started) {
      this.LIVE.claudeImport = { kind: 'import', phase: 'unzip', done: 0, total: 0 };
      this.toast('info', 'Importing ' + (r.file || 'the export') + ' — the counter shows progress; chats are listed when the import finishes.');
      this.forceUpdate();
    }
  },
};
