// QUEUE rail — AGENT's compact "NEXT UP" seed list.
//
// v4.3 moved the full board out of here. The whole intel/queue.mjs queue —
// every source, every group, every verb, the severity sections and the blast
// bars — now lives on the TASKS surface (src/surfaces/tasks/). What remains on
// the workbench is the one job the workbench actually needs from the queue:
// pick something and load it into the dispatch form beside it. So this rail
// shows the few most urgent items that can ACTUALLY seed a session, each with a
// single verb, and hands the reader to TASKS for anything else.
//
// WHY ONLY SEEDABLE ITEMS: queue.mjs drops `dispatch` from any item whose
// project has no path in the scan, and a "next up" list whose rows cannot be
// picked up is dead weight in the column next to the form they would fill.
// The header still counts the WHOLE queue, so the rail never understates how
// much is outstanding — the footer sentence says exactly what is being shown.
//
// Verb contract (one verb, and it is real):
//   dispatch -> fills the agent pane's form (local, synchronous, real)
// The board's other three verbs (open / done / note) live on TASKS, which is
// one click away through the footer control. Every control here either acts or
// renders disabled with a title that says why — there is no third state.
//
// v4.3 PRESENTATION (design constitution + the HOME exemplar): the row's TITLE
// is the verb, the way `.pick-open` is on HOME. Six identical uppercase
// "DISPATCH" boxes were the loudest thing in a 320px column and told the reader
// nothing the row did not already say; the action is unchanged, only its
// affordance. The row itself receded to a flat background step with a 2px
// severity seam, and the source moved from a bordered `.chip` into the plain
// label register. The header's queue total stopped being a glowing --fs-2xl
// numeral: one display level per screen, and it belongs to the AGENT column.
import { el, esc } from '../../ui/util.js';
import { dispatch, resolve } from '../../core/actions.mjs';

// How many rows the seed list shows. Small on purpose: this column sits beside
// the dispatch form, not in place of the board.
const NEXT_UP = 6;

export function createQueueRail(api) {
  // api: { ctx, canDispatch, seed(item) }
  const root = el('section', 'work-queue', `
    <div class="wq-head">
      <h2 class="work-key">Next up</h2>
      <span class="wq-total"><span data-count>0</span> queued</span>
    </div>
    <div class="wq-body" data-body></div>
    <div class="wq-foot" data-foot></div>`);
  const bodyEl = root.querySelector('[data-body]');
  const countEl = root.querySelector('[data-count]');
  const footEl = root.querySelector('[data-foot]');

  // THE item component. Every scan-derived string is esc()'d on the way in, and
  // the title is the control: one tap target per row, named by the row.
  function queueItem(item) {
    const node = el('div', 'q-item');
    node.dataset.sev = item.severity || 'dim';
    node.dataset.itemId = item.id;
    const where = item.projectName || item.projectId || 'unattached';
    node.innerHTML = `
      <div class="q-source">${esc(item.source)}</div>
      <h3 class="q-title"><button class="q-open" type="button">${esc(item.title)}</button></h3>
      <div class="q-where">${esc(where)}</div>`;
    const open = node.querySelector('.q-open');
    // .setAttribute takes the RAW string — esc() here would show entity text to
    // a screen reader instead of the character.
    open.setAttribute('aria-label', `Load into the dispatch form: ${item.title}`);
    if (!api.canDispatch) {
      open.disabled = true;
      open.title = 'Dispatch needs the live app — this preview has no bridge to the main process (window.hq is absent).';
    } else {
      open.title = 'Load this item into the dispatch form beside it (does not start the agent).';
      open.onclick = () => api.seed(item);
    }
    return node;
  }

  // The one control in the footer: the whole board, one click away. A quiet
  // text verb (the exemplar's `.pick-done`), not a third box in the column.
  function boardButton() {
    const btn = el('button', 'work-link', 'Open the full board');
    btn.type = 'button';
    if (!resolve('go:tasks')) {
      btn.disabled = true;
      btn.title = 'No "go:tasks" action is registered in this build.';
    } else {
      btn.title = 'Opens the TASKS board — every threat, task, gap and idea, with all of their verbs.';
      btn.onclick = () => dispatch('go:tasks', api.ctx);
    }
    return btn;
  }

  // Full rebuild. No listeners survive it: every handler is assigned as a
  // property on a freshly created node, so the old nodes (and their handlers)
  // are garbage with the old innerHTML.
  function render(model) {
    const items = model?.items || [];
    const seedable = items.filter((i) => (i.verbs || []).includes('dispatch'));
    const shown = seedable.slice(0, NEXT_UP);

    // The header counts the WHOLE queue and takes the colour of the worst
    // severity in it — severity is the only thing on this rail allowed to spend
    // colour, and a queue of nothing but ideas stays neutral.
    countEl.textContent = String(items.length);
    const worst = ['red', 'orange', 'yellow'].find((s) => items.some((i) => i.severity === s));
    countEl.dataset.sev = items.length === 0 ? 'dim' : (worst || 'dim');

    bodyEl.innerHTML = '';
    if (!shown.length) {
      bodyEl.appendChild(el('p', 'work-quiet', items.length
        ? 'Nothing in this snapshot can seed a session — every queued item is missing a project path in the scan.'
        : 'Queue is empty — no threats, open tasks, signal gaps or captured ideas in this snapshot.'));
    } else {
      for (const item of shown) bodyEl.appendChild(queueItem(item));
    }

    footEl.innerHTML = '';
    if (shown.length) {
      footEl.appendChild(el('div', 'q-note', shown.length < seedable.length
        ? `Showing the ${shown.length} most urgent of ${seedable.length} items that can seed a session.`
        : `Showing all ${shown.length} items that can seed a session.`));
    }
    footEl.appendChild(boardButton());
  }

  // Marks which item last seeded the dispatch form, so the two columns are
  // visibly connected instead of the form changing for no apparent reason.
  // Tolerates an id that is not in this short list — a seed can arrive from the
  // command palette or from the TASKS board, and neither is bound to these six.
  function markSeeded(itemId) {
    for (const n of bodyEl.querySelectorAll('.q-item')) n.classList.toggle('is-seeded', n.dataset.itemId === itemId);
  }

  return { el: root, render, markSeeded };
}
