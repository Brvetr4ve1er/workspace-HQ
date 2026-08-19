// WORK surface — the workbench, and the whole point of v4:
//
//   QUEUE (decide)  |  AGENT (act)  |  TRUTH (sense)
//
// This module owns composition and LIFECYCLE only; the three columns are their
// own modules. Read them for the behaviour:
//   queue-rail.js  the one item component + the four verbs
//   agent-pane.js  dispatch form, session cards, streaming output, kill, changes
//   truth-rail.js  live pushes vs the nightly snapshot, told apart honestly
//
// LIFECYCLE CONTRACT (the rule that keeps a 6-surface selftest from leaking):
// everything created in mount() is released in unmount() — the live subscriber,
// the one-second interval, the document keydown listener, the drawer. `gen` is
// bumped by BOTH mount and unmount, and every async continuation (motion
// imports, IPC replies) checks alive() AFTER its await, so a continuation that
// resolves post-teardown touches nothing. Sub-modules create no timers and no
// global listeners; their element handlers are property assignments on nodes
// they create, so a re-render drops them with the nodes.
import { el } from '../../ui/util.js';
import { buildQueue } from '../../intel/queue.mjs';
import { get as liveGet, on as liveOn } from '../../state/live.js';
import { ensureWired } from './wire.js';
import { createQueueRail } from './queue-rail.js';
import { createAgentPane } from './agent-pane.js';
import { createTruthRail } from './truth-rail.js';
import { openDrawer } from './drawer.js';

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
      root.appendChild(el('section', 'panel', `
        <div class="panel-head"><span class="panel-title">Work</span></div>
        <div class="panel-body">
          <div class="empty">No scan data in this build — run a scan to populate the queue and the project list.</div>
        </div>`));
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

    let drawer = null;
    const closeDrawer = () => { if (drawer) { drawer.close(); drawer = null; } };

    const queue = createQueueRail({
      hq: ctx.hq,
      canDispatch: typeof ctx.hq?.sessionStart === 'function',
      alive,
      seed: (item) => { agent.seed(item); queue.markSeeded(item.id); },
      openProject: (item) => {
        closeDrawer();
        const p = (scan.projects || []).find((x) => x && x.id === item.projectId);
        drawer = openDrawer(root, p || { name: item.projectName, path: item.projectPath }, ctx.hq, () => { drawer = null; });
      },
    });

    grid.appendChild(queue.el);
    grid.appendChild(agent.el);
    grid.appendChild(truth.el);

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

    // ---- the one global listener -----------------------------------------
    const onKey = (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); };
    document.addEventListener('keydown', onKey);
    teardown.push(() => document.removeEventListener('keydown', onKey));
    teardown.push(closeDrawer);

    // Scrubbing the time machine changes which snapshot the queue describes.
    //
    // KNOWN BOUNDARY (audited, deliberately not "fixed" here): this rebuilds the
    // QUEUE only. The agent pane's project list, the drawer's metric lookup and
    // the truth rail's Snapshot tile all close over the MOUNT-TIME scan, so after
    // a scrub the Snapshot tile would name an older scan than the topstrip.
    // That is unreachable in v4.0 — data.select() is never called: v4's shell has
    // no time-machine scrubber (shell.js renders rail + topstrip only), so this
    // handler is forward-compat and nothing can currently observe the skew.
    // WHOEVER ADDS THE SCRUBBER (v4.1) must make this a full re-mount instead of
    // a queue rebuild, or the rail starts lying about which photograph it is.
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
