// QUEUE rail — the DECIDE column. Renders buildQueue()'s items through exactly
// ONE item component (queueItem below), grouped by source with live counts.
//
// "One shape -> one component" is the design's structural fix for v3's "every
// screen is a different card": hierarchy, rhythm and severity are designed once
// here. A future surface that wants a queue renders THIS, it does not fork it.
//
// Verb contract (the four verbs buildQueue can emit):
//   dispatch -> fills the agent pane's form (local, synchronous, real)
//   open     -> project drawer-lite, from the SNAPSHOT (labeled as such)
//   done     -> hq.markQuestDone  (async, main writes + RELOADS the window)
//   note     -> capture:note action (async, main writes + RELOADS the window)
// Every one of them is either wired to a real effect or rendered disabled with
// a title that says why — there is no third state.
import { el, esc } from '../../ui/util.js';
import { dispatch } from '../../core/actions.mjs';
import { itemCleared } from './motion.js';

const GROUPS = [
  { source: 'threat', label: 'THREATS' },
  { source: 'task',   label: 'TASKS' },
  { source: 'gap',    label: 'GAPS' },
  { source: 'idea',   label: 'IDEAS' },
];

const VERB_LABEL = { dispatch: 'Dispatch', open: 'Open', done: 'Done', note: 'Note' };

// buildQueue's documented id scheme: tasks are `task:<questId>`. The raw quest
// id is not carried as its own field, so it is recovered here (and ONLY here).
function questIdOf(item) {
  return (typeof item.id === 'string' && item.id.startsWith('task:')) ? item.id.slice(5) : null;
}

export function createQueueRail(api) {
  // api: { hq, canDispatch, seed(item), openProject(item), alive() }
  const root = el('section', 'panel work-queue', `
    <div class="panel-head">
      <span class="panel-title">Queue</span>
      <span class="spacer"></span>
      <span class="q-total"><span class="figure" data-count>0</span><span class="figure-label">items</span></span>
    </div>
    <div class="panel-body" data-body></div>`);
  const bodyEl = root.querySelector('[data-body]');
  const countEl = root.querySelector('[data-count]');

  // Re-derived from the DOM after every clear, so the header can never drift
  // from what is actually on screen.
  function recount() {
    const n = bodyEl.querySelectorAll('.q-item').length;
    countEl.textContent = String(n);
    countEl.dataset.sev = n === 0 ? 'dim' : 'red';
    for (const head of bodyEl.querySelectorAll('.q-group')) {
      const left = head.querySelectorAll('.q-item').length;
      head.querySelector('.q-group-n').textContent = String(left);
      const empty = head.querySelector('[data-empty]');
      if (empty) empty.hidden = left > 0;
    }
  }

  function verbButton(item, verb, node) {
    const btn = el('button', 'btn btn--sm', esc(VERB_LABEL[verb] || verb));
    btn.type = 'button';
    // 23 identical "Dispatch" labels are useless to a screen reader — name the target.
    btn.setAttribute('aria-label', `${VERB_LABEL[verb] || verb}: ${item.title}`);

    if (verb === 'dispatch') {
      if (!api.canDispatch) {
        btn.disabled = true;
        btn.title = 'Dispatch needs the live app — this preview has no bridge to the main process (window.hq is absent).';
      } else {
        btn.title = 'Load this item into the dispatch form (does not start the agent).';
        btn.onclick = () => api.seed(item);
      }
      return btn;
    }

    if (verb === 'open') {
      if (!item.projectId) {
        btn.disabled = true;
        btn.title = 'No project attached to this item.';
      } else {
        btn.title = 'Project detail from the latest scan snapshot.';
        btn.onclick = () => api.openProject(item);
      }
      return btn;
    }

    if (verb === 'done') {
      const questId = questIdOf(item);
      if (typeof api.hq?.markQuestDone !== 'function' || !questId) {
        btn.disabled = true;
        btn.title = questId
          ? 'Completing a quest needs the live app — window.hq is absent in this preview.'
          : 'This item is not a quest, so it cannot be completed.';
      } else {
        btn.title = 'Mark this quest done. Main rewrites the overrides and RELOADS the window.';
        btn.onclick = async () => {
          // Honest-async, same shape as v3 Med-Bay's "Note for cleanup":
          // the in-flight label is set BEFORE the await because main's
          // hq:quest-done ends in spawnSync(assemble.mjs) + win.reload() —
          // this renderer is usually destroyed mid-await, so "Completing…"
          // is the last state the user can actually see. Do NOT add a toast
          // or delay the await to "fix" the missing confirmation; the reload
          // belongs to the shared quest pipeline (a main-lane concern).
          btn.disabled = true;
          btn.title = '';
          btn.textContent = 'Completing…';
          try {
            const r = dispatch('quest:done', { questId });
            if (!r.ok) throw new Error(r.error || 'dispatch failed');
            const ok = await Promise.resolve(r.result);
            if (ok === false) throw new Error('main refused the completion');
            // CONFIRMED cleared -> the one state change that earns the motion.
            itemCleared(node, api.alive, () => { node.remove(); recount(); });
          } catch (err) {
            // Visible, not console-only: a silent snap-back is indistinguishable
            // from a mis-click.
            console.warn('[work/queue] quest:done failed', err);
            btn.disabled = false;
            btn.classList.add('btn--bad');
            btn.textContent = '✗ Not done';
            btn.title = `Not completed — ${String(err?.message || err)}. Click to retry.`;
          }
        };
      }
      return btn;
    }

    if (verb === 'note') {
      // Gap items carry agency's captureText in .detail — that is the text
      // written to the capture inbox; the label is the human summary.
      const text = item.detail || item.title;
      if (typeof api.hq?.captureSave !== 'function' || !text) {
        btn.disabled = true;
        btn.title = text
          ? 'Capture needs the live app — window.hq is absent in this preview.'
          : 'Nothing to capture for this item.';
      } else {
        btn.title = 'Write this to the capture inbox. Main saves, reassembles and RELOADS the window (~1.6s freeze).';
        btn.onclick = async () => {
          // Same known hazard as above: hq:capture-save runs a blocking
          // spawnSync + win.reload(), so "Saving…" is the last visible state.
          btn.disabled = true;
          btn.title = '';
          btn.textContent = 'Saving…';
          try {
            const r = dispatch('capture:note', { text });
            if (!r.ok) throw new Error(r.error || 'dispatch failed');
            const ok = await Promise.resolve(r.result);
            if (ok === false) throw new Error('capture refused');
            btn.textContent = 'Noted';   // usually preempted by main's win.reload()
          } catch (err) {
            console.warn('[work/queue] capture:note failed', err);
            btn.disabled = false;
            btn.classList.add('btn--bad');
            btn.textContent = '✗ Not saved';
            btn.title = `Not saved — ${String(err?.message || err)}. Click to retry.`;
          }
        };
      }
      return btn;
    }

    // Unknown verb from a future queue.mjs: render it inert and say so rather
    // than dropping it silently (a dropped verb is an invisible regression).
    btn.disabled = true;
    btn.title = `This build has no handler for the "${verb}" verb.`;
    return btn;
  }

  // THE item component. Every scan-derived string is esc()'d on the way in.
  function queueItem(item) {
    const node = el('div', 'q-item');
    node.dataset.sev = item.severity || 'dim';
    node.dataset.itemId = item.id;
    const where = item.projectName || item.projectId || 'unattached';
    node.innerHTML = `
      <div class="q-title">${esc(item.title)}</div>
      <div class="q-sub">
        <span class="chip" data-sev="${esc(item.severity || 'dim')}">${esc(item.source)}</span>
        <span class="meta">${esc(where)}</span>
      </div>
      ${item.detail && item.detail !== item.title ? `<div class="q-note">${esc(item.detail)}</div>` : ''}
      ${item.projectPath ? '' : '<div class="q-note dim">no project path in the scan — dispatch unavailable for this item</div>'}`;
    const verbs = el('div', 'q-verbs');
    for (const v of (item.verbs || [])) verbs.appendChild(verbButton(item, v, node));
    if (!(item.verbs || []).length) {
      verbs.appendChild(el('span', 'q-note dim', 'no actions available for this item'));
    }
    node.appendChild(verbs);
    return node;
  }

  // Full rebuild. No listeners survive it: every handler is assigned as a
  // property on a freshly created node, so the old nodes (and their handlers)
  // are garbage with the old innerHTML.
  function render(model) {
    const items = model?.items || [];
    bodyEl.innerHTML = '';
    if (!items.length) {
      bodyEl.appendChild(el('div', 'empty', 'Queue is empty — no threats, open tasks, signal gaps or captured ideas in this snapshot.'));
      countEl.textContent = '0';
      countEl.dataset.sev = 'dim';
      return;
    }
    for (const g of GROUPS) {
      const mine = items.filter((i) => i.source === g.source);
      if (!mine.length) continue;
      const sec = el('section', 'q-group', `
        <div class="q-group-head">${esc(g.label)} <span class="q-group-n">${mine.length}</span></div>`);
      for (const item of mine) sec.appendChild(queueItem(item));
      // revealed only if every item in the group gets cleared this session
      const empty = el('div', 'empty', 'All clear in this group.');
      empty.setAttribute('data-empty', '');
      empty.hidden = true;
      sec.appendChild(empty);
      bodyEl.appendChild(sec);
    }
    recount();
  }

  // Marks which item last seeded the dispatch form, so the two columns are
  // visibly connected instead of the form changing for no apparent reason.
  function markSeeded(itemId) {
    for (const n of bodyEl.querySelectorAll('.q-item')) n.classList.toggle('is-seeded', n.dataset.itemId === itemId);
  }

  return { el: root, render, markSeeded };
}
