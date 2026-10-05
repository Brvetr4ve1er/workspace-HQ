// Add-a-project onboarding. obSet / finishOnboard are RECONSTRUCTED: rebuilt from how
// the template uses them, not from the Design export (see the note in src/vals/overlays.js).
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.

export const onboardLogic = {
  obSet(k, e) { const val = e.target.value; this.setState((st) => ({ onboard: Object.assign({}, st.onboard, { [k]: val }) })); },
  // Tracked projects live in collector/collector.config.json (structure lane);
  // there is no app channel to add one yet, so the last step hands over a
  // ready-to-paste entry instead of pretending it was added.
  finishOnboard() {
    const o = this.state.onboard; if (!o) return;
    const name = (o.name || '').trim() || (o.path || '').split(/[\\/]/).filter(Boolean).pop() || 'new-project';
    const entry = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, path: o.path, dev_cmd: o.dev || null, canonical_branch: o.branch || 'main' };
    this.copy(JSON.stringify(entry, null, 2), 'Copied the project entry · paste it into collector.config.json, then Scan now');
    this.setState({ onboard: null });
  },
};
