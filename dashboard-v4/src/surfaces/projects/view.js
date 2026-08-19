// PROJECTS surface — the product shelf (v4.1 S1, ported from v3 forge/view.js).
//
//   GRID (the shelf)  |  FOCUS (working on now) + SUGGESTED ACTIONS
//
// This module owns composition and LIFECYCLE only; the pieces are their own
// modules — read them for the behaviour:
//   grid.js       toolbar + product cards (health chips, meter, dev toggle)
//   drawer.js     the full project panel (re-entry briefing + real actions)
//   focus.js      browser focus: snapshot rollups + the live-tab line
//   strip.js      agency proposals -> Send Claude / Add to ideas (Epic D)
//   core.mjs      the pure sort/filter/derive helpers (node --test'd)
//
// LIFECYCLE CONTRACT (same as work/view.js, the reference implementation):
// everything created in mount() is released in unmount() — the bus/live/dev
// subscriptions, the document keydown listener, the drawer. `gen` is bumped by
// BOTH mount and unmount and every continuation checks alive() after its
// await-equivalent, so nothing touches a torn-down DOM. Element handlers are
// property assignments on nodes this surface creates — a re-render drops them
// with the nodes.
import { el } from '../../ui/util.js';
import { get as liveGet, on as liveOn } from '../../state/live.js';
// The ONE wiring path (audited action registry + live-state subscriber, both
// idempotent). Imported from the workbench rather than re-implemented: two
// wire modules would eventually disagree about what "wired" means.
import { ensureWired } from '../work/wire.js';
import { prevProjectMap } from './core.mjs';
import { createGrid } from './grid.js';
import { createFocusPanel } from './focus.js';
import { createActionsStrip } from './strip.js';
import { openDrawer } from './drawer.js';
import { paintDevToggle } from './dev-toggle.js';

let gen = 0;              // bumped by mount AND unmount — the async guard token
let teardown = [];        // every release fn for the current mount

// Dev-server run state, fed ONLY by hq:dev-status pushes. Module-level so it
// survives re-renders and surface switches (v3's shared devState, scoped to
// this surface — the renderer's only honest knowledge of what is running).
const devRunning = Object.create(null);

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[projects] teardown', err); }
  }
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                       // belt-and-braces: a mount without a prior unmount still starts clean

    const root = el('div', 'projects-root');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    if (!ctx.data.selected) {
      // No controls at all in this state — a shelf with nothing on it.
      root.appendChild(el('section', 'panel', `
        <div class="panel-head"><span class="panel-title">Projects</span></div>
        <div class="panel-body">
          <div class="empty">No scan data in this build — run a scan to populate the product shelf.</div>
        </div>`));
      return;
    }

    // Audited action registry (claude:dispatch / capture:note live there) +
    // the live-state subscriber. Idempotent; WORK usually got here first.
    ensureWired(ctx.hq);

    let drawer = null;
    let focusRef = null;
    const closeDrawer = () => { if (drawer) { drawer.close(); drawer = null; } };

    const render = () => {
      closeDrawer();                    // the open drawer closes over the OLD scan
      root.innerHTML = '';
      const scan = ctx.data.selected;   // re-read EVERY render — scrub-safe
      if (!scan) return { projects: 0, proposals: 0 };
      const prevScan = ctx.data.selectedIndex > 0 ? ctx.data.scans[ctx.data.selectedIndex - 1] : null;
      const prevMap = prevProjectMap(prevScan);

      const openDetail = (p) => {
        closeDrawer();
        drawer = openDrawer(root, { project: p, prev: prevMap[p.id] || null, scan, hq: ctx.hq, devRunning }, () => { drawer = null; });
      };

      const grid = createGrid({ scan, prevMap, hq: ctx.hq, devRunning, openDetail });
      root.appendChild(grid.el);

      const side = el('div', 'projects-side');
      const focus = createFocusPanel({ scan, hq: ctx.hq, isLatest: ctx.data.isLatest, liveBrowser: liveGet().browser });
      focusRef = focus;
      side.appendChild(focus.el);
      const strip = createActionsStrip({ scan, hq: ctx.hq });
      if (strip) side.appendChild(strip.el);
      root.appendChild(side);

      return { projects: (scan.projects || []).length, proposals: strip ? strip.count : 0 };
    };
    const stats = render();

    // Scrubbing the time machine re-renders the whole surface from the newly
    // selected snapshot. (The v4.1 shell additionally full-re-mounts on
    // data:select per the recorded b1d4d9c boundary — this handler keeps the
    // surface honest even where only the bus event arrives.)
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) render(); }));

    // Live browser ticker via state/live.js — live.js owns the hq subscription
    // for the app's lifetime; this surface only holds its listener off().
    let prevLive = liveGet();
    teardown.push(liveOn((state) => {
      if (!alive()) return;
      if (state.browser !== prevLive.browser) focusRef?.paintLive(state.browser);
      prevLive = state;
    }));

    // Dev-server truth: the hq:dev-status push repaints every .dev-toggle for
    // that project (card + drawer share the component and the repaint path).
    if (typeof ctx.hq?.onDevStatus === 'function') {
      teardown.push(ctx.hq.onDevStatus((d) => {
        if (!alive() || !d || d.id == null) return;
        devRunning[d.id] = !!d.running;
        for (const b of root.querySelectorAll('.dev-toggle')) {
          if (b.dataset.devId === String(d.id) && !b.disabled) paintDevToggle(b, !!d.running);
        }
      }));
    }

    // ---- the one global listener -----------------------------------------
    const onKey = (e) => { if (e.key === 'Escape' && drawer) closeDrawer(); };
    document.addEventListener('keydown', onKey);
    teardown.push(() => document.removeEventListener('keydown', onKey));
    teardown.push(closeDrawer);

    // One scriptable line per mount, for the verify harnesses. NOT esc()'d:
    // console text, not DOM, and the payload is two integers + a flag.
    console.log(`PROJECTS mounted projects=${stats.projects} proposals=${stats.proposals} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                              // invalidate every in-flight continuation
    releaseAll();
  },
};
