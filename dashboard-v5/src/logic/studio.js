// Studio actions (Phase 3 P4, v3 realms/studio/view.js): the capture media in the
// grid and the lightbox, and Show in folder. Component.prototype mixin (src/app.js):
// same `this` as the class methods.
//
//  - Length of a recording: main writes one next to every clean save (library-list
//    durationMs, a .meta sidecar), so tiles and the lightbox show it at once. Older
//    recordings, recovered ones and saves with gaps have none (null): then only the
//    <video> knows it, once it has loaded metadata (the lightbox). Recorder WebM files
//    often report Infinity until played through, so only a finite, positive length is
//    kept (per path, for this window's life) — and when the video does report one, that
//    is the file's own length and wins over the sidecar. Unknown hides the field, never
//    a guess (vals/studio.js durOf).
//  - A file that fails to load (moved or deleted since the list was read) is
//    remembered by its URL, so the tile falls back to its glyph and the lightbox
//    says it couldn't load it instead of showing a broken image.
import { FX } from './shared.js';

// seconds → "m:ss" / "h:mm:ss"; '' when unknown (not finite, 0 or negative)
export function fmtDur(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.max(1, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
}

export const studioLogic = {
  // recorded length in seconds, 0 while unknown
  capDur(path) { const m = this._capDur; return (m && m.get(path)) || 0; },
  // <video> loadedmetadata / durationchange → remember a real length and re-render
  noteCapDur(path, e) {
    const v = e && e.target, d = v ? Number(v.duration) : NaN;
    if (!path || !Number.isFinite(d) || d <= 0) return;
    if (!this._capDur) this._capDur = new Map();
    if (this._capDur.get(path) === d) return;
    this._capDur.set(path, d);
    this.forceUpdate();
  },
  capBad(src) { return !!(src && this._capBad && this._capBad.has(src)); },
  // <img>/<video> error → this URL doesn't load; the next render uses the fallback
  markCapBad(src) {
    if (!src || this.capBad(src)) return;
    if (!this._capBad) this._capBad = new Set();
    this._capBad.add(src);
    this.forceUpdate();
  },
  // Show in folder (studio.libraryReveal → true / false; main refuses paths outside the library)
  async revealCapture(path) {
    if (!path) return;
    const st = this.hq && this.hq.studio;
    if (!st || !st.libraryReveal) return this.denied('Unavailable — the bridge is offline');
    let ok = false, why = '';
    try { ok = (await st.libraryReveal(path)) === true; } catch (e) { why = ' · ' + ((e && e.message) || e); }
    if (!ok) { this.toast('error', 'Couldn’t show it in its folder' + (why || ' · it may have been moved or deleted')); FX().sfx('error'); }
  },
  // Open in its default app (studio.libraryOpen → true | false | {error}; main opens only a
  // capture file inside the library). A bridge without libraryOpen is a main that predates it:
  // that is "not wired", not a failure.
  async openCapture(path, name) {
    if (!path) return;
    const st = this.hq && this.hq.studio;
    if (!st) return this.denied('Unavailable — the bridge is offline');
    if (typeof st.libraryOpen !== 'function') return this.notWired('Opening a capture in its own app');
    let r, why = '';
    try { r = await st.libraryOpen(path); } catch (e) { why = String((e && e.message) || e); }
    const label = name || String(path).split(/[\\/]/).pop();
    if (r === true) { this.toast('success', 'Opening ' + label + ' in its default app'); return; }
    if (/No handler registered/i.test(why)) why = 'restart WorkspaceHQ first — the running app is older than this button';
    else if (!why && r && typeof r === 'object' && r.error) why = String(r.error);
    this.toast('error', 'Couldn’t open ' + label + ' · ' + (why || 'it isn’t a capture in the library, or it was moved or deleted'));
    FX().sfx('error');
  },
};
