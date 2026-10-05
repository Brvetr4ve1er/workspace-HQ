// Studio render values: captures by day, filters, snip / record, lightbox.
// Moved from moreVals() in app-more.js (pre-split, a8e0bf1).

export function studioVals(ctx) {
  const { S, H, tabStyle, ro } = ctx;
  // ---- studio ----
  const caps = H.CAPTURES.filter((c) => S.studioFilter === 'all' || c.kind === S.studioFilter);
  const days = []; caps.slice(0, 120).forEach((c) => { let d = days.find((x) => x.day === c.day); if (!d) { d = { day: c.day, items: [] }; days.push(d); } d.items.push({ name: c.name, time: c.time, size: c.size, isRec: c.kind === 'rec', dur: '', open: () => this.setState({ lightbox: c.id }) }); });
  const latest = caps[0];
  const lbC = S.lightbox ? H.CAPTURES.find((c) => c.id === S.lightbox) : null;
  const studioFilters = [['all', 'All'], ['snip', 'Snips'], ['rec', 'Recordings']].map(([id, l]) => ({ label: l, go: () => this.setState({ studioFilter: id }), style: tabStyle(S.studioFilter === id) }));
  const studio = this.hq && this.hq.studio;
  return {
    days, hasCaps: caps.length > 0, noCaps: caps.length === 0, latest: latest || {}, hasLatest: !!latest, openLatest: () => latest && this.setState({ lightbox: latest.id }), studioFilters,
    snip: () => { if (!studio) return this.denied(); studio.snipArm('region'); },
    record: () => { if (!studio) return this.denied(); studio.panelToggle(); },
    hasLightbox: !!lbC, lb: lbC ? { name: lbC.name, meta: lbC.day + ' ' + lbC.time + ' · ' + lbC.size, isRec: lbC.kind === 'rec' } : {}, closeLightbox: () => this.setState({ lightbox: null }),
    lbOpen: () => lbC && studio && studio.libraryReveal(lbC.path), lbCopy: () => lbC && this.copy(lbC.path, 'Copied the file path'), lbReveal: () => lbC && studio && studio.libraryReveal(lbC.path),
    lbDelete: () => lbC && !ro() && this.sheet({ act: 'delete', path: lbC.path, name: lbC.name, title: 'Delete ' + lbC.name + '?', body: 'It goes to the Recycle Bin.', ok: 'Delete', danger: true }),
  };
}
