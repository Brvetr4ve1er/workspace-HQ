// AI archive H6 — drop card, ChatGPT import button, System report, document hits + view. Every key starts with di or cd.
import { dropCards, hubDocHit, hubDocument, importReportLines, importView } from '../live/adapter.mjs';

export function claudeImportsVals(ctx) {
  const { LIVE, cantWrite, writeReason } = ctx;
  const imp = LIVE.claudeImports || { folder: null, found: [], refused: [] };
  const hasBridge = !!(this.hq && this.hq.claudeHub && this.hq.claudeHub.importExport);
  const v = importView(LIVE.claudeImport, LIVE.claudeHub, { hasBridge, canWrite: !cantWrite, writeReason });
  const cards = dropCards(imp), lib = LIVE.claudeLib || {};
  const last = LIVE.claudeHub && LIVE.claudeHub.lastImport;
  const report = last && last.ok ? importReportLines(last.report) : [];
  const folder = imp.folder;
  const doc = lib.doc || null, d = doc && !doc.loading && !doc.error ? hubDocument(doc) : null;
  const hits = Array.isArray(lib.docHits) ? lib.docHits.map((h) => hubDocHit(h)) : [];
  return {
    diImportChatGPT: () => this.diImportChatGPT(), diChatGPTTip: v.why || 'Pick your ChatGPT data export (.zip) — it is read on this PC only; nothing is uploaded',
    diShow: cards.length > 0, diCard: cards[0] || { text: '', sub: '', kind: '' }, diMore: cards.length > 1 ? '+ ' + (cards.length - 1) + ' more waiting' : '',
    diConfirm: () => this.diConfirm(), diDismiss: () => this.diDismiss(), diCant: !v.canImport, diCantTip: v.why || 'Import this export now',
    diHasReport: report.length > 0, diReport: report.map((text, i) => ({ key: 'r' + i, text })),
    diFolderText: !folder ? '' : folder.exists ? 'Drop folder: Documents\\' + folder.name + ' — new exports dropped there are offered once'
      : 'Drop folder: not created yet — create Documents\\' + folder.name + ' to drop exports there (WorkspaceHQ never creates it)',
    diHasRefused: (imp.refused || []).length > 0, diRefused: (imp.refused || []).map((r, i) => ({ key: 'x' + i, text: r.file + ': ' + r.error })),
    cdHasHits: hits.length > 0, cdHits: hits.map((h) => ({ ...h, open: () => this.cdOpenDoc(h.id) })),
    cdHitsText: hits.length === 1 ? '1 note or document matches' : hits.length + ' notes and documents match',
    cdOpen: !!doc, cdLoading: !!(doc && doc.loading), cdHasError: !!(doc && doc.error), cdError: doc && doc.error ? String(doc.error) : '',
    cdDoc: d || { title: '', badge: '', project: '', when: '', lines: [] }, cdClose: () => this.cdCloseDoc(),
  };
}
