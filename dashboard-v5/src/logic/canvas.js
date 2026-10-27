// Claude › Canvas card actions (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card): Pin to Home, Remove.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
import { FX } from './shared.js';
import { pinKey, togglePin, CANVAS_PIN_MAX } from './canvas-pins.mjs';

export const canvasLogic = {
  // per-PC (whq3-prefs.canvasPins), so a pin works in the preview and on past snapshots too
  canvasPinToggle(w) {
    const key = pinKey(w); if (!key) return this.denied('This card has no id, so it can’t be pinned');
    const r = togglePin(this.state.canvasPins, key);
    if (r.full) return this.toast('info', 'Pin up to ' + CANVAS_PIN_MAX + ' canvas cards — unpin one first');
    const on = r.pins.includes(key);
    this.setState({ canvasPins: r.pins });
    this.toast('info', on ? 'Pinned to Home · on this PC' : 'Unpinned from Home');
  },
  // two clicks: Remove → "Remove for good?" → hq.canvasRemove; the board update arrives by push
  async canvasRemove(w) {
    const key = pinKey(w); if (!key) return this.denied('This card has no id, so it can’t be removed here');
    if (!this.hq || !this.hq.canvasRemove) return this.denied('Unavailable — the bridge is offline');
    if (!this.canWrite()) return this.denied();
    if (this.state.canvasRemoving) return;
    if (this.state.canvasRemoveAsk !== key) { this.setState({ canvasRemoveAsk: key }); return; }
    this.setState({ canvasRemoving: key });
    let r;
    try { r = await this.hq.canvasRemove(w.board, w.id); } catch (e) { r = { error: String((e && e.message) || e) }; }
    this.setState((s) => ({ canvasRemoving: null, canvasRemoveAsk: null, canvasPins: r && r.ok ? (s.canvasPins || []).filter((k) => k !== key) : s.canvasPins }));
    if (!r || !r.ok) { this.toast('error', 'Not removed · ' + ((r && r.error) || 'no answer')); FX().sfx('error'); return; }
    this.toast('success', 'Removed from ' + w.board + ' · a copy is kept in data\\canvas\\removed.jsonl'); FX().sfx('done');
  },
};
