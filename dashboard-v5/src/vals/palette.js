// Command palette render values (Go & do / Ask modes).

export function paletteVals(ctx) {
  const { S, tabStyle, rows } = ctx;
  // ----- palette -----
  const PI = S.paletteOpen ? this.paletteItems() : { groups: [], count: 0 };
  const palGroups = PI.groups.map((gr) => ({ name: gr.name, items: gr.items.map((it) => ({ glyph: it.glyph, label: it.label, hint: it.hint, run: () => { this.setState({ paletteOpen: false }); it.run(); }, hoverSel: () => this.setState({ paletteSel: it.idx }), style: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--term)', fontSize: 14, background: it.active ? 'var(--card-hi)' : 'transparent', color: it.active ? 'var(--text)' : 'var(--muted)', boxShadow: it.active ? 'inset 3px 0 0 var(--gold)' : 'none' } })) }));
  const palModeTabs = [['go', 'Go & do'], ['ask', '✦ Ask local model']].map(([id, l]) => ({ label: l, go: () => { if (id === 'ask') this.warmModel(); this.setState({ paletteMode: id }); }, style: Object.assign(tabStyle(S.paletteMode === id), { height: 30, fontSize: 12 }) }));
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // palette
    paletteOpen: S.paletteOpen, closePalette: () => this.setState({ paletteOpen: false }), palModeTabs, paletteQuery: S.paletteQuery,
    onPaletteInput: (e) => this.setState({ paletteQuery: e.target.value, paletteSel: 0 }),
    palPlaceholder: S.paletteMode === 'ask' ? 'Ask about your projects, tasks or scans…' : 'Go to, open or run…  try “commit ' + ((rows[0] || {}).name || 'a project').toLowerCase() + '”',
    palIsGo: S.paletteMode === 'go', palIsAsk: S.paletteMode === 'ask', palGroups, palEmpty: S.paletteMode === 'go' && PI.count === 0,
    askExamples: ['What is uncommitted?', 'Any exposed secrets?', 'What went stale?', 'What should I do first?'].map((q) => ({ q, go: () => this.submitAsk(q) })),
  };
}
