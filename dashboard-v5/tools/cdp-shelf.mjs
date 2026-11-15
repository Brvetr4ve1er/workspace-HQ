// CDP scenarios for the Projects Shelf (batch 7, dish "cartridge-shelf"). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeShelfScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
// It runs on the invented projects of tools/console-fixture.mjs (never owner data): each scenario puts 83 (or the size it needs) of them
// into the page's model through hqFake.shelfProjects() (the hook tools/console-fixture-paste.mjs adds to fake-preload.js), switches the
// Console layer on by setting its pref, and puts everything back (model, pref, prefs key, knob, emulated media) in a finally.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario shelf-off-no-dom,shelf-render,...    (needs --preload=fake)
//
//   shelf-off-no-dom        layer off (even with the sub-flag left on): no List|Shelf toggle, no cartridge, no Shelf node; the list's own 83 cards
//   shelf-render            layer on, Shelf chosen: 48 cartridges of 83, "showing 48 of 83", ONE Inserted cartridge (the current project), every
//                           cartridge a button with an accessible name and no text beyond its initials, the shelf a role=list
//   shelf-render-budget     the first Shelf render with 83 invented projects: under 400 ms (named budget; a miss under load is re-run alone on a
//                           fresh instance before it counts, nothing is loosened)
//   shelf-hover-click       hover lifts a cartridge (computed transform, drop shadow, 120 ms transition) and clicking opens that project's page
//   shelf-reduced-motion    with the reduceMotion pref, and again with the OS media query: hover shows a 2 px outline and no transform, no transition
//   shelf-more-and-search   "Show 35 more" reveals the rest; a search that matches nothing says so; switching back to List restores the original cards
//   shelf-keyboard          Tab reaches the inserted cartridge and the cartridges, Enter opens a project
// First real run (2026-11-15): the harness window is hidden, so Input.dispatchMouseEvent never reaches :hover (no frames are produced, matches(':hover') stays
// false). hover() sends the real mouse move first and, when :hover did not apply, forces the pseudo-state through CDP (CSS.forcePseudoState) so the
// CSS rule under test is still the one measured; the click is a real press and release, which does reach the page.
import { fakeShelfProjects } from './console-fixture.mjs';

export const SHELF_SCENARIOS = Object.freeze(['shelf-off-no-dom', 'shelf-render', 'shelf-render-budget', 'shelf-hover-click', 'shelf-reduced-motion', 'shelf-more-and-search', 'shelf-keyboard']);

export const COUNT_KEY = 'hqFake:projectCount';
export const BIG = 83;
export const PAGE_SIZE = 48;
/** The named budget (design: shelf-render-budget). Milliseconds in the page, forced layout included. */
export const BUDGET = Object.freeze({ firstRender: 400 });
/** The hooks the templates carry (tpl/shelf.tpl.js); the unit test pins them against the template text. */
export const SEL = Object.freeze({
  cart: '[data-shelf="cart"]', inserted: '[data-shelf="inserted"]', count: '[data-shelf="count"]', more: '[data-shelf="more"]', empty: '[data-shelf="empty"]',
  view: '[data-shelf="view"]', toggle: '[data-shelf="toggle"]', toggleBtn: '[data-shelf-view]', list: '[role="list"][data-shelf="shelf"]',
  any: '[data-shelf],[data-shelf-view]', search: 'input[aria-label="Search projects"]',
});

// real key presses through CDP Input (Tab and Enter; the gate's own press() has no Tab)
export const KEYS = Object.freeze({ Tab: ['Tab', 9, ''], Enter: ['Enter', 13, '\r'] });
export function keyEvents(name) {
  const K = KEYS[name];
  if (!K) throw new Error('cdp-shelf: no key table entry for ' + name);
  const [code, vk, text] = K, base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: 0 };
  return [Object.assign({ type: text ? 'keyDown' : 'rawKeyDown' }, base, text ? { text, unmodifiedText: text } : null), Object.assign({ type: 'keyUp' }, base)];
}
const key = async (t, name) => { for (const ev of keyEvents(name)) await t.send('Input.dispatchKeyEvent', ev); };

/** The pref object the scenarios set: every sub-flag spelled out (the console-layer normaliser's shape), `o` on top. */
export const layerPref = (o) => ({ on: false, skin: false, scan: false, palette: '', debug: false, shelf: false, ...(o || {}) });

const L_ = 'WHQ.app.logic';
const q = (s) => JSON.stringify(s);
const brief = (v) => JSON.stringify(v);
const WORST = "(() => { const L = WHQ.app.logic, R = (p) => L.M.ST[p.st].rank, s = L.projectsAt(0).slice().sort((a, b) => R(a) - R(b) || b.pct - a.pct); return s[0] ? { id: s[0].id, name: s[0].name } : null; })()";

// ---- in-page snippets (strings for t.evaluate); exported so a test can compile every one of them ----------------------
export const PAGE = {
  READY: "!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0 && window.hqFake && typeof hqFake.shelfProjects === 'function')",
  quiet: `(() => { ${L_}.setState({ whatsNewOpen: false, paletteOpen: false, settingsOpen: false, toasts: [] }); return true; })()`,
  // what to put back afterwards: the console pref and the motion pref as the page had them (undefined before the console layer exists)
  saveOriginals: `(() => { const L = ${L_}; if (!('__shelfOrig' in window)) window.__shelfOrig = { cl: L.state.consoleLayer === undefined ? null : JSON.stringify(L.state.consoleLayer), rm: !!L.state.reduceMotion }; return true; })()`,
  setKnob: (n) => (n == null ? `(sessionStorage.removeItem(${q(COUNT_KEY)}), true)` : `(sessionStorage.setItem(${q(COUNT_KEY)}, ${q(String(n))}), true)`),
  // the invented projects into the model's own P0 array, in place (every reader goes through it); count = the knob (hqFake.shelfProjects() with no argument)
  putProjects: `(async () => { const A = await import('./src/live/adapter.mjs'), L = ${L_}, P0 = L.M.at(0).P0; if (!window.__shelfP0) window.__shelfP0 = P0.slice(); P0.splice(0, P0.length, ...hqFake.shelfProjects().map(A.toProject)); L.setState({ projSearch: L.state.projSearch || '' }); return P0.length; })()`,
  setLayer: (o) => `(() => { ${L_}.setState({ consoleLayer: ${JSON.stringify(layerPref(o))} }); return true; })()`,
  setState: (patch) => `(() => { ${L_}.setState(${JSON.stringify(patch)}); return true; })()`,
  rerender: `(() => { const L = ${L_}; L.setState({ projSearch: L.state.projSearch || '' }); return true; })()`,
  goProjects: `(() => { const L = ${L_}; L.setState({ route: null }); L.go('projects', 'grid'); return true; })()`,
  reset: `(() => { ${L_}.setState({ shelfMore: null, projSearch: '', projStatus: 'all', projSort: 'worst', route: null, paletteOpen: false, askOpen: false, whatsNewOpen: false, settingsOpen: false, toasts: [] }); return true; })()`,
  // everything back: model rows, knob, console pref, motion pref, shelf paging, route; then home and a fresh fake
  cleanup: `(() => { const L = ${L_}; try { const P0 = L.M.at(0).P0; if (window.__shelfP0) { P0.splice(0, P0.length, ...window.__shelfP0); delete window.__shelfP0; } } catch (e) {}
    sessionStorage.removeItem(${q(COUNT_KEY)});
    const o = window.__shelfOrig; delete window.__shelfOrig;
    L.setState({ consoleLayer: o && o.cl != null ? JSON.parse(o.cl) : undefined, reduceMotion: o ? o.rm : false, shelfMore: null, projSearch: '', projStatus: 'all', projSort: 'worst', route: null, paletteOpen: false });
    L.go('home'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); hqFake.reset(true); return true; })()`,
  route: `(${L_}.state.route ? { type: ${L_}.state.route.type, id: ${L_}.state.route.id } : null)`,
  cartCount: `document.querySelectorAll(${q(SEL.cart)}).length`,
  anyShelfNodes: `document.querySelectorAll(${q(SEL.any)}).length`,
  insertedCount: `document.querySelectorAll(${q(SEL.inserted)}).length`,
  countText: `(() => { const e = document.querySelector(${q(SEL.count)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  moreText: `(() => { const e = document.querySelector(${q(SEL.more)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  emptyText: `(() => { const e = document.querySelector(${q(SEL.empty)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  hasList: `!!document.querySelector(${q(SEL.list)})`,
  listRole: `(() => { const e = document.querySelector(${q(SEL.list)}); return e ? { role: e.getAttribute('role'), label: e.getAttribute('aria-label'), items: e.querySelectorAll('[role="listitem"]').length } : null; })()`,
  insertedInfo: `[...document.querySelectorAll(${q(SEL.inserted)})].map((b) => ({ tag: b.tagName.toLowerCase(), label: b.getAttribute('aria-label'), id: b.getAttribute('data-id') }))`,
  cartsInfo: `[...document.querySelectorAll(${q(SEL.cart)})].map((b) => ({ tag: b.tagName.toLowerCase(), id: b.getAttribute('data-id'), label: b.getAttribute('aria-label') || '', text: b.textContent.replace(/\\s+/g, '').trim(), initials: [...b.querySelectorAll('text')].map((x) => x.textContent).join('').replace(/\\s+/g, '').trim(), art: !!b.querySelector('svg[role="img"]') }))`,
  toggleInfo: `(() => { const g = document.querySelector(${q(SEL.toggle)}); return { group: g ? { role: g.getAttribute('role'), label: g.getAttribute('aria-label') } : null, buttons: [...document.querySelectorAll(${q(SEL.toggleBtn)})].map((b) => ({ view: b.getAttribute('data-shelf-view'), pressed: b.getAttribute('aria-pressed'), text: b.textContent.trim() })) }; })()`,
  valsInfo: `(() => { const v = ${L_}.renderVals().shfv; return v ? { on: v.on, listOn: v.listOn, shelfOn: v.shelfOn, toggle: v.toggle.length, rows: v.rows.length, lift: v.lift, countLine: v.countLine, inserted: v.insertedList.length } : null; })()`,
  worstFirst: WORST,
  listCards: "[...document.querySelectorAll('main button')].filter((b) => /est\\./.test(b.textContent)).length",
  listCardsWanted: `${L_}.renderVals().projCards.length`,
  setSearch: (text) => `(() => { const i = document.querySelector(${q(SEL.search)}); if (!i) return false; i.focus(); i.value = ${q(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  focusSearch: `(() => { const i = document.querySelector(${q(SEL.search)}); if (!i) return false; i.focus(); return document.activeElement === i; })()`,
  clickSel: (sel) => `(() => { const b = document.querySelector(${q(sel)}); if (!b) return false; b.click(); return true; })()`,
  clickToggle: (view) => `(() => { const b = document.querySelector('[data-shelf-view=' + ${q(view)} + ']'); if (!b) return false; b.click(); return true; })()`,
  active: `(() => { const a = document.activeElement; return a ? { shelf: a.getAttribute('data-shelf'), id: a.getAttribute('data-id'), tag: a.tagName.toLowerCase() } : null; })()`,
  // a point inside the i-th element of a selector, scrolled into view
  centerOf: (sel, i) => `(() => { const b = document.querySelectorAll(${q(sel)})[${Number(i) || 0}]; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: b.getAttribute('data-id') }; })()`,
  styleOf: (sel, i) => `(() => { const b = document.querySelectorAll(${q(sel)})[${Number(i) || 0}]; if (!b) return null; const s = getComputedStyle(b); return { transform: s.transform, filter: s.filter, duration: s.transitionDuration, outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth }; })()`,
  osReduce: "matchMedia('(prefers-reduced-motion: reduce)').matches",
  firstRender: `(async () => {
    const L = ${L_}, t0 = performance.now(), dl = t0 + 15000;
    L.setState({ consoleLayer: ${JSON.stringify(layerPref({ on: true, shelf: true }))} });
    let n = 0;
    while (performance.now() < dl) { n = document.querySelectorAll(${q(SEL.cart)}).length; if (n >= ${PAGE_SIZE}) break; await new Promise((r) => setTimeout(r, 2)); }
    void document.body.getBoundingClientRect();
    return { ms: Math.round((performance.now() - t0) * 10) / 10, n };
  })()`,
};

/** What the screen should say for `count` invented projects, from the generator alone (the gates never read a screen to learn the answer). */
export function expectedShelf(count) {
  const n = Math.max(0, Number(count) || 0), shown = Math.min(n, PAGE_SIZE), remaining = n - shown;
  const d = fakeShelfProjects({ describe: true });
  return { total: n, shown, remaining, count: 'showing ' + shown + ' of ' + n, moreLabel: remaining > 0 ? 'Show ' + Math.min(PAGE_SIZE, remaining) + ' more' : null, statusCounts: d.statusCounts(n), names: fakeShelfProjects({ count: n }).map((p) => p.name) };
}

// ---- the scenarios ---------------------------------------------------------------------------------------------------
export function makeShelfScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep } = {}) {
  const pause = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));

  // A known page: the invented projects in the model (`count` of them), the console pref as `layer` says, Projects > Grid shown.
  // Returns failure strings, or null when ready.
  async function boot(t, count, layer) {
    const pre = await fresh(t); if (pre) return pre;
    if (!await t.evaluate("typeof hqFake.shelfProjects === 'function'")) return ['hqFake.shelfProjects is missing: run node tools/console-fixture-paste.mjs --init then --write (the fake preload needs the console-control block)'];
    await t.send('Page.bringToFront'); await pause(150);
    await t.evaluate(PAGE.quiet);
    await t.evaluate(PAGE.saveOriginals);
    await t.evaluate(PAGE.setKnob(count));
    // a dynamic import() inside Runtime.evaluate can answer 'Promise was collected' right after a reload or a heavy scenario: ask again (the swap is idempotent)
    let n; for (let k = 0; k < 4; k++) { try { n = await t.evaluate(PAGE.putProjects); break; } catch (e) { if (k === 3 || !/collected/i.test(String(e && e.message || e))) throw e; await pause(400); } }
    if (n !== count) return ['the invented projects never reached the model (' + n + ', want ' + count + '): is hqFake.shelfProjects in fake-preload.js?'];
    await t.evaluate(PAGE.reset);
    await t.evaluate(PAGE.setLayer(layer));
    await t.evaluate(PAGE.goProjects);
    await pause(250);
    return null;
  }
  async function leave(t, saved) {
    await t.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    await t.evaluate(PAGE.cleanup).catch(() => {});
    await t.evaluate(RESTORE_KEYS(saved)).catch(() => {});
  }
  const cartsReady = (t, n) => t.waitFor(`${PAGE.cartCount} === ${Number(n)}`, 8000);

  // hover a cartridge with a real mouse move; resolves its computed style after the transition could have finished
  const forced = new WeakMap();   // t -> the nodeId whose :hover this file forced
  async function forceHover(t, i, on) {
    await t.send('DOM.enable'); await t.send('CSS.enable'); await t.send('DOM.getDocument', { depth: 0 });
    let nodeId = forced.get(t);
    if (on) {
      const r = await t.send('Runtime.evaluate', { expression: 'document.querySelectorAll(' + JSON.stringify(SEL.cart) + ')[' + (Number(i) || 0) + ']' });
      nodeId = (await t.send('DOM.requestNode', { objectId: r.result.objectId })).nodeId; forced.set(t, nodeId);
    }
    if (nodeId) await t.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: on ? ['hover'] : [] });
    if (!on) forced.delete(t);
  }
  async function hover(t, i) {
    const c = await t.evaluate(PAGE.centerOf(SEL.cart, i));
    if (!c) return { error: 'no cartridge #' + i };
    await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    await pause(150);
    if (!await t.evaluate('document.querySelectorAll(' + JSON.stringify(SEL.cart) + ')[' + (Number(i) || 0) + '].matches(":hover")')) await forceHover(t, i, true);
    await pause(350);
    await settle(t, i);
    return { id: c.id, style: await t.evaluate(PAGE.styleOf(SEL.cart, i)) };
  }
  // the hidden window makes no frames, so a CSS transition never advances by itself: finish the running ones, then the computed style is the target
  const settle = (t, i) => t.evaluate('document.querySelectorAll(' + JSON.stringify(SEL.cart) + ')[' + (Number(i) || 0) + '].getAnimations().forEach((a) => a.finish())');
  const away = async (t) => { await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }); await forceHover(t, 0, false).catch(() => {}); await pause(350); await t.evaluate('document.getAnimations().forEach((a) => a.finish())'); };
  const LIFT = /^matrix\(1, 0, 0, 1, 0, -6\)$/;

  return {
    // layer off: nothing of the Shelf exists, the list is the list
    async 'shelf-off-no-dom'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        // the sub-flag is left ON on purpose: with the layer off it must change nothing
        const pre = await boot(t, BIG, { on: false, shelf: true }); if (pre) return pre;
        const nodes = await t.evaluate(PAGE.anyShelfNodes);
        if (nodes !== 0) out.push(nodes + ' Shelf node(s) in the page with the Console layer off (data-shelf / data-shelf-view), want 0');
        const v = await t.evaluate(PAGE.valsInfo);
        if (!v || v.on || v.shelfOn || !v.listOn || v.toggle !== 0) out.push('the Shelf vals with the layer off: ' + brief(v) + ' (want on false, shelfOn false, listOn true, no toggle)');
        const cards = await t.evaluate(PAGE.listCards), want = await t.evaluate(PAGE.listCardsWanted);
        if (want !== BIG) out.push('the list holds ' + want + ' projects, want ' + BIG);
        if (cards !== want) out.push('the list shows ' + cards + ' cards, the vals say ' + want);
        if (await t.evaluate(PAGE.hasList)) out.push('a role=list Shelf is in the page with the layer off');
        out.push(...(await t.evaluate(`${L_}.state.toasts.filter((x) => x.kind === 'error').map((x) => x.text)`)));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // layer on, Shelf chosen: the first page, the count, one Inserted cartridge, names and no stray text
    async 'shelf-render'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs'])), E = expectedShelf(BIG);
      try {
        const pre = await boot(t, BIG, { on: true, shelf: true }); if (pre) return pre;
        if (!await cartsReady(t, E.shown)) return out.concat('the Shelf never showed ' + E.shown + ' cartridges (got ' + await t.evaluate(PAGE.cartCount) + ')');
        const count = await t.evaluate(PAGE.countText);
        if (count !== E.count) out.push('the count line reads "' + count + '", want "' + E.count + '"');
        const more = await t.evaluate(PAGE.moreText);
        if (more !== E.moreLabel) out.push('the more button reads ' + brief(more) + ', want ' + brief(E.moreLabel));
        const ins = await t.evaluate(PAGE.insertedInfo), worst = await t.evaluate(PAGE.worstFirst);
        if (ins.length !== 1) out.push(ins.length + ' Inserted cartridges, want exactly 1');
        else {
          if (ins[0].tag !== 'button') out.push('the Inserted cartridge is a <' + ins[0].tag + '>, want a button');
          if (!/^Inserted: /.test(ins[0].label || '')) out.push('the Inserted cartridge is named ' + brief(ins[0].label) + ', want "Inserted: <name>"');
          // the invented projects carry no task of the fake data, so the console holds the first worst-first row
          if (worst && (ins[0].id !== worst.id || !(ins[0].label || '').includes(worst.name))) out.push('the Inserted cartridge is ' + brief(ins[0]) + ', the first worst-first project is ' + brief(worst));
        }
        const carts = await t.evaluate(PAGE.cartsInfo);
        const bad = carts.filter((c) => c.tag !== 'button' || !c.label || !/^.+, .+$/.test(c.label) || !c.art);
        if (bad.length) out.push(bad.length + ' cartridge(s) without a button, an "<name>, <status>" name or art, first ' + brief(bad[0]));
        const texty = carts.filter((c) => c.text !== c.initials || c.initials.length > 2 || c.initials.length < 1);
        if (texty.length) out.push(texty.length + ' cartridge(s) carry text beyond their initials, first ' + brief(texty[0]));
        const ids = new Set(carts.map((c) => c.id));
        if (ids.size !== carts.length) out.push('two cartridges share a project id');
        const list = await t.evaluate(PAGE.listRole);
        if (!list || list.role !== 'list' || list.items !== E.shown) out.push('the shelf is ' + brief(list) + ', want a role=list of ' + E.shown + ' items');
        const tg = await t.evaluate(PAGE.toggleInfo);
        if (tg.buttons.length !== 2 || tg.buttons.map((b) => b.text).join('|') !== 'List|Shelf') out.push('the toggle is ' + brief(tg.buttons) + ', want List and Shelf');
        else if (tg.buttons.find((b) => b.view === 'shelf').pressed !== 'true' || tg.buttons.find((b) => b.view === 'list').pressed !== 'false') out.push('the toggle does not show Shelf pressed: ' + brief(tg.buttons));
        if (await t.evaluate(PAGE.listCards) !== 0) out.push('the list cards are still on screen under the Shelf');
        out.push(...(await t.evaluate(`${L_}.state.toasts.filter((x) => x.kind === 'error').map((x) => x.text)`)));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // the named budget: the first Shelf render with 83 invented projects
    async 'shelf-render-budget'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const hint = ' - re-run alone on a fresh instance before counting it a failure; if it still misses, SHELF_PAGE in dashboard-v5/src/logic/shelf.mjs is the knob';
      try {
        const pre = await boot(t, BIG, { on: true, shelf: false }); if (pre) return pre;
        await pause(300);   // the list is up; the Shelf has never been built
        const first = await t.evaluate(PAGE.firstRender);
        if (first.n < PAGE_SIZE) return out.concat('the Shelf never reached its ' + PAGE_SIZE + ' cartridges (got ' + first.n + ')');
        if (first.ms > BUDGET.firstRender) out.push('the first Shelf render took ' + first.ms + ' ms (budget ' + BUDGET.firstRender + ')' + hint);
        console.log('[shelf-render-budget] first render ' + first.ms + ' ms for ' + first.n + ' cartridges (budget ' + BUDGET.firstRender + ')');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // hover lifts, a click opens the project
    async 'shelf-hover-click'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, BIG, { on: true, shelf: true }); if (pre) return pre;
        if (!await cartsReady(t, PAGE_SIZE)) return out.concat('the Shelf never showed ' + PAGE_SIZE + ' cartridges');
        if (!await t.evaluate(PAGE.valsInfo).then((v) => v && v.lift)) return out.concat('the vals say motion is not allowed (lift false) on a page with no reduce-motion signal: clear the OS setting and the pref first');
        const before = await t.evaluate(PAGE.styleOf(SEL.cart, 4));
        if (!before || before.transform !== 'none') out.push('a resting cartridge has transform ' + brief(before && before.transform) + ', want none');
        if (before && !/0\.12s/.test(before.duration)) out.push('a cartridge transitions over ' + brief(before.duration) + ', want 0.12s');
        const h = await hover(t, 4);
        if (h.error) return out.concat(h.error);
        if (!LIFT.test(h.style.transform)) out.push('a hovered cartridge has transform ' + brief(h.style.transform) + ', want matrix(1, 0, 0, 1, 0, -6) (translateY(-6px))');
        if (!/drop-shadow/.test(h.style.filter)) out.push('a hovered cartridge has filter ' + brief(h.style.filter) + ', want a drop shadow');
        await away(t);
        const rest = await t.evaluate(PAGE.styleOf(SEL.cart, 4));
        if (rest.transform !== 'none') out.push('the cartridge did not settle after the pointer left: ' + brief(rest.transform));
        // click it with a real press and release
        const c = await t.evaluate(PAGE.centerOf(SEL.cart, 4));
        await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
        await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
        await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
        if (!await t.waitFor(`!!${PAGE.route} && ${PAGE.route}.type === 'project' && ${PAGE.route}.id === ${q(c.id)}`, 4000)) out.push('clicking the cartridge did not open project ' + c.id + ' (route ' + brief(await t.evaluate(PAGE.route)) + ')');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // reduced motion, both signals: an outline, no transform, no transition
    async 'shelf-reduced-motion'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const check = async (label) => {
        const v = await t.evaluate(PAGE.valsInfo);
        if (!v || v.lift !== false) { out.push(label + ': the vals still allow the lift (' + brief(v) + ')'); return; }
        const h = await hover(t, 2);
        if (h.error) { out.push(label + ': ' + h.error); return; }
        if (h.style.transform !== 'none') out.push(label + ': hover moved the cartridge (transform ' + brief(h.style.transform) + ')');
        if (!/^0s(, 0s)*$/.test(h.style.duration)) out.push(label + ': the cartridge still transitions (' + brief(h.style.duration) + ')');
        if (h.style.outlineStyle === 'none' || parseFloat(h.style.outlineWidth) < 2) out.push(label + ': hover shows no 2px outline (' + brief(h.style.outlineStyle + ' ' + h.style.outlineWidth) + ')');
        await away(t);
      };
      try {
        const pre = await boot(t, BIG, { on: true, shelf: true }); if (pre) return pre;
        if (!await cartsReady(t, PAGE_SIZE)) return out.concat('the Shelf never showed ' + PAGE_SIZE + ' cartridges');
        // 1. the app's own pref
        await t.evaluate(PAGE.setState({ reduceMotion: true })); await pause(250);
        await check('with the reduceMotion pref');
        // 2. the OS query alone
        await t.evaluate(PAGE.setState({ reduceMotion: false }));
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await t.evaluate(PAGE.rerender); await pause(250);
        if (!await t.evaluate(PAGE.osReduce)) out.push('the emulated OS media query did not take (matchMedia says no preference)');
        await check('with the OS media query');
        // 3. and back: motion allowed again once neither signal is on
        await t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await t.evaluate(PAGE.rerender); await pause(250);
        const v = await t.evaluate(PAGE.valsInfo);
        if (!v || v.lift !== true) out.push('the lift did not come back with both signals off (' + brief(v) + ')');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // Show more, a search that matches nothing, back to List
    async 'shelf-more-and-search'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs'])), E = expectedShelf(BIG);
      try {
        const pre = await boot(t, BIG, { on: true, shelf: true }); if (pre) return pre;
        if (!await cartsReady(t, E.shown)) return out.concat('the Shelf never showed ' + E.shown + ' cartridges');
        if (!await t.evaluate(PAGE.clickSel(SEL.more))) return out.concat('no "Show more" button on the first page of ' + BIG);
        if (!await cartsReady(t, BIG)) out.push('"Show more" left ' + await t.evaluate(PAGE.cartCount) + ' cartridges, want all ' + BIG);
        const all = await t.evaluate(PAGE.countText);
        if (all !== 'showing ' + BIG + ' of ' + BIG) out.push('after Show more the count reads "' + all + '", want "showing ' + BIG + ' of ' + BIG + '"');
        if (await t.evaluate(PAGE.moreText) !== null) out.push('the more button is still there with everything shown');
        // nothing matches
        await t.evaluate(PAGE.setSearch('zzzz-no-such-project'));
        if (!await cartsReady(t, 0)) out.push('a search that matches nothing left ' + await t.evaluate(PAGE.cartCount) + ' cartridges');
        const empty = await t.evaluate(PAGE.emptyText);
        if (!empty || !/Nothing on the shelf matches/.test(empty)) out.push('the empty line reads ' + brief(empty) + ', want "Nothing on the shelf matches..."');
        const none = await t.evaluate(PAGE.countText);
        if (none !== 'showing 0 of 0') out.push('the count with nothing matching reads "' + none + '", want "showing 0 of 0"');
        await t.evaluate(PAGE.setSearch(''));
        if (!await t.waitFor(`${PAGE.cartCount} > 0`, 4000)) out.push('clearing the search did not bring the cartridges back');
        // List again: the original cards, no Shelf
        if (!await t.evaluate(PAGE.clickToggle('list'))) return out.concat('no List button in the toggle');
        await pause(300);
        const cards = await t.evaluate(PAGE.listCards), want = await t.evaluate(PAGE.listCardsWanted);
        if (cards !== want || want !== BIG) out.push('back on List the page shows ' + cards + ' cards, the vals say ' + want + ' (want ' + BIG + ')');
        if (await t.evaluate(PAGE.cartCount) !== 0 || await t.evaluate(PAGE.hasList)) out.push('Shelf nodes are still in the page on List');
        const tg = await t.evaluate(PAGE.toggleInfo);
        if (tg.buttons.find((b) => b.view === 'list').pressed !== 'true') out.push('the toggle does not show List pressed: ' + brief(tg.buttons));
        // and Shelf once more (the choice is the persisted sub-flag)
        if (!await t.evaluate(PAGE.clickToggle('shelf')) || !await t.waitFor(`${PAGE.cartCount} > 0`, 4000)) out.push('Shelf did not come back from the toggle');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // Tab reaches the cartridges, Enter opens a project
    async 'shelf-keyboard'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, BIG, { on: true, shelf: true }); if (pre) return pre;
        if (!await cartsReady(t, PAGE_SIZE)) return out.concat('the Shelf never showed ' + PAGE_SIZE + ' cartridges');
        if (!await t.evaluate(PAGE.focusSearch)) return out.concat('could not focus the Projects search box');
        const seen = [];
        let hit = null;
        for (let i = 0; i < 30 && !hit; i++) {
          await key(t, 'Tab'); await pause(40);
          const a = await t.evaluate(PAGE.active);
          seen.push(a && a.shelf ? a.shelf : (a ? a.tag : '?'));
          if (a && a.shelf === 'cart') hit = a;
        }
        if (!hit) return out.concat('Tab never reached a cartridge in 30 presses (saw ' + brief(seen) + ')');
        if (!seen.includes('inserted')) out.push('Tab skipped the Inserted cartridge (saw ' + brief(seen) + ')');
        if (!hit.id) out.push('the focused cartridge carries no project id');
        await key(t, 'Enter');
        if (!await t.waitFor(`!!${PAGE.route} && ${PAGE.route}.type === 'project' && ${PAGE.route}.id === ${q(hit.id)}`, 4000)) out.push('Enter on a focused cartridge did not open project ' + hit.id + ' (route ' + brief(await t.evaluate(PAGE.route)) + ')');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },
  };
}
