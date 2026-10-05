// Render values for src/tpl/extras.tpl.js (v5 additions without a design slice):
// the "What's new · trailers" overlay (Phase 3 P8, logic in src/logic/whats-new.js).
import { TRAILERS, WHATS_NEW_VERSION, changesFor } from '../logic/whats-new.js';

export function extrasVals(ctx) {
  const S = ctx.S, failed = S.whatsNewMissing || {};
  // ok = bundled in this build and hasn't failed to play; otherwise the text fallback
  const trailers = TRAILERS.map((t) => {
    const ok = !!t.bundled && !failed[t.id];
    return { title: t.title, src: t.src, poster: t.poster, ok, missing: !ok, failed: () => this.trailerFailed(t.id) };
  });
  return {
    whatsNewOpen: !!S.whatsNewOpen, openWhatsNew: () => this.openWhatsNew(), closeWhatsNew: () => this.closeWhatsNew(),
    whatsNew: { version: 'v5 · ' + WHATS_NEW_VERSION, trailers, changes: changesFor(this) },
  };
}
