// WAR ROOM view — SITROOM tactical board (System-HUD skin). Task 1 shipped a
// placeholder shell; Task 3 fills the board (cards + HP bars + remediation +
// motion). Task 4 populates the .wr-radar slot (3D radar); Task 5 draws vectors.
import { el, esc } from '../../ui/util.js';
import { sfx, openDrawer, deriveScanContext, aosKids } from '../../ui/components.js';
import { dispatch } from '../../core/actions.mjs';
import { triage } from '../../intel/derive.mjs';
import { buildBoardModel } from './warroom-model.mjs';

let rootEl = null, ctxRef = null, offData = null;

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

function threatCard(t, ctx, projById, prevProj) {
  const card = el('div', 'wr-card');
  card.setAttribute('data-sev', t.sev);
  const dispOn = dispatchFlagOn();
  card.innerHTML = `
    <div class="wr-card-head">
      <span class="wr-badge" data-sev="${esc(t.sev)}">${esc(KIND_LABEL[t.kind] || String(t.kind || '').toUpperCase())}</span>
      <span class="wr-name">${esc(t.name)}</span>
    </div>
    <div class="wr-detail">${esc(t.detail)}</div>
    <span class="wr-hp"><i data-hp="${t.hpPct}" style="width:0%"></i></span>
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
      <span class="wr-sub">${threats.length ? `·· ${threats.length} ACTIVE THREATS` : 'standing by…'}</span>
      <div class="wr-radar"></div>
    </div>
  </div>`;
  const frame = sec.querySelector('.wr-frame');

  if (!threats.length) {
    const empty = el('div', 'wr-empty');
    empty.innerHTML = `<div class="wr-empty-glyph">⌖</div>
      <div class="wr-empty-title">AREA SECURE</div>
      <div class="wr-empty-sub">no active threats</div>`;
    frame.appendChild(empty);
    root.appendChild(sec);
    return;
  }

  const board = el('div', 'wr-board');
  threats.forEach((t) => board.appendChild(threatCard(t, ctx, projById, prevProj)));
  frame.appendChild(board);
  root.appendChild(sec);

  aosKids(board, 'fade-up', 60);
  drainHp(sec);
}

export const view = {
  mount(root, ctx) { rootEl = root; ctxRef = ctx; offData = ctx.bus.on('data:select', render); render(); },
  unmount() { if (offData) { offData(); offData = null; } rootEl = null; ctxRef = null; },
};
