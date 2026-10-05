// Snapshots (time machine) and snapshot-compare render values.

export function scrubVals(ctx) {
  const { S, H, off, live, snap, viewedLabel, open, unc, tabStyle } = ctx;
  // ----- scrub (time machine) -----
  const scrubSpan = this.span(90, 0), scrubSeries = scrubSpan.map((o) => ({ o, v: this.series('unc', o) }));
  const smax = Math.max(1, ...scrubSeries.map((x) => x.v));
  const scrubBars = scrubSeries.map((x) => ({ h: 6 + Math.round(x.v / smax * 40), c: x.o === off ? 'var(--gold)' : x.o === 0 ? 'var(--green)' : 'var(--frame-hi)', title: H.fmtD(H.dayAt(x.o)) + ' · ' + x.v + ' uncommitted', go: () => this.setState({ snapOffset: x.o }) }));
  const quick = [['Live', 0], ['Yesterday', 1], ['7 scans ago', 7], ['30 scans ago', 30], ['Oldest', H.maxOff]].filter(([, o], i, a) => o <= H.maxOff && a.findIndex((x) => x[1] === o) === i);
  const scrubQuick = quick.map(([l, o]) => ({ label: l, go: () => this.setState({ snapOffset: o }), style: Object.assign(tabStyle(off === o), { height: 30, fontSize: 12, padding: '0 10px' }) }));
  // ----- compare two snapshots -----
  const cmpRows = S.compareOff == null ? [] : [['Uncommitted files', 'unc', 'down'], ['Open tasks', 'tasks', 'down'], ['Likely secrets', 'secrets', 'down'], ['Commits that scan', 'commits', 'up'], ['XP', 'xp', 'up']].map(([l, m, good]) => { const a = this.series(m, S.compareOff), b = this.series(m, off), d = b - a; return { l, a, b, d: (d > 0 ? '+' : '') + d, c: d === 0 ? 'var(--faint)' : ((d < 0) === (good === 'down') ? 'var(--green)' : 'var(--orange)') }; });
  const scrubTo = H.fmtD(H.dayAt(0)), scrubFrom = H.fmtD(H.dayAt(scrubSpan[0]));
  return {
    compareOn: S.compareOff != null, toggleCompare: () => this.setState({ compareOff: S.compareOff == null ? Math.min(H.maxOff, off + 7) : null }), compareLabel: S.compareOff != null ? H.fmtD(H.dayAt(S.compareOff)) + ' → ' + viewedLabel : '', compareShift: (d) => this.setState((st) => ({ compareOff: Math.max(0, Math.min(H.maxOff, (st.compareOff || 0) + d)) })), cmpBack: () => this.setState((st) => ({ compareOff: Math.min(H.maxOff, (st.compareOff || 0) + 1) })), cmpFwd: () => this.setState((st) => ({ compareOff: Math.max(0, (st.compareOff || 0) - 1) })),
    cmpRows, scrubFrom, scrubTo,
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // snapshots
    scrubOpen: S.scrubOpen, closeScrub: () => this.setState({ scrubOpen: false }), scrubBars, scrubQuick,
    scrubSel: { label: live ? 'Live · ' + viewedLabel : viewedLabel, unc, tasks: open.length, xp: this.xpAt(off), changes: snap.changes.length },
  };
}
