// CDP scenarios for the Cosmos space (key 0). cdp-gate.mjs merges them:  Object.assign(SCENARIOS, makeCosmosScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
//
//   node tools/cdp-gate.mjs --port 9342 --scenario cosmos-open-key0,cosmos-search-narrows,...   (needs --preload=fake)
//
// The library the page is served is the invented one from tools/cosmos-fixture.mjs, pasted into the fake preload: 40 works by
// default, 1,000 when sessionStorage 'hqFake:cosmosCount' says so (the scenarios that need 1,000 set it; every scenario takes it
// away again, so the global button sweep and the rest keep the small library). What a scenario EXPECTS is computed here in Node from
// the same generator, with plain filters (visibleWorks / expectedCounts): never by asking the page's own search code.
//
//   cosmos-open-key0           press 0 -> Cosmos on Feed; ONE hq.cosmos.read; the count; ONE hq.use mark
//   cosmos-search-narrows      tag:, #hex (nearest first), a colour family, a type word, no match, clear -> known counts
//   cosmos-lightbox-arrows     open, arrows keep the time machine still, f / "/" / Ctrl+K / Escape in their layers
//   cosmos-no-bridge-readonly  no hq.cosmos: the read-only state, nothing written, nothing thrown
//   cosmos-button-sweep        every button in the Feed and in each dialog once; the Recycle Bin 'Yes' never
//   cosmos-render-budget       1,000 cards: first render, unchanged re-render median, one narrowing keystroke, leaving for Home
//   cosmos-index-progress      the push channel drives the banner and the overlay; a reload mid-run shows the run again
//   cosmos-drop-import         a drop: pathForFile once per File, importFiles gets the paths in order, the toast is main's
import { fakeCosmos } from './cosmos-fixture.mjs';

export const COSMOS_SCENARIOS = Object.freeze(['cosmos-open-key0', 'cosmos-search-narrows', 'cosmos-lightbox-arrows', 'cosmos-no-bridge-readonly', 'cosmos-button-sweep', 'cosmos-render-budget', 'cosmos-index-progress', 'cosmos-drop-import']);

export const COUNT_KEY = 'hqFake:cosmosCount';
export const BIG = 1000;
/** The named budget (design: cosmos-render-budget). Times are milliseconds in the page, forced layout included. */
export const BUDGET = Object.freeze({ firstRender: 400, rerenderMedian: 40, narrowKeystroke: 150 });
/** Every hq.cosmos method that writes, spends or opens something; a read-only window must never record one. */
export const WRITE_METHODS = Object.freeze(['cosmos.apply', 'cosmos.pickFolder', 'cosmos.index', 'cosmos.cancelIndex', 'cosmos.trash', 'cosmos.reveal', 'cosmos.importFiles', 'cosmos.importFromLocal']);

// ---- what the gates expect, from the generator, with plain filters ---------------------------------------------
export const fmtInt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The works the Feed shows by default: hidden ones left out, the owner's title/tag edits applied. */
export function visibleWorks(lib) {
  const hidden = (lib.curation && lib.curation.hidden) || {}, over = (lib.curation && lib.curation.overrides) || {};
  return lib.works.filter((w) => !hidden[w.id]).map((w) => {
    const o = over[w.id];
    if (!o) return w;
    return { ...w, title: typeof o.title === 'string' && o.title.trim() ? o.title : w.title, tags: Array.isArray(o.tags) ? o.tags : w.tags };
  });
}

/** Counts the narrowing scenario asserts, for a library answer. `known` is fakeCosmos({describe:true}).known. */
export function expectedCounts(lib, known = fakeCosmos({ describe: true }).known) {
  const vis = visibleWorks(lib), d = fakeCosmos({ describe: true });
  const family = new Set(d.colors.filter((c) => c.family === known.family).map((c) => c.hex));
  const exact = vis.filter((w) => w.color && w.color.hex === known.hex);
  const total = lib.works.length;
  return {
    total, visible: vis.length,
    all: vis.length === total ? fmtInt(total) + ' elements' : fmtInt(vis.length) + ' of ' + fmtInt(total),
    of: (n) => (n === total ? fmtInt(n) + ' elements' : fmtInt(n) + ' of ' + fmtInt(total)),
    tag: vis.filter((w) => w.tags.includes(known.tag)).length,
    family: vis.filter((w) => w.color && family.has(w.color.hex)).length,
    type: vis.filter((w) => w.type === known.type).length,
    withColor: vis.filter((w) => w.color).length,
    hexExact: exact.length,
    exactIds: new Set(exact.map((w) => w.id)),
    colorById: new Map(vis.filter((w) => w.color).map((w) => [w.id, w.color.hex])),
    known,
  };
}

/** The toast texts cosDrop makes for main's answer (logic/cosmos.js cosDrop), in order. */
export function dropToasts(answer) {
  const skipped = Array.isArray(answer.skipped) ? answer.skipped : [], n = Number(answer.imported) || 0, out = [];
  if (n > 0) out.push(['success', 'Added ' + n + (n === 1 ? ' file' : ' files') + (skipped.length ? ' · ' + skipped.length + ' skipped' : '')]);
  if (skipped.length) out.push([n > 0 ? 'info' : 'error', (skipped[0] && skipped[0].reason) || 'Some files were skipped']);
  return out;
}

// ---- real key presses through CDP Input (the scenarios do not depend on the gate's own key table) -----------------
export const KEYS = Object.freeze({
  '0': ['Digit0', 48, '0'], f: ['KeyF', 70, 'f'], '/': ['Slash', 191, '/'], k: ['KeyK', 75, 'k'],
  ArrowRight: ['ArrowRight', 39, ''], ArrowLeft: ['ArrowLeft', 37, ''], Escape: ['Escape', 27, ''], Backspace: ['Backspace', 8, ''],
});
export function keyEvents(name, o = {}) {
  const K = KEYS[name];
  if (!K) throw new Error('cdp-cosmos: no key table entry for ' + name);
  const [code, vk, text] = K, ctrl = !!o.ctrl, withText = !!text && !ctrl;
  const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 };
  return [
    Object.assign({ type: withText ? 'keyDown' : 'rawKeyDown' }, base, withText ? { text, unmodifiedText: text } : null),
    Object.assign({ type: 'keyUp' }, base),
  ];
}
const key = async (t, name, o) => { for (const ev of keyEvents(name, o)) await t.send('Input.dispatchKeyEvent', ev); };

// ---- in-page snippets (strings for t.evaluate); exported so a test can compile every one of them ----------------------
const L_ = 'WHQ.app.logic';
const COS_CLOSED = "cosLb: null, cosIdx: false, cosReportOpen: false, cosReplaceAsk: false, cosQuery: '', cosFav: false, cosShowHidden: false, paletteOpen: false, askOpen: false, whatsNewOpen: false, toasts: [], snapOffset: 0";

export const PAGE = {
  READY: "!!(window.WHQ && WHQ.app && WHQ.app.logic && document.querySelector('#app') && document.querySelector('#app').childElementCount > 0 && window.hqFake)",
  setCount: (n) => (n == null ? `(sessionStorage.removeItem(${JSON.stringify(COUNT_KEY)}), true)` : `(sessionStorage.setItem(${JSON.stringify(COUNT_KEY)}, ${JSON.stringify(String(n))}), true)`),
  home: `(() => { ${L_}.go('home'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()`,
  quiet: `(() => { ${L_}.setState({ whatsNewOpen: false }); hqFake.reset(); return true; })()`,
  goCosmos: `(() => { ${L_}.go('cosmos', 'feed'); return true; })()`,
  tab: `${L_}.state.tab`,
  sub: `${L_}.state.sub.cosmos`,
  libHas: (n) => `(() => { const c = WHQ.store.live.cosmos; return !!(c && Array.isArray(c.works) && c.works.length === ${Number(n)}); })()`,
  cards: "document.querySelectorAll('[data-cos-card]').length",
  cardIds: "[...document.querySelectorAll('[data-cos-card]')].map((b) => b.getAttribute('data-id'))",
  order: `${L_}.cosOrder()`,
  orderLen: `${L_}.cosOrder().length`,
  shown: `(${L_}.state.cosShown > 0 ? ${L_}.state.cosShown : 0)`,
  countText: "(() => { const e = document.querySelector(\"[data-cos='count']\"); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()",
  emptyReason: "(() => { const e = document.querySelector(\"[data-cos='empty']\"); return e ? e.getAttribute('data-reason') : null; })()",
  mainText: "(document.querySelector('main') ? document.querySelector('main').textContent.replace(/\\s+/g, ' ') : '')",
  toasts: `${L_}.state.toasts.map((x) => [x.kind, x.text])`,
  errorToasts: `${L_}.state.toasts.filter((x) => x.kind === 'error').map((x) => x.text)`,
  focusSearch: "(() => { const i = document.querySelector(\"[data-cos='search']\"); if (!i) return false; i.focus(); i.select && i.select(); return document.activeElement === i; })()",
  searchFocused: "(() => { const a = document.activeElement; return !!a && a.getAttribute && a.getAttribute('data-cos') === 'search'; })()",
  blur: "(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); return true; })()",
  clickClear: "(() => { const b = document.querySelector('[aria-label=\"Clear search\"]'); if (!b) return false; b.click(); return true; })()",
  clickFirstCard: "(() => { const b = document.querySelector('[data-cos-card]'); if (!b) return null; const id = b.getAttribute('data-id'); b.click(); return id; })()",
  lbId: `(${L_}.state.cosLb && ${L_}.state.cosLb.id) || null`,
  snapOffset: `${L_}.state.snapOffset`,
  focusMode: `${L_}.state.focus`,
  paletteOpen: `!!${L_}.state.paletteOpen`,
  dialog: (label) => `(() => { const d = document.querySelector('[role="dialog"][aria-label=${JSON.stringify(label)}]'); if (!d) return null; let e = d, z = getComputedStyle(d).zIndex; while (z === 'auto' && e.parentElement) { e = e.parentElement; z = getComputedStyle(e).zIndex; } return { z, position: getComputedStyle(e).position }; })()`,   // the layer is the dialog's fixed wrapper (data-cos=lightbox), not the dialog box
  hasFixedZ: (z) => `[...document.querySelectorAll('body *')].some((e) => { const s = getComputedStyle(e); return s.position === 'fixed' && s.zIndex === ${JSON.stringify(String(z))}; })`,
  isFavorite: (id) => `!!(WHQ.store.live.cosmos.curation.favorites && WHQ.store.live.cosmos.curation.favorites[${JSON.stringify(id)}])`,
  calls: (m) => `hqFake.calls(${JSON.stringify(m)})`,
  callCount: (m) => `hqFake.calls(${JSON.stringify(m)}).length`,
  anyCall: (methods) => `hqFake.calls().filter((c) => ${JSON.stringify(methods)}.includes(c.method)).map((c) => c.method)`,
  vals: `(() => { const v = ${L_}.renderVals(); return { on: v.cosOn, offline: v.cosOffline, reason: v.cosReason, count: v.cosCount, cards: v.cosCards.length, hasCards: v.cosHasCards, hasMore: v.cosHasMore, banner: v.cosBannerIndexing, bannerText: v.cosBannerIndexingText, idxOpen: v.cosIdxOpen, idxRunning: v.cosIdxRunning, idxProgress: v.cosIdxProgress, hasSummary: v.cosIdxHasSummary, summary: v.cosIdxSummary, subtitle: v.screenSub }; })()`,
  // the library on the slice goes back to the default size after a scenario used 1,000
  reread: "(WHQ.store && typeof WHQ.store.refreshCosmos === 'function' ? WHQ.store.refreshCosmos(true).then(() => true, () => true) : true)",
  cleanup: `(async () => { sessionStorage.removeItem(${JSON.stringify(COUNT_KEY)}); if (window.__cosHq) { WHQ.store.hq = window.__cosHq; delete window.__cosHq; } ${L_}.setState({ ${COS_CLOSED}, cosFolder: '' }); ${L_}.go('home'); hqFake.reset(true); try { await WHQ.store.refreshCosmos(true); } catch (e) {} hqFake.reset(true); return true; })()`,
  readOnly: "(() => { window.__cosHq = WHQ.store.hq; WHQ.store.hq = Object.assign({}, WHQ.store.hq, { cosmos: undefined }); return true; })()",
  readOnlyOff: "(() => { if (window.__cosHq) { WHQ.store.hq = window.__cosHq; delete window.__cosHq; } return true; })()",
  emit: (payload) => `hqFake.emit('hq:cosmos:index-progress', ${JSON.stringify(payload)})`,
  persistRead: (answer) => `hqFake.set('cosmos.read', ${JSON.stringify(answer)}, { persist: true })`,
  setAnswer: (method, answer) => `hqFake.set(${JSON.stringify(method)}, ${JSON.stringify(answer)})`,
  openIndexOverlay: `(() => { ${L_}.cosIndexOpen(); return true; })()`,
  // a drop the way the browser makes one: a real DOM event whose dataTransfer carries plain File-like objects (a real File would lose its fakePath crossing the bridge)
  dragOver: "(() => { const h = document.querySelector(\"[data-cos='feed']\"); if (!h) return null; const ev = new Event('dragover', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { files: [], types: ['Files'] } }); h.dispatchEvent(ev); return ev.defaultPrevented; })()",
  drop: (files) => `(() => { const h = document.querySelector("[data-cos='feed']"); if (!h) return null; const ev = new Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { files: ${JSON.stringify(files)}, types: ['Files'] } }); h.dispatchEvent(ev); return ev.defaultPrevented; })()`,
  // the sweep: open one scope on a clean slate, count its buttons, click the i-th (never a 'Yes')
  sweepReset: (extraState) => `(async () => { hqFake.reset(true); ${L_}.go('cosmos', 'feed'); ${L_}.setState({ ${COS_CLOSED}${extraState ? ', ' + extraState : ''} }); try { await WHQ.store.refreshCosmos(true); } catch (e) {} return true; })()`,
  sweepSetReport: "(() => { WHQ.store.live.cosmos.report = { clusters: 3, favorites: 25, hidden: 15, overrides: 4, found: 38, seeded: 12, skipped: [], missingIds: ['alpha-site-9001'], missingCount: 1, conflicts: 3, token: 'sweep-token', note: 'Imported the placeholder backup' }; WHQ.app.logic.setState({ cosReportOpen: true, cosReplaceAsk: false, toasts: [] }); return true; })()",
  sweepCount: (root) => `(() => { const r = ${root}; return r ? r.querySelectorAll('button').length : -1; })()`,
  sweepClick: (root, i) => `(() => { const r = ${root}; if (!r) return { gone: 'scope' }; const b = r.querySelectorAll('button')[${Number(i)}]; if (!b) return { gone: 'button' };
    const label = ((b.getAttribute('aria-label') || '') + ' ' + b.textContent).replace(/\\s+/g, ' ').trim().slice(0, 80) || '(no label)';
    if (b.textContent.trim() === 'Yes') return { skipped: label }; b.click(); return { label }; })()`,
  buttonByText: (root, re) => `(() => { const r = ${root}; if (!r) return null; const b = [...r.querySelectorAll('button')].find((x) => ${re}.test(x.textContent.trim() + ' ' + (x.getAttribute('aria-label') || ''))); if (!b) return null; b.click(); return b.textContent.trim(); })()`,
  trashAsk: `!!(${L_}.state.cosLb && ${L_}.state.cosLb.trashAsk)`,
  openLb: (id, extra) => `(() => { ${L_}.setState({ cosLb: Object.assign({ id: ${JSON.stringify(id)}, edit: null, trashAsk: false }, ${JSON.stringify(extra || {})}) }); return true; })()`,
  // the render budget
  firstRender: `(async () => {
    const L = ${L_}, t0 = performance.now(), dl = t0 + 15000;
    L.go('cosmos', 'feed');
    let want = -1, n = 0;
    while (performance.now() < dl) {
      const c = WHQ.store.live.cosmos;
      if (c && Array.isArray(c.works) && c.works.length > 0) {
        const total = L.cosOrder().length, shown = L.state.cosShown > 0 ? L.state.cosShown : Infinity;
        want = Math.min(total, shown); n = document.querySelectorAll('[data-cos-card]').length;
        if (want > 0 && n === want) break;
      }
      await new Promise((r) => setTimeout(r, 2));
    }
    void document.body.getBoundingClientRect();
    return { ms: Math.round((performance.now() - t0) * 10) / 10, want, n };
  })()`,
  rerenders: (k) => `(async () => {
    const L = ${L_}, ms = [];
    for (let i = 0; i < ${Number(k)}; i++) {
      const t0 = performance.now();
      L.setState({ cosFolder: 'probe-' + i });
      await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
      void document.body.getBoundingClientRect();
      ms.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 20));
    }
    L.setState({ cosFolder: '' });
    const sorted = ms.slice().sort((a, b) => a - b);
    return { median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, all: ms.map((x) => Math.round(x * 10) / 10) };
  })()`,
  narrow: (q, want) => `(async () => {
    const i = document.querySelector("[data-cos='search']"); if (!i) return { error: 'no search box' };
    const t0 = performance.now(), dl = t0 + 5000; let n = -1;
    i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true }));
    while (performance.now() < dl) { n = document.querySelectorAll('[data-cos-card]').length; if (n === ${Number(want)}) break; await new Promise((r) => setTimeout(r, 1)); }
    void document.body.getBoundingClientRect();
    return { ms: Math.round((performance.now() - t0) * 10) / 10, n };
  })()`,
  buildCount: "(() => { const c = WHQ.store.live.cosmos, m = c && c._memo; return m && m.stats ? m.stats.misses + m.stats.reuses : -1; })()",
};

const brief = (v) => JSON.stringify(v);

// ---- the scenarios ----------------------------------------------------------------------------------------------
export function makeCosmosScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep } = {}) {
  const pause = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));

  // A known page with the library at `count` works (null = the fake's default). cold = reload first, so the slice starts empty and
  // the arrival is a real first load. Returns failure strings, or null when ready.
  async function boot(t, count, cold) {
    let pre = await fresh(t); if (pre) return pre;
    await t.evaluate(PAGE.setCount(count));
    if (cold) {
      await t.reload();
      if (!await t.waitFor(PAGE.READY + ' && hqFake.calls("liveState").length > 0', 15000)) return ['the app never came back after the reload'];
      await pause(400);
      pre = await fresh(t); if (pre) return pre;
    }
    await t.send('Page.bringToFront');   // a --hidden harness's first focus opens What's new once, which blocks the hotkeys
    await pause(200);
    await t.evaluate(PAGE.quiet);
    return null;
  }
  async function leave(t, saved) {
    await t.evaluate(PAGE.cleanup).catch(() => {});
    await t.evaluate(RESTORE_KEYS(saved)).catch(() => {});
  }
  // the Cosmos Feed with its whole library in the slice
  async function openFeed(t, n) {
    await t.evaluate(PAGE.goCosmos);
    if (!await t.waitFor(PAGE.libHas(n), 8000)) return ['the ' + n + '-element library never arrived in LIVE.cosmos'];
    if (!await t.waitFor(`${PAGE.cards} > 0`, 8000)) return ['no card ever rendered (data-cos-card)'];
    await pause(150);
    return null;
  }

  return {
    // Pressing 0 opens the space on Feed; the arrival reads main once; the count says what is in the library; one usage mark
    async 'cosmos-open-key0'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const lib = fakeCosmos({ count: BIG }), K = expectedCounts(lib);
      try {
        const pre = await boot(t, BIG, true); if (pre) return pre;
        await t.evaluate(PAGE.home); await pause(150);
        await t.send('Page.bringToFront'); await pause(150);
        await t.evaluate(PAGE.quiet); await pause(100);
        await key(t, '0');
        if (!await t.waitFor(`${PAGE.tab} === 'cosmos'`, 5000)) return ['pressing 0 did not open the Cosmos space (tab ' + await t.evaluate(PAGE.tab) + ')'];
        const sub = await t.evaluate(PAGE.sub);
        if (sub !== 'feed') out.push('opened on ' + sub + ', want feed');
        if (!await t.waitFor(PAGE.libHas(BIG), 8000)) return out.concat('the ' + BIG + '-element library never arrived in LIVE.cosmos');
        await pause(600);   // anything that would read twice has had time to
        const reads = await t.evaluate(PAGE.callCount('cosmos.read'));
        if (reads !== 1) out.push('arrival called hq.cosmos.read ' + reads + ' times, want exactly 1');
        if (!await t.waitFor(`${PAGE.cards} > 0`, 5000)) out.push('no card rendered on arrival');
        const v = await t.evaluate(PAGE.vals);
        if (!v.on) out.push('vals say the space is not on (cosOn false)');
        if (v.count !== K.all) out.push('the count reads "' + v.count + '", want "' + K.all + '" (' + K.visible + ' of the ' + K.total + ' elements are not hidden)');
        const text = await t.evaluate(PAGE.mainText);
        if (!text.includes(fmtInt(K.total))) out.push('the screen never says ' + fmtInt(K.total) + ' (header subtitle / count)');
        const cards = await t.evaluate(PAGE.cards);
        if (cards !== v.cards) out.push('the DOM holds ' + cards + ' cards, the vals say ' + v.cards);
        if (!v.hasMore && cards !== K.visible) out.push('paging is off but ' + cards + ' cards render, want ' + K.visible);
        const marks = await t.evaluate(`hqFake.calls('use').filter((c) => c.args[0] === 'cosmos').map((c) => c.args.join('/'))`);
        if (marks.length !== 1) out.push('hq.use marks for cosmos: ' + brief(marks) + ', want exactly one');
        const bad = await t.evaluate(PAGE.errorToasts);
        if (bad.length) out.push('error toast: ' + brief(bad));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // Typing narrows to the known counts; a colour query reorders nearest first; clearing restores everything
    async 'cosmos-search-narrows'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const lib = fakeCosmos({ count: BIG }), K = expectedCounts(lib), KN = K.known;
      try {
        const pre = await boot(t, BIG, false); if (pre) return pre;
        const open = await openFeed(t, BIG); if (open) return open;
        const shownCap = await t.evaluate(PAGE.shown);
        const cap = (n) => (shownCap > 0 ? Math.min(n, shownCap) : n);
        if (await t.evaluate(PAGE.orderLen) !== K.visible) return ['the Feed holds ' + await t.evaluate(PAGE.orderLen) + ' results before any query, want ' + K.visible];
        const base = (await t.evaluate(PAGE.order)).slice(0, 8);
        if (await t.evaluate(PAGE.countText) !== K.all) out.push('the count reads "' + await t.evaluate(PAGE.countText) + '" before any query, want "' + K.all + '"');
        const typeQuery = async (label, query, wantN) => {
          if (!await t.evaluate(PAGE.focusSearch)) { out.push(label + ': no search box ([data-cos="search"])'); return false; }
          await t.type(query);
          if (!await t.waitFor(`${PAGE.orderLen} === ${wantN}`, 4000)) { out.push(label + ': "' + query + '" gave ' + await t.evaluate(PAGE.orderLen) + ' results, want ' + wantN); return false; }
          await pause(120);
          const ct = await t.evaluate(PAGE.countText);
          if (wantN > 0 && ct !== K.of(wantN)) out.push(label + ': the count reads "' + ct + '", want "' + K.of(wantN) + '"');
          const cards = await t.evaluate(PAGE.cards);
          if (cards !== cap(wantN)) out.push(label + ': ' + cards + ' cards in the DOM, want ' + cap(wantN));
          return true;
        };
        const clear = async (label) => {
          if (!await t.evaluate(PAGE.focusSearch)) { out.push(label + ': no search box to clear'); return false; }
          await key(t, 'Backspace');
          if (!await t.waitFor(`${PAGE.orderLen} === ${K.visible}`, 1500)) await t.evaluate(PAGE.clickClear);   // the Backspace is a CDP key; the Clear button is the app's own way back
          if (!await t.waitFor(`${PAGE.orderLen} === ${K.visible}`, 4000)) { out.push(label + ': clearing left ' + await t.evaluate(PAGE.orderLen) + ' results, want ' + K.visible); return false; }
          await pause(120);
          return true;
        };

        // tag:<known> -> the known count
        if (await typeQuery('tag', 'tag:' + KN.tag, K.tag) && !await clear('tag')) return out;
        // a colour query: the nearest first, capped at 80
        const cap80 = Math.min(80, K.withColor);
        if (await typeQuery('colour', KN.hex, cap80)) {
          const order = await t.evaluate(PAGE.order);
          const lead = Math.min(K.hexExact, cap80);
          const wrong = order.slice(0, lead).filter((id) => K.colorById.get(id) !== KN.hex);
          if (wrong.length) out.push('colour: ' + wrong.length + ' of the first ' + lead + ' results are not ' + KN.hex + ' (nearest first)');
          if (brief(order.slice(0, 8)) === brief(base)) out.push('colour: the order did not change from the newest-first Feed');
          if (!await clear('colour')) return out;
        }
        // a colour family and a type word
        if (await typeQuery('family', KN.family.toLowerCase(), K.family) && !await clear('family')) return out;
        if (await typeQuery('type', KN.type, K.type) && !await clear('type')) return out;
        // a query nothing matches: the honest empty state, with a way back
        if (await typeQuery('no match', 'zzzq-nothing', 0)) {
          const reason = await t.evaluate(PAGE.emptyReason);
          if (reason !== 'no-match') out.push('no match: the empty block reads "' + reason + '", want no-match');
          if (!await clear('no match')) return out;
        }
        if (await t.evaluate(PAGE.countText) !== K.all) out.push('after clearing the count reads "' + await t.evaluate(PAGE.countText) + '", want "' + K.all + '"');
        if (brief((await t.evaluate(PAGE.order)).slice(0, 8)) !== brief(base)) out.push('clearing did not restore the original order');
        const bad = await t.evaluate(PAGE.errorToasts);
        if (bad.length) out.push('error toast: ' + brief(bad));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // The lightbox: arrows step through the Feed's order without touching the time machine; f, "/", Ctrl+K and Escape each act in their own layer
    async 'cosmos-lightbox-arrows'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, null, false); if (pre) return pre;
        const open = await openFeed(t, 40); if (open) return open;
        const order = await t.evaluate(PAGE.order);
        if (order.length < 4) return ['the default library has only ' + order.length + ' results, too few to step through'];
        const opened = await t.evaluate(PAGE.clickFirstCard);
        if (!opened) return ['no card to click ([data-cos-card])'];
        if (!await t.waitFor(`${PAGE.lbId} === ${JSON.stringify(opened)}`, 3000)) return ['clicking a card did not open it in the lightbox (cosLb ' + brief(await t.evaluate(PAGE.lbId)) + ')'];
        const dlg = await t.evaluate(PAGE.dialog('Cosmos element'));
        if (!dlg) return ['no dialog labelled "Cosmos element"'];
        if (dlg.z !== '990') out.push('the lightbox z-index is ' + dlg.z + ', want 990 (under the palette at 1000)');
        // arrows: the next id in the Feed's order, and the time machine stays where it was
        const snap0 = await t.evaluate(PAGE.snapOffset), at = order.indexOf(opened);
        await key(t, 'ArrowRight');
        if (!await t.waitFor(`${PAGE.lbId} === ${JSON.stringify(order[at + 1])}`, 2000)) out.push('ArrowRight did not move to the next element (' + brief(await t.evaluate(PAGE.lbId)) + ', want ' + order[at + 1] + ')');
        if (await t.evaluate(PAGE.snapOffset) !== snap0) out.push('ArrowRight moved the time machine (snapOffset ' + snap0 + ' -> ' + await t.evaluate(PAGE.snapOffset) + ')');
        await key(t, 'ArrowLeft');
        if (!await t.waitFor(`${PAGE.lbId} === ${JSON.stringify(opened)}`, 2000)) out.push('ArrowLeft did not come back');
        if (await t.evaluate(PAGE.snapOffset) !== snap0) out.push('ArrowLeft moved the time machine');
        // f: favourite the open element, never focus mode
        const id = await t.evaluate(PAGE.lbId), was = await t.evaluate(PAGE.isFavorite(id));
        await t.evaluate('hqFake.reset(); true');
        await key(t, 'f');
        if (!await t.waitFor(`${PAGE.callCount('cosmos.apply')} >= 1`, 3000)) out.push('f did not call hq.cosmos.apply');
        else {
          const calls = await t.evaluate(PAGE.calls('cosmos.apply')), intent = calls[0].args[0];
          if (brief(intent) !== brief({ type: 'favorite', id, on: !was })) out.push('f sent ' + brief(intent) + ', want ' + brief({ type: 'favorite', id, on: !was }));
        }
        if (await t.evaluate(PAGE.focusMode)) out.push('f opened focus mode');
        if (await t.evaluate(PAGE.snapOffset) !== snap0) out.push('f moved the time machine');
        // "/": closes the lightbox, focuses the Feed's search, never opens the palette
        await key(t, '/');
        if (!await t.waitFor(`${PAGE.lbId} === null`, 2000)) out.push('/ did not close the lightbox');
        if (!await t.waitFor(PAGE.searchFocused, 2000)) out.push('/ did not focus the search box');
        if (await t.evaluate(PAGE.paletteOpen)) out.push('/ opened the palette while the lightbox was open');
        // Ctrl+K with the lightbox open: the palette on top; Escape closes the palette first, then the lightbox
        await t.evaluate(PAGE.blur);
        const again = await t.evaluate(PAGE.clickFirstCard);
        if (!again || !await t.waitFor(`${PAGE.lbId} === ${JSON.stringify(again)}`, 3000)) return out.concat('the lightbox did not open a second time');
        await key(t, 'k', { ctrl: true });
        if (!await t.waitFor(PAGE.paletteOpen, 2000)) out.push('Ctrl+K did not open the palette over the lightbox');
        else {
          if (await t.evaluate(PAGE.lbId) === null) out.push('opening the palette closed the lightbox');
          if (!await t.evaluate(PAGE.hasFixedZ(1000))) out.push('no fixed layer at z-index 1000: the palette is not above the lightbox (990)');
        }
        await key(t, 'Escape');
        if (!await t.waitFor(`!${PAGE.paletteOpen}`, 2000)) out.push('Escape did not close the palette first');
        if (await t.evaluate(PAGE.lbId) === null) out.push('the first Escape closed the lightbox as well as the palette');
        await key(t, 'Escape');
        if (!await t.waitFor(`${PAGE.lbId} === null`, 2000)) out.push('the second Escape did not close the lightbox');
        // with the lightbox closed, "/" is the palette again
        await t.evaluate(PAGE.blur);
        await key(t, '/');
        if (!await t.waitFor(PAGE.paletteOpen, 2000)) out.push('after the lightbox closed, / no longer opens the palette');
        await key(t, 'Escape');
        const bad = await t.evaluate(PAGE.errorToasts);
        if (bad.length) out.push('error toast: ' + brief(bad));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // No main process behind the window: the read-only state says so, shows no card, writes nothing, throws nothing
    async 'cosmos-no-bridge-readonly'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, null, false); if (pre) return pre;
        await t.evaluate(PAGE.home); await pause(100);
        await t.evaluate(PAGE.readOnly);   // the store's hq without .cosmos (window.hq itself is frozen by the bridge)
        await t.evaluate('hqFake.reset(); true');
        t.clearErrors();
        await t.evaluate(PAGE.goCosmos);
        if (!await t.waitFor(`${PAGE.tab} === 'cosmos'`, 3000)) return ['the Cosmos space did not open without a bridge'];
        await pause(600);
        const v = await t.evaluate(PAGE.vals);
        if (!v.offline) out.push('the vals do not say offline (cosOffline false)');
        if (v.hasCards || v.cards) out.push('offline, but the vals carry ' + v.cards + ' cards');
        const cards = await t.evaluate(PAGE.cards);
        if (cards) out.push('offline, but ' + cards + ' cards are in the DOM');
        const text = await t.evaluate(PAGE.mainText);
        if (!/main process unavailable/i.test(text)) out.push('the screen does not say the main process is unavailable');
        if (await t.evaluate(PAGE.emptyReason) !== 'offline') out.push('the empty block reads "' + await t.evaluate(PAGE.emptyReason) + '", want offline');
        const writes = await t.evaluate(PAGE.anyCall(WRITE_METHODS));
        if (writes.length) out.push('a write call was recorded without a bridge: ' + brief(writes));
        const bad = await t.evaluate(PAGE.errorToasts);
        if (bad.length) out.push('error toast: ' + brief(bad));
        await t.evaluate(PAGE.readOnlyOff);
      } finally { await t.evaluate(PAGE.readOnlyOff).catch(() => {}); await leave(t, saved); }
      return out.concat(t.errors());
    },

    // Every button in the Feed and in each dialog once: none throws, none leaves an error, the Recycle Bin 'Yes' is never clicked
    async 'cosmos-button-sweep'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const lib = fakeCosmos({ count: 40 }), by = lib.works;
      const plain = by.find((w) => !w.video && !w.approx && !w.rel.startsWith('imports:') && w.thumbUrl), video = by.find((w) => w.video), dropped = by.find((w) => w.rel.startsWith('imports:'));
      const DLG = (label) => `document.querySelector('[role="dialog"][aria-label=${JSON.stringify(label)}]')`;
      const scopes = [
        { name: 'Feed', root: "document.querySelector('main')", state: '' },
        { name: 'lightbox (image)', need: plain, root: DLG('Cosmos element'), state: `cosLb: { id: ${JSON.stringify(plain && plain.id)}, edit: null, trashAsk: false }` },
        { name: 'lightbox (video)', need: video, root: DLG('Cosmos element'), state: `cosLb: { id: ${JSON.stringify(video && video.id)}, edit: null, trashAsk: false }` },
        { name: 'lightbox (title edit)', need: plain, root: DLG('Cosmos element'), state: `cosLb: { id: ${JSON.stringify(plain && plain.id)}, edit: 'title', draft: 'A new title' }` },
        { name: 'lightbox (dropped-in file)', need: dropped, root: DLG('Cosmos element'), state: `cosLb: { id: ${JSON.stringify(dropped && dropped.id)}, edit: null, trashAsk: false }` },
        { name: 'Index a folder', root: DLG('Index a folder'), state: "cosIdx: true, cosFolder: 'C:/placeholder-library'" },
        { name: 'Import report', root: DLG('Import report'), state: 'cosReportOpen: true', report: true },
      ];
      let clicked = 0, skipped = 0, trashed = 0;
      const findings = [];
      try {
        const pre = await boot(t, null, false); if (pre) return pre;
        for (const sc of scopes) {
          if ('need' in sc && !sc.need) { out.push(sc.name + ': the 40-element library has no such element to open'); continue; }
          const setup = async () => { await t.evaluate(PAGE.sweepReset(sc.state)); if (sc.report) await t.evaluate(PAGE.sweepSetReport); await pause(sc.name === 'Feed' ? 150 : 120); };
          await setup();
          const n = await t.evaluate(PAGE.sweepCount(sc.root));
          if (n < 0) { out.push(sc.name + ': the scope never rendered (' + sc.root + ')'); continue; }
          if (n === 0) { out.push(sc.name + ': no buttons found'); continue; }
          for (let i = 0; i < n; i++) {
            await setup();
            t.clearErrors();
            const r = await t.evaluate(PAGE.sweepClick(sc.root, i));
            await pause(70);
            if (r && r.gone) { if (i < n - 1) findings.push(sc.name + ' #' + i + ': the button vanished (' + r.gone + ')'); continue; }
            if (r && r.skipped) { skipped++; continue; }
            clicked++;
            trashed += await t.evaluate(PAGE.callCount('cosmos.trash'));
            const errs = t.errors().concat((await t.evaluate(PAGE.errorToasts)).map((x) => 'error toast: ' + x));
            const wired = (await t.evaluate(PAGE.toasts)).filter((x) => /isn.t wired/.test(x[1]));
            if (errs.length || wired.length) findings.push(sc.name + ' · "' + (r && r.label) + '": ' + errs.concat(wired.map((x) => x[1])).join(' | '));
          }
        }
        // the dropped-in file: arm the Recycle Bin bar, then say No: nothing may reach main
        if (dropped) {
          await t.evaluate(PAGE.sweepReset(`cosLb: { id: ${JSON.stringify(dropped.id)}, edit: null, trashAsk: false }`)); await pause(220);
          const root = DLG('Cosmos element');
          if (!await t.evaluate(PAGE.buttonByText(root, '/Recycle Bin/i'))) out.push('the dropped-in file offers no "Move to Recycle Bin" button');
          else if (!await t.waitFor(PAGE.trashAsk, 2000)) out.push('the Recycle Bin button did not arm the confirm bar');
          else {
            if (!await t.evaluate(PAGE.buttonByText(root, '/^No\\b/'))) out.push('the armed bar has no No button');
            else if (!await t.waitFor(`!${PAGE.trashAsk}`, 2000)) out.push('No did not disarm the bar');
            if (await t.evaluate(PAGE.callCount('cosmos.trash'))) out.push('arming then No still called hq.cosmos.trash');
          }
        }
        if (plain) {   // and a normal element offers no Recycle Bin button at all
          await t.evaluate(PAGE.sweepReset(`cosLb: { id: ${JSON.stringify(plain.id)}, edit: null, trashAsk: false }`)); await pause(220);
          if (await t.evaluate(`[...(${DLG('Cosmos element')} || document).querySelectorAll('button')].some((b) => /Recycle Bin/i.test(b.textContent + ' ' + (b.getAttribute('aria-label') || '')))`)) out.push('a file from the pictures folder offers "Move to Recycle Bin"');
        }
        if (trashed) out.push('the sweep reached hq.cosmos.trash ' + trashed + ' time(s)');
        console.log('[cosmos-button-sweep] ' + clicked + ' buttons clicked across ' + scopes.length + ' scopes, ' + skipped + " 'Yes' buttons left alone");
        for (const f of findings) out.push(f);
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // The named budget at 1,000 cards (design: cosmos-render-budget). Prints the numbers for the HANDOFF.
    async 'cosmos-render-budget'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      const lib = fakeCosmos({ count: BIG }), K = expectedCounts(lib);
      const hint = ' - set FEED_PAGE = 250 in dashboard-v5/src/logic/cosmos-view.mjs and re-run; the paged variant must pass the same budget';
      try {
        const pre = await boot(t, BIG, true); if (pre) return pre;
        await t.evaluate(PAGE.home); await pause(300);
        // 1. first render after arrival (read + layout + DOM + forced style/layout)
        const first = await t.evaluate(PAGE.firstRender);
        if (first.n !== first.want || first.want < 1) return out.concat('the Feed never reached its ' + first.want + ' cards (got ' + first.n + ')');
        if (first.ms > BUDGET.firstRender) out.push('first render took ' + first.ms + ' ms (budget ' + BUDGET.firstRender + ')' + hint);
        await pause(500);
        const shown = await t.evaluate(PAGE.shown);
        // 2. nine re-renders that leave the result set unchanged: the memo answers
        const rr = await t.evaluate(PAGE.rerenders(9));
        if (rr.median > BUDGET.rerenderMedian) out.push('the median of 9 unchanged re-renders took ' + rr.median + ' ms (budget ' + BUDGET.rerenderMedian + '; ' + brief(rr.all) + ')' + hint);
        // 3. one keystroke that narrows ~1,000 to ~100
        const wantN = shown > 0 ? Math.min(K.type, shown) : K.type;
        const nar = await t.evaluate(PAGE.narrow(K.known.type, wantN));
        if (nar.error) out.push(nar.error);
        else {
          if (nar.n !== wantN) out.push('the narrowing keystroke left ' + nar.n + ' cards, want ' + wantN);
          if (nar.ms > BUDGET.narrowKeystroke) out.push('a keystroke narrowing ' + K.visible + ' to ' + K.type + ' took ' + nar.ms + ' ms (budget ' + BUDGET.narrowKeystroke + ')' + hint);
        }
        await t.evaluate(PAGE.focusSearch); await key(t, 'Backspace'); await t.waitFor(`${PAGE.orderLen} === ${K.visible}`, 4000); await pause(200);
        // 4. leaving for Home builds nothing: the Feed's pipeline is not re-run
        const before = await t.evaluate(PAGE.buildCount);
        await t.evaluate(PAGE.home); await pause(500);
        await t.evaluate(`${L_}.setState({ cosFolder: 'x' }); ${L_}.setState({ cosFolder: '' }); true`); await pause(300);
        const after = await t.evaluate(PAGE.buildCount);
        if (before < 0 || after < 0) out.push('the Feed memo (LIVE.cosmos._memo.stats) is not there to count builds');
        else if (after !== before) out.push('leaving the Cosmos space built the Feed again (' + (after - before) + ' build(s) while on Home)');
        console.log('[cosmos-render-budget] ' + K.visible + ' of ' + K.total + ' elements' + (shown > 0 ? ', paged at ' + shown : ', every card emitted') + ': first render ' + first.ms + ' ms (<= ' + BUDGET.firstRender + '), median of 9 unchanged re-renders ' + rr.median + ' ms (<= ' + BUDGET.rerenderMedian + '), narrowing keystroke ' + (nar && nar.ms) + ' ms (<= ' + BUDGET.narrowKeystroke + '), builds while on Home ' + (after - before));
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // Index progress arrives on the push channel: the banner and the overlay follow it, the summary shows, main is read again; a reload mid-run shows the run
    async 'cosmos-index-progress'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, null, false); if (pre) return pre;
        const open = await openFeed(t, 40); if (open) return open;
        await t.evaluate('hqFake.reset(); true');
        await t.evaluate(PAGE.openIndexOverlay); await pause(150);
        const phases = [['walk', 10, 100, 'reading the folder'], ['thumbs', 40, 100, 'thumbnails'], ['hashes', 70, 100, 'file hashes']];
        for (const [phase, done, total, word] of phases) {
          const heard = await t.evaluate(PAGE.emit({ phase, done, total }));
          if (!(heard >= 1)) { out.push('the ' + phase + ' push reached ' + heard + ' subscriber(s): nothing listens to hq:cosmos:index-progress'); break; }
          await pause(200);
          const v = await t.evaluate(PAGE.vals), want = 'Indexing: ' + word + ' ' + done + ' / ' + total;
          if (!v.banner) out.push(phase + ': the banner is not showing the run');
          if (v.bannerText !== want) out.push(phase + ': the banner reads "' + v.bannerText + '", want "' + want + '"');
          if (!v.idxRunning || v.idxProgress !== want) out.push(phase + ': the overlay reads "' + v.idxProgress + '", want "' + want + '"');
        }
        // done_all: the banner goes, the summary shows, main is read again
        const reads0 = await t.evaluate(PAGE.callCount('cosmos.read'));
        await t.evaluate(PAGE.emit({ phase: 'dupes', done: 100, total: 100, done_all: true, summary: { elements: 40, thumbsFailed: 1, minted: 3 } }));
        if (!await t.waitFor(`${PAGE.callCount('cosmos.read')} > ${reads0}`, 4000)) out.push('done_all did not read hq.cosmos.read again');
        await pause(300);
        const end = await t.evaluate(PAGE.vals);
        if (end.banner) out.push('the banner is still up after done_all');
        if (end.idxRunning) out.push('the overlay still says running after done_all');
        if (!end.hasSummary || !/40 elements/.test(end.summary)) out.push('the final summary is "' + end.summary + '", want it to say 40 elements');
        // a reload in the middle of a run: the persisted read says indexing, and the run shows again
        const mid = fakeCosmos({ count: 40, indexing: { phase: 'thumbs', done: 12, total: 40 } });
        await t.evaluate(PAGE.persistRead(mid));
        await t.reload();
        if (!await t.waitFor(PAGE.READY + ' && hqFake.calls("liveState").length > 0', 15000)) { out.push('the app never came back after the reload'); return out; }
        await pause(400);
        await t.send('Page.bringToFront'); await t.evaluate(PAGE.quiet);
        await t.evaluate(PAGE.goCosmos);
        if (!await t.waitFor(`${PAGE.libHas(40)}`, 8000)) out.push('after the reload the library never arrived');
        await pause(300);
        const again = await t.evaluate(PAGE.vals);
        if (!again.banner || again.bannerText !== 'Indexing: thumbnails 12 / 40') out.push('after a reload mid-run the banner reads "' + again.bannerText + '", want "Indexing: thumbnails 12 / 40"');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },

    // A drop onto the Feed: the paths come from pathForFile (once per File), only non-empty ones go to main, in order; the toast is main's own answer
    async 'cosmos-drop-import'(t) {
      const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
      try {
        const pre = await boot(t, null, false); if (pre) return pre;
        const open = await openFeed(t, 40); if (open) return open;
        const answer = { imported: 2, skipped: [{ path: 'C:/placeholder-drop/note.txt', reason: 'That is not a picture or a video' }] };
        await t.evaluate('hqFake.reset(); true');
        await t.evaluate(PAGE.setAnswer('cosmos.importFiles', answer));
        const over = await t.evaluate(PAGE.dragOver);
        if (over === null) return ['no Feed host to drop on ([data-cos="feed"])'];
        if (over !== true) out.push('dragover was not default-prevented (the window would navigate to the file)');
        const files = [{ name: 'a.png', fakePath: 'C:/placeholder-drop/a.png' }, { name: 'note.txt' }, { name: 'b.mp4', fakePath: 'C:/placeholder-drop/b.mp4' }];
        const prevented = await t.evaluate(PAGE.drop(files));
        if (prevented !== true) out.push('drop was not default-prevented');
        if (!await t.waitFor(`${PAGE.callCount('cosmos.importFiles')} >= 1`, 4000)) return out.concat('the drop never reached hq.cosmos.importFiles');
        const asked = await t.evaluate(PAGE.callCount('cosmos.pathForFile'));
        if (asked !== files.length) out.push('pathForFile was called ' + asked + ' times for ' + files.length + ' files');
        const sent = await t.evaluate(PAGE.calls('cosmos.importFiles'));
        if (sent.length !== 1) out.push('importFiles was called ' + sent.length + ' times, want 1');
        else if (brief(sent[0].args[0]) !== brief(['C:/placeholder-drop/a.png', 'C:/placeholder-drop/b.mp4'])) out.push('importFiles got ' + brief(sent[0].args[0]) + ', want the two real paths in order');
        await pause(300);
        const toasts = await t.evaluate(PAGE.toasts), want = dropToasts(answer);
        for (const w of want) if (!toasts.some((x) => x[0] === w[0] && x[1] === w[1])) out.push('no ' + w[0] + ' toast "' + w[1] + '" (got ' + brief(toasts) + ')');
        // a drop of things that are not files (no path): nothing goes to main, and the owner is told
        await t.evaluate('hqFake.reset(); true');
        await t.evaluate(`${L_}.setState({ toasts: [] }); true`);
        const none = await t.evaluate(PAGE.drop([{ name: 'a folder' }]));
        if (none !== true) out.push('the second drop was not default-prevented');
        await pause(400);
        if (await t.evaluate(PAGE.callCount('cosmos.importFiles'))) out.push('a drop with no paths still called importFiles');
        if (!(await t.evaluate(PAGE.toasts)).some((x) => /Nothing was added/.test(x[1]))) out.push('a drop with no paths gave no "Nothing was added" toast');
      } finally { await leave(t, saved); }
      return out.concat(t.errors());
    },
  };
}
