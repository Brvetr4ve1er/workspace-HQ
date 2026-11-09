// Cosmos actions (space "cosmos", key 0: the owner's local pictures and videos). Component.prototype mixin (src/app.js):
// same `this` as the class methods; methods are cos-prefixed. Follows Money (logic/money.js) file for file.
//
//  - Main owns the data (dashboard/cosmos.js). The renderer sends INTENTS (favorite, hide, tags, title, import-replace),
//    never an entity, an id of its own making or a path for a read or a delete: trash and reveal send element ids, a
//    drop sends the absolute paths webUtils.getPathForFile gave (hq.cosmos.pathForFile), nothing else.
//  - One write path: cosApply. S.cosBusy is the double-submit guard; a refused write releases it and toasts main's real
//    error; success toasts only what main answered.
//  - The library is read ON ARRIVAL (cosArrive), never at boot, and not at all while another tab is open.
//  - The Feed's result set is computed in ONE place (cosFeed, memoised on LIVE.cosmos._memo); the vals and the lightbox's
//    stepping (cosOrder) both ask it, so the arrow keys follow exactly what the Feed shows.
//  - Keys (cosKey) act ONLY while the lightbox is open. With it closed app.js onKey behaves exactly as before.
//  - Writes are NOT gated on the time machine: the library is live data, not a scan.
import { FX, loadPrefs, savePrefs } from './shared.js';
import { FEED_PAGE, buildFeed, feedKey, createFeedMemo } from './cosmos-view.mjs';
import { effectiveWorks, isFlagged, parseTags, SORT_MODES } from './cosmos-search.mjs';
import { GROUP_MODES } from './cosmos-group.mjs';
import { DENSITIES } from './cosmos-layout.mjs';

export const COS_OFFLINE = 'Cosmos needs the desktop app';
export const COS_PAGE_STEP = 240;
export const COS_WIDTH = 1040;
const IMPORTS = 'imports:';

/** Paging: 0 means every card (FEED_PAGE is Infinity until the Pass decides); a finite FEED_PAGE starts at that many. */
export const cosInitialShown = () => (Number.isFinite(FEED_PAGE) ? FEED_PAGE : 0);

/** Local day string ('2026-11-08'): the shuffle's seed and the memo key's day. The caller may inject a Date. */
export function cosToday(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);

/**
 * The cos* component state, ready to spread into initState: `...cosInitState(P, saved)` with P = loadPrefs() and saved = the
 * parsed sessionStorage 'whq3-place'. Sort, group and density come back from the prefs; the query and the open element's id
 * from the place (an id whose element is gone is dropped by cosArrive once the library has been read).
 */
export function cosInitState(P = {}, saved = {}) {
  const p = P && typeof P === 'object' ? P : {}, s = saved && typeof saved === 'object' ? saved : {};
  return {
    cosQuery: typeof s.cosQuery === 'string' ? s.cosQuery : '',
    cosSort: pick(SORT_MODES, p.cosSort, 'newest'),
    cosGroup: pick(GROUP_MODES, p.cosGroup, 'none'),
    cosDensity: pick(DENSITIES, p.cosDensity, 'cozy'),
    cosFav: false,
    cosShowHidden: false,
    cosShown: cosInitialShown(),
    cosWidth: COS_WIDTH,
    cosLb: typeof s.cosLb === 'string' && s.cosLb ? { id: s.cosLb, edit: null, trashAsk: false } : null,
    cosIdx: false,
    cosReportOpen: false,
    cosReplaceAsk: false,
    cosBusy: false,
    cosFolder: '',
  };
}

/** Every state key the Cosmos mixin sets (the gates assert against it; a test pins it to cosInitState). */
export const COS_STATE_KEYS = Object.freeze(Object.keys(cosInitState()));

/** What belongs in the saved prefs (survives a restart) and in the place (survives a reload). */
export const cosPrefsOf = (S) => ({ cosSort: S.cosSort, cosGroup: S.cosGroup, cosDensity: S.cosDensity });
export const cosPlaceOf = (S) => ({ cosQuery: typeof S.cosQuery === 'string' ? S.cosQuery : '', cosLb: S.cosLb && S.cosLb.id ? S.cosLb.id : null });

const hasKey = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/**
 * The Feed for the current state, memoised on the slice. null while the library has not arrived (works null).
 * `S` is component state, `C` is LIVE.cosmos.
 */
export function cosFeed(S, C, today) {
  if (!C || !Array.isArray(C.works)) return null;
  const memo = C._memo || (C._memo = createFeedMemo());
  const shown = S.cosShown > 0 ? S.cosShown : Infinity;
  const width = S.cosWidth > 0 ? S.cosWidth : COS_WIDTH;
  const day = today || cosToday();
  const key = feedKey({ width, sort: S.cosSort, group: S.cosGroup, density: S.cosDensity, query: S.cosQuery, favOnly: S.cosFav, showHidden: S.cosShowHidden, shown, revision: C.revision, today: day });
  return memo.get(key, () => buildFeed({
    works: C.works, curation: C.curation, query: S.cosQuery, sort: S.cosSort, group: S.cosGroup, density: S.cosDensity,
    favOnly: S.cosFav, showHidden: S.cosShowHidden, width, shown, today: day,
  }));
}

const byIdCache = new WeakMap();   // works array -> Map(id -> work)
/** The effective work (the owner's title/tag overrides applied) for an id, or null. Looks at the WHOLE library, not just the Feed. */
export function cosWork(C, id) {
  if (!C || !Array.isArray(C.works) || typeof id !== 'string') return null;
  let m = byIdCache.get(C.works);
  if (!m) { m = new Map(); for (const w of C.works) m.set(w.id, w); byIdCache.set(C.works, m); }
  const w = m.get(id);
  return w ? effectiveWorks([w], C.curation)[0] : null;
}

/** Only files the app itself copied in (rel 'imports:<name>') may be moved to the Recycle Bin from here; main refuses the rest. */
export const cosCanTrash = (w) => !!w && typeof w.rel === 'string' && w.rel.startsWith(IMPORTS);

const idOf = (self, id) => (typeof id === 'string' && id ? id : (self.state.cosLb && self.state.cosLb.id) || '');
const lbPatch = (s, patch) => ({ cosLb: s.cosLb ? { ...s.cosLb, ...patch } : s.cosLb });

export const cosmosLogic = {
  // ---- arrival ---------------------------------------------------------------------------------------
  // One read per arrival (the caller: app.js componentDidUpdate's moved branch and componentDidMount for a restored tab).
  // Marks the surface used (a no-op where hq.use is absent). Resolves main's answer; never throws.
  async cosArrive() {
    if (typeof this.useMark === 'function') { try { this.useMark('cosmos', 'open'); } catch { /* a usage mark is a bonus */ } }
    const st = this.store;
    if (!st || typeof st.refreshCosmos !== 'function') return { error: COS_OFFLINE };
    let r;
    try { r = await st.refreshCosmos(false); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    // a lightbox restored from the last session whose element is gone does not stay open on nothing
    const lb = this.state.cosLb, C = this.LIVE && this.LIVE.cosmos;
    if (lb && C && Array.isArray(C.works) && !cosWork(C, lb.id)) this.setState({ cosLb: null });
    return r;
  },

  // ---- search, sort, group, density, filters -----------------------------------------------------------
  cosSearch(text) { this.setState({ cosQuery: String(text == null ? '' : text), cosShown: cosInitialShown() }); },
  cosClear() { this.setState({ cosQuery: '', cosShown: cosInitialShown() }); },
  cosPersist() { try { savePrefs(Object.assign(loadPrefs(), cosPrefsOf(this.state))); } catch { /* prefs are a convenience */ } },
  cosSetSort(v) { if (!SORT_MODES.includes(v)) return; this.setState({ cosSort: v, cosShown: cosInitialShown() }); this.cosPersist(); FX().sfx('tab'); },
  cosSetGroup(v) { if (!GROUP_MODES.includes(v)) return; this.setState({ cosGroup: v, cosShown: cosInitialShown() }); this.cosPersist(); FX().sfx('tab'); },
  cosSetDensity(v) { if (!DENSITIES.includes(v)) return; this.setState({ cosDensity: v, cosShown: cosInitialShown() }); this.cosPersist(); FX().sfx('tab'); },
  cosToggleFav() { this.setState((s) => ({ cosFav: !s.cosFav, cosShown: cosInitialShown() })); },
  cosToggleHidden() { this.setState((s) => ({ cosShowHidden: !s.cosShowHidden, cosShown: cosInitialShown() })); },
  cosMore() { this.setState((s) => (s.cosShown > 0 ? { cosShown: s.cosShown + COS_PAGE_STEP } : null)); },

  // The Feed grid's width comes from the grid host itself (a callback ref), never from the document in vals.
  // The ref function is stable so the runtime does not detach/attach it on every render.
  cosGridRef() {
    return this._cosRef || (this._cosRef = (el) => this.cosMeasure(el));
  },
  cosMeasure(el) {
    if (this._cosObs) { try { this._cosObs.disconnect(); } catch { /* gone */ } this._cosObs = null; }
    if (!el) return;
    const read = () => {
      const w = Math.round((el.clientWidth || (el.getBoundingClientRect && el.getBoundingClientRect().width)) || 0);
      if (w > 0 && w !== this.state.cosWidth) this.setState({ cosWidth: w });
    };
    read();
    if (typeof ResizeObserver !== 'undefined') { try { this._cosObs = new ResizeObserver(read); this._cosObs.observe(el); } catch { this._cosObs = null; } }
  },

  // ---- the lightbox --------------------------------------------------------------------------------------
  // The order the arrows follow: every result the Feed holds (not just the cards shown so far).
  cosOrder() {
    const f = cosFeed(this.state, this.LIVE && this.LIVE.cosmos, cosToday());
    return f ? f.ids : [];
  },
  cosOpen(id) {
    if (typeof id !== 'string' || !id) return;
    this.setState({ cosLb: { id, edit: null, trashAsk: false } });
    FX().sfx('open');
  },
  cosClose() { if (this.state.cosLb) this.setState({ cosLb: null }); },
  // next / previous result; disabled at the ends (no wrap). Resolves true when it moved.
  cosStep(delta) {
    const lb = this.state.cosLb;
    if (!lb || !delta) return false;
    const order = this.cosOrder(), at = order.indexOf(lb.id), to = at + delta;
    if (at < 0 || to < 0 || to >= order.length) return false;
    this.setState({ cosLb: { id: order[to], edit: null, trashAsk: false } });
    return true;
  },
  cosFocusSearch() {
    try {
      const el = typeof document !== 'undefined' && document.querySelector ? document.querySelector("[data-cos='search']") : null;
      if (el && el.focus) { el.focus(); if (el.select) el.select(); }
    } catch { /* focus is a convenience */ }
  },
  // true when the key was handled (app.js onKey then stops). Acts ONLY while the lightbox is open; app.js has already
  // returned for typing, the palette and every dialog above the lightbox.
  cosKey(e) {
    if (!this.state.cosLb || !e || e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case 'ArrowLeft': this.cosStep(-1); return true;
      case 'ArrowRight': this.cosStep(1); return true;
      case 'f': case 'F': this.cosFavorite(); return true;   // the open element's star, never focus mode
      case '/': this.cosClose(); this.cosFocusSearch(); return true;   // the search box, never the palette
      case 'Escape': this.cosClose(); return true;
      default: return false;
    }
  },

  // ---- the one write path ---------------------------------------------------------------------------------
  // Resolves true when main saved it, false otherwise (already toasted).
  async cosApply(intent, after) {
    const m = this.hq && this.hq.cosmos;
    if (!m || !this.store || typeof this.store.applyCosmos !== 'function') { this.denied(COS_OFFLINE); return false; }
    if (this.state.cosBusy) { this.toast('info', 'Still saving the last one — try again in a moment'); return false; }   // never a silent drop
    this.setState({ cosBusy: true });
    let r;
    try { r = await this.store.applyCosmos(intent); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (!r || r.error) {
      this.setState({ cosBusy: false });
      this.toast('error', (r && r.error) || 'That didn’t save');
      FX().sfx('error');
      return false;
    }
    this.setState((s) => { const n = { cosBusy: false }; if (after) Object.assign(n, after(s)); return n; });
    if (r.note) this.toast('success', r.note);
    FX().sfx('done');
    return true;
  },

  async cosFavorite(id) {
    const eid = idOf(this, id), C = this.LIVE && this.LIVE.cosmos;
    if (!eid) return false;
    const on = !isFlagged(C && C.curation && C.curation.favorites, eid);
    return this.cosApply({ type: 'favorite', id: eid, on });
  },
  async cosHide(id) {
    const eid = idOf(this, id), C = this.LIVE && this.LIVE.cosmos;
    if (!eid) return false;
    const on = !isFlagged(C && C.curation && C.curation.hidden, eid);
    const order = this.cosOrder(), at = order.indexOf(eid), lb = this.state.cosLb;
    const ok = await this.cosApply({ type: 'hide', id: eid, on });
    // a hidden element leaves the Feed (unless hidden ones are shown): the lightbox moves on instead of staying on a ghost
    if (ok && on && !this.state.cosShowHidden && lb && lb.id === eid) {
      const next = order[at + 1] || order[at - 1];
      this.setState({ cosLb: next && next !== eid ? { id: next, edit: null, trashAsk: false } : null });
    }
    return ok;
  },
  async cosReveal(id) {
    const eid = idOf(this, id);
    if (!eid) return false;
    const st = this.store;
    if (!st || typeof st.revealCosmos !== 'function' || !(this.hq && this.hq.cosmos)) { this.denied(COS_OFFLINE); return false; }
    let r;
    try { r = await st.revealCosmos(eid); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (r === true) return true;
    this.toast('error', (r && (r.message || r.error)) || 'Could not show that file');
    return false;
  },

  // title and tags: the draft lives inside cosLb (only while editing) so a half-typed edit dies with the lightbox
  cosTitleEdit() {
    const lb = this.state.cosLb, w = lb && cosWork(this.LIVE && this.LIVE.cosmos, lb.id);
    if (!lb || !w) return;
    this.setState((s) => lbPatch(s, { edit: 'title', draft: w.title == null ? '' : String(w.title) }));
  },
  cosTitleDraft(text) { this.setState((s) => (s.cosLb && s.cosLb.edit === 'title' ? lbPatch(s, { draft: String(text == null ? '' : text) }) : null)); },
  cosTitleCancel() { this.setState((s) => (s.cosLb ? { cosLb: { id: s.cosLb.id, edit: null, trashAsk: !!s.cosLb.trashAsk } } : null)); },
  async cosTitleSave(text) {
    const lb = this.state.cosLb;
    if (!lb) return false;
    const raw = text !== undefined && typeof text !== 'object' ? String(text) : String(lb.draft == null ? '' : lb.draft);
    const t = raw.trim(), w = cosWork(this.LIVE && this.LIVE.cosmos, lb.id);
    if (w && t === String(w.title == null ? '' : w.title)) { this.cosTitleCancel(); return true; }   // nothing changed: nothing to send
    return this.cosApply({ type: 'title', id: lb.id, title: t === '' ? null : t }, (s) => ({ cosLb: s.cosLb && s.cosLb.id === lb.id ? { id: lb.id, edit: null, trashAsk: !!s.cosLb.trashAsk } : s.cosLb }));
  },
  cosTagDraft(text) { this.setState((s) => (s.cosLb ? lbPatch(s, { tagDraft: String(text == null ? '' : text) }) : null)); },
  async cosTagAdd(text) {
    const lb = this.state.cosLb;
    if (!lb) return false;
    const raw = text !== undefined && typeof text !== 'object' ? String(text) : String(lb.tagDraft == null ? '' : lb.tagDraft);
    const add = parseTags(raw);
    if (add.length === 0) return false;
    return this.cosApply({ type: 'tags', id: lb.id, add }, (s) => {
      if (!s.cosLb || s.cosLb.id !== lb.id) return null;
      const rest = { ...s.cosLb };
      delete rest.tagDraft;
      return { cosLb: rest };
    });
  },
  async cosTagRemove(tag) {
    const lb = this.state.cosLb;
    if (!lb || typeof tag !== 'string' || !tag) return false;
    return this.cosApply({ type: 'tags', id: lb.id, remove: [tag] });
  },

  // ---- move to the Recycle Bin: arm, then confirm; ids only, never a path ---------------------------------------
  cosTrashAsk() {
    const lb = this.state.cosLb, w = lb && cosWork(this.LIVE && this.LIVE.cosmos, lb.id);
    if (!lb || !cosCanTrash(w)) return;
    this.setState((s) => lbPatch(s, { trashAsk: true }));
  },
  cosTrashNo() { this.setState((s) => (s.cosLb ? lbPatch(s, { trashAsk: false }) : null)); },
  async cosTrashYes() {
    const lb = this.state.cosLb;
    if (!lb || !lb.trashAsk) return false;   // the first click only arms
    const C = this.LIVE && this.LIVE.cosmos, w = cosWork(C, lb.id);
    if (!cosCanTrash(w)) { this.setState((s) => lbPatch(s, { trashAsk: false })); return false; }
    if (!this.hq || !this.hq.cosmos || !this.store || typeof this.store.trashCosmos !== 'function') { this.denied(COS_OFFLINE); return false; }
    if (this.state.cosBusy) { this.toast('info', 'Still working on the last one — try again in a moment'); return false; }
    this.setState({ cosBusy: true });
    const order = this.cosOrder(), at = order.indexOf(lb.id);
    let r;
    try { r = await this.store.trashCosmos([lb.id]); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    const trashed = r && Array.isArray(r.trashed) ? r.trashed : [], failed = r && Array.isArray(r.failed) ? r.failed : [];
    const done = trashed.includes(lb.id);
    // the element left the library only if main said so; otherwise it stays, with main's own words
    for (const f of failed.slice(0, 3)) this.toast('error', (f && f.message) || 'Could not move it to the Recycle Bin');
    if (!r || r.error || (!done && failed.length === 0)) this.toast('error', (r && r.error) || 'Could not move it to the Recycle Bin');
    if (done) {
      this.toast('success', 'Moved to the Recycle Bin.');
      FX().sfx('done');
      const next = order[at + 1] || order[at - 1];
      this.setState({ cosBusy: false, cosLb: next && next !== lb.id ? { id: next, edit: null, trashAsk: false } : null });
      return true;
    }
    FX().sfx('error');
    this.setState((s) => ({ cosBusy: false, ...lbPatch(s, { trashAsk: false }) }));
    return false;
  },

  // ---- index a folder ----------------------------------------------------------------------------------------
  cosIndexOpen() {
    const C = this.LIVE && this.LIVE.cosmos;
    this.setState({ cosIdx: true, cosFolder: (C && C.config && typeof C.config.root === 'string' && C.config.root) || '' });
    FX().sfx('open');
  },
  cosIndexClose() { this.setState({ cosIdx: false }); },
  async cosPick() {
    const st = this.store;
    if (!this.hq || !this.hq.cosmos || !st || typeof st.pickCosmosFolder !== 'function') { this.denied(COS_OFFLINE); return null; }
    const p = await st.pickCosmosFolder();
    if (typeof p === 'string' && p) { this.setState({ cosFolder: p }); return p; }
    if (p && p.error) this.toast('error', p.error);   // null = the owner cancelled the dialog: nothing to say
    return null;
  },
  async cosIndexStart() {
    const C = this.LIVE && this.LIVE.cosmos;
    if (!this.hq || !this.hq.cosmos || !this.store || typeof this.store.indexCosmos !== 'function') { this.denied(COS_OFFLINE); return false; }
    if (this.state.cosBusy) { this.toast('info', 'Still working on the last one — try again in a moment'); return false; }
    if (!this.state.cosFolder && !(C && C.config && C.config.root)) { this.toast('error', 'Choose a folder first'); return false; }
    this.setState({ cosBusy: true });
    let r;
    try { r = await this.store.indexCosmos(); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (r === true) {
      this.setState({ cosBusy: false, cosIdx: false });
      FX().sfx('done');
      return true;
    }
    this.setState({ cosBusy: false });
    this.toast('error', (r && (r.message || r.error)) || 'Could not start the index');
    FX().sfx('error');
    return false;
  },
  async cosIndexCancel() {
    const st = this.store;
    if (!st || typeof st.cancelCosmosIndex !== 'function' || !(this.hq && this.hq.cosmos)) { this.denied(COS_OFFLINE); return false; }
    await st.cancelCosmosIndex();
    return true;
  },

  // ---- bring the old gallery's curation over ---------------------------------------------------------------------
  async cosImportLocal() {
    if (!this.hq || !this.hq.cosmos || !this.store || typeof this.store.importCosmosLocal !== 'function') { this.denied(COS_OFFLINE); return false; }
    if (this.state.cosBusy) { this.toast('info', 'Still working on the last one — try again in a moment'); return false; }
    this.setState({ cosBusy: true });
    let r;
    try { r = await this.store.importCosmosLocal(); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    this.setState({ cosBusy: false });
    if (r && r.ok === false) {
      if (r.reason !== 'canceled') { this.toast('error', r.message || 'Could not import'); FX().sfx('error'); }   // cancelling the file dialog is not a failure
      return false;
    }
    if (!r || r.error) { this.toast('error', (r && r.error) || 'Could not import'); FX().sfx('error'); return false; }
    this.setState({ cosReportOpen: true, cosReplaceAsk: false });
    FX().sfx('done');
    return true;
  },
  cosReportClose() { this.setState({ cosReportOpen: false, cosReplaceAsk: false }); },
  // Replace: main kept the owner's version where the backup differed; replacing needs two deliberate clicks
  cosReplaceAsk() {
    const rep = this.LIVE && this.LIVE.cosmos && this.LIVE.cosmos.report;
    if (!rep || !rep.token) return;
    this.setState({ cosReplaceAsk: true });
  },
  cosReplaceNo() { this.setState({ cosReplaceAsk: false }); },
  async cosReplaceYes() {
    const rep = this.LIVE && this.LIVE.cosmos && this.LIVE.cosmos.report;
    if (!this.state.cosReplaceAsk || !rep || !rep.token) return false;
    return this.cosApply({ type: 'import-replace', token: rep.token }, () => ({ cosReplaceAsk: false }));
  },

  // ---- drop files onto the Feed --------------------------------------------------------------------------------------
  // The renderer cannot read a dropped file's path itself (Electron 32 has no File.path): the preload's pathForFile does,
  // one File at a time. Main copies; this toasts only what main answered.
  async cosDrop(files) {
    const m = this.hq && this.hq.cosmos;
    if (!m || typeof m.importFiles !== 'function' || !this.store || typeof this.store.importCosmosFiles !== 'function') { this.denied(COS_OFFLINE); return false; }
    if (typeof m.pathForFile !== 'function') { this.toast('error', 'This window cannot read the paths of dropped files'); return false; }
    const paths = [];
    for (const f of Array.from(files || [])) {
      let p = '';
      try { p = m.pathForFile(f); } catch { p = ''; }
      if (typeof p === 'string' && p !== '') paths.push(p);
    }
    if (paths.length === 0) { this.toast('info', 'Nothing was added: those items are not files'); return false; }
    let r;
    try { r = await this.store.importCosmosFiles(paths); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (!r || r.error) { this.toast('error', (r && r.error) || 'Could not add those files'); FX().sfx('error'); return false; }
    const skipped = Array.isArray(r.skipped) ? r.skipped : [];
    const n = Number(r.imported) || 0;
    if (n > 0) this.toast('success', 'Added ' + n + (n === 1 ? ' file' : ' files') + (skipped.length ? ' · ' + skipped.length + ' skipped' : ''));
    if (skipped.length) this.toast(n > 0 ? 'info' : 'error', (skipped[0] && skipped[0].reason) || 'Some files were skipped');
    if (n > 0) FX().sfx('done');
    return n > 0;
  },
};
