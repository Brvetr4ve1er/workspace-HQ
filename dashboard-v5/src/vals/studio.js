// Studio render values: captures by day, filters, snip / record, lightbox.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).
// Phase 3 P4: real media (v3 parity). Tiles: the sidecar thumbnail, else the snip
// file itself, else a glyph (▶ for a recording). The hero and the lightbox show
// the file (<img> / <video controls>) through model.fileUrl. A recording's length
// comes from main's sidecar (capture durationMs) or, without one, once its video has
// reported one (logic/studio.js) — the video's own length wins when both exist;
// recovered recordings are badged. Open → studio.libraryOpen (logic/studio.js).
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
  // m:ss, or '' while unknown: the video's reported length, else main's recorded length
  const durOf = (c) => {
    if (c.kind !== 'rec') return '';
    const seen = this.capDur(c.path);
    return fmtDur(seen || (typeof c.durationMs === 'number' ? c.durationMs / 1000 : 0));
  };
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
    // opens the record panel (recording starts there), it doesn't start recording. While a
    // recording runs (LIVE.recording, from the rec-status pushes) the live pill is on screen and
    // this must not touch it. Main also guards it now: panel-toggle only shows the panel during
    // a recording (screen-capture.js showPanel); the renderer check stays as a second layer.
    record: () => {
      if (!studio) return this.denied();
      if (this.LIVE && this.LIVE.recording) { this.toast('info', 'Recording now · the recorder is the pill on screen — stop it there, or with Ctrl+Alt+R'); return; }
      studio.panelToggle();
    },
    hasLightbox: !!lbC, lb, closeLightbox: () => this.setState({ lightbox: null }),
    // studio.libraryOpen: main opens a capture file inside the library only (a main without it → "not wired")
    lbOpen: () => lbC && this.openCapture(lbC.path, lbC.name), lbCopy: () => lbC && this.copy(lbC.path, 'Copied the file path'), lbReveal: () => lbC && this.revealCapture(lbC.path),
    lbDelete: () => lbC && !ro() && this.sheet({ act: 'delete', path: lbC.path, name: lbC.name, title: 'Delete ' + lbC.name + '?', body: 'It goes to the Recycle Bin.', ok: 'Delete', danger: true }),
  };
}
