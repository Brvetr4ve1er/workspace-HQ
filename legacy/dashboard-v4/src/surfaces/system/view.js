// SYSTEM surface — the machine you are sitting at, in three sections:
//
//   MACHINE (vitals + fix scripts + cleanup)  ·  SCREEN TIME  ·  SOCIAL
//
// Ported CONTENT from three v3 realms — medbay/view.js, watchtower/view.js and
// social/view.js — rebuilt on the v4 component language (styles/components.css
// + styles/system.css). This module owns composition, the tab bar and
// LIFECYCLE only; each section is its own module:
//   machine.js      pc-health vitals, the danger-gated fix cards, the cleanup panel
//   screen-time.js  the browsing rollup (pure derivations in screen-core.mjs)
//   social.js       bridge presence, metrics tiles, feed/mentions/outbox
//
// LIFECYCLE CONTRACT (mirrors surfaces/work/view.js — the reference view):
// everything created in mount() is released in unmount(): the active section's
// dispose() (the SOCIAL poll interval lives there) and the bus subscription.
// `gen` is bumped by BOTH mount and unmount, and every async continuation in a
// section checks alive() AFTER its await, so a reply that lands post-teardown
// touches nothing. Sections create no global listeners; their element handlers
// are property assignments on nodes they create, so a re-render drops them
// with the nodes.
import { el, esc } from '../../ui/util.js';
import { initActions, resolve } from '../../core/actions.mjs';
import { createMachineSection } from './machine.js';
import { createScreenSection } from './screen-time.js';
import { createSocialSection } from './social.js';

const TABS = [
  { id: 'machine', label: 'Machine',     make: createMachineSection },
  { id: 'screen',  label: 'Screen time', make: createScreenSection },
  { id: 'social',  label: 'Social',      make: createSocialSection },
];

let activeTab = 'machine';   // module scope: the tab you left survives a surface switch
let gen = 0;                 // bumped by mount AND unmount — the async guard token
let teardown = [];

function releaseAll() {
  for (const fn of teardown.splice(0)) {
    try { fn(); } catch (err) { console.error('[system] teardown', err); }
  }
}

// styles/system.css has no <link> in index.html: under the v4.1 fleet plan no
// agent owns index.html, so each new surface brings its own sheet. Injected
// once per document (never torn down — a stylesheet is a document asset, and
// removing it on every surface switch would flash unstyled content), and it
// no-ops the moment index.html links the sheet statically.
const STYLE_HREF = new URL('../../../styles/system.css', import.meta.url).href;
function ensureStyles() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => l.href === STYLE_HREF);
  if (have) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = STYLE_HREF;
  link.dataset.surfaceStyle = 'system';
  document.head.appendChild(link);
}

// The cleanup panel writes through core/actions.mjs (the ONE audited path for
// side-effects), which needs the default registry seeded. WORK's wire.js seeds
// it at its first mount — but SYSTEM must not depend on another surface having
// been visited first, so seed it here when it is missing. initActions registers
// the same ids with the same effect functions, so the two callers cannot
// disagree; the check keeps it to exactly one call either way.
function ensureActions(hq) {
  if (!resolve('capture:note')) initActions({ hq });
}

export const view = {
  mount(stage, ctx) {
    gen++;
    const myGen = gen;
    releaseAll();                        // belt-and-braces: a mount without a prior unmount still starts clean

    ensureStyles();
    ensureActions(ctx.hq);

    const root = el('div', 'sys-root');
    const alive = () => myGen === gen && root.isConnected;
    stage.appendChild(root);

    const tabsEl = el('nav', 'sys-tabs');
    tabsEl.setAttribute('aria-label', 'System sections');
    const sectionEl = el('div', 'sys-stage');
    root.appendChild(tabsEl);
    root.appendChild(sectionEl);

    let section = null;
    const dropSection = () => {
      if (section?.dispose) { try { section.dispose(); } catch (err) { console.error('[system] dispose', err); } }
      section = null;
    };

    const paint = () => {
      dropSection();
      sectionEl.innerHTML = '';
      const t = TABS.find((x) => x.id === activeTab) || TABS[0];
      section = t.make({ hq: ctx.hq, data: ctx.data, alive });
      sectionEl.appendChild(section.el);
      for (const b of tabsEl.querySelectorAll('.sys-tab')) {
        const on = b.dataset.tab === t.id;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    };

    for (const t of TABS) {
      const b = el('button', 'sys-tab', esc(t.label));
      b.type = 'button';
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.onclick = () => { if (activeTab === t.id) return; activeTab = t.id; paint(); };
      tabsEl.appendChild(b);
    }
    tabsEl.setAttribute('role', 'tablist');

    teardown.push(dropSection);

    // Scrubbing the time machine changes which snapshot the cleanup panel and
    // the screen-time rollup describe, so the active section is rebuilt from
    // the new selection. (When v4.1's shell starts re-mounting surfaces on
    // data:select this becomes redundant, not wrong — the surface would be torn
    // down and re-mounted immediately after this repaint.)
    teardown.push(ctx.bus.on('data:select', () => { if (alive()) paint(); }));

    paint();

    // One scriptable line per mount for the verify harnesses. NOT esc()'d: this
    // is console text, not DOM, and every field is an integer or a fixed word.
    const ph = ctx.data?.bundle?.pcHealth;
    const organs = Array.isArray(ph?.organs) ? ph.organs.filter((o) => o && typeof o === 'object') : [];
    const fixes = organs.reduce((n, o) => n + (Array.isArray(o.fixes) ? o.fixes.length : 0), 0);
    const inv = ctx.data?.selected?.inventory || {};
    const cleanup = (inv.clones?.length || 0) + (inv.duplicates?.length || 0) + (inv.empty?.length || 0);
    const captured = (ctx.data?.scans || []).slice(0, (ctx.data?.selectedIndex ?? -1) + 1)
      .filter((s) => s?.browser?.captured && s.browser.by_domain?.length).length;
    console.log(`SYSTEM mounted tab=${activeTab} organs=${organs.length} fixes=${fixes} cleanup=${cleanup} captured=${captured} bridge=${ctx.hq ? 'yes' : 'no'}`);
  },

  unmount() {
    gen++;                               // invalidate every in-flight continuation
    releaseAll();
  },
};

// test/harness hook (house style — actions.mjs exports _reset the same way)
export function _setTab(id) { if (TABS.some((t) => t.id === id)) activeTab = id; }
