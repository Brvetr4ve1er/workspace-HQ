// LOOKBACK surface — the review room. Everything the app remembers:
//
//   TRENDS (what the numbers did) | TROPHIES (what you earned) | TIMELINE (the story)
//
// This module owns COMPOSITION and LIFECYCLE only; each section is its own
// module — read those for the behaviour:
//   trends.js    records, the ten charts, momentum forecast (v3 legacy + atlas)
//   trophies.js  consistency, the "almost there" strip, the trophy grid (v3 legacy)
//   timeline.js  header, weekly recap, the scan-by-scan story (v3 chronicle)
//   charts.js    lineChart/stackedBar/legend/chartCard + the hover tooltips
//   ach.js       the achievement catalog (names, pixel-art icons, criteria)
//
// LIFECYCLE CONTRACT. LOOKBACK is READ-ONLY: it starts no timer, opens no
// session, calls no window.hq method and adds no document-level listener. So the
// whole teardown is (1) the one bus subscription and (2) dropping the root —
// every element handler is a property assignment on a node this module created,
// so clearing the container releases them with the nodes. `gen` is bumped by
// BOTH mount and unmount so any continuation added later cannot outlive a
// teardown.
//
// TIME MACHINE. Re-renders on 'data:select' with the active tab preserved. Once
// v4.1's scrubber makes that a FULL surface re-mount (the recorded boundary in
// surfaces/work/view.js), this handler is simply disposed first and the re-mount
// paints the same thing — the module-scope `activeTab` is what keeps the user on
// the section they were reading either way.
import { el, esc } from '../../ui/util.js';
import { renderHero } from './hero.js';
import { renderTrends } from './trends.js';
import { renderTrophies } from './trophies.js';
import { renderTimeline } from './timeline.js';

// STYLESHEET. index.html is not in any Phase-1 agent's ownership, so this
// surface links its own sheet on first mount instead of editing a file it does
// not own. Resolved from import.meta.url (not the document URL) so it is correct
// under any host page, including the verify harness. Idempotent, and it tolerates
// a static <link> being added to index.html later — either way there is exactly
// one. NOT torn down on unmount: it is a single <head> node, not a leak, and
// removing/re-adding it on every surface switch would flash the surface unstyled.
const CSS_HREF = new URL('../../../styles/lookback.css', import.meta.url).href;
function ensureStyles() {
  if (document.querySelector('link[data-lb-css], link[href$="lookback.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.setAttribute('data-lb-css', '');
  document.head.appendChild(link);
}

const TABS = [
  { id: 'trends',   label: 'Trends',   render: (body, ctx, now) => renderTrends(body, ctx, now) },
  { id: 'trophies', label: 'Trophies', render: (body, ctx) => renderTrophies(body, ctx) },
  { id: 'timeline', label: 'Timeline', render: (body, ctx) => renderTimeline(body, ctx) },
];

// Module scope on purpose: the section you were reading survives a re-render
// AND a full re-mount (surface switch, scrubber). A review room that snapped
// back to Trends every time the shell blinked would be its own small lie about
// where you are.
let activeTab = 'trends';

let gen = 0;
let teardown = [];

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[lookback] teardown', err); }
  }
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                     // a mount without a prior unmount still starts clean
    ensureStyles();

    const root = el('div', 'lb-root');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    const scan = ctx.data.selected;
    if (!scan) {
      // No tabs in this state: three tabs onto three empty rooms is a control
      // that promises content the build does not have. And no panel either —
      // the constitution's empty states are calm single sentences.
      root.appendChild(el('p', 'lb-quiet lb-quiet--only',
        'No scan data in this build yet. Run a scan and this room fills with your history.'));
      console.log('LOOKBACK mounted tab=none scans=0 (no scan data)');
      return;
    }

    // ---- hero ------------------------------------------------------------
    // The surface's ONE focal element (see hero.js). It sits ABOVE the tab bar
    // because it is the whole room's headline, not one section's: whichever
    // section you are reading, you read it under the same answer to "where is
    // this heading". Repainted by paint(), so it time-travels with everything
    // else.
    const heroSlot = el('div', 'lb-hero-slot');
    root.appendChild(heroSlot);

    // ---- tab bar ---------------------------------------------------------
    const bar = el('div', 'lb-tabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Lookback sections');
    root.appendChild(bar);

    const body = el('div', 'lb-body');
    root.appendChild(body);

    const buttons = new Map();
    for (const t of TABS) {
      // NOT a `.btn`: that component carries a full 1px outline, and three
      // outlined controls at the top of a screen trying to calm down is the
      // border-everything habit the beautify pass exists to end. The active
      // state is brightness plus a hairline under the word (home's `.mo-tab`).
      const b = el('button', 'lb-tab', esc(t.label));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.onclick = () => { if (activeTab !== t.id) { activeTab = t.id; paint(); } };
      buttons.set(t.id, b);
      bar.appendChild(b);
    }

    // ---- paint -----------------------------------------------------------
    // One entry point for mount, tab switch and data:select. Clearing `body`
    // drops every node the previous paint created — including the chart
    // tooltips' listeners, which live on those nodes.
    function paint() {
      if (!alive()) return;
      const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
      for (const [id, b] of buttons) {
        const on = id === tab.id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      body.innerHTML = '';
      heroSlot.innerHTML = '';
      // `now` is read HERE and threaded down, never inside intel/*.mjs — that is
      // what keeps the pure brain pure and the forecast honest under the scrubber.
      const now = new Date().toISOString();
      let hero = {};
      try { hero = renderHero(heroSlot, ctx, now) || {}; }
      catch (err) {
        console.error('[lookback] hero', err);
        heroSlot.innerHTML = '';
        heroSlot.appendChild(el('p', 'lb-quiet', 'The momentum forecast could not be fitted from this snapshot.'));
      }
      let facts = {};
      try { facts = tab.render(body, ctx, now) || {}; }
      catch (err) {
        console.error('[lookback] render', tab.id, err);
        body.innerHTML = '';
        body.appendChild(el('div', 'empty', `This section could not be built from the selected snapshot.`));
      }
      const S = ctx.data.selected;
      const ach = S?.achievements || [];
      // One scriptable line per paint, for the verify harnesses. NOT esc()'d:
      // console text, not DOM, and the payload is integer counts + our own tab id.
      console.log(
        `LOOKBACK mounted tab=${tab.id} snapshot=${S?.scan?.id || 'none'} ` +
        `snapshots=${ctx.data.scans.length} achievements=${ach.length} ` +
        `unlocked=${ach.filter((x) => x && x.unlocked).length} ` +
        `nodes=${ctx.data.selectedIndex + 1} hero=${JSON.stringify(hero)} section=${JSON.stringify(facts)}`
      );
    }

    paint();

    // Scrubbing the time machine changes which photograph this room describes:
    // every card, record and node re-derives from the newly selected scan.
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) paint(); }));
  },

  unmount() {
    gen++;                            // invalidate anything still holding `alive`
    releaseAll();
  },
};

// exported for the verify harness / a future palette entry — switching the
// section without synthesizing a click.
export function _setTab(id) { if (TABS.some((t) => t.id === id)) activeTab = id; }
export const _tabs = TABS.map((t) => t.id);
