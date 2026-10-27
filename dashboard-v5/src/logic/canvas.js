// Claude › Canvas card actions (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card): Pin to Home, Remove.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
import { FX } from './shared.js';
import { pinKey, togglePin, CANVAS_PIN_MAX } from './canvas-pins.mjs';
import { CANVAS_NAME_RE } from './claude.js';

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

  // ---- ＋ Board / Clear board (IPC-CONTRACT 2026-10-27 ＋ Board and Clear board) ----
  // why boards can't be made or cleared right now ('' = they can)
  canvasBoardWhy() {
    if (!this.hq || !this.hq.canvasCreate) return 'Unavailable — the bridge is offline';
    if (!this.canWrite()) return this.writeReason() || 'Read-only right now';
    return '';
  },
  // why this draft can't be a board name ('' = it can)
  canvasBoardNameWhy(draft) {
    const name = String(draft || '').trim();
    if (!name) return 'Type a name for the board';
    if (!CANVAS_NAME_RE.test(name)) return 'Letters, digits, spaces, - and _ only (max 64)';
    if (this.canvasBoardNames().some((n) => n.toLowerCase() === name.toLowerCase())) return 'There is already a board called ' + name;
    return '';
  },
  toggleCanvasBoard() {
    if (this.state.canvasBoardOpen) { this.setState({ canvasBoardOpen: false }); return; }
    const why = this.canvasBoardWhy(); if (why) return this.denied(why);
    this.setState({ canvasBoardOpen: true, canvasNoteOpen: false }); FX().sfx('open');
  },
  canvasBoardKey(e) { if (e.key === 'Enter' && !e.isComposing && !e.repeat) { e.preventDefault(); this.createCanvasBoard(); } },
  async createCanvasBoard() {
    const why = this.canvasBoardWhy(); if (why) return this.denied(why);
    const name = String(this.state.canvasBoardDraft || '').trim();
    const bad = this.canvasBoardNameWhy(name); if (bad) { this.toast('info', bad); return; }
    if (this.state.canvasCreating) return;
    this.setState({ canvasCreating: true });
    let r;
    try { r = await this.hq.canvasCreate(name); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { this.setState({ canvasCreating: false }); this.toast('error', 'Board not created · ' + ((r && r.error) || 'no answer')); FX().sfx('error'); return; }
    // the new board is where ＋ Note writes next; it shows up when main's watcher pushes
    this.setState({ canvasCreating: false, canvasBoardOpen: false, canvasBoardDraft: '', canvasBoard: name });
    this.toast('success', 'Board ' + name + ' created · add notes with ＋ Note'); FX().sfx('done');
  },
  // two clicks: Clear → "Clear N cards?" → hq.canvasClear; that board's pins drop with it
  async canvasClear(name, count) {
    const why = this.canvasBoardWhy(); if (why) return this.denied(why);
    if (!this.hq.canvasClear) return this.denied('Unavailable — the bridge is offline');
    if (!count) return this.toast('info', name + ' is already empty');
    if (this.state.canvasClearing) return;
    if (this.state.canvasClearAsk !== name) { this.setState({ canvasClearAsk: name }); return; }
    this.setState({ canvasClearing: name });
    let r;
    try { r = await this.hq.canvasClear(name); } catch (e) { r = { error: String((e && e.message) || e) }; }
    const ok = !!(r && r.ok);
    this.setState((s) => ({ canvasClearing: null, canvasClearAsk: null, canvasPins: ok ? (s.canvasPins || []).filter((k) => !k.startsWith(name + '/')) : s.canvasPins }));
    if (!ok) { this.toast('error', 'Not cleared · ' + ((r && r.error) || 'no answer')); FX().sfx('error'); return; }
    this.toast('success', 'Cleared ' + name + ' · ' + r.nodes + ' card' + (r.nodes === 1 ? '' : 's') + ' copied to data\\canvas\\removed.jsonl'); FX().sfx('done');
  },
};
