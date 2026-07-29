// WAR ROOM view — SITROOM tactical board (System-HUD skin). Task 1 ships a
// placeholder shell; Task 3 fills the board, Task 4 the 3D radar, Task 5 vectors.
import { el } from '../../ui/util.js';

let rootEl = null, ctxRef = null, offData = null;

function render() {
  const root = rootEl; if (!root) return;
  root.innerHTML = '';
  const sec = el('section', 'realm-warroom');
  sec.innerHTML = `<div class="wr-frame">
    <div class="wr-head"><span class="wr-title">SITROOM</span><span class="wr-sub">standing by…</span></div>
  </div>`;
  root.appendChild(sec);
}

export const view = {
  mount(root, ctx) { rootEl = root; ctxRef = ctx; offData = ctx.bus.on('data:select', render); render(); },
  unmount() { if (offData) { offData(); offData = null; } rootEl = null; ctxRef = null; },
};
