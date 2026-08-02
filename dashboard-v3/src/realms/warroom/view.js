// WAR ROOM view — SITROOM tactical board (System-HUD skin). Task 1 shipped a
// placeholder shell; Task 3 fills the board (cards + HP bars + remediation +
// motion). Task 4 populates the .wr-radar slot (3D radar); Task 5 draws vectors.
import { el, esc } from '../../ui/util.js';
import { sfx, openDrawer, deriveScanContext, aosKids } from '../../ui/components.js';
import { dispatch } from '../../core/actions.mjs';
import { triage } from '../../intel/derive.mjs';
import { buildBoardModel } from './warroom-model.mjs';
import { mountRadar } from './warroom-radar.js';

let rootEl = null, ctxRef = null, offData = null, radarDispose = null, vecRaf = 0;

const KIND_LABEL = {
  security: 'SECURITY', uncommitted: 'UNCOMMITTED', stale: 'STALE',
  'no-tests': 'NO TESTS', 'no-ci': 'NO CI',
};

// Feature-flagged inert chip — dispatch-to-Claude ships Phase 2. Default OFF.
function dispatchFlagOn() {
  try { return localStorage.getItem('hq-ff-dispatch') === 'on'; } catch { return false; }
}

// Drains the HP bars from 0 -> data-hp% via anime.js. The vendor file is a
// static asset the render path doesn't control — a missing/broken import can
// never crash the board, it just skips straight to the instant-set fallback.
async function drainHp(sec) {
  const bars = sec.querySelectorAll('.wr-hp > i');
  if (!bars.length) return;
  try {
    const mod = await import('../../../vendor/anime.es.js');
    const anime = mod?.default;
    if (typeof anime !== 'function') throw new Error('anime unavailable');
    anime({
      targets: bars,
      width: (elm) => elm.getAttribute('data-hp') + '%',
      easing: 'easeOutExpo', duration: 900, delay: anime.stagger(70),
    });
  } catch {
    bars.forEach((b) => { b.style.width = (b.getAttribute('data-hp') || '0') + '%'; });
  }
}

// Draws the SVG "attack vector" overlay linking cards of multi-concern
// projects (model.vectors[]: { projectId, idx[] } — idx = indexes into
// threats/.wr-card children, same order). Positions are computed relative
// to the board (not the viewport), and the draw is deferred one rAF past
// render() so the freshly-built grid has real layout dimensions — a zero-size
// board right after render() would collapse every card to (0,0). render()
// and unmount() both cancel a pending frame via the shared `vecRaf` id, so a
// stale callback can never paint into a torn-down board (this realm
// mounts/unmounts 105x in the selftest).
function drawVectors(board, vectors) {
  if (vecRaf) { cancelAnimationFrame(vecRaf); vecRaf = 0; }
  if (!board || !vectors?.length) return;
  vecRaf = requestAnimationFrame(() => { vecRaf = 0; paintVectors(board, vectors); });
}

function paintVectors(board, vectors) {
  if (!board.isConnected) return;   // torn down while the frame was pending
  board.querySelectorAll(':scope > .wr-vectors').forEach((n) => n.remove());   // never accumulate across re-renders
  const boardRect = board.getBoundingClientRect();
  if (!boardRect.width || !boardRect.height) return;   // still unlaid-out — bail rather than draw garbage

  const cards = board.querySelectorAll(':scope > .wr-card');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'wr-vectors');
  svg.setAttribute('viewBox', `0 0 ${boardRect.width} ${boardRect.height}`);

  vectors.forEach(({ idx }) => {
    const linkedCards = idx.map((i) => cards[i]).filter(Boolean);
    if (linkedCards.length < 2) return;
    const pts = linkedCards.map((c) => {
      c.classList.add('linked');
      const r = c.getBoundingClientRect();
      return { x: r.left - boardRect.left + r.width / 2, y: r.top - boardRect.top + r.height / 2 };
    });
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'wr-vector-path');
    svg.appendChild(path);
    linkedCards.forEach((c) => {
      if (!c.querySelector('.wr-front-pip')) c.appendChild(el('span', 'wr-front-pip', `${linkedCards.length}-FRONT`));
    });
  });

  if (svg.childElementCount) { board.appendChild(svg); animateVectors(svg); }
}

// Animates the vector paths in via anime.js stroke-dashoffset. Vendor asset
// is a static file the render path doesn't control — same fallback shape as
// drainHp: a missing/broken import can never crash the board, the paths just
// render fully visible with no animation instead.
async function animateVectors(svg) {
  const paths = svg.querySelectorAll('path');
  if (!paths.length) return;
  try {
    const mod = await import('../../../vendor/anime.es.js');
    const anime = mod?.default;
    if (typeof anime !== 'function') throw new Error('anime unavailable');
    anime({
      targets: paths,
      strokeDashoffset: [anime.setDashoffset, 0],
      easing: 'easeInOutSine', duration: 700, delay: anime.stagger(120),
    });
  } catch {
    paths.forEach((p) => { p.style.strokeDasharray = 'none'; p.style.strokeDashoffset = '0'; });
  }
}

function threatCard(t, ctx, projById, prevProj, dispOn) {
  const card = el('div', 'wr-card');
  card.setAttribute('data-sev', t.sev);
  card.innerHTML = `
    <div class="wr-card-head">
      <span class="wr-badge" data-sev="${esc(t.sev)}">${esc(KIND_LABEL[t.kind] || String(t.kind || '').toUpperCase())}</span>
      <span class="wr-name">${esc(t.name)}</span>
    </div>
    <div class="wr-detail">${esc(t.detail)}</div>
    <span class="wr-hp"><i data-hp="${esc(String(t.hpPct))}" style="width:0%"></i></span>
    <div class="wr-actions">
      <button class="wr-act" type="button">Remediate</button>
      <button class="wr-claude" type="button" ${dispOn ? '' : 'disabled'}
        title="${dispOn ? 'Send Claude' : 'Send Claude — coming in Phase 2'}">Send Claude</button>
    </div>`;
  card.querySelector('.wr-act').onclick = () => {
    dispatch('go:forge', ctx);
    const p = projById[t.projectId];
    if (p) openDrawer(p, prevProj[t.projectId], ctx.data);
    sfx('blip');
  };
  return card;
}

function render() {
  // render() re-runs on data:select while mounted — tear down any live radar
  // (WebGL or Canvas2D) BEFORE rebuilding, or contexts stack up across scrubs.
  radarDispose?.(); radarDispose = null;
  if (vecRaf) { cancelAnimationFrame(vecRaf); vecRaf = 0; }   // cancel any pending vector draw before the board it targets is torn down

  const root = rootEl; if (!root) return;
  const ctx = ctxRef;
  root.innerHTML = '';
  if (!ctx?.data?.selected) return;   // empty/first-run bundle: render nothing rather than crash

  const { S, projById, prevProj } = deriveScanContext(ctx.data);
  const model = buildBoardModel(triage(S));
  const threats = model.threats;

  const sec = el('section', 'realm-warroom');
  sec.innerHTML = `<div class="wr-frame">
    <div class="wr-head">
      <span class="wr-title">SITROOM</span>
      <span class="wr-sub">${threats.length ? `·· ${esc(String(threats.length))} ACTIVE THREATS` : 'standing by…'}</span>
      <div class="wr-radar"></div>
    </div>
  </div>`;
  const frame = sec.querySelector('.wr-frame');
  root.appendChild(sec);   // connect to the live DOM first so the radar slot has real layout dimensions

  const radarSlot = sec.querySelector('.wr-radar');
  if (radarSlot) radarDispose = mountRadar(radarSlot, model.radar);

  if (!threats.length) {
    const empty = el('div', 'wr-empty');
    empty.innerHTML = `<div class="wr-empty-glyph">⌖</div>
      <div class="wr-empty-title">AREA SECURE</div>
      <div class="wr-empty-sub">no active threats</div>`;
    frame.appendChild(empty);
    return;
  }

  const dispOn = dispatchFlagOn();   // read once per render, not once per card
  const board = el('div', 'wr-board');
  threats.forEach((t) => board.appendChild(threatCard(t, ctx, projById, prevProj, dispOn)));
  frame.appendChild(board);
  board.firstElementChild?.classList.add('top-threat');   // threats[] arrives blast-sorted desc — index 0 is the most dangerous

  aosKids(board, 'fade-up', 60);
  drainHp(sec);
  drawVectors(board, model.vectors);
}

export const view = {
  mount(root, ctx) { rootEl = root; ctxRef = ctx; offData = ctx.bus.on('data:select', render); render(); },
  unmount() {
    radarDispose?.(); radarDispose = null;   // before nulling refs, per the lifecycle contract
    if (vecRaf) { cancelAnimationFrame(vecRaf); vecRaf = 0; }   // a pending vector draw must never fire post-teardown
    if (offData) { offData(); offData = null; }
    rootEl = null; ctxRef = null;
  },
};
