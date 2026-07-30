// WAR ROOM 3D radar — a small tilted disc in the SITROOM header (.wr-radar
// slot, mounted by view.js). Pure ambient accent: never steals focus, never
// throws, never leaks. three.js is vendored locally (CSP blocks CDN scripts);
// loaded lazily via dynamic import so realms that never visit WAR ROOM don't
// pay for it at boot, and so an import failure can be caught like any other
// runtime error instead of breaking the whole module graph.
//
// Lifecycle contract (this realm mounts/unmounts ~105 times in the selftest):
//   mountRadar(el, radarData) -> dispose()
// dispose() must be safe to call multiple times and must be safe to call
// before the async three.js load ever resolves (the disposed flag guards
// that race). Graceful degradation: if WebGL is unavailable, the three.js
// import fails, or the flag `hq-ff-warroom-3d` is 'off', a lightweight
// Canvas2D sweep renders instead — same shape, same disposer, never throws.

const SEV_HEX = { red: 0xff4d5e, orange: 0xffa23c, yellow: 0xffd44d, dim: 0x6c6a8a };
const SEV_CSS = { red: '#ff4d5e', orange: '#ffa23c', yellow: '#ffd44d', dim: '#6c6a8a' };
const VIOLET = 0xa78bfa, VIOLET_HI = 0xc4b5fd;
const RING_RADII = [0.35, 0.6, 0.85, 1];
const SWEEP_SPEED = (Math.PI * 2) / 6.5;   // one revolution per ~6.5s — slow, ambient

function flag3dOn() {
  try { return localStorage.getItem('hq-ff-warroom-3d') !== 'off'; } catch { return true; }
}

function boxSize(el) {
  const w = el.clientWidth || 96;
  const h = el.clientHeight || 96;
  return { w, h };
}

// ---------------------------------------------------------------- three.js
function mountThreeRadar(THREE, el, radar) {
  const { w, h } = boxSize(el);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  try {
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, (w / h) || 1, 0.1, 10);
    camera.position.set(0, 1.3, 1.05);
    camera.lookAt(0, 0, 0);

    // Flat shapes are baked flat (rotateX bakes into the vertex buffer, not the
    // object transform) so each mesh's own .rotation stays at identity — that
    // keeps the sweep-arm's rotation.y a clean single-axis spin with no Euler
    // composition surprises.
    const flat = (geo) => { geo.rotateX(-Math.PI / 2); return geo; };

    const discMat = new THREE.MeshBasicMaterial({ color: 0x1c1730, transparent: true, opacity: 0.4, depthWrite: false });
    const disc = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 48)), discMat);
    scene.add(disc);

    const ringMat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.22, depthWrite: false });
    const rings = RING_RADII.map((r) => {
      const ring = new THREE.Mesh(flat(new THREE.RingGeometry(Math.max(0.001, r - 0.01), r + 0.01, 48)), ringMat);
      ring.position.y = 0.002;
      scene.add(ring);
      return ring;
    });

    const sweepMat = new THREE.MeshBasicMaterial({
      color: VIOLET_HI, transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const sweep = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 32, 0, Math.PI / 7)), sweepMat);
    sweep.position.y = 0.004;
    scene.add(sweep);

    const blipGeo = flat(new THREE.CircleGeometry(0.05, 10));
    const blips = (radar || []).map((b) => {
      const mat = new THREE.MeshBasicMaterial({ color: SEV_HEX[b.sev] || SEV_HEX.dim, depthWrite: false });
      const mesh = new THREE.Mesh(blipGeo, mat);
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
    rafId = requestAnimationFrame(tick);

    return function dispose() {
      cancelAnimationFrame(rafId);
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
    // Partial failure after the renderer/context already exists — tear down
    // what we made before rethrowing so the caller's fallback doesn't stack
    // a second WebGL context on top of a leaked one.
    try { renderer.forceContextLoss(); } catch {}
    try { renderer.domElement.remove(); } catch {}
    try { renderer.dispose(); } catch {}
    throw err;
  }
}

// ------------------------------------------------------------ Canvas2D degrade
function mountCanvasRadar(el, radar) {
  const { w, h } = boxSize(el);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return () => {}; }   // exotic env with no 2D context either — inert, never throws
  ctx.scale(dpr, dpr);

  const cx = w / 2, cy = h / 2, R = Math.max(1, Math.min(w, h) / 2 - 4);
  let angle = 0, last = performance.now(), rafId = 0;

  const frame = (now) => {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    angle += dt * SWEEP_SPEED;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(167,139,250,.28)';
    ctx.lineWidth = 1;
    RING_RADII.forEach((f) => { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle - Math.PI / 7, angle, false);
    ctx.closePath();
    ctx.fillStyle = 'rgba(196,181,253,.35)';
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
  rafId = requestAnimationFrame(frame);

  return function dispose() {
    cancelAnimationFrame(rafId);
    canvas.remove();
  };
}

// --------------------------------------------------------------------- mount
/**
 * Mounts the SITROOM radar into `el` (the `.wr-radar` slot) using `radarData`
 * (`model.radar`: `{ angle, radius, sev }[]`). Returns a disposer — call it
 * exactly the way the rest of the realm's teardown works: on unmount() AND at
 * the top of every render() (data:select re-runs render, so a stale radar
 * must go before a new one mounts, or WebGL contexts stack up).
 *
 * Never throws: flag-off or any three.js failure (missing WebGL, failed
 * import) transparently degrades to a Canvas2D sweep with the same shape.
 */
export function mountRadar(el, radarData) {
  if (!el) return () => {};
  const radar = Array.isArray(radarData) ? radarData : [];
  let disposed = false;
  let inner = null;

  function useCanvas() {
    if (disposed) return;
    try { inner = mountCanvasRadar(el, radar); }
    catch (err) { console.warn('[warroom-radar] 2D fallback failed; radar disabled', err); inner = null; }
  }

  if (flag3dOn()) {
    import('../../../vendor/three.module.js').then((THREE) => {
      if (disposed) return;   // torn down while three.js was loading — never mount
      try { inner = mountThreeRadar(THREE, el, radar); }
      catch (err) { console.warn('[warroom-radar] three.js unavailable, using 2D fallback', err); useCanvas(); }
    }).catch((err) => {
      console.warn('[warroom-radar] three.js import failed, using 2D fallback', err);
      useCanvas();
    });
  } else {
    useCanvas();
  }

  return function dispose() {
    disposed = true;
    try { inner?.(); } catch (err) { console.warn('[warroom-radar] dispose error', err); }
    inner = null;
  };
}
