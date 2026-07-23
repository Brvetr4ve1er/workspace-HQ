// THE CANVAS — JSON Canvas boards (data/canvas/*.canvas, Obsidian-compatible).
// Read-only render (drag-to-pan, inspect) plus exactly ONE write path: the
// "＋ NOTE" inscription → hq.canvasAdd(boardName, {type:'text', text, x, y}).
// Boards arrive from the view (bundle snapshot, replaced by live pushes); this
// module owns board selection + per-board pan, which survive re-renders and
// realm switches like grimoire's filter state.
import { el, esc, mdLite } from '../../ui/util.js';
import { sfx } from '../../ui/components.js';

const PAD = 80;   // plane margin around the nodes' bounding box

// JSON Canvas preset palette "1".."6"; raw "#hex" strings pass through.
const PRESET = { 1: '#ff4757', 2: '#ffa502', 3: '#ffe14d', 4: '#3aff6e', 5: '#00f0ff', 6: '#b14aff' };

let activeBoard = null;        // board name
const pans = new Map();        // board name -> {x, y}
const localNotes = new Map();  // board name -> optimistic nodes awaiting the fs-watch push

// The live push carries the persisted truth (our note included) — drop echoes.
export function clearLocalNotes() { localNotes.clear(); }

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// boards are user/Obsidian-editable files — entry shape is NOT trusted:
// nodes may be a non-array, entries may be null; filter before touching fields
const objArr = (v) => (Array.isArray(v) ? v.filter((n) => n && typeof n === 'object') : []);

function normNodes(board) {
  return [...objArr(board.nodes), ...objArr(localNotes.get(board.name))].map((n) => ({
    ...n, x: num(n.x, 0), y: num(n.y, 0), width: num(n.width, 280), height: num(n.height, 120),
  }));
}

function bounds(nodes) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 480, maxY: 320 };
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.width)),
    maxY: Math.max(...nodes.map((n) => n.y + n.height)),
  };
}

// ------------------------------------------------------------------ edges
const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
// JSON Canvas edges may omit sides — face the peer's center, axis-dominant.
const sideOf = (a, b) => {
  const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
  const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
};
const anchor = (n, side) =>
  side === 'top' ? [n.x + n.width / 2, n.y]
  : side === 'bottom' ? [n.x + n.width / 2, n.y + n.height]
  : side === 'left' ? [n.x, n.y + n.height / 2]
  : [n.x + n.width, n.y + n.height / 2];

function edgesSvg(nodes, edges, off, w, h) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let paths = '';
  for (const e of objArr(edges)) {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) continue;
    const s1 = SIDE_N[e.fromSide] ? e.fromSide : sideOf(a, b);
    const s2 = SIDE_N[e.toSide] ? e.toSide : sideOf(b, a);
    const [x1, y1] = anchor(a, s1), [x2, y2] = anchor(b, s2);
    const k = Math.max(40, Math.min(140, Math.hypot(x2 - x1, y2 - y1) / 2.6));
    const [n1x, n1y] = SIDE_N[s1], [n2x, n2y] = SIDE_N[s2];
    const p = [x1 + off.x, y1 + off.y, x1 + off.x + n1x * k, y1 + off.y + n1y * k,
               x2 + off.x + n2x * k, y2 + off.y + n2y * k, x2 + off.x, y2 + off.y];
    paths += `<path class="cv-edge" marker-end="url(#cv-arr)" d="M${p[0]},${p[1]} C${p[2]},${p[3]} ${p[4]},${p[5]} ${p[6]},${p[7]}"/>`;
    if (e.label) {
      const mx = (p[0] + 3 * p[2] + 3 * p[4] + p[6]) / 8;   // cubic midpoint, t = .5
      const my = (p[1] + 3 * p[3] + 3 * p[5] + p[7]) / 8;
      paths += `<text class="cv-elbl" x="${mx.toFixed(1)}" y="${(my - 6).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text>`;
    }
  }
  return `<svg class="cv-edges" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><marker id="cv-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor"/></marker></defs>
    ${paths}</svg>`;
}

// ------------------------------------------------------------------ nodes
function nodeCard(n, off) {
  const card = el('div', 'cv-node cv-' + (n.type || 'text'));
  card.style.left = (n.x + off.x) + 'px';
  card.style.top = (n.y + off.y) + 'px';
  card.style.width = n.width + 'px';
  card.style.height = n.height + 'px';
  const c = n.color ? (PRESET[n.color] || String(n.color)) : null;
  if (c) card.style.setProperty('--cvc', c);
  if (n.type === 'file') {
    const base = String(n.file || '').split(/[\\/]/).pop();
    card.innerHTML = `<span class="cv-chip" title="${esc(n.file || '')}">📄 ${esc(base || 'file')}</span>`;
  } else if (n.type === 'link') {
    const short = String(n.url || '').replace(/^https?:\/\//, '');
    card.innerHTML = `<span class="cv-chip" title="${esc(n.url || '')}">🔗 ${esc(short || 'link')}</span>`;
  } else {
    card.innerHTML = `<div class="cv-text">${mdLite(n.text || '')}</div>`;
  }
  return card;
}

// ------------------------------------------------------------------ board
// Rebuilds the picker + active board inside host. The view re-invokes this
// whenever the boards array changes; picker clicks redraw internally.
export function renderCanvas(host, ctx, boardsIn) {
  // a malformed .canvas file yields a null/shapeless board entry — drop it
  const boards = objArr(boardsIn).filter((b) => typeof b.name === 'string');
  const draw = () => {
    host.innerHTML = '';
    const board = boards.find((b) => b.name === activeBoard) || boards[0] || null;
    if (board) activeBoard = board.name;

    // picker frame renders even with zero boards — the circle beckons below it
    const bar = el('div', 'cv-bar');
    boards.forEach((b) => {
      const t = el('button', 'cv-tab' + (b === board ? ' active' : ''), esc(b.name));
      t.onclick = () => { activeBoard = b.name; draw(); sfx('blip'); };
      bar.appendChild(t);
    });
    if (!boards.length) bar.appendChild(el('span', 'cv-none', 'no boards bound'));
    const canAdd = !!ctx.hq?.canvasAdd;
    const add = el('button', 'cv-note-btn', '＋ NOTE');
    add.disabled = !canAdd || !board;
    add.title = canAdd ? 'inscribe a text note at the center of your view'
      : 'bridge asleep — the quill wakes when hq:canvas-add answers';
    bar.appendChild(add);
    host.appendChild(bar);

    if (!board) {
      const void_ = el('div', 'cv-viewport cv-void');
      void_.innerHTML = `<div class="cv-empty">
          <div class="cv-circle">🔔</div>
          <div class="cv-empty-note">no canvases yet — drop a <b>.canvas</b> file in <span class="cv-path">data\\canvas\\</span> or let the Familiar draw first</div>
        </div>`;
      host.appendChild(void_);
      return;
    }

    const nodes = normNodes(board);
    const bb = bounds(nodes);
    const w = bb.maxX - bb.minX + PAD * 2, h = bb.maxY - bb.minY + PAD * 2;
    const off = { x: PAD - bb.minX, y: PAD - bb.minY };

    const noteForm = el('div', 'cv-note-form');
    noteForm.style.display = 'none';
    noteForm.innerHTML = `<input class="cv-note-in" maxlength="600" placeholder="inscribe… (lands at the center of your view)" /><button class="cv-note-go">INSCRIBE</button>`;
    host.appendChild(noteForm);

    const viewport = el('div', 'cv-viewport');
    const plane = el('div', 'cv-plane');
    plane.style.width = w + 'px';
    plane.style.height = h + 'px';
    plane.insertAdjacentHTML('beforeend', edgesSvg(nodes, board.edges, off, w, h));
    nodes.forEach((n) => plane.appendChild(nodeCard(n, off)));
    viewport.appendChild(plane);
    host.appendChild(viewport);

    const pan = pans.get(board.name) || { x: 0, y: 0 };
    pans.set(board.name, pan);
    const apply = () => { plane.style.transform = `translate(${pan.x}px, ${pan.y}px)`; };
    apply();

    // drag-to-pan on the background; node cards stay hover/select-able
    viewport.addEventListener('pointerdown', (e0) => {
      if (e0.button !== 0 || e0.target.closest('.cv-node')) return;
      const sx = e0.clientX - pan.x, sy = e0.clientY - pan.y;
      viewport.setPointerCapture(e0.pointerId);
      viewport.classList.add('panning');
      const move = (e) => { pan.x = e.clientX - sx; pan.y = e.clientY - sy; apply(); };
      const up = () => {
        viewport.removeEventListener('pointermove', move);
        viewport.removeEventListener('pointerup', up);
        viewport.removeEventListener('pointercancel', up);
        viewport.classList.remove('panning');
      };
      viewport.addEventListener('pointermove', move);
      viewport.addEventListener('pointerup', up);
      viewport.addEventListener('pointercancel', up);
    });
    viewport.addEventListener('wheel', (e) => { e.preventDefault(); pan.x -= e.deltaX; pan.y -= e.deltaY; apply(); }, { passive: false });

    // ---- the one write path -------------------------------------------
    const input = noteForm.querySelector('.cv-note-in');
    add.onclick = () => {
      if (add.disabled) return;
      const show = noteForm.style.display === 'none';
      noteForm.style.display = show ? '' : 'none';
      if (show) input.focus();
    };
    const inscribe = () => {
      const text = input.value.trim();
      if (!text || !ctx.hq?.canvasAdd) return;
      const vw = viewport.clientWidth || 800, vh = viewport.clientHeight || 520;
      const x = Math.round(vw / 2 - pan.x - off.x - 140);
      const y = Math.round(vh / 2 - pan.y - off.y - 60);
      const node = { type: 'text', text, x, y };
      Promise.resolve(ctx.hq.canvasAdd(board.name, node)).catch(() => {});
      const mine = localNotes.get(board.name) || [];
      mine.push({ id: 'local-' + Date.now().toString(36), width: 280, height: 120, ...node });
      localNotes.set(board.name, mine);
      sfx('coin');
      draw();
    };
    noteForm.querySelector('.cv-note-go').onclick = inscribe;
    input.onkeydown = (e) => { if (e.key === 'Enter') inscribe(); };
  };
  draw();
}
