// CDP scenarios for the Cosmos polish dish (batch 5). cdp-gate.mjs merges them:
//   Object.assign(SCENARIOS, makeCosmosPolishScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep }));
// This file imports nothing from cdp-gate.mjs (the helpers are passed in) and does nothing on import: no socket, no timer, no process hook.
// It reuses the page snippets and the invented library of tools/cdp-cosmos.mjs / tools/cosmos-fixture.mjs (never owner data).
//
//   node tools/cdp-gate.mjs --port 9342 --scenario cosmos-polish-selects,cosmos-polish-failed-card,...   (needs --preload=fake)
//
//   cosmos-polish-selects        sort and group are <select>s (data-cos="sort" / "group"); choosing an option sets cosSort / cosGroup, the selected
//                                option follows, and the Feed order changes for at least one sort mode, exactly like the old chips did
//   cosmos-polish-failed-card    a card whose thumbnail file is missing falls back to its original; a card whose pictures are both missing shows its
//                                title and "could not load" with no <img> (data-failed="true"); the failures land in state cosBroken
//   cosmos-polish-lightbox       the size toggle (data-cos="lb-size") flips Fit / Actual size; Escape in the title draft cancels the draft and keeps the
//                                lightbox, a second Escape closes it; with the palette open over a draft, Escape closes the palette first
//   cosmos-polish-drag           a file drag over the Feed host sets data-drag="true" with a dashed outline; a child's enter/leave does not flicker it;
//                                leaving or dropping clears it; a dragged piece of text never lights it; dragover/drop stay default-prevented
//   cosmos-polish-index-phases   under a fake indexing push the four per-phase rows (data-cos="idx-phase", data-phase, data-state) walk waiting ->
//                                running -> done in the engine order
//   cosmos-polish-report         the import report shows the seeded, re-keyed and skipped lines (and the manifest state) main sent; a report whose
//                                skippedCount is 0 shows no skipped line
//   (cosmos-render-budget and cosmos-button-sweep are the existing scenarios in cdp-cosmos.mjs: re-run unchanged, nothing to register for them)
import { fakeCosmos } from './cosmos-fixture.mjs';
import { PAGE as BASE, keyEvents, COUNT_KEY } from './cdp-cosmos.mjs';
import { phaseRows, reportExtraLines } from '../src/logic/cosmos-polish.mjs';

export const COSMOS_POLISH_SCENARIOS = Object.freeze(['cosmos-polish-selects', 'cosmos-polish-failed-card', 'cosmos-polish-lightbox', 'cosmos-polish-drag', 'cosmos-polish-index-phases', 'cosmos-polish-report']);

const L_ = 'WHQ.app.logic';
/** The hooks the templates must carry (the shared tpl edit's contract; the unit test pins them against the template text when the edit is in). */
export const SEL = Object.freeze({
  sort: '[data-cos="sort"]', group: '[data-cos="group"]', card: '[data-cos-card]', feed: '[data-cos="feed"]',
  lbSize: '[data-cos="lb-size"]', lbImage: '[data-cos="lb-image"]', lbFailed: '[data-cos="lb-failed"]',
  idxPhase: '[data-cos="idx-phase"]', repLines: '[data-cos="rep-lines"]',
});
export const MISSING = 'file:///placeholder-missing/';   // a file: URL that does not exist: the <img> fires its error event
export const FAILED_WORDS = 'could not load';

const q = (s) => JSON.stringify(s);
const brief = (v) => JSON.stringify(v);

export const PAGE = {
  READY: BASE.READY,
  // a clean slate again: the base cleanup, plus the polish state back to its defaults
  reset: `(async () => { try { ${L_}.setState({ cosBroken: {}, cosLbZoom: 'fit', cosDrag: 0, cosLb: null, paletteOpen: false, settingsOpen: false }); } catch (e) {} return true; })()`,
  selectInfo: (which) => `(() => { const s = document.querySelector(${q(SEL[which])}); if (!s || !s.options) return null; return { tag: s.tagName.toLowerCase(), value: s.value, options: [...s.options].map((o) => o.value), selected: [...s.options].filter((o) => o.selected).map((o) => o.value) }; })()`,
  selectSet: (which, value) => `(() => { const s = document.querySelector(${q(SEL[which])}); if (!s) return false; s.value = ${q(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
  sortGroupState: `(() => { const L = ${L_}, v = L.renderVals(); return { sort: L.state.cosSort, group: L.state.cosGroup, valsSort: v.cosSorts && v.cosSorts.value, valsGroup: v.cosGroups && v.cosGroups.value, order: L.cosOrder().slice(0, 12) }; })()`,
  cardInfo: (id) => `(() => { const c = document.querySelector('[data-cos-card][data-id=' + ${q(String(id))} + ']'); if (!c) return null; const i = c.querySelector('img'); return { failed: c.getAttribute('data-failed'), img: !!i, src: i ? (i.getAttribute('src') || '') : '', text: c.textContent.replace(/\\s+/g, ' ').trim() }; })()`,
  broken: `JSON.stringify(${L_}.state.cosBroken || null)`,
  // the card <img>s are loading="lazy": a card far down the Feed never requests its picture, so it never fails; bring it into view first
  reveal: (id) => `(() => { const c = document.querySelector('[data-cos-card][data-id=' + ${q(String(id))} + ']'); if (!c) return false; c.scrollIntoView({ block: 'center' }); return true; })()`,
  setLibrary: (answer) => `hqFake.set('cosmos.read', ${JSON.stringify(answer)}, { persist: true })`,
  reread: BASE.reread,
  openLb: (id, extra) => BASE.openLb(id, extra),
  lbInfo: `(() => { const L = ${L_}, lb = L.state.cosLb, b = document.querySelector(${q(SEL.lbSize)}), im = document.querySelector(${q(SEL.lbImage)}); return { id: lb ? lb.id : null, edit: lb ? lb.edit : null, draft: lb && lb.draft != null ? lb.draft : null, zoom: L.state.cosLbZoom, button: b ? b.textContent.replace(/\\s+/g, ' ').trim() : null, size: im ? im.getAttribute('data-size') : null, palette: !!L.state.paletteOpen, settings: !!L.state.settingsOpen }; })()`,
  clickSel: (sel) => `(() => { const b = document.querySelector(${q(sel)}); if (!b) return false; b.click(); return true; })()`,
  openPalette: `(() => { ${L_}.setState({ paletteOpen: true, paletteMode: 'go', paletteQuery: '', paletteSel: 0 }); return true; })()`,
  // a drag event the way the browser makes one: a real DOM event whose dataTransfer lists the drag's types; returns whether default was prevented
  dragEvent: (kind, selector, types) => `(() => { const h = document.querySelector(${q(selector)}); if (!h) return null; const ev = new Event(${q(kind)}, { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'dataTransfer', { value: { files: [], types: ${JSON.stringify(types)} } }); h.dispatchEvent(ev); return ev.defaultPrevented; })()`,
  feedInfo: `(() => { const h = document.querySelector(${q(SEL.feed)}); if (!h) return null; const s = getComputedStyle(h); return { drag: h.getAttribute('data-drag'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth }; })()`,
  phases: `[...document.querySelectorAll(${q(SEL.idxPhase)})].map((r) => ({ id: r.getAttribute('data-phase'), state: r.getAttribute('data-state'), text: r.textContent.replace(/\\s+/g, ' ').trim() }))`,
  emit: BASE.emit,
  openIndexOverlay: BASE.openIndexOverlay,
  setAnswer: BASE.setAnswer,
  importLocal: `(() => { ${L_}.cosImportLocal(); return true; })()`,
  repState: `!!${L_}.state.cosReportOpen`,
  repText: `(() => { const e = document.querySelector(${q(SEL.repLines)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`,
  repClose: `(() => { ${L_}.cosReportClose(); return true; })()`,
  callCount: BASE.callCount,
  errorToasts: BASE.errorToasts,
  toasts: BASE.toasts,
};

// ---- the scenarios ------------------------------------------------------------------------------------------------------
export function makeCosmosPolishScenarios({ fresh, SNAP_KEYS, RESTORE_KEYS, sleep } = {}) {
  const pause = typeof sleep === 'function' ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const key = async (t, name) => { for (const ev of keyEvents(name)) await t.send('Input.dispatchKeyEvent', ev); };

  async function boot(t) {
    const pre = await fresh(t); if (pre) return pre;
    await t.evaluate(BASE.setCount(null));
    await t.send('Page.bringToFront');
    await pause(200);
    await t.evaluate(BASE.quiet);
    await t.evaluate(BASE.goCosmos);
    if (!await t.waitFor(BASE.libHas(40), 8000)) return ['the 40-element library never arrived in LIVE.cosmos'];
    if (!await t.waitFor(`${BASE.cards} > 0`, 8000)) return ['no card ever rendered (data-cos-card)'];
    await pause(150);
    return null;
  }
  async function leave(t, saved) {
    await t.evaluate(PAGE.reset).catch(() => {});
    await t.evaluate(BASE.cleanup).catch(() => {});
    await t.evaluate(RESTORE_KEYS(saved)).catch(() => {});
  }
  const run = (body) => async (t) => {
    const out = [], saved = await t.evaluate(SNAP_KEYS(['whq3-prefs']));
    try {
      const pre = await boot(t); if (pre) return pre;
      await body(t, out);
    } finally { await leave(t, saved); }
    return out;
  };

  return {
    // Sort and group are <select>s now; choosing an option does what the chip did
    'cosmos-polish-selects': run(async (t, out) => {
      for (const which of ['sort', 'group']) {
        const info = await t.evaluate(PAGE.selectInfo(which));
        if (!info) { out.push('no ' + which + ' <select> (' + SEL[which] + ')'); continue; }
        if (info.tag !== 'select') out.push(which + ' control is a <' + info.tag + '>, want a <select>');
        if (info.options.length < 2) { out.push(which + ' <select> has ' + info.options.length + ' option(s)'); continue; }
        if (info.selected.length !== 1 || info.selected[0] !== info.value) out.push(which + ': the selected option ' + brief(info.selected) + ' is not the value ' + info.value);
        const base = await t.evaluate(PAGE.sortGroupState);
        let orderChanged = false;
        for (const v of info.options.filter((o) => o !== info.value)) {
          await t.evaluate(PAGE.selectSet(which, v));
          await pause(150);
          const now = await t.evaluate(PAGE.sortGroupState);
          if ((which === 'sort' ? now.sort : now.group) !== v) out.push('choosing ' + which + ' "' + v + '" left the state at "' + (which === 'sort' ? now.sort : now.group) + '"');
          if ((which === 'sort' ? now.valsSort : now.valsGroup) !== v) out.push('the ' + which + ' vals value is "' + (which === 'sort' ? now.valsSort : now.valsGroup) + '", want "' + v + '"');
          const after = await t.evaluate(PAGE.selectInfo(which));
          if (!after || after.value !== v || after.selected[0] !== v) out.push('the ' + which + ' <select> does not show "' + v + '" after choosing it');
          if (brief(now.order) !== brief(base.order)) orderChanged = true;
        }
        if (which === 'sort' && !orderChanged) out.push('no sort mode changed the order of the Feed');
        await t.evaluate(PAGE.selectSet(which, info.value));   // back to where it was
        await pause(100);
      }
      const bad = (await t.evaluate(PAGE.errorToasts)) || [];
      if (bad.length) out.push('error toasts: ' + brief(bad));
    }),

    // A missing thumbnail falls back to the original; both missing shows the title and the words, no broken image
    'cosmos-polish-failed-card': run(async (t, out) => {
      const lib = fakeCosmos({ count: 40 });
      const [a, b, spare] = lib.works;
      const dataUri = (spare && (spare.thumbUrl || spare.url)) || '';
      if (!a || !b || !String(dataUri).startsWith('data:')) return out.push('the invented library has no three works with data: pictures to build the missing-file case from');
      a.thumbUrl = MISSING + 'thumb-a.jpg'; a.url = dataUri;                 // thumbnail missing, original fine
      b.thumbUrl = MISSING + 'thumb-b.jpg'; b.url = MISSING + 'orig-b.png';  // both missing
      await t.evaluate(PAGE.setLibrary(lib));
      await t.evaluate(PAGE.reread);
      if (!await t.waitFor(`(() => { const c = WHQ.store.live.cosmos; return !!(c && c.works && c.works[0] && c.works[0].id === ${q(lib.works[0].id)} && String(c.works[0].thumbUrl).startsWith('file:')); })()`, 6000)) return out.push('the library with missing thumbnails never reached LIVE.cosmos');
      await t.waitFor(PAGE.reveal(a.id), 4000); await pause(300); await t.waitFor(PAGE.reveal(b.id), 4000); await pause(300); await t.waitFor(PAGE.reveal(a.id), 4000);
      const ok = await t.waitFor(`(() => { const x = document.querySelector('[data-cos-card][data-id=' + ${q(a.id)} + '] img'); return !!x && String(x.getAttribute('src')).startsWith('data:'); })()`, 6000);
      if (!ok) out.push('card ' + a.id + ' did not fall back from its missing thumbnail to its original: ' + brief(await t.evaluate(PAGE.cardInfo(a.id))));
      if (!await t.waitFor(`(() => { const c = document.querySelector('[data-cos-card][data-id=' + ${q(b.id)} + ']'); return !!c && c.getAttribute('data-failed') === 'true'; })()`, 6000)) return out.push('card ' + b.id + ' never showed its failed state: ' + brief(await t.evaluate(PAGE.cardInfo(b.id))));
      const ci = await t.evaluate(PAGE.cardInfo(b.id));
      if (ci.img) out.push('the failed card still holds an <img> (a broken-image icon)');
      if (!ci.text.includes(FAILED_WORDS)) out.push('the failed card does not say "' + FAILED_WORDS + '": ' + ci.text);
      if (b.title && !ci.text.includes(String(b.title))) out.push('the failed card lost its title "' + b.title + '": ' + ci.text);
      const fine = await t.evaluate(PAGE.cardInfo(a.id));
      if (fine && fine.failed === 'true') out.push('the card with a good original was marked failed');
      const broken = JSON.parse(await t.evaluate(PAGE.broken));
      if (!broken || broken[b.id] !== 'failed') out.push('cosBroken does not record ' + b.id + ' as failed: ' + brief(broken));
      const bad = (await t.evaluate(PAGE.errorToasts)) || [];
      if (bad.length) out.push('error toasts: ' + brief(bad));
    }),

    // The size toggle, and Escape in a title draft
    'cosmos-polish-lightbox': run(async (t, out) => {
      const id = await t.evaluate(BASE.clickFirstCard);
      if (!id) return out.push('no card to open the lightbox on');
      if (!await t.waitFor(`${BASE.lbId} === ${q(id)}`, 4000)) return out.push('the lightbox did not open on ' + id);
      await pause(150);
      let lb = await t.evaluate(PAGE.lbInfo);
      if (lb.button === null) return out.push('no size toggle (' + SEL.lbSize + ') in the lightbox');
      if (lb.button !== 'Actual size' || lb.size !== 'fit') out.push('the lightbox starts as ' + brief([lb.button, lb.size]) + ', want ["Actual size","fit"]');
      await t.evaluate(PAGE.clickSel(SEL.lbSize)); await pause(120);
      lb = await t.evaluate(PAGE.lbInfo);
      if (lb.zoom !== 'actual' || lb.button !== 'Fit' || lb.size !== 'actual') out.push('after the toggle: ' + brief([lb.zoom, lb.button, lb.size]) + ', want ["actual","Fit","actual"]');
      await t.evaluate(PAGE.clickSel(SEL.lbSize)); await pause(120);
      lb = await t.evaluate(PAGE.lbInfo);
      if (lb.zoom !== 'fit' || lb.button !== 'Actual size') out.push('the second toggle did not return to Fit: ' + brief(lb));
      // Escape in the title draft: the draft goes, the lightbox stays; the second Escape closes it
      await t.evaluate(PAGE.openLb(id, { edit: 'title', draft: 'half typed title' })); await pause(150);
      await key(t, 'Escape'); await pause(150);
      lb = await t.evaluate(PAGE.lbInfo);
      if (lb.id !== id) out.push('Escape with a title draft closed the lightbox (id ' + lb.id + ')');
      if (lb.edit !== null || lb.draft !== null) out.push('Escape did not cancel the title draft: ' + brief([lb.edit, lb.draft]));
      await key(t, 'Escape'); await pause(150);
      if ((await t.evaluate(PAGE.lbInfo)).id !== null) out.push('the second Escape did not close the lightbox');
      // a palette over the lightbox closes first and leaves the draft alone
      await t.evaluate(PAGE.openLb(id, { edit: 'title', draft: 'kept draft' })); await pause(120);
      await t.evaluate(PAGE.openPalette); await pause(120);
      await key(t, 'Escape'); await pause(150);
      lb = await t.evaluate(PAGE.lbInfo);
      if (lb.palette) out.push('Escape with the palette over the lightbox did not close the palette');
      if (lb.id !== id || lb.edit !== 'title' || lb.draft !== 'kept draft') out.push('closing the palette disturbed the draft: ' + brief([lb.id, lb.edit, lb.draft]));
      const bad = (await t.evaluate(PAGE.errorToasts)) || [];
      if (bad.length) out.push('error toasts: ' + brief(bad));
    }),

    // Dragging a file over the Feed shows the outline; leaving or dropping clears it
    'cosmos-polish-drag': run(async (t, out) => {
      const FILES = ['Files'], TEXT = ['text/plain'];
      const info = async () => t.evaluate(PAGE.feedInfo);
      let f = await info();
      if (!f) return out.push('no Feed host (' + SEL.feed + ')');
      if (f.drag === 'true') out.push('the Feed starts with the drag outline on');
      const over = await t.evaluate(PAGE.dragEvent('dragover', SEL.feed, FILES));
      if (over !== true) out.push('dragover was not default-prevented');
      await t.evaluate(PAGE.dragEvent('dragenter', SEL.feed, TEXT)); await pause(80);
      if ((await info()).drag === 'true') out.push('a dragged piece of text lit the drop outline');
      await t.evaluate(PAGE.dragEvent('dragenter', SEL.feed, FILES)); await pause(100);
      f = await info();
      if (f.drag !== 'true' || !/dashed/.test(f.outlineStyle)) out.push('a file drag over the Feed shows no dashed outline: ' + brief(f));
      await t.evaluate(PAGE.dragEvent('dragenter', SEL.card, FILES)); await pause(60);   // into a child
      await t.evaluate(PAGE.dragEvent('dragleave', SEL.feed, FILES)); await pause(100);  // out of the host's own edge, still inside the child
      if ((await info()).drag !== 'true') out.push('entering a child element made the outline flicker off');
      await t.evaluate(PAGE.dragEvent('dragleave', SEL.card, FILES)); await pause(100);
      f = await info();
      if (f.drag === 'true') out.push('leaving the Feed left the outline on');
      // a drop clears it, and stays default-prevented
      await t.evaluate(PAGE.dragEvent('dragenter', SEL.feed, FILES)); await pause(80);
      const dropped = await t.evaluate(PAGE.dragEvent('drop', SEL.feed, FILES)); await pause(200);
      if (dropped !== true) out.push('drop was not default-prevented');
      if ((await info()).drag === 'true') out.push('the outline stayed on after a drop');
      const bad = (await t.evaluate(PAGE.errorToasts)) || [];
      if (bad.length) out.push('error toasts: ' + brief(bad));
    }),

    // The index overlay's per-phase rows walk waiting -> running -> done under a fake indexing push
    'cosmos-polish-index-phases': run(async (t, out) => {
      await t.evaluate('hqFake.reset(); true');
      await t.evaluate(PAGE.openIndexOverlay); await pause(150);
      const steps = [['walk', 10, 100], ['thumbs', 40, 100], ['hashes', 70, 100], ['dupes', 5, 9]];
      for (const [phase, done, total] of steps) {
        const heard = await t.evaluate(PAGE.emit({ phase, done, total }));
        if (!(heard >= 1)) { out.push('the ' + phase + ' push reached ' + heard + ' subscriber(s)'); break; }
        await pause(220);
        const rows = await t.evaluate(PAGE.phases);
        const want = phaseRows({ phase, done, total });
        if (rows.length !== want.length) { out.push(phase + ': ' + rows.length + ' phase rows, want ' + want.length); continue; }
        for (let i = 0; i < want.length; i++) {
          if (rows[i].id !== want[i].id || rows[i].state !== want[i].state) out.push(phase + ': row ' + i + ' is ' + rows[i].id + ':' + rows[i].state + ', want ' + want[i].id + ':' + want[i].state);
          if (!rows[i].text.includes(want[i].text)) out.push(phase + ': row ' + want[i].id + ' reads "' + rows[i].text + '", want it to say "' + want[i].text + '"');
        }
      }
      await t.evaluate(PAGE.emit({ phase: 'dupes', done: 9, total: 9, done_all: true, summary: { elements: 40, thumbsFailed: 0, minted: 0 } }));
      await pause(300);
      if ((await t.evaluate(PAGE.phases)).length) out.push('phase rows are still up after the run finished');
    }),

    // The import report shows what the backup seeded, re-keyed and skipped
    'cosmos-polish-report': run(async (t, out) => {
      const base = { clusters: 3, favorites: 25, hidden: 15, overrides: 4, found: 38, missingIds: [], missingCount: 0, conflicts: 0, token: null, note: 'Imported the placeholder backup' };
      const full = { ...base, seeded: 12, rekeyed: 3, skippedCount: 3, skipped: [{ id: 'alpha-site-9001', reason: 'id-known' }, { id: null, reason: 'no-id' }, { id: 'alpha-site-9002', reason: 'bad-path' }], notMatchedCount: 1, notMatched: [{ rel: 'placeholder/a.png', id: 'alpha-site-0001', manifestId: 'alpha-site-9003', reason: 'referenced' }], manifest: 'used' };
      await t.evaluate('hqFake.reset(); true');
      await t.evaluate(PAGE.setAnswer('cosmos.importFromLocal', full));
      await t.evaluate(PAGE.importLocal);
      if (!await t.waitFor(PAGE.repState, 4000)) return out.push('the import never opened the report');
      await pause(200);
      let text = await t.evaluate(PAGE.repText);
      if (text === null) return out.push('no report lines (' + SEL.repLines + ')');
      for (const l of reportExtraLines(full)) if (!text.includes(l.label) || !text.includes(l.value)) out.push('the report lacks "' + l.label + ': ' + l.value + '": ' + text.slice(0, 400));
      for (const w of ['Clusters', 'Favourites']) if (!text.includes(w)) out.push('the report lost its old line "' + w + '"');
      await t.evaluate(PAGE.repClose); await pause(150);
      // nothing skipped: no skipped line at all
      const calm = { ...base, seeded: 5, rekeyed: 0, skippedCount: 0, skipped: [], notMatchedCount: 0, notMatched: [], manifest: 'used' };
      await t.evaluate(PAGE.setAnswer('cosmos.importFromLocal', calm));
      await t.evaluate(PAGE.importLocal);
      if (!await t.waitFor(PAGE.repState, 4000)) return out.push('the second import never opened the report');
      await pause(200);
      text = await t.evaluate(PAGE.repText);
      if (/Skipped from the manifest/.test(text || '')) out.push('a report with skippedCount 0 still shows a skipped line');
      if (!/Matched to old ids/.test(text || '')) out.push('the second report lacks "Matched to old ids"');
      const bad = (await t.evaluate(PAGE.errorToasts)) || [];
      if (bad.length) out.push('error toasts: ' + brief(bad));
    }),
  };
}

export { COUNT_KEY };
