// Focus mode render values.

export function focusVals(ctx) {
  const { S, H, open, TR, tk } = ctx;
  // ----- focus -----
  let focus = {};
  if (S.focus) {
    const t = H.T0.find((x) => x.id === S.focus.taskId), secs = Math.floor((S.now - S.focus.start) / 1000);
    focus = t ? Object.assign(tk(t), { has: true, none: false, elapsed: String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0') }) : { has: false, none: true, elapsed: '00:00' };
    focus.picker = open.filter((x) => !t || x.id !== t.id).slice(0, 4).map((x) => ({ title: x.title, color: TR[x.tier].color, go: () => this.setState({ focus: { taskId: x.id, start: Date.now() } }) }));
    focus.hasPicker = focus.picker.length > 0;
    focus.stop = () => this.endFocus(true);
  }
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    hasFocus: !!S.focus, focus, closeFocus: () => this.endFocus(false),
  };
}
