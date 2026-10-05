// Ask panel render values.

export function askVals(ctx) {
  const { S, live } = ctx;
  // ----- ask (model text renders as plain text; never outside this panel) -----
  const asks = S.askHistory.map((h) => ({ q: h.q, text: h.a.text || (h.a.status === 'thinking' ? '…' : ''), src: h.a.src || [], hasSrc: (h.a.src || []).length > 0, est: !!h.a.est, refusal: !!h.a.refusal }));
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // ask
    askOpen: S.askOpen, closeAsk: () => this.setState({ askOpen: false }), askPastNote: !live, asks, askDraft: S.askDraft,
    onAskInput: (e) => this.setState({ askDraft: e.target.value }), askKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.submitAsk(this.state.askDraft); } }, askSubmit: () => this.submitAsk(S.askDraft),
  };
}
