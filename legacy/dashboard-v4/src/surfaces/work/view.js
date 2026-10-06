// WORK surface — the workbench, and the whole point of v4:
//
//   QUEUE (decide)  |  AGENT (act)  |  TRUTH (sense)
//
// This module owns composition and LIFECYCLE only; the three columns are their
// own modules. Read them for the behaviour:
//   queue-rail.js  the compact "next up" seed list (v4.3: the full board moved
//                  to surfaces/tasks/ — this column now shows only the few most
//                  urgent items that can seed a session, one verb each)
//   agent-pane.js  dispatch form, session cards, streaming output, kill, changes
//   truth-rail.js  live pushes vs the nightly snapshot, told apart honestly
//
// LIFECYCLE CONTRACT (the rule that keeps an 8-surface selftest from leaking):
// everything created in mount() is released in unmount() — the live subscriber
// and the one-second interval. `gen` is bumped by BOTH mount and unmount, and
// every async continuation (motion imports, IPC replies) checks alive() AFTER
// its await, so a continuation that resolves post-teardown touches nothing.
// Sub-modules create no timers and no global listeners; their element handlers
// are property assignments on nodes they create, so a re-render drops them with
// the nodes. (v4.3 removed this surface's only document-level listener with the
// project drawer: the `open` verb that summoned it lives on TASKS now, which
// owns that listener and reuses drawer.js unchanged.)
import { el } from '../../ui/util.js';
import { buildQueue } from '../../intel/queue.mjs';
import { get as liveGet, on as liveOn } from '../../state/live.js';
import { ensureWired } from './wire.js';
import { createQueueRail } from './queue-rail.js';
import { createAgentPane } from './agent-pane.js';
import { createTruthRail } from './truth-rail.js';

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[work] teardown', err); }
  }
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // belt-and-braces: a mount without a prior unmount still starts clean

    const scan = ctx.data.selected;
    const root = el('div', 'work-root');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    if (!scan) {
      // No controls at all in this state: everything the workbench does needs a
      // project list, and a form that can only fail is a lying control.
      // v4.3: a calm sentence on the ground, not a bordered panel wrapping a
      // dashed box — the constitution's "empty states are calm single
      // sentences" rule, and the exemplar's `.home-quiet` treatment.
      root.appendChild(el('section', 'work-blank', `
        <h2 class="work-key">Agent</h2>
        <p class="work-quiet">No scan data in this build — run a scan to populate the queue and the project list.</p>`));
      return;
    }

    // The audited action registry + the live-state subscriber (idempotent).
    ensureWired(ctx.hq);

    const grid = el('div', 'work');
    root.appendChild(grid);

    // Only projects with a real path can host an agent (session-api rejects
    // anything outside the Documents root anyway).
    const projects = (scan.projects || [])
      .filter((p) => p && p.path)
      .map((p) => ({ id: p.id, name: p.name, path: p.path }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const agent = createAgentPane({ hq: ctx.hq, projects, alive });
    const truth = createTruthRail({ hq: ctx.hq, scan, alive });

    const queue = createQueueRail({
      ctx,
      canDispatch: typeof ctx.hq?.sessionStart === 'function',
      seed: (item) => { agent.seed(item); queue.markSeeded(item.id); },
    });

    // v4.3 COMPOSITION: two columns, not three. TRUTH and NEXT UP share one
    // 320px context rail so the AGENT column — the focal one, the reason this
    // surface exists — is wider than both of them put together at every size
    // the app opens at. The old 380 | 1fr | 300 grid gave the thing you look at
    // the least room, which is half of why the screen read as crowded.
    // Truth sits ABOVE Next up because it is short and fixed-height, so the
    // part that scrolls is the tail of an urgency-sorted list rather than a
    // whole named block disappearing below the fold.
    const rail = el('div', 'work-rail');
    rail.appendChild(truth.el);
    rail.appendChild(queue.el);
    grid.appendChild(rail);
    grid.appendChild(agent.el);

    let model = buildQueue(scan);
    queue.render(model);

    // The command palette (core/palette.js) indexes the same buildQueue model
    // and hands an item back here: it calls switchSurface('work') — which
    // mounts synchronously, so this subscriber exists — and then emits. It runs
    // the IDENTICAL path as the rail's own `dispatch` verb (agent.seed +
    // markSeeded), so a palette seed and a rail seed can never diverge.
    teardown.push(ctx.bus.on('work:seed', (item) => {
      if (!alive() || !item) return;
      agent.seed(item);
      queue.markSeeded(item.id);
    }));

    // ---- live wiring -----------------------------------------------------
    // Reference comparison decides what actually changed: applyEvent() returns
    // a new state object per event but keeps untouched sub-objects by
    // reference, so an output chunk never rebuilds the session strip.
    let prev = liveGet();
    const onLive = (state) => {
      if (!alive()) return;
      const changed = {
        sessions: state.sessions !== prev.sessions,
        machine: state.machine !== prev.machine,
        browser: state.browser !== prev.browser,
      };
      prev = state;
      truth.sync(state, changed);
      agent.sync(state, changed.sessions);
    };
    teardown.push(liveOn(onLive));

    // Mount-time paint from whatever live.js already holds (it subscribes at
    // boot and survives surface switches). stamp=false / animate=false: this
    // view did not just receive these, and they did not just start.
    truth.sync(prev, { sessions: true, machine: true, browser: true }, false);
    agent.sync(prev, true, false);

    // ---- the one interval -------------------------------------------------
    const timer = setInterval(() => {
      if (!alive()) return;
      agent.tick();
      truth.tick();
    }, 1000);
    teardown.push(() => clearInterval(timer));

    // Scrubbing the time machine changes which snapshot the seed list describes.
    //
    // The skew this handler used to warn about is gone: v4.1's shell answers
    // `data:select` with a FULL surface re-mount (core/shell.js, the b1d4d9c
    // boundary), so the agent pane's project list and the truth rail's Snapshot
    // tile are rebuilt from the newly selected scan along with everything else.
    // This subscriber stays as belt-and-braces for any path where only the bus
    // event arrives; it is idempotent, so during a re-mount it costs one
    // redundant rebuild on already-correct data and nothing else.
    teardown.push(ctx.bus.on('data:select', () => {
      if (!alive()) return;
      const next = ctx.data.selected;
      if (!next) return;
      model = buildQueue(next);
      queue.render(model);
    }));

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d:
    // this is console text, not DOM, and the payload is per-source integer
    // counts under the queue's four fixed source keys.
    console.log(`WORK mounted queue=${model.items.length} counts=${JSON.stringify(model.counts)} projects=${projects.length} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();
  },
};
