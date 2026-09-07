// icons.js — the sprite loader + helpers for dashboard-v3/icons/hq-icons.svg.
//
// WHY A SPRITE, NOT PER-ICON <img>. A rail with 16 icons + verbs everywhere
// would otherwise trigger dozens of file:// GETs; a single sprite is one fetch,
// and `<use href="#name">` references then reuse the injected symbols with no
// further round trips. It also keeps the amber-nexus stroke discipline in ONE
// place — every symbol composes the sprite's <style> rules.
//
// WHY WE INJECT INSTEAD OF `<use href="hq-icons.svg#name">`. Chromium under
// file:// treats cross-file <use> references as cross-origin for many purposes
// (they render, but their fill/stroke propagation is fragile and the DOM
// element's boundingClientRect can lag). Inlining the sprite into <body> makes
// every <use href="#name"> same-document, which sidesteps that entirely.
//
// LIFECYCLE. `injectIconSprite()` is idempotent — it runs once at boot and
// re-runs on a hot reload without duplicating. `hasIcon()` reads the injected
// DOM (never the raw source string), so a symbol I later remove from the sprite
// vanishes from the app the same session without a code change here.

const SPRITE_URL = new URL('../../icons/hq-icons.svg', import.meta.url).href;
const SLOT_ID = 'hq-icon-sprite';
let injectPromise = null;

/**
 * Fetch the sprite and inject it into <body> as a hidden container.
 * Idempotent; safe to call more than once.  Returns a Promise that resolves
 * when the sprite is in the DOM (or rejects if the fetch fails).
 */
export function injectIconSprite() {
  if (document.getElementById(SLOT_ID)) return injectPromise || Promise.resolve();
  if (injectPromise) return injectPromise;
  injectPromise = fetch(SPRITE_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`sprite fetch ${r.status}`);
      return r.text();
    })
    .then((svg) => {
      // Guard against a hot-reload race where two callers fetch in parallel.
      if (document.getElementById(SLOT_ID)) return;
      const slot = document.createElement('div');
      slot.id = SLOT_ID;
      slot.setAttribute('aria-hidden', 'true');
      slot.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
      // Sprite content is authored by us and shipped in-repo — safe to inline.
      slot.innerHTML = svg;
      document.body.appendChild(slot);
    })
    .catch((err) => {
      // Not fatal: every caller of icon() falls back to whatever placeholder the
      // realm registered (m.sigil), and callers of hasIcon() see false.
      console.warn('[icons] sprite inject failed:', err && err.message);
      injectPromise = null;                 // allow a retry on the next call
      throw err;
    });
  return injectPromise;
}

/**
 * Does a symbol with this id exist in the injected sprite?
 * Reads the DOM, not the source string, so removing a symbol without a
 * corresponding code edit correctly reports false.
 */
export function hasIcon(name) {
  if (!name) return false;
  return !!document.getElementById(`i-${name}`);
}

/**
 * Return an SVG string that references a sprite symbol.
 *   icon('realm-forge')                         → default 20px, currentColor
 *   icon('verb-snip', { size: 16 })             → 16px
 *   icon('realm-forge', { className: 'x y' })   → adds extra CSS classes
 *
 * The returned string is safe to concatenate into an HTML template: it contains
 * no user data (the name is a fixed key our own code chooses) and the size is
 * clamped to an integer. Callers should still use textContent for any *label*
 * they render beside the icon.
 */
export function icon(name, opts) {
  const size = Math.max(8, Math.min(96, Math.round(opts?.size ?? 20)));
  const cls = String(opts?.className ?? '').replace(/[^a-zA-Z0-9 _-]/g, '');
  const id = String(name).replace(/[^a-zA-Z0-9_-]/g, '');
  return `<svg class="i i-${id}${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-${id}"/></svg>`;
}

/**
 * Convenience for the level-coin frame (48-unit viewBox, not 24).  Same
 * currentColor + CSS class discipline as icon().
 */
export function coinFrame(size = 96, className = '') {
  const s = Math.max(24, Math.min(256, Math.round(size)));
  const cls = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
  return `<svg class="i i-brand-level-coin${cls ? ' ' + cls : ''}" width="${s}" height="${s}" viewBox="0 0 48 48" aria-hidden="true"><use href="#i-brand-level-coin"/></svg>`;
}
