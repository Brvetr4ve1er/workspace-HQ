// AUTOMATE surface — the automation catalog and its runway (v4.1 S4):
//
//   ARSENAL (find)  |  DETAIL (inspect) · RUN LOG (watch) · SESSIONS (recall)
//
// Feature truth ported from legacy/dashboard-v3/src/realms/grimoire/view.js (arsenal,
// filters, coverage, usage tiers, cast flow, deep-scan/rescan, connected
// agents) and legacy/dashboard-v3/src/realms/summoning/view.js (the sessions list).
// The summoning realm's OTHER two surfaces map elsewhere in v4: "start a
// session" is the WORK surface's dispatch form; the canvas belongs to MIND.
//
// This module owns composition and LIFECYCLE only; behaviour lives in:
//   catalog.mjs  the pure filter/sort/usage brain (node-tested)
//   arsenal.js   search-first catalog panel (capped list, honest counts)
//   detail.js    inspect-and-run panel (confirm-gated RUN, favorites)
//   cast.js      the ported cast seam: confirm modal + run log + stream wiring
//   sessions.js  session history from state/live.js
//
// LIFECYCLE CONTRACT (same as work/view.js): everything created in mount() is
// released in unmount() — bus/live/cast-stream subscriptions, the one interval,
// the confirm overlay. `gen` is bumped by BOTH mount and unmount and every
// async continuation checks alive() after its await.
import { el } from '../../ui/util.js';
import { get as liveGet, on as liveOn, initLive } from '../../state/live.js';
import { defaultFilters, fmtCd } from './catalog.mjs';
import { createArsenal } from './arsenal.js';
import { createDetailPanel } from './detail.js';
import { createCastEngine } from './cast.js';
import { createSessionsPanel } from './sessions.js';

// Filter/search/paging state survives surface switches (v3 parity: the module
// scope is the closure-global). DOM references never live here.
const persist = { filters: defaultFilters(), limit: 24 };

let gen = 0;
let teardown = [];

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[automate] teardown', err); }
  }
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();

    const hq = ctx.hq;
    const root = el('div', 'automate-root');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    // live.js is normally inited by WORK's wire (the default surface), but this
    // surface must not depend on visit order — initLive is idempotent.
    initLive(hq);

    // ---- per-mount state -------------------------------------------------
    let selected = null;                                   // the inspected spell
    // Favorites: build-time sidecar first, live telemetry beats it (below).
    let favorites = Array.isArray(ctx.data.bundle.telemetry?.favorites)
      ? [...ctx.data.bundle.telemetry.favorites] : [];
    // Usage rollup stays on the BUILD-TIME shape (distinct_days arrays);
    // catalog.mjs normalizes, so a future live feed would also work.
    const rollup = () => ctx.data.bundle.telemetry?.rollup || {};

    // ---- panels ----------------------------------------------------------
    const engine = createCastEngine({ hq, host: root, alive });

    const detail = createDetailPanel({
      hq, alive,
      onCast: (s) => engine.cast(s),
      onToggleFav: (s) => toggleFav(s),
    });

    const arsenal = createArsenal({
      data: ctx.data, hq, alive,
      state: persist,
      getFavorites: () => favorites,
      getRollup: rollup,
      onSelect: (s) => { selected = s; renderDetail(); },
      onCast: (s) => engine.cast(s),
      onToggleFav: (s) => toggleFav(s),
      log: (stream, text) => engine.line(null, stream, text),
    });

    const sessionsPanel = createSessionsPanel({ hq });

    const logPanel = el('section', 'panel automate-log', `
      <div class="panel-head">
        <span class="panel-title">Run log</span>
        <span class="spacer"></span>
        <span class="panel-sub">output while this surface is open</span>
      </div>
      <div class="panel-body automate-log-body"></div>`);
    logPanel.querySelector('.automate-log-body').appendChild(engine.logEl);

    const grid = el('div', 'automate');
    grid.appendChild(arsenal.el);
    const side = el('div', 'automate-side');
    side.appendChild(detail.el);
    side.appendChild(logPanel);
    side.appendChild(sessionsPanel.el);
    grid.appendChild(side);
    root.appendChild(grid);

    function renderDetail() {
      detail.render(selected, { rollup: rollup(), favorites });
    }

    // ---- favorites -------------------------------------------------------
    // Toggle round-trips to main (it owns the telemetry file) and repaints from
    // the ARRAY MAIN RETURNS — the renderer never guesses the resulting state.
    async function toggleFav(spell) {
      if (typeof hq?.favoriteSpell !== 'function') return;   // stars are disabled; belt-and-braces
      try {
        const res = await hq.favoriteSpell(spell.id);
        if (!alive()) return;
        if (Array.isArray(res)) favorites = res;
        arsenal.draw();                                      // fav-first sort + stars
        renderDetail();
      } catch (err) {
        console.warn('[automate] favorite toggle failed', err);
        if (alive()) engine.line(null, 'err', `x favorite: ${String(err?.message || err)}`);
      }
    }
    // Live telemetry beats the build-time snapshot — favorites only (its
    // rollup flattens distinct_days to counts; the build-time rollup is richer).
    if (typeof hq?.getSpellTelemetry === 'function') {
      Promise.resolve(hq.getSpellTelemetry()).then((t) => {
        if (!alive() || !Array.isArray(t?.favorites)) return;
        favorites = t.favorites;
        arsenal.draw();
        renderDetail();
      }).catch(() => { /* seed is best-effort */ });
    }

    // ---- first paint -----------------------------------------------------
    arsenal.render();
    renderDetail();
    sessionsPanel.render(liveGet().sessions);

    // ---- subscriptions ---------------------------------------------------
    for (const off of engine.wireStream()) teardown.push(off);
    teardown.push(() => engine.dispose());

    let prevSessions = liveGet().sessions;
    teardown.push(liveOn((state) => {
      if (!alive()) return;
      if (state.sessions !== prevSessions) {
        prevSessions = state.sessions;
        sessionsPanel.render(state.sessions);
      }
    }));

    // Scrubbing the time machine changes the snapshot the coverage meter and
    // counts describe. S6 wires data:select to a full re-mount; this handler is
    // the belt-and-braces for the pre-S6 world and costs nothing after it.
    teardown.push(ctx.bus.on('data:select', () => {
      if (!alive()) return;
      arsenal.render();
      renderDetail();
    }));

    // ---- the one interval ------------------------------------------------
    // 1s: session elapsed labels. Every 30th tick: cooldown countdown text on
    // [data-cd] nodes (v3's grimoire ticker cadence) — text nodes only.
    let ticks = 0;
    const timer = setInterval(() => {
      if (!alive()) return;
      sessionsPanel.tick();
      if (++ticks % 30 === 0) {
        for (const n of root.querySelectorAll('[data-cd]')) {
          n.textContent = fmtCd(Number(n.dataset.cd) - Date.now());
        }
      }
    }, 1000);
    teardown.push(() => clearInterval(timer));

    // One scriptable line per mount for the verify harnesses. Console text,
    // not DOM; every value is a count or boolean.
    const book = ctx.data.bundle.spellbook;
    console.log(`AUTOMATE mounted spells=${Number(book?.counts?.total) || 0} rows=${arsenal.visibleRows()} favorites=${favorites.length} sessions=${(liveGet().sessions || []).length} bridge=${hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                               // invalidate every in-flight continuation
    releaseAll();
  },
};
