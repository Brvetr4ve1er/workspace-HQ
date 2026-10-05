// Module-level helpers shared by src/app.js, the src/logic/*.js mixins and
// src/vals/*.js. Moved verbatim from app.js; stateless (prefs live in
// localStorage, everything else on the Component).
export const FX = () => window.HQFx || { sfx() {}, burst() {}, coinFly() { return Promise.resolve(); }, event() {}, say() {}, set() {}, init() {}, destroy() {}, floatText() {}, asciiBurst() {} };
export const PREFS = 'whq3-prefs';
export const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch { return {}; } };
export const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} };
export const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export const WRITE_DELAY = 1600;   // ms before a reloading write fires (Undo window)
