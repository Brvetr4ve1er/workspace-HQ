// Studio actions (Phase 3 P4, v3 realms/studio/view.js): the capture media in the
// grid and the lightbox, and Show in folder. Component.prototype mixin (src/app.js):
// same `this` as the class methods.
//
//  - Length of a recording: only the <video> knows it, once it has loaded metadata
//    (the lightbox). Recorder WebM files often report Infinity until played through,
//    so only a finite, positive length is kept (per path, for this window's life);
//    the tiles show it once known and hide the field otherwise, never a guess.
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
};
