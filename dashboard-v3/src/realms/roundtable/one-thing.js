// Provenance: dashboard/lib/one-thing.js (v2 tree, READ-ONLY) is dual-mode —
// require()'d by its node test and side-effect-loaded in browsers, where it
// attaches window.computeOneThing. Importing it as ESM takes the browser path
// (`typeof module` is false in module scope), so this seam just re-exports the
// window attach. Do not copy the ranking here; the v2 file stays the one truth.
import '../../../../dashboard/lib/one-thing.js';

export const computeOneThing = window.computeOneThing;
