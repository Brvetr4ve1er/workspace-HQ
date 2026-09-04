// TASKS radar — the tilted 3D sweep disc from v3's War Room, restored into the
// SITROOM header's `.tasks-radar` slot (96x96, mounted by tasks/view.js).
//
// PURE AMBIENT ACCENT. It is NOT the focal element of this surface — the focal
// element is `.tasks-count`, and the radar is deliberately small, low-contrast
// and silent so it can never compete with it. It adds no information the board
// does not already carry in prose, which is why its canvas is aria-hidden: a
// screen reader gets the sections, not a decorative disc.
//
// PORTED FROM dashboard-v3/src/realms/warroom/warroom-radar.js. What changed and
// why, in full:
//
//   FLAG      `hq-ff-warroom-3d` -> `hq-ff-radar`, and the semantics follow the
//             new NAME. v3's flag was named for the 3D renderer, so 'off' meant
//             "draw the 2D one instead". This one is named for the radar, so
//             'off' means NO RADAR AT ALL — the slot stays empty and the header
//             lays out exactly as it does today. The Canvas2D path is still
//             reachable on purpose: 'hq-ff-radar' = '2d' forces it, which is how
//             the degrade is verified without a GPU-less machine.
//   COLOUR    v3 drew the disc, rings and sweep in violet (0xa78bfa/0xc4b5fd).
//             Here they are NEUTRAL (--hud-dim). tasks.css already spends both
//             of the constitution's two violet-accent slots on the header — the
//             panel's edge glow and the calm-case hero count — so a violet disc
//             sitting inside that same header would be the third, which is the
//             specific failure the budget exists to prevent. The only colour on
//             the disc is SEVERITY, on the blips, which is exactly what the
//             constitution says colour is for. The hexes below MIRROR
//             styles/tokens.css (the same mirror home/view.js keeps for its seam
//             colours) because a WebGL material takes a number, not a var().
//   IMPORT    the vendored module is loaded through ONE cached promise, the
//             idiom surfaces/work/motion.js established: this surface mounts and
//             unmounts ~105 times per selftest and must not re-enter a 670KB
//             file:// import on each one.
//   RADIUS    consumed AS GIVEN from board-model.mjs, which already maps worst
//             -> 0.35 (centre) and calmest -> 0.95 (rim). v3's model had this
//             inverted — the worst threat sat on the rim, which reads backwards
//             on any radar ever drawn. Do NOT re-map it here; there is exactly
//             one place that decision lives and it is the pure model.
//
// PRESERVED EXACTLY, because it is the reason the v3 version survived 105
// mount/unmount cycles with zero leaked contexts:
//   - `new THREE.WebGLRenderer()` sits OUTSIDE the try. A machine with no WebGL
//     throws THERE, so it falls through to the caller's Canvas2D fallback rather
//     than into the inner catch's cleanup path (which would be cleaning up a
//     renderer that was never constructed).
//   - the inner try's catch tears down the half-built renderer BEFORE rethrowing,
//     so the fallback never stacks a second context on a leaked one.
//   - dispose(): cancelAnimationFrame, dispose every geometry and material via
//     scene.traverse, renderer.dispose(), renderer.forceContextLoss(), remove the
//     canvas, null the refs.
//   - the `disposed` flag guards the async import resolving AFTER unmount.
//
// LIFECYCLE CONTRACT:  mountRadar(el, radarData) -> dispose()
// dispose() is safe to call twice and safe to call before the three.js import
// ever resolves. The caller (tasks/view.js) calls it BOTH before every re-render
// and from unmount() — `render()` does `root.innerHTML = ''`, which detaches the
// slot, so a radar that outlived its slot would hold a live WebGL context on a
// node nobody can see.

// Severity, mirrored from styles/tokens.css: --hud-red / --hud-amber /
// --hud-yellow / --hud-dim. THE ONLY COLOUR ON THIS DISC.
const SEV_HEX = { red: 0xf2555a, orange: 0xf2a33c, yellow: 0xe6c34a, dim: 0x6b6390 };
const SEV_CSS = { red: '#f2555a', orange: '#f2a33c', yellow: '#e6c34a', dim: '#6b6390' };

// Neutral chrome. --hud-dim for the graticule and the sweep, --hud-ink for the
// disc — a DARKER step than the header panel it sits on, so the disc reads as a
// well rather than as another raised box. No violet anywhere in this file.
const CHROME = 0x6b6390;
const CHROME_CSS = '107, 99, 144';
const DISC = 0x0d0b16;

const RING_RADII = [0.35, 0.6, 0.85, 1];
const SWEEP_SPEED = (Math.PI * 2) / 6.5;   // one revolution per ~6.5s — slow, ambient
const SWEEP_ARC = Math.PI / 7;

// Framing — the "nothing clips at the edge" requirement, solved by arithmetic
// rather than by eye. The disc has world radius 1; the outermost blip centre the
// model can emit is 0.95 and a blip adds 0.05, so the scene's half-extent is
// exactly 1.0 and the camera must see at least that much or the rim and the
// outer blips clip against the 96px box. At fov 34 the visible half-height at
// distance d is d * tan(17deg) = d * 0.3057. The base eye vector (0, 1.3, 1.05)
// has length 1.671; scaling it by 2.25 keeps the tilt bit-for-bit identical
// while pushing the distance to ~3.76, which lands the side rim at ~0.87 NDC —
// a comfortable margin inside the frame. The tilt compresses the disc
// vertically, so the near rim lands at ~0.81 NDC and the far rim at ~0.58; the
// horizontal extent is the binding constraint.
const CAM_PULLBACK = 2.25;

// ...and the horizontal extent is the one that scales with ASPECT. The slot is
// a fixed 96x96 square today, but a box TALLER than it is wide would shrink the
// horizontal field and clip the rim, so the pullback is divided by the aspect
// whenever it drops below 1. Wider-than-tall needs no correction: NDC y is
// unaffected by aspect and the vertical extent already fits.
function pullbackFor(aspect) {
  return CAM_PULLBACK / Math.min(1, aspect || 1);
}

// 'off' -> no radar at all (the slot stays empty and the header is unchanged).
// '2d'  -> skip three.js and draw the Canvas2D degrade, so the fallback is
//          reachable for verification on a machine that HAS WebGL.
// anything else (including absent) -> the 3D disc, degrading to 2D on failure.
function radarMode() {
  try {
    const v = localStorage.getItem('hq-ff-radar');
    if (v === 'off') return 'off';
    if (v === '2d') return '2d';
    return '3d';
  } catch { return '3d'; }   // storage denied (file://, private mode) — default ON
}

// The sweep is an INFINITE rAF; a CSS media query cannot reach it. Under
// prefers-reduced-motion both renderers draw exactly ONE static frame and the
// loop never starts — the disc, the rings and the blips (the actual information)
// all still render, only the animation is dropped.
function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }   // matchMedia absent => assume motion is fine
}

function boxSize(el) {
  const w = el.clientWidth || 96;
  const h = el.clientHeight || 96;
  return { w, h };
}

// Decorative by construction: the board underneath carries every one of these
// blips as a titled, verbed row. Announcing a canvas would be duplicate noise.
function decorate(node) {
  node.setAttribute('aria-hidden', 'true');
  node.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  return node;
}

// The vendored module, imported at most once per app run. NEVER rejects: a
// missing or broken vendor file is a degradation, not an error the render path
// has to handle, so it resolves to null and the caller draws the 2D sweep.
let threePromise = null;
function loadThree() {
  if (!threePromise) {
    threePromise = import('../../../vendor/three.module.js')
      .catch((err) => { console.warn('[tasks-radar] three.js import failed, using 2D fallback', err); return null; });
  }
  return threePromise;
}

// ---------------------------------------------------------------- three.js
function mountThreeRadar(THREE, el, radar) {
  const { w, h } = boxSize(el);
  // OUTSIDE the try, deliberately — see the header. A no-WebGL environment
  // throws here and the caller degrades; it must not land in the inner catch.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  try {
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(decorate(renderer.domElement));

    const aspect = (w / h) || 1;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 10);
    const pull = pullbackFor(aspect);
    camera.position.set(0, 1.3 * pull, 1.05 * pull);
    camera.lookAt(0, 0, 0);

    // Flat shapes are baked flat (rotateX bakes into the vertex buffer, not the
    // object transform) so each mesh's own .rotation stays at identity — that
    // keeps the sweep arm's rotation.y a clean single-axis spin with no Euler
    // composition surprises.
    const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };

    const discMat = new THREE.MeshBasicMaterial({ color: DISC, transparent: true, opacity: 0.55, depthWrite: false });
    const disc = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 48)), discMat);
    scene.add(disc);

    const ringMat = new THREE.MeshBasicMaterial({ color: CHROME, transparent: true, opacity: 0.3, depthWrite: false });
    const rings = RING_RADII.map((r) => {
      const ring = new THREE.Mesh(flat(new THREE.RingGeometry(Math.max(0.001, r - 0.01), r + 0.01, 48)), ringMat);
      ring.position.y = 0.002;
      scene.add(ring);
      return ring;
    });

    const sweepMat = new THREE.MeshBasicMaterial({
      color: CHROME, transparent: true, opacity: 0.42, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const sweep = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 32, 0, SWEEP_ARC)), sweepMat);
    sweep.position.y = 0.004;
    scene.add(sweep);

    const blipGeo = flat(new THREE.CircleGeometry(0.05, 10));
    const blips = (radar || []).map((b) => {
      const mat = new THREE.MeshBasicMaterial({ color: SEV_HEX[b.sev] || SEV_HEX.dim, depthWrite: false });
      const mesh = new THREE.Mesh(blipGeo, mat);
      // b.radius is the model's already-correct mapping: worst -> 0.35 (centre).
      mesh.position.set(Math.cos(b.angle) * b.radius, 0.006, Math.sin(b.angle) * b.radius);
      scene.add(mesh);
      return mesh;
    });

    let rafId = 0;
    let last = performance.now();
    const tick = (now) => {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sweep.rotation.y += dt * SWEEP_SPEED;
      renderer.render(scene, camera);
    };
    if (reduceMotion()) renderer.render(scene, camera);   // one static frame, no loop
    else rafId = requestAnimationFrame(tick);

    return function dispose() {
      cancelAnimationFrame(rafId);   // rafId stays 0 under reduced motion — cancelling 0 is a no-op
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      blips.length = 0; rings.length = 0;
    };
  } catch (err) {
    // Partial failure after the renderer/context already exists — tear down what
    // we made before rethrowing, so the caller's fallback does not stack a second
    // WebGL context on top of a leaked one.
    try { renderer.forceContextLoss(); } catch {}
    try { renderer.domElement.remove(); } catch {}
    try { renderer.dispose(); } catch {}
    throw err;
  }
}

// ------------------------------------------------------------ Canvas2D degrade
// Same shape, same disposer, same reduced-motion behaviour. Flat rather than
// tilted — a 2D fake of the perspective would cost geometry for no information.
function mountCanvasRadar(el, radar) {
  const { w, h } = boxSize(el);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = decorate(document.createElement('canvas'));
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }   // exotic env with no 2D context either — inert, never throws
  ctx.scale(dpr, dpr);

  // R leaves 4px of margin AND the blip dot radius (2.6px) inside the box: the
  // outermost blip centre the model emits is 0.95R, so its rim lands at
  // 0.95R + 2.6 < R + 4 for every R this slot can produce. Nothing clips.
  const cx = w / 2, cy = h / 2, R = Math.max(1, Math.min(w, h) / 2 - 4);
  let angle = 0, last = performance.now(), rafId = 0;

  const draw = () => {
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(13, 11, 22, .55)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(${CHROME_CSS}, .34)`;
    ctx.lineWidth = 1;
    RING_RADII.forEach((f) => { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle - SWEEP_ARC, angle, false);
    ctx.closePath();
    ctx.fillStyle = `rgba(${CHROME_CSS}, .4)`;
    ctx.fill();
    ctx.restore();

    (radar || []).forEach((b) => {
      const bx = cx + Math.cos(b.angle) * b.radius * R;
      const by = cy + Math.sin(b.angle) * b.radius * R;
      ctx.beginPath();
      ctx.fillStyle = SEV_CSS[b.sev] || SEV_CSS.dim;
      ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  };
  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle += dt * SWEEP_SPEED;
    draw();
  };
  if (reduceMotion()) draw();   // one static frame, no loop
  else rafId = requestAnimationFrame(frame);

  return function dispose() {
    cancelAnimationFrame(rafId);   // rafId stays 0 under reduced motion — cancelling 0 is a no-op
    canvas.remove();
  };
}

// --------------------------------------------------------------------- mount
/**
 * Mounts the SITROOM radar into `el` (the `.tasks-radar` slot) using `radarData`
 * (`board.radar` from board-model.mjs: `{ idx, angle, radius, sev }[]`, where
 * radius already runs 0.95 at the calm rim down to 0.35 at the worst-threat
 * centre). Returns a disposer — call it exactly the way the rest of the surface's
 * teardown works: from unmount() AND before every re-render, because render()
 * clears the header that owns this slot.
 *
 * Never throws. Flag 'off' mounts nothing; flag '2d', a missing WebGL context or
 * any three.js failure transparently degrades to a Canvas2D sweep of the same
 * shape with the same disposer.
 */
export function mountRadar(el, radarData) {
  if (!el) return () => {};
  const mode = radarMode();
  if (mode === 'off') return () => {};          // killed by flag: the slot stays empty
  const radar = Array.isArray(radarData) ? radarData : [];
  let disposed = false;
  let inner = null;

  function useCanvas() {
    if (disposed) return;
    try { inner = mountCanvasRadar(el, radar); }
    catch (err) { console.warn('[tasks-radar] 2D fallback failed; radar disabled', err); inner = null; }
  }

  if (mode === '2d') {
    useCanvas();
  } else {
    loadThree().then((THREE) => {
      if (disposed) return;   // torn down while three.js was loading — never mount
      if (!THREE) { useCanvas(); return; }
      try { inner = mountThreeRadar(THREE, el, radar); }
      catch (err) { console.warn('[tasks-radar] three.js unavailable, using 2D fallback', err); useCanvas(); }
    });
  }

  return function dispose() {
    disposed = true;
    try { inner?.(); } catch (err) { console.warn('[tasks-radar] dispose error', err); }
    inner = null;
  };
}
