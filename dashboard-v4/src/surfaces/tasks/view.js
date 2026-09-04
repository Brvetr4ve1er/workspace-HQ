// TASKS — the board the user lost, restored.
//
// This is the WHOLE intel/queue.mjs queue (threats · tasks · gaps · ideas),
// presented the way dashboard-v3's War Room presented its SITROOM board:
// severity-sectioned, a hero count that wears the worst severity on the board,
// a shape line under it, blast bars on the threats, kind badges, compact rows
// for the long tail and ONE roll-up for hygiene. The AGENT surface keeps only a
// compact "next up" seed list; everything else about the queue lives here.
//
// WHAT WAS DELIBERATELY NOT PORTED FROM v3 (a design review condemned both):
//   - the dashed outline on nearly every card. Passive containers here separate
//     by a background step plus air, exactly like the HOME exemplar.
//   - the crossing SVG "attack vector" connector lines. They fired on ~100% of
//     cards, so they carried zero bits while owning the loudest visual channel.
// Severity is carried by ONE accent edge per row plus the badge. Nothing else.
//
// CONSTITUTION COMPLIANCE (docs/superpowers/specs/2026-08-19-v4-design-constitution.md):
// - ONE focal element: `.tasks-count`, the number of rows that carry a severity.
//   It is the only display-weight type on the screen. Section labels are tiny
//   caps-mono in the label register; every title, detail and sentence is prose.
// - VIOLET BUDGET = 2, both on the header: the panel's edge glow, and the hero
//   count in the calm case (when nothing is flagged it is violet rather than a
//   severity colour, because severity owns red/amber/yellow and a violet zero is
//   not an alarm). When something IS flagged the count takes that severity
//   colour, which spends only ONE of the two. Hover/focus violet on the shared
//   .btn component is transient interaction feedback, not a standing accent.
// - BORDER DIET: no passive container is outlined. The only borders on this
//   screen belong to interactive controls (.btn, via components.css) and to the
//   2px severity seam on a card/row.
// - MOTION: none. Not even a blast-bar drain — v3 tweened those with anime.js,
//   which bought one second of animation and a whole class of torn-down-mid-
//   import failures. The bars are set at their width and stay there.
//
// LIFECYCLE CONTRACT (the reference implementation is work/view.js): everything
// created in mount() is released in unmount() AND before every re-render. `gen`
// is bumped by BOTH mount and unmount, so any async continuation that resolves
// post-teardown touches nothing. There are no timers on this surface. The one
// global listener (Escape closes the project drawer) is removed in teardown.
//
// STYLESHEET: styles/tasks.css, linked statically from index.html.
import { el, esc } from '../../ui/util.js';
import { dispatch, resolve } from '../../core/actions.mjs';
import { buildBoard } from './board-model.mjs';
// Read-only reuse of the WORK drawer — the queue's `open` verb has always shown
// project detail FROM THE SNAPSHOT, and that module already says so at the top
// of the panel. Its .drawer* classes live in work.css, which index.html loads
// document-wide, so they resolve here without this surface owning any of it.
import { openDrawer } from '../work/drawer.js';
// The ambient 3D sweep disc in the header slot. Owns its own teardown and never
// throws; see the mount/dispose pair in mount() below.
import { mountRadar } from './radar.js';

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[tasks] teardown', err); }
  }
}

// ---------------------------------------------------------------- constants
// Module constants, never scan data — so the badge text is safe by construction
// (it is esc()'d on the way in anyway).
const KIND_LABEL = {
  security: 'SECURITY', uncommitted: 'UNCOMMITTED', stale: 'STALE',
  'no-tests': 'NO TESTS', 'no-ci': 'NO CI',
};
const SOURCE_BADGE = { task: 'TASK', gap: 'GAP', idea: 'IDEA' };
const VERB_LABEL = { dispatch: 'Dispatch', open: 'Open', done: 'Done', note: 'Note' };

// A row section longer than this shows its head and hides the tail behind one
// real expander. 18 gaps and 19 ideas as an unbroken wall is the "too crowded"
// complaint the constitution exists to kill; a board you cannot skim is not one.
const ROW_CAP = 8;

const NO_BRIDGE = 'needs the live app — this preview has no bridge to the main process (window.hq is absent).';

// buildQueue's documented id scheme: tasks are `task:<questId>`. The raw quest
// id is not carried as its own field, so it is recovered here (and ONLY here).
function questIdOf(item) {
  return (typeof item.id === 'string' && item.id.startsWith('task:')) ? item.id.slice(5) : null;
}

// What each source shows where. Threats name their TARGET first (the project)
// and carry the finding underneath — that is the SITROOM reading order, and it
// is what makes a column of them scannable. Everything else leads with its own
// title and carries the project as the quiet meta line.
function present(item) {
  if (item.source === 'threat') {
    return {
      badge: KIND_LABEL[item.kind] || String(item.kind || 'threat').toUpperCase(),
      title: item.projectName || item.projectId || 'unattached',
      detail: item.title || '',
      meta: '',
    };
  }
  return {
    badge: SOURCE_BADGE[item.source] || String(item.source || '').toUpperCase(),
    title: item.title || 'Untitled',
    detail: (item.detail && item.detail !== item.title) ? item.detail : '',
    meta: item.projectName || item.projectId || 'unattached',
  };
}

// ------------------------------------------------------------------- board
// Everything below is created per render() and released with the render: every
// handler is a PROPERTY assignment on a node this file just made, so dropping
// the node drops the handler. There is nothing to unsubscribe.
export function createBoard(api) {
  // api: { ctx, alive(), openProject(item) }
  const ctx = api.ctx;
  const root = el('div', 'tasks');

  // Re-derived from the DOM after every clear, so the header and the section
  // counts can never drift from what is actually on screen.
  function recount() {
    const rows = root.querySelectorAll('.t-card, .t-row');
    let flagged = 0;
    for (const n of rows) if (n.dataset.sev && n.dataset.sev !== 'dim') flagged++;
    const worst = ['red', 'orange', 'yellow'].find((s) => root.querySelector(`.t-card[data-sev="${s}"], .t-row[data-sev="${s}"]`)) || 'dim';

    const count = root.querySelector('.tasks-count');
    const sub = root.querySelector('.tasks-sub');
    const shapeEl = root.querySelector('.tasks-shape');
    if (count) {
      count.textContent = String(flagged);
      count.dataset.sev = flagged ? worst : 'dim';
    }
    if (sub) sub.textContent = flagged ? 'need attention' : 'nothing needs attention';

    const parts = [];
    let total = 0;
    for (const sec of root.querySelectorAll('.t-sec')) {
      // rollup sections hold no rows of their own — they carry their count on
      // the section itself, and nothing on this surface can clear one.
      const n = sec.dataset.rollup ? Number(sec.dataset.rollup) : sec.querySelectorAll('.t-card, .t-row').length;
      total += n;
      const nEl = sec.querySelector('.t-n');
      if (nEl) nEl.textContent = String(n);
      const empty = sec.querySelector('[data-empty]');
      if (empty) empty.hidden = n > 0;
      if (n) parts.push(`${n} ${sec.dataset.word || 'items'}`);
    }
    if (shapeEl) {
      shapeEl.textContent = total
        ? `${total} item${total === 1 ? '' : 's'} on the board — ${parts.join(' · ')}`
        : 'Nothing on the board.';
    }
  }

  // ------------------------------------------------------------- the verbs
  // Every one is wired to a real effect or rendered disabled WITH A TITLE that
  // says why. There is no third state on this surface.
  function verbButton(item, verb, node) {
    const p = present(item);
    const btn = el('button', 'btn btn--sm', esc(VERB_LABEL[verb] || verb));
    btn.type = 'button';
    // 40 identical "Dispatch" labels are useless to a screen reader — name the
    // target and the finding.
    btn.setAttribute('aria-label', `${VERB_LABEL[verb] || verb}: ${p.title}${p.detail ? ` — ${p.detail}` : ''}`);

    if (verb === 'dispatch') {
      // THE SEAM, and it is the one the command palette already uses: switch to
      // AGENT through the audited action registry, then hand the item over on
      // the `work:seed` bus event. WORK mounts synchronously inside dispatch(),
      // so its subscriber exists by the time we emit. Do NOT invent a second
      // path — a rail seed, a palette seed and a board seed must stay the same
      // code on the other side.
      if (!resolve('go:work')) {
        btn.disabled = true;
        btn.title = 'No "go:work" action is registered in this build, so there is nowhere to send this.';
      } else {
        btn.title = 'Opens the AGENT workbench with this loaded into its dispatch form. It does not start the agent.';
        btn.onclick = () => {
          dispatch('go:work', ctx);
          ctx.bus.emit('work:seed', item);
        };
      }
      return btn;
    }

    if (verb === 'open') {
      if (!item.projectId) {
        btn.disabled = true;
        btn.title = 'No project attached to this item.';
      } else {
        btn.title = 'Project detail from the scan snapshot you are looking at.';
        btn.onclick = () => api.openProject(item);
      }
      return btn;
    }

    if (verb === 'done') {
      const questId = questIdOf(item);
      // Gated on isLatest as well as the bridge, the way HOME gates its "Mark
      // done": completing a quest while scrubbed back to an older photograph
      // would write today's log from yesterday's belief.
      const stale = !ctx.data.isLatest;
      if (typeof ctx.hq?.markQuestDone !== 'function' || !questId || stale) {
        btn.disabled = true;
        btn.title = !questId
          ? 'This item is not a quest, so it cannot be completed.'
          : stale
            ? 'You are reading an older snapshot. Completing work is only offered on the latest scan.'
            : `Completing a quest ${NO_BRIDGE}`;
      } else {
        btn.title = 'Mark this quest done. Main rewrites the overrides and RELOADS the window.';
        btn.onclick = async () => {
          // Honest-async, the shape dashboard-v3's Med-Bay proved and the WORK
          // rail carries: the in-flight label is set BEFORE the await, because
          // main's hq:quest-done ends in spawnSync(assemble.mjs) + win.reload()
          // and this renderer is usually destroyed mid-await. "Completing…" is
          // the last state the user can actually see. Do NOT add a toast or
          // delay the await to "fix" the missing confirmation — the reload
          // belongs to the shared quest pipeline, a main-lane concern.
          btn.disabled = true;
          btn.title = '';
          btn.textContent = 'Completing…';
          try {
            const r = dispatch('quest:done', { ...ctx, questId });
            if (!r.ok) throw new Error(r.error || 'dispatch failed');
            const ok = await Promise.resolve(r.result);
            if (ok === false) throw new Error('main refused the completion');
            if (!api.alive()) return;          // torn down while the IPC was in flight
            node.remove();
            recount();
          } catch (err) {
            // Visible, not console-only: a silent snap-back is indistinguishable
            // from a mis-click.
            console.warn('[tasks] quest:done failed', err);
            if (!api.alive()) return;
            btn.disabled = false;
            btn.classList.add('btn--bad');
            btn.textContent = 'Not done';
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
      if (typeof ctx.hq?.captureSave !== 'function' || !text) {
        btn.disabled = true;
        btn.title = text ? `Capture ${NO_BRIDGE}` : 'Nothing to capture for this item.';
      } else {
        btn.title = 'Writes this to the capture inbox. Main saves, reassembles and RELOADS the window (~1.6s freeze).';
        btn.onclick = async () => {
          // Same known hazard as `done`: hq:capture-save runs a blocking
          // spawnSync + win.reload(), so "Saving…" is the last visible state.
          btn.disabled = true;
          btn.title = '';
          btn.textContent = 'Saving…';
          try {
            const r = dispatch('capture:note', { ...ctx, text });
            if (!r.ok) throw new Error(r.error || 'dispatch failed');
            const ok = await Promise.resolve(r.result);
            if (ok === false) throw new Error('capture refused');
            if (!api.alive()) return;
            btn.textContent = 'Noted';         // usually preempted by main's win.reload()
          } catch (err) {
            console.warn('[tasks] capture:note failed', err);
            if (!api.alive()) return;
            btn.disabled = false;
            btn.classList.add('btn--bad');
            btn.textContent = 'Not saved';
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

  function verbRow(item, node) {
    const verbs = el('div', 't-verbs');
    for (const v of (item.verbs || [])) verbs.appendChild(verbButton(item, v, node));
    if (!(item.verbs || []).length) {
      // queue.mjs drops `dispatch` when a project has no path, which can leave
      // an idea with no honest verb at all. Say so instead of drawing a button
      // that cannot act.
      verbs.appendChild(el('span', 't-none', 'No action available for this item — the scan has no path for its project.'));
    }
    node.appendChild(verbs);
    return verbs;
  }

  // -------------------------------------------------------------- the rows
  function card(item) {
    const p = present(item);
    const node = el('article', 't-card');
    node.dataset.sev = item.severity || 'dim';
    node.dataset.itemId = item.id;
    const pct = typeof item.hpPct === 'number' ? item.hpPct : null;
    node.innerHTML = `
      <div class="t-kind">${esc(p.badge)}</div>
      <h3 class="t-title">${esc(p.title)}</h3>
      ${p.detail ? `<p class="t-detail">${esc(p.detail)}</p>` : ''}
      ${p.meta ? `<p class="t-meta">${esc(p.meta)}</p>` : ''}
      ${pct === null ? '' : `<span class="t-blast" role="img" aria-label="Blast radius ${esc(String(pct))} percent of this category's ceiling"><i style="width:${esc(String(pct))}%"></i></span>`}`;
    verbRow(item, node);
    return node;
  }

  function row(item) {
    const p = present(item);
    const node = el('div', 't-row');
    node.dataset.sev = item.severity || 'dim';
    node.dataset.itemId = item.id;
    // Threat rows lead with the project and carry the finding; everything else
    // leads with its own title and carries the project.
    const sub = item.source === 'threat' ? p.detail : p.meta;
    node.innerHTML = `
      <span class="t-row-title">${esc(p.title)}</span>
      ${sub ? `<span class="t-row-sub">${esc(sub)}</span>` : ''}`;
    verbRow(item, node);
    return node;
  }

  // ALL hygiene items collapse into ONE control. Missing tests and missing CI
  // are real, but they are a backlog, not an incident — and ten of them at card
  // weight would out-shout three leaked credentials.
  function rollup(group) {
    const noTests = group.items.filter((t) => t.kind === 'no-tests').length;
    const noCi = group.items.filter((t) => t.kind === 'no-ci').length;
    const parts = [];
    if (noTests) parts.push(`${noTests} without tests`);
    if (noCi) parts.push(`${noCi} without CI`);
    const head = `${group.count} hygiene item${group.count === 1 ? '' : 's'}`;
    const btn = el('button', 't-rollup');
    btn.type = 'button';
    btn.innerHTML = `<span class="t-rollup-head">${esc(head)}</span>
      <span class="t-rollup-sub">${esc(parts.join(', '))}</span>
      <span class="t-rollup-go" aria-hidden="true">Projects →</span>`;
    btn.setAttribute('aria-label', `${head}: ${parts.join(', ')}. Open the Projects shelf.`);
    if (!resolve('go:projects')) {
      btn.disabled = true;
      btn.title = 'No "go:projects" action is registered in this build.';
    } else {
      btn.title = 'Opens the Projects shelf, where these are fixed one project at a time.';
      btn.onclick = () => dispatch('go:projects', ctx);
    }
    return btn;
  }

  function section(group) {
    const sec = el('section', 't-sec');
    sec.dataset.group = group.id;
    sec.dataset.word = group.word;
    sec.innerHTML = `<h2 class="tasks-key">${esc(group.label)}<span class="t-n">${esc(String(group.count))}</span></h2>`;

    if (group.mode === 'rollup') {
      sec.dataset.rollup = String(group.count);
      sec.appendChild(rollup(group));
      return sec;
    }

    if (group.mode === 'card') {
      const board = el('div', 't-board');
      for (const item of group.items) board.appendChild(card(item));
      sec.appendChild(board);
    } else {
      const list = el('div', 't-rows');
      const hidden = [];
      group.items.forEach((item, i) => {
        const node = row(item);
        if (i >= ROW_CAP) { node.hidden = true; hidden.push(node); }
        list.appendChild(node);
      });
      sec.appendChild(list);
      if (hidden.length) {
        // A real control: it reveals rows that are already built and in the DOM.
        const more = el('button', 't-more', `Show ${hidden.length} more`);
        more.type = 'button';
        more.title = `Reveal the remaining ${hidden.length} rows in this group.`;
        more.setAttribute('aria-expanded', 'false');
        more.onclick = () => {
          const opening = hidden[0].hidden;
          for (const n of hidden) n.hidden = !opening;
          more.textContent = opening ? 'Show fewer' : `Show ${hidden.length} more`;
          more.title = opening ? 'Collapse this group back to the first rows.' : `Reveal the remaining ${hidden.length} rows in this group.`;
          more.setAttribute('aria-expanded', opening ? 'true' : 'false');
        };
        sec.appendChild(more);
      }
    }

    // Revealed only if every row in the group is cleared during this session.
    const empty = el('p', 't-clear', 'All clear in this group.');
    empty.setAttribute('data-empty', '');
    empty.hidden = true;
    sec.appendChild(empty);
    return sec;
  }

  // ------------------------------------------------------------- the header
  // The ONE focal element on the screen is `.tasks-count`. It counts the rows
  // that carry a SEVERITY, not every row on the board: 47 of the 63 rows in the
  // live snapshot are dim gaps and ideas, and a big red 63 would claim 63
  // things are wrong. The shape line underneath carries the full composition.
  function header(board) {
    const head = el('header', 'tasks-head');
    head.innerHTML = `
      <div class="tasks-headline">
        <div class="tasks-eyebrow">SITROOM</div>
        <div class="tasks-count-row">
          <span class="tasks-count" data-sev="${esc(board.flagged ? board.worstSev : 'dim')}">${esc(String(board.flagged))}</span>
          <span class="tasks-sub">${board.flagged ? 'need attention' : 'nothing needs attention'}</span>
        </div>
        <p class="tasks-shape">${board.total
          ? `${esc(String(board.total))} item${board.total === 1 ? '' : 's'} on the board — ${esc(board.shape)}`
          : 'Nothing on the board.'}</p>
      </div>
      <div class="tasks-radar"></div>`;
    // The radar slot is left EMPTY here on purpose. render() replaces this whole
    // header, so anything mounted into the slot from inside header() would be
    // orphaned by the next paint with its WebGL context still live. The radar is
    // mounted (and disposed) around board.render() in paint() instead — one pair,
    // one owner, see mount().
    return head;
  }

  function render(board) {
    root.innerHTML = '';
    root.appendChild(header(board));
    if (!board.total) {
      // Calm single sentence, not a styled panel.
      root.appendChild(el('p', 'tasks-quiet',
        'Nothing is queued in this snapshot — no threats, open tasks, signal gaps or captured ideas. Run a scan and this board fills itself.'));
      return;
    }
    for (const g of board.groups) {
      if (!g.count) continue;
      root.appendChild(section(g));
    }
  }

  return { el: root, render, recount };
}

// ---------------------------------------------------------------------- view
export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // a mount without a prior unmount still starts clean

    const host = el('div', 'tasks-host');
    const alive = () => myGen === gen && host.isConnected;
    stage.appendChild(host);

    let drawer = null;
    const closeDrawer = () => { if (drawer) { try { drawer.close(); } catch {} drawer = null; } };

    const board = createBoard({
      ctx,
      alive,
      openProject: (item) => {
        closeDrawer();
        const S = ctx.data.selected;
        const p = (S?.projects || []).find((x) => x && x.id === item.projectId);
        drawer = openDrawer(host, p || { name: item.projectName, path: item.projectPath }, ctx.hq, () => { drawer = null; });
      },
    });
    host.appendChild(board.el);

    // THE RADAR'S ONE MOUNT/DISPOSE PAIR. render() does `root.innerHTML = ''`,
    // which detaches the `.tasks-radar` slot — so a radar that outlived a repaint
    // would hold a live WebGL context on a node nobody can see, and 105 selftest
    // cycles would exhaust the context pool. dropRadar() therefore runs BEFORE
    // every render (below) and again from teardown, and it is idempotent.
    let radar = null;
    const dropRadar = () => {
      if (!radar) return;
      const d = radar; radar = null;
      try { d(); } catch (err) { console.error('[tasks] radar dispose', err); }
    };
    teardown.push(dropRadar);

    const paint = () => {
      closeDrawer();                    // a drawer describing the previous snapshot must not survive it
      dropRadar();                      // ...and neither must a radar bound to the header it drew on
      const S = ctx.data.selected;
      const model = buildBoard(S);
      board.render(model);
      // Ambient accent only, and never load-bearing: mountRadar never throws and
      // returns a no-op disposer when the flag is off or the slot is missing.
      radar = mountRadar(board.el.querySelector('.tasks-radar'), model.radar);
      return model;
    };

    const model = paint();

    // The v4.1 shell answers `data:select` with a full surface re-mount, so this
    // is belt-and-braces for any path where only the bus event arrives. It is
    // idempotent, so the redundant paint during a re-mount costs one repaint on
    // already-correct data.
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) paint(); }));

    // The one global listener on this surface.
    const onKey = (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); };
    document.addEventListener('keydown', onKey);
    teardown.push(() => document.removeEventListener('keydown', onKey));
    teardown.push(closeDrawer);

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d —
    // this is console text, not DOM, and the payload is integer counts under
    // the board's seven fixed section ids.
    const groups = {};
    for (const g of model.groups) if (g.count) groups[g.id] = g.count;
    console.log(`TASKS mounted items=${model.total} flagged=${model.flagged} worst=${model.worstSev} groups=${JSON.stringify(groups)} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();
  },
};
