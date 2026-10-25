// Claude Hub H4 — the "Import claude.ai export" strip (Claude › Chats and Settings). Keys start with ci.
import { importView } from '../live/adapter.mjs';

export function claudeImportVals(ctx) {
  const { LIVE, cantWrite, writeReason } = ctx;
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
  const v = importView(LIVE.claudeImport, LIVE.claudeHub, { hasBridge, canWrite: !cantWrite, writeReason });
  const color = v.tone === 'error' ? 'var(--orange)' : v.tone === 'ok' ? 'var(--text)' : 'var(--muted)';
  return {
    ciImport: () => this.clImport(), ciCant: !v.canImport,
    ciTip: v.why || 'Pick your claude.ai data export (.zip) — it is read on this PC only; nothing is uploaded',
    ciRunning: v.running, ciText: v.text, ciHasText: !!v.text, ciTone: { fontSize: '12px', color },
    ciReport: v.report.map((text, i) => ({ key: 'r' + i, text })), ciHasReport: v.hasReport,
  };
}
