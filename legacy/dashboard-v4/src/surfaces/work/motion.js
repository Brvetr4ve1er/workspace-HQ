// motion — the ONLY animation entry point for the WORK surface.
//
// Three laws, all inherited from the design spec and the v3 war-room's hard-won
// drainHp() shape:
//
// 1. MOTION FOLLOWS A REAL STATE CHANGE. Every export here is named after the
//    event that earns it — a session appearing, output arriving, a session
//    settling, a queue item clearing. There is no fade-in, no reveal-on-mount,
//    no decorative loop. If you cannot name the event, there is no animation.
// 2. THE VENDOR FILE IS NOT LOAD-BEARING. anime.es.js is a static asset the
//    render path does not control, so it is dynamically imported and every
//    failure path (missing file, broken module, no default export) falls
//    through to an INSTANT SET of the same final state. The UI must be correct
//    with zero animation.
// 3. NOTHING ANIMATES A DETACHED NODE. Callers pass an `alive()` predicate
//    (checked AFTER the await, which is the whole point) — the WORK surface
//    mounts/unmounts on every surface switch and every selftest cycle, so an
//    unguarded continuation would tween DOM that has already been torn down.
//
// prefers-reduced-motion short-circuits every export to its instant path.

let animePromise = null;   // the vendored module, imported at most once per app run

export function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }   // matchMedia absent => assume motion is fine
}

// Resolves to anime() or null. NEVER rejects: a missing/broken vendor file is a
// styling degradation, not an error the render path has to handle.
function loadAnime() {
  if (!animePromise) {
    animePromise = import('../../../vendor/anime.es.js')
      .then((m) => (typeof m?.default === 'function' ? m.default : null))
      .catch((err) => { console.warn('[work/motion] anime unavailable — instant fallback', err); return null; });
  }
  return animePromise;
}

// A session card just appeared in the registry push.
export async function sessionAppeared(node, alive) {
  if (!node) return;
  if (reduceMotion()) return;                       // resting style IS the final state
  const anime = await loadAnime();
  if (!anime || !alive()) return;
  anime({ targets: node, translateX: [-14, 0], opacity: [0, 1], duration: 420, easing: 'easeOutExpo' });
}

// A chunk of output landed. Pulses the channel indicator, never the text —
// animating the text block would fight the scroller the user may be reading.
export async function outputArrived(node, alive) {
  if (!node || reduceMotion()) return;
  const anime = await loadAnime();
  if (!anime || !alive()) return;
  anime({ targets: node, opacity: [1, .25, 1], scale: [1, 1.35, 1], duration: 460, easing: 'easeOutQuad' });
}

// A session left 'running' (done/failed/killed) — one sweep across its card.
export async function sessionSettled(node, alive) {
  if (!node || reduceMotion()) return;
  const anime = await loadAnime();
  if (!anime || !alive()) return;
  anime({ targets: node, boxShadow: ['0 0 0 0 rgba(167,139,250,.55)', '0 0 26px 6px rgba(167,139,250,0)'], duration: 700, easing: 'easeOutQuad' });
}

// A queue item was CONFIRMED cleared (main returned true) — collapse it out and
// call done() once the node is gone. done() ALWAYS runs, on every path, so the
// DOM removal can never be stranded behind a failed import.
export async function itemCleared(node, alive, done) {
  const finish = () => { try { done(); } catch (err) { console.warn('[work/motion] itemCleared done()', err); } };
  if (!node || reduceMotion()) { finish(); return; }
  const anime = await loadAnime();
  if (!anime || !alive()) { finish(); return; }
  anime({
    targets: node,
    opacity: [1, 0], translateX: [0, 24], height: [node.offsetHeight, 0],
    marginTop: 0, paddingTop: 0, paddingBottom: 0,
    duration: 380, easing: 'easeInQuad',
    complete: finish,
  });
}
