// CONJURE realm — the live feed of widgets Claude conjures while you chat.
// Reads the SAME canvas seam the Summoning canvas uses (ctx.data.bundle.canvas
// snapshot, replaced by hq.getCanvas()/onCanvas() live pushes), but presents it
// as a newest-first responsive grid of pretty widgets (widget.js) instead of a
// pan-plane. Display-only: every hq call is feature-detected so the dev harness
// renders fully, powered-down.
import { el, esc } from '../../ui/util.js';
import { widgetEl, parseSpec } from './widget.js';

const DEFAULT_BOARD = 'conjure';   // the canonical board Claude conjures onto

let root = null, CTX = null;
let boards = [];                   // [{name, nodes, edges}]
let activeBoard = null;            // sticky board name across repaints
let offSelect = null, offCanvas = null;

// boards/nodes are user- & Obsidian-editable files — never trust the shape
const objArr = (v) => (Array.isArray(v) ? v.filter((n) => n && typeof n === 'object') : []);
const liveBoards = (payload) => (Array.isArray(payload) ? payload : payload && payload.boards);

// pick the board to show: the sticky one, else 'conjure', else the fullest, else first
function chooseBoard() {
  const named = (n) => boards.find((b) => b.name === n);
  return named(activeBoard)
    || named(DEFAULT_BOARD)
    || [...boards].sort((a, b) => objArr(b.nodes).length - objArr(a.nodes).length)[0]
    || null;
}

const isWidget = (node) => node && (node.type === 'file' || node.type === 'link' || parseSpec(node.text));

function emptyState() {
  const wrap = el('div', 'cj-empty');
  wrap.innerHTML = `
    <div class="cj-empty-glyph" aria-hidden="true">✦</div>
    <h3>Nothing conjured yet</h3>
    <p>Ask Claude to build something while you chat — a stat tile, a checklist, a
       chart. It appears here live. Claude conjures by appending a node to the
       <b>${esc(DEFAULT_BOARD)}</b> canvas board:</p>
    <pre class="cj-spec">hq_canvas_add(name:"${esc(DEFAULT_BOARD)}", text:
\`\`\`hq
{ "type": "stat", "label": "Red quests", "value": 3, "delta": -2, "tone": "danger" }
\`\`\`
)</pre>
    <p class="cj-vocab">Types: <b>stat</b> · <b>progress</b> · <b>checklist</b> ·
       <b>callout</b> · <b>table</b> · <b>chips</b> · <b>spark</b> · <b>bars</b> · <b>note</b></p>`;
  return wrap;
}

function render() {
  if (!root || !CTX) return;
  root.innerHTML = '';
  const board = chooseBoard();
  if (board) activeBoard = board.name;

  // newest-first: both writers push() to nodes[], so file order is chronological
  const nodes = board ? [...objArr(board.nodes)].reverse() : [];
  const widgets = nodes.filter(isWidget);

  const head = el('h2', 'sec',
    `${esc(CTX.LX('tab_conjure'))} <span class="cj-count">${widgets.length || ''}${widgets.length ? (widgets.length === 1 ? ' element' : ' elements') : ''}</span>`);
  root.appendChild(head);
  root.appendChild(el('p', 'cj-teach', 'Live UI Claude builds while you chat — newest first.'));

  // board switcher (only when there's a real choice)
  if (boards.length > 1) {
    const bar = el('div', 'cj-tabs');
    boards.forEach((b) => {
      const t = el('button', 'cj-tab' + (b === board ? ' active' : ''), esc(b.name));
      t.onclick = () => { activeBoard = b.name; render(); };
      bar.appendChild(t);
    });
    root.appendChild(bar);
  }

  if (!widgets.length) { root.appendChild(emptyState()); return; }

  const feed = el('div', 'cj-feed');
  widgets.forEach((n) => { try { feed.appendChild(widgetEl(n)); } catch { /* one bad node never blanks the feed */ } });
  root.appendChild(feed);
}

export const view = {
  mount(stage, ctx) {
    CTX = ctx;
    root = el('section', 'realm-conjure');
    stage.appendChild(root);
    boards = objArr(ctx.data.bundle && ctx.data.bundle.canvas);
    render();
    offSelect = ctx.bus.on('data:select', render);

    const hq = ctx.hq;
    // live canvas beats the build-time snapshot — both seams optional
    if (hq && hq.getCanvas) {
      Promise.resolve(hq.getCanvas()).then((payload) => {
        const arr = liveBoards(payload);
        if (CTX && Array.isArray(arr)) { boards = objArr(arr); render(); }
      }).catch(() => {});
    }
    if (hq && hq.onCanvas) {
      offCanvas = hq.onCanvas((payload) => {
        const arr = liveBoards(payload);
        if (Array.isArray(arr)) { boards = objArr(arr); render(); }
      });
    }
  },

  unmount() {
    offSelect && offSelect(); offSelect = null;
    offCanvas && offCanvas(); offCanvas = null;
    root = null; CTX = null; boards = [];
  },
};
