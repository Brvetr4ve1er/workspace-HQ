// Module-level helpers shared by src/app.js, the src/logic/*.js mixins and
// src/vals/*.js. Moved verbatim from app.js; stateless (prefs live in
// localStorage, everything else on the Component).
export const FX = () => window.HQFx || { sfx() {}, burst() {}, coinFly() { return Promise.resolve(); }, event() {}, say() {}, set() {}, init() {}, destroy() {}, floatText() {}, asciiBurst() {} };
export const PREFS = 'whq3-prefs';
export const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
export const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} };
export const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export const WRITE_DELAY = 1600;   // ms before a reloading write fires (Undo window)
// one idea text, compared: case, spacing and trailing punctuation don't count. The project page's
// Next (vals/project-page.js) and the capture buttons (logic/system.js) use this same key.
export const normText = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.!…]+$/, '').trim();

// ---- shared UI prefs (theme, reduce motion) ------------------------------------
// Main holds theme + reduce motion for every window (dashboard/ui-prefs.js,
// hq.uiPrefs); v5 keeps its own copy in whq3-prefs and v3 left its choices in
// 'hq-theme' / 'hq-sfx' / 'hq-ambient'. Every storage access is guarded: a
// private or blocked storage must not take the screen down.
export const THEMES = ['dark', 'light', 'os'];
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// v3 has seven themes and only 'daylight' is light; v5 has dark / light / os.
export const fromV3Theme = (t) => (t === 'daylight' ? 'light' : 'dark');

// What v3 left behind that v5 can seed from; null = v3 never stored it.
export function readV3Prefs() {
  const t = lsGet('hq-theme'), s = lsGet('hq-sfx'), a = lsGet('hq-ambient');
  return {
    theme: t ? fromV3Theme(t) : null,
    sound: s === '1' ? true : s === '0' ? false : null,
    ambientPref: a === 'open' ? true : a === 'closed' ? false : null,
  };
}

// Mirror v5's theme into v3's key so a rollback to v3 keeps it. Family-preserving:
// light → 'daylight'; dark → 'nexus' unless v3 already holds one of its dark
// themes (an 'arcade' pick survives); 'os' leaves v3's value alone. Writing also
// sets 'hq-theme-migrated', or v3's one-time migration would reset it to 'nexus'.
export function mirrorV3Theme(theme) {
  const cur = lsGet('hq-theme');
  let next = null;
  if (theme === 'light') next = cur === 'daylight' ? null : 'daylight';
  else if (theme === 'dark') next = cur && cur !== 'daylight' ? null : 'nexus';
  if (!next) return;
  lsSet('hq-theme', next);
  lsSet('hq-theme-migrated', '1');
}

// The viewed scan is remembered by id (whq3-place.snapId): a scan that lands while
// viewing the past shifts every offset by one, the id doesn't. Live (offset 0) is
// stored WITHOUT an id: live follows the latest scan, and a finished scan reloads
// the window — keyed by id, live would come back one scan in the past, read-only.
//   M = the store model ({ maxOff, at(off) → { id } })
export function placeSnapId(M, off) { return off > 0 ? ((M.at(off) || {}).id || null) : null; }
// → the offset to open at: 0 for live (whatever id an entry carries), the saved
// scan's current offset when it's still there, live when it's gone; an entry
// without an id (older builds) keeps its offset, clamped.
export function restoreSnapOffset(saved, M) {
  const off = Math.max(0, Math.min(M.maxOff, +((saved || {}).snapOffset) || 0));
  if (!off || !saved.snapId) return off;
  for (let o = 0; o <= M.maxOff; o++) if ((M.at(o) || {}).id === saved.snapId) return o;
  return 0;
}

// <html data-hq-reduce="1"> while Reduce motion is on; the custom elements
// (src/elements/hq-v3.js) read it next to prefers-reduced-motion.
export function setReduceFlag(on) {
  try { const d = document.documentElement.dataset; if (on) d.hqReduce = '1'; else delete d.hqReduce; } catch {}
}

// The one-time seed (whq3-prefs gets uiPrefsSeeded afterwards). Pure.
//   P    = whq3-prefs as saved          main = { theme, reduceMotion } from hq.uiPrefs
//   v3   = readV3Prefs()
// → { state: patch for v5's state, push: patch for hq.uiPrefs.set, or null }
// Main still on its defaults (dark, motion on) means nobody chose there yet:
// v5's own saved choice goes to main, else v3's theme does. Otherwise main's
// choice is adopted. Sound and the status rail exist only in v5: v3's values
// fill in what v5 never saved.
export function planUiSeed(P, main, v3) {
  P = P || {}; v3 = v3 || {};
  const state = {}, push = {};
  if (main.theme === 'dark' && !main.reduceMotion) {
    const theme = THEMES.includes(P.themePref) ? P.themePref : v3.theme;
    if (theme) { state.themePref = theme; if (theme !== main.theme) push.theme = theme; }
    if (typeof P.reduceMotion === 'boolean') { state.reduceMotion = P.reduceMotion; if (P.reduceMotion !== main.reduceMotion) push.reduceMotion = P.reduceMotion; }
    else state.reduceMotion = main.reduceMotion;
  } else {
    state.themePref = main.theme; state.reduceMotion = main.reduceMotion;
  }
  if (typeof P.sound !== 'boolean' && typeof v3.sound === 'boolean') state.sound = v3.sound;
  if (typeof P.ambientPref !== 'boolean' && typeof v3.ambientPref === 'boolean') state.ambientPref = v3.ambientPref;
  return { state, push: Object.keys(push).length ? push : null };
}
