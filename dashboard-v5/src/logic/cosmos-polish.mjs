/* Cosmos polish (batch 5): the pure helpers behind the Feed's rough edges on a real-size library.
   PURE: no DOM, no timers of its own, no state. The one stateful helper (createFailureBatcher) takes its timer functions
   as arguments, so a plain Node test drives it without a clock.

     select models       sortSelect / groupSelect / selectModel   chip rows -> one <select> with the selected value
     failed pictures     nextBrokenLevel, applyFailures, cardImage, createFailureBatcher
     lightbox            lbSizeModel, lbFailedModel, escapeAction
     drag highlight      dragStep, isFileDrag
     index phases        phaseRows  (one row per engine phase, from the single {phase, done, total} push)
     import report       reportExtraLines  (only the numbers main actually sent)

   Everything here answers in plain words and never invents a number: a field that is absent adds no line. */

// ---- sort / group as a <select> -----------------------------------------------------------------------------------------
/** { value, options:[{ value, label, selected }], sel: { [mode]: boolean }, onChange }. `sel` exists because the HTML parser drops an <sc-for> inside a <select>: the template writes its <option>s out once (from the same modes) and binds each one's `selected` to sel.<mode>. onChange takes an event (event.target.value) or a bare value; a value that is not one of `modes` is ignored. */
export function selectModel(modes, labels, current, pick) {
  const list = Array.isArray(modes) ? modes : [];
  const names = labels && typeof labels === 'object' ? labels : {};
  const value = list.includes(current) ? current : (list[0] === undefined ? '' : list[0]);
  return {
    value,
    options: list.map((m) => ({ value: m, label: names[m] == null ? String(m) : String(names[m]), selected: m === value })),
    sel: Object.fromEntries(list.map((m) => [m, m === value])),
    onChange: (e) => {
      const v = e && typeof e === 'object' && e.target ? e.target.value : e;
      if (typeof pick === 'function' && list.includes(v)) pick(v);
    },
  };
}
export const sortSelect = selectModel;
export const groupSelect = selectModel;

// ---- a picture that will not load ---------------------------------------------------------------------------------------
export const FAILED_TEXT = 'could not load';
/** broken level of one card: undefined = fine, 'thumb' = the thumbnail failed (the original is showing), 'failed' = nothing loads. */
const hasImageOriginal = (w) => !!(w && w.url && !w.video && w.url !== w.thumbUrl);

/** What an error event on the card's <img> means for its level. The thumbnail is swapped for the original first (never for a video: it cannot be an <img>). */
export function nextBrokenLevel(work, level) {
  if (level === 'failed') return 'failed';
  if (level === 'thumb') return 'failed';
  return work && work.thumbUrl && hasImageOriginal(work) ? 'thumb' : 'failed';
}

/** A new broken map with the ids' next levels applied, or `prev` itself (same identity: no re-render) when nothing moved. lookup(id) -> work | null; an id the library does not hold is dropped. */
export function applyFailures(prev, ids, lookup) {
  const base = prev && typeof prev === 'object' ? prev : {};
  let next = null;
  const seen = new Set();
  for (const id of ids || []) {
    if (seen.has(id)) continue;   // one batch moves an id one step, however many times its <img> fired
    seen.add(id);
    const w = typeof lookup === 'function' ? lookup(id) : null;
    if (!w) continue;
    const cur = base[id];
    const to = nextBrokenLevel(w, cur);
    if (to === cur) continue;
    if (!next) next = { ...base };
    next[id] = to;
  }
  return next || prev || base;
}

/** The <img> a card draws at `level`: { src, hasSrc, thumbFailed, failed, failedText }. A failed card has no <img> at all: it shows its title and the words. */
export function cardImage(work, level) {
  const w = work || {};
  const thumb = w.thumbUrl || '';
  const orig = hasImageOriginal(w) ? w.url : '';
  if (level === 'failed') return { src: '', hasSrc: false, thumbFailed: !!thumb, failed: true, failedText: FAILED_TEXT };
  if (level === 'thumb') {
    if (orig) return { src: orig, hasSrc: true, thumbFailed: true, failed: false, failedText: '' };
    return { src: '', hasSrc: false, thumbFailed: true, failed: true, failedText: FAILED_TEXT };
  }
  const src = thumb || w.url || '';
  return { src, hasSrc: !!src, thumbFailed: false, failed: false, failedText: '' };
}

/** Batches failure reports so a missing drive does not trigger 1,000 re-renders.
    report(id) adds to a pending set and arms ONE timer; when it fires (or flushNow() is called) onFlush(ids[]) runs once.
    clear() drops pending ids and the timer (library switch; the batcher stays usable). dispose() is permanent (unmount):
    nothing reported or flushed afterwards reaches onFlush. Timer functions are injected (default: the global ones). */
export function createFailureBatcher({ onFlush, delayMs = 100, setTimer, clearTimer } = {}) {
  const set = setTimer || ((fn, ms) => setTimeout(fn, ms));
  const unset = clearTimer || ((h) => clearTimeout(h));
  const pending = new Set();
  let handle = null, dead = false, flushes = 0;
  const stop = () => { if (handle !== null) { unset(handle); handle = null; } };
  function flushNow() {
    stop();
    if (dead || pending.size === 0) return 0;
    const ids = [...pending];
    pending.clear();
    flushes += 1;
    if (typeof onFlush === 'function') onFlush(ids);
    return ids.length;
  }
  return {
    report(id) {
      if (dead || id == null || id === '') return;
      pending.add(String(id));
      if (handle === null) handle = set(() => { handle = null; flushNow(); }, delayMs);
    },
    flushNow,
    clear() { stop(); pending.clear(); },
    dispose() { dead = true; stop(); pending.clear(); },
    get size() { return pending.size; },
    get armed() { return handle !== null; },
    get flushes() { return flushes; },
    get disposed() { return dead; },
  };
}

// ---- the lightbox: size toggle and a failed original --------------------------------------------------------------------
/** { mode: 'fit' | 'actual', label, pressed, toggle }. The label names what pressing does: 'Actual size' while fitting, 'Fit' while at actual size. toggle(setMode) calls setMode with the other mode. */
export function lbSizeModel(zoom, setMode) {
  const mode = zoom === 'actual' ? 'actual' : 'fit';
  const other = mode === 'fit' ? 'actual' : 'fit';
  return { mode, label: mode === 'fit' ? 'Actual size' : 'Fit', pressed: mode === 'actual' ? 'true' : 'false', toggle: () => { if (typeof setMode === 'function') setMode(other); } };
}
export const LB_FAILED_TEXT = 'Could not open the original';
/** { lbFailed, lbFailedText }: shown over the thumbnail underlay (or alone when there is none). */
export function lbFailedModel(failed, hasThumb) {
  return { lbFailed: !!failed, lbFailedText: failed ? LB_FAILED_TEXT + (hasThumb ? ': showing the thumbnail' : '') : '' };
}

// ---- Escape in a title / tag field ---------------------------------------------------------------------------------------
/** Every flag that puts something ABOVE the lightbox in app.js closeTop(): while any is set Escape closes that, not the draft. */
export const ABOVE_LIGHTBOX = Object.freeze(['levelUp', 'sheet', 'commit', 'confirm', 'onboard', 'vault', 'whatsNewOpen', 'cosReportOpen', 'cosIdx', 'cheatOpen', 'settingsOpen', 'paletteOpen']);
/** true while the lightbox holds a half-finished title or tag. */
export function lbDraftOpen(lb) {
  if (!lb || typeof lb !== 'object') return false;
  return lb.edit === 'title' || lb.edit === 'tags' || (typeof lb.tagDraft === 'string' && lb.tagDraft !== '');
}
/** { handled, patch }. handled is true ONLY when the lightbox is the topmost overlay and a draft is open; the patch cancels the draft and keeps the lightbox (and its open Recycle Bin question). Anything else: handled false, patch null, closeTop runs as before. */
export function escapeAction(S) {
  const st = S && typeof S === 'object' ? S : {};
  const lb = st.cosLb;
  if (!lb || typeof lb !== 'object') return { handled: false, patch: null };
  for (const k of ABOVE_LIGHTBOX) if (st[k]) return { handled: false, patch: null };
  if (!lbDraftOpen(lb)) return { handled: false, patch: null };
  const { draft, tagDraft, ...rest } = lb;
  void draft; void tagDraft;
  return { handled: true, patch: { cosLb: { ...rest, edit: null, trashAsk: !!lb.trashAsk } } };
}

// ---- drag highlight ------------------------------------------------------------------------------------------------------
/** true when the drag carries files (dataTransfer.types holds 'Files'); a dragged piece of page text never lights the drop host. */
export function isFileDrag(dt) {
  const t = dt && dt.types;
  if (!t) return false;
  if (typeof t.contains === 'function') { try { if (t.contains('Files')) return true; } catch { /* fall through */ } }
  try { return Array.from(t).includes('Files'); } catch { return false; }
}
/** The enter/leave counter, so a child element's own enter and leave do not flicker the outline.
    kind: 'enter' | 'leave' | 'drop' | 'reset'. Returns { count, on }. enter counts only a file drag; leave never goes below 0; drop and reset zero it. */
export function dragStep(count, kind, dt) {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  let next = n;
  if (kind === 'enter') next = isFileDrag(dt) ? n + 1 : n;
  else if (kind === 'leave') next = Math.max(0, n - 1);
  else if (kind === 'drop' || kind === 'reset') next = 0;
  return { count: next, on: next > 0 };
}

// ---- the index overlay: one row per phase --------------------------------------------------------------------------------
/** The engine's order (dashboard/cosmos/indexer.mjs: walk -> thumbs -> hashes -> dupes, each with a first and a last event). */
export const PHASE_ORDER = Object.freeze(['walk', 'thumbs', 'hashes', 'dupes']);
export const PHASE_LABELS = Object.freeze({ walk: 'Reading the folder', thumbs: 'Thumbnails', hashes: 'File hashes', dupes: 'Duplicates' });
const fmtInt = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** [{ id, label, state: 'done' | 'running' | 'waiting', text }]. No run (null) or a phase the engine does not have: no rows, so the caller falls back to its one progress string.
    Earlier phases are done, the current one reads 'N / total' (or 'N' with no total, 'starting' at zero), later ones wait. */
export function phaseRows(indexing) {
  if (!indexing || typeof indexing !== 'object') return [];
  const at = PHASE_ORDER.indexOf(indexing.phase);
  if (at < 0) return [];
  const total = Number(indexing.total) || 0, done = Number(indexing.done) || 0;
  return PHASE_ORDER.map((id, i) => {
    const state = i < at ? 'done' : i === at ? 'running' : 'waiting';
    const text = state === 'done' ? 'done' : state === 'waiting' ? 'waiting' : total > 0 ? fmtInt(done) + ' / ' + fmtInt(total) : done > 0 ? fmtInt(done) : 'starting';
    return { id, label: PHASE_LABELS[id], state, text };
  });
}

// ---- the import report: what the backup seeded, re-keyed and skipped ------------------------------------------------------
const SKIP_WORDS = Object.freeze({
  'bad-path': 'its path is not a real folder path',
  'no-id': 'it has no id',
  'no-path': 'it has no file path',
  'path-known': 'that file already has an id here',
  'id-known': 'that id is already used here',
});
const NOT_MATCHED_WORDS = Object.freeze({
  referenced: 'the file keeps the id your curation already points at',
  'id-in-use': 'the old id is already taken by another file',
});
const MANIFEST_WORDS = Object.freeze({
  used: 'Used',
  skipped: 'None chosen: no ids were taken over',
  unreadable: 'Could not be read: no ids were taken over',
});
const present = (n) => typeof n === 'number' && Number.isFinite(n);
const plural = (n, one, many) => fmtInt(n) + ' ' + (n === 1 ? one : many);

/** The skip reasons in plain words, first `limit` distinct ones (3 by default), each with its count among the listed entries. */
export function skipReasonWords(skipped, limit = 3) {
  const list = Array.isArray(skipped) ? skipped : [];
  const counts = new Map();
  for (const s of list) {
    const r = s && typeof s.reason === 'string' ? s.reason : '';
    if (!r) continue;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  return [...counts.entries()].slice(0, Math.max(0, limit)).map(([r, n]) => (SKIP_WORDS[r] || 'another reason') + (n > 1 ? ' (' + fmtInt(n) + ')' : ''));
}

/** Extra { label, value } rows for the import report, appended after the existing six. Only lines whose numbers are present; a zero skip count adds no skipped line.
    Lines: 'Matched to old ids' (seeded), 'Re-keyed to the old ids' (rekeyed), 'Skipped from the manifest' (skippedCount, with the first few reasons in words),
    'Not matched' (notMatchedCount, with the reasons), 'Manifest' (its state in words). */
export function reportExtraLines(report) {
  const r = report && typeof report === 'object' ? report : null;
  if (!r) return [];
  const out = [];
  if (present(r.seeded)) out.push({ label: 'Matched to old ids', value: fmtInt(r.seeded) });
  if (present(r.rekeyed)) out.push({ label: 'Re-keyed to the old ids', value: fmtInt(r.rekeyed) });
  const skippedN = present(r.skippedCount) ? r.skippedCount : Array.isArray(r.skipped) && r.skipped.length > 0 ? r.skipped.length : null;
  if (skippedN !== null && skippedN > 0) {
    const why = skipReasonWords(r.skipped);
    out.push({ label: 'Skipped from the manifest', value: plural(skippedN, 'entry', 'entries') + (why.length ? ': ' + why.join('; ') : '') });
  }
  const nmN = present(r.notMatchedCount) ? r.notMatchedCount : Array.isArray(r.notMatched) && r.notMatched.length > 0 ? r.notMatched.length : null;
  if (nmN !== null && nmN > 0) {
    const seen = [];
    for (const n of Array.isArray(r.notMatched) ? r.notMatched : []) {
      const w = n && NOT_MATCHED_WORDS[n.reason];
      if (w && !seen.includes(w)) seen.push(w);
      if (seen.length >= 2) break;
    }
    out.push({ label: 'Not matched', value: plural(nmN, 'file', 'files') + (seen.length ? ': ' + seen.join('; ') : '') });
  }
  if (typeof r.manifest === 'string' && MANIFEST_WORDS[r.manifest]) out.push({ label: 'Manifest', value: MANIFEST_WORDS[r.manifest] });
  return out;
}
