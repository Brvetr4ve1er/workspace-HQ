// Studio render values: captures by day, filters, snip / record, lightbox.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).
// Phase 3 P4: real media (v3 parity). Tiles: the sidecar thumbnail, else the snip
// file itself, else a glyph (▶ for a recording). The hero and the lightbox show
// the file (<img> / <video controls>) through model.fileUrl. A recording's length
// shows once its video has reported one (logic/studio.js); recovered recordings
// are badged.
import { fmtDur } from '../logic/studio.js';

const RECOVERED = 'Restored from a recording that ended abnormally — the last few seconds may be missing';

export function studioVals(ctx) {
  const { S, H, tabStyle, ro } = ctx;
  const fileOf = (c) => (H.fileUrl ? H.fileUrl(c.path) : '');
  // the first source that hasn't failed to load; '' → the glyph
  const pick = (list) => list.find((s) => s && !this.capBad(s)) || '';
  const media = (c, big) => {
    const file = fileOf(c), isRec = c.kind === 'rec';
    // a recording's file is a video: never in an <img>. Tiles prefer the small sidecar, the hero the file.
    const src = isRec ? pick([c.thumb]) : pick(big ? [file, c.thumb] : [c.thumb, file]);
    return { src, hasImg: !!src, noImg: !src, glyph: isRec ? '▶' : '▢', onErr: () => this.markCapBad(src) };
  };
  const durOf = (c) => (c.kind === 'rec' ? fmtDur(this.capDur(c.path)) : '');
  // ---- studio ----
  const caps = H.CAPTURES.filter((c) => S.studioFilter === 'all' || c.kind === S.studioFilter);
  const days = []; caps.slice(0, 120).forEach((c) => {
    let d = days.find((x) => x.day === c.day); if (!d) { d = { day: c.day, items: [] }; days.push(d); }
    const dur = durOf(c);
    d.items.push(Object.assign(media(c, false), { name: c.name, time: c.time, size: c.size, isRec: c.kind === 'rec', dur, hasDur: !!dur, recovered: !!c.recovered, recoveredTip: RECOVERED, open: () => this.setState({ lightbox: c.id }) }));
  });
  const latest = caps[0];
  const lbC = S.lightbox ? H.CAPTURES.find((c) => c.id === S.lightbox) : null;
  const studioFilters = [['all', 'All'], ['snip', 'Snips'], ['rec', 'Recordings']].map(([id, l]) => ({ label: l, go: () => this.setState({ studioFilter: id }), style: tabStyle(S.studioFilter === id) }));
  const studio = this.hq && this.hq.studio;
  let lb = {};
  if (lbC) {
    const isRec = lbC.kind === 'rec', file = fileOf(lbC), bad = this.capBad(file), dur = durOf(lbC);
    lb = {
      name: lbC.name, isRec,
      meta: lbC.day + ' ' + lbC.time + ' · ' + lbC.size + (dur ? ' · ' + dur : '') + (lbC.recovered ? ' · recovered: the last few seconds may be missing' : ''),
      src: file, isImg: !!file && !bad && !isRec, isVideo: !!file && !bad && isRec, noMedia: !file || bad,
      missing: bad ? 'Couldn’t load ' + lbC.name + ' · it may have been moved or deleted' : lbC.name,
      onErr: () => this.markCapBad(file),
      onMeta: (e) => this.noteCapDur(lbC.path, e),
    };
  }
  return {
    days, hasCaps: caps.length > 0, noCaps: caps.length === 0, hasLatest: !!latest, openLatest: () => latest && this.setState({ lightbox: latest.id }), studioFilters,
    latest: latest ? Object.assign(media(latest, true), { name: latest.name, day: latest.day, time: latest.time, size: latest.size }) : {},
    snip: () => { if (!studio) return this.denied(); studio.snipArm('region'); },
    // opens the record panel (recording starts there), it doesn't start recording
    record: () => { if (!studio) return this.denied(); studio.panelToggle(); },
    hasLightbox: !!lbC, lb, closeLightbox: () => this.setState({ lightbox: null }),
    // there is no "open this capture in its own app" channel (hq.openFile only opens files inside project folders)
    lbOpen: () => lbC && this.notWired('Opening a capture in its own app'), lbCopy: () => lbC && this.copy(lbC.path, 'Copied the file path'), lbReveal: () => lbC && this.revealCapture(lbC.path),
    lbDelete: () => lbC && !ro() && this.sheet({ act: 'delete', path: lbC.path, name: lbC.name, title: 'Delete ' + lbC.name + '?', body: 'It goes to the Recycle Bin.', ok: 'Delete', danger: true }),
  };
}
