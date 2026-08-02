// WAR ROOM view — SITROOM tactical board (System-HUD skin). The board is
// SECTIONED by threat kind, which costs no reordering: triage() sorts by
// blastRadius and the per-kind blast bands never overlap (security 101+ >
// uncommitted 51-90 > stale 20.5-50 > no-tests 15 > no-ci 10), so the rows
// already arrive contiguous by kind. Each section renders at the weight its
// threats deserve: full cards for SECURITY/UNCOMMITTED, compact one-line rows
// for STALE, and a single roll-up for HYGIENE (a "no CI" chip has never
// deserved the same pixel budget as a leaked credential).
import { el, esc } from '../../ui/util.js';
import { sfx, openDrawer, deriveScanContext, aosKids, aosRefresh } from '../../ui/components.js';
import { dispatch } from '../../core/actions.mjs';
import { triage } from '../../intel/derive.mjs';
import { buildBoardModel } from './warroom-model.mjs';
import { mountRadar } from './warroom-radar.js';

let rootEl = null, ctxRef = null, offData = null, radarDispose = null;

// Generation token, bumped by BOTH render() and unmount(). Any async
// continuation captures it before its await and bails when it no longer
// matches — this realm mounts/unmounts 105x in the selftest and every one of
// those dynamic imports resolves AFTER its own teardown, so an unguarded
// continuation animates detached DOM. Same idiom warroom-radar.js proves out
// with its `disposed` flag, widened to survive re-render as well as unmount.
let gen = 0;

const KIND_LABEL = {
  security: 'SECURITY', uncommitted: 'UNCOMMITTED', stale: 'STALE',
  'no-tests': 'NO TESTS', 'no-ci': 'NO CI',
};

// Board sections, in render order. `kinds` groups no-tests + no-ci under one
// HYGIENE heading; `mode` picks the weight each section renders at.
const GROUPS = [
  { id: 'security',    label: 'SECURITY',    kinds: ['security'],          mode: 'card' },
  { id: 'uncommitted', label: 'UNCOMMITTED', kinds: ['uncommitted'],       mode: 'card' },
  { id: 'stale',       label: 'STALE',       kinds: ['stale'],             mode: 'row' },
  { id: 'hygiene',     label: 'HYGIENE',     kinds: ['no-tests', 'no-ci'], mode: 'rollup' },
];

// Feature-flagged — dispatch-to-Claude ships Phase 2. Default OFF, and when
// OFF the button is not rendered at all: a permanently-disabled control on
// every card is ~40% of the action row spent saying "no".
function dispatchFlagOn() {
  try { return localStorage.getItem('hq-ff-dispatch') === 'on'; } catch { return false; }
}

function reduceMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Drains the HP bars from 0 -> data-hp% via anime.js. The vendor file is a
// static asset the render path doesn't control — a missing/broken import can
// never crash the board, it just skips straight to the instant-set fallback.
async function drainHp(sec) {
  const myGen = gen;
  const bars = sec.querySelectorAll('.wr-hp > i');
  if (!bars.length) return;
  const instant = () => bars.forEach((b) => { b.style.width = (b.getAttribute('data-hp') || '0') + '%'; });
  if (reduceMotion()) { instant(); return; }   // JS tweens ignore CSS media queries — honour it here
  try {
    const mod = await import('../../../vendor/anime.es.js');
    if (myGen !== gen || !sec.isConnected) return;   // torn down / re-rendered while the import was in flight
    const anime = mod?.default;
    if (typeof anime !== 'function') throw new Error('anime unavailable');
    anime({
      targets: bars,
      width: (elm) => elm.getAttribute('data-hp') + '%',
      easing: 'easeOutExpo', duration: 900, delay: anime.stagger(70),
    });
  } catch (err) {
    console.warn('[warroom] anime unavailable, instant-set fallback', err);
    if (myGen !== gen || !sec.isConnected) return;
    instant();
  }
}

function actionsHtml(t, dispOn) {
  // 23 identical "Remediate" labels are useless to a screen reader — each
  // button names its own target and detail.
  const aria = `Remediate ${esc(t.name)} — ${esc(t.detail)}`;
  return `<div class="wr-actions">
      <button class="wr-act" type="button" aria-label="${aria}">Remediate</button>
      ${dispOn ? `<button class="wr-claude" type="button" aria-label="Send Claude to ${esc(t.name)}">Send Claude</button>` : ''}
    </div>`;
}

function wireActions(node, t, ctx, projById, prevProj) {
  const act = node.querySelector('.wr-act');
  if (act) act.onclick = () => {
    dispatch('go:forge', ctx);
    const p = projById[t.projectId];
    if (p) openDrawer(p, prevProj[t.projectId], ctx.data);
    sfx('blip');
  };
  const claude = node.querySelector('.wr-claude');
  // Only reachable with hq-ff-dispatch=on. The Phase-2 `hq:spawn-session` IPC
  // doesn't exist yet, so say so out loud rather than shipping a silent no-op.
  if (claude) claude.onclick = () => {
    console.warn('[warroom] "Send Claude" is not wired yet — needs the Phase-2 hq:spawn-session IPC', t.projectId);
    sfx('blip');
  };
}

// Hovering/focusing a threat rings its SIBLINGS — the other rows belonging to
// the same project. Replaces the deleted SVG "attack vector" overlay, which
// fired on ~100% of cards (triage() emits up to 5 concerns per project) and so
// carried zero bits while owning the loudest visual channel.
// PROPERTY assignment, never addEventListener: the handler dies with the node,
// so a re-render can't strand a listener on a detached card.
function wireSiblings(node, sec) {
  const id = node.getAttribute('data-project-id');
  if (!id) return;
  const on = () => {
    sec.querySelectorAll('[data-project-id]').forEach((n) => {
      // compared in JS, not baked into the selector — a project id is data
      if (n !== node && n.getAttribute('data-project-id') === id) n.classList.add('sibling');
    });
  };
  const off = () => { sec.querySelectorAll('.sibling').forEach((n) => n.classList.remove('sibling')); };
  node.onmouseenter = on;
  node.onmouseleave = off;
  // focus/blur don't bubble, so the keyboard path binds on the focusable
  // descendants themselves rather than on the container.
  node.querySelectorAll('button').forEach((b) => { b.onfocus = on; b.onblur = off; });
}

function tagProject(node, t) {
  if (t.projectId != null) node.setAttribute('data-project-id', String(t.projectId));
}

function threatCard(t, ctx, projById, prevProj, dispOn, sec) {
  const card = el('div', 'wr-card');
  card.setAttribute('data-sev', t.sev);
  tagProject(card, t);
  card.innerHTML = `
    <div class="wr-card-head">
      <span class="wr-badge" data-sev="${esc(t.sev)}">${esc(KIND_LABEL[t.kind] || String(t.kind || '').toUpperCase())}</span>
      <span class="wr-name">${esc(t.name)}</span>
    </div>
    <div class="wr-detail">${esc(t.detail)}</div>
    <span class="wr-hp"><i data-hp="${esc(String(t.hpPct))}" style="width:0%"></i></span>
    ${actionsHtml(t, dispOn)}`;
  wireActions(card, t, ctx, projById, prevProj);
  wireSiblings(card, sec);
  return card;
}

// STALE renders one line, not a card: name · detail · Remediate. Same data,
// a fifth of the vertical budget.
function threatRow(t, ctx, projById, prevProj, sec) {
  const row = el('div', 'wr-row');
  row.setAttribute('data-sev', t.sev);
  tagProject(row, t);
  row.innerHTML = `<span class="wr-name">${esc(t.name)}</span>
    <span class="wr-detail">${esc(t.detail)}</span>
    <button class="wr-act" type="button" aria-label="Remediate ${esc(t.name)} — ${esc(t.detail)}">Remediate</button>`;
  wireActions(row, t, ctx, projById, prevProj);
  wireSiblings(row, sec);
  return row;
}

// ALL hygiene items collapse into ONE row that hands off to the forge. Missing
// tests and missing CI are real, but they are a backlog, not an incident.
function hygieneRollup(rows, ctx) {
  const noTests = rows.filter((t) => t.kind === 'no-tests').length;
  const noCi = rows.filter((t) => t.kind === 'no-ci').length;
  const parts = [];
  if (noTests) parts.push(`${noTests} no tests`);
  if (noCi) parts.push(`${noCi} no CI`);
  const head = `${rows.length} hygiene item${rows.length > 1 ? 's' : ''}`;
  const btn = el('button', 'wr-rollup');
  btn.type = 'button';
  btn.setAttribute('aria-label', `${head} — ${parts.join(', ')}. Open the forge.`);
  btn.innerHTML = `<b>${esc(head)}</b><span class="wr-rollup-sub">${esc(parts.join(', '))}</span><span class="wr-rollup-go">FORGE →</span>`;
  btn.onclick = () => { dispatch('go:forge', ctx); sfx('blip'); };
  return btn;
}

function render() {
  // render() re-runs on data:select while mounted — tear down any live radar
  // (WebGL or Canvas2D) BEFORE rebuilding, or contexts stack up across scrubs.
  radarDispose?.(); radarDispose = null;
  gen++;   // invalidate every async continuation aimed at the board we're about to discard

  const root = rootEl; if (!root) return;
  const ctx = ctxRef;
  root.innerHTML = '';
  if (!ctx?.data?.selected) return;   // empty/first-run bundle: render nothing rather than crash

  const { S, projById, prevProj } = deriveScanContext(ctx.data);
  const model = buildBoardModel(triage(S));
  const threats = model.threats;
  // threats[] is blast-sorted desc, so index 0 carries the worst severity —
  // the hero count wears its color.
  const worstSev = threats[0]?.sev || 'dim';
  const counts = GROUPS.map((g) => threats.filter((t) => g.kinds.includes(t.kind)).length);
  const shape = GROUPS.map((g, i) => (counts[i] ? `${counts[i]} ${g.label}` : null)).filter(Boolean).join(' · ');

  const sec = el('section', 'realm-warroom');
  sec.innerHTML = `<div class="wr-frame">
    <div class="wr-head">
      <div class="wr-headline">
        <span class="wr-eyebrow">SITROOM</span>
        <div class="wr-count-row">
          <span class="wr-count" data-sev="${esc(worstSev)}">${esc(String(threats.length))}</span>
          <span class="wr-sub">${threats.length ? 'active threats' : 'standing by…'}</span>
        </div>
        ${shape ? `<div class="wr-shape">${esc(shape)}</div>` : ''}
      </div>
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
  const groups = el('div', 'wr-groups');
  let firstCard = null;
  GROUPS.forEach((g, gi) => {
    if (!counts[gi]) return;
    const rows = threats.filter((t) => g.kinds.includes(t.kind));
    const gsec = el('section', 'wr-sec');
    gsec.setAttribute('data-group', g.id);
    gsec.innerHTML = `<h3 class="wr-sec-head">${esc(g.label)}<span class="wr-sec-n">· ${esc(String(rows.length))}</span></h3>`;
    if (g.mode === 'card') {
      const board = el('div', 'wr-board');
      rows.forEach((t) => {
        const card = threatCard(t, ctx, projById, prevProj, dispOn, sec);
        board.appendChild(card);
        if (!firstCard) firstCard = card;
      });
      gsec.appendChild(board);
      aosKids(board, 'fade-up', 60);
    } else if (g.mode === 'row') {
      const list = el('div', 'wr-rows');
      rows.forEach((t) => list.appendChild(threatRow(t, ctx, projById, prevProj, sec)));
      gsec.appendChild(list);
      aosKids(list, 'fade-up', 40);
    } else {
      gsec.appendChild(hygieneRollup(rows, ctx));
    }
    groups.appendChild(gsec);
  });
  frame.appendChild(groups);
  firstCard?.classList.add('top-threat');   // the single most dangerous thing on the board

  aosRefresh();   // without the refresh, data-aos nodes can sit stuck at opacity:0
  drainHp(sec);
}

export const view = {
  mount(root, ctx) { rootEl = root; ctxRef = ctx; offData = ctx.bus.on('data:select', render); render(); },
  unmount() {
    radarDispose?.(); radarDispose = null;   // before nulling refs, per the lifecycle contract
    gen++;   // a pending anime import must never paint into a torn-down board
    if (offData) { offData(); offData = null; }
    rootEl = null; ctxRef = null;
  },
};
