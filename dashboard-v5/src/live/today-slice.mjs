// Today ribbon — the live slice (LIVE.today) and the one function that moves it. Pure ESM: IO is injected, so plain Node tests drive it with
// a fake window.hq.today. The store (live/store.js) builds one with createTodaySlice and spreads the result into its API; its live init
// object gets `today: emptyToday()`.
//
// Main owns the data (dashboard/day-ribbon.js, hq:today:read). This file only holds the last answers:
//   days      { [dayOffset 0..6]: { model, at } }  the last GOOD answer for each day stepped to (null = never answered)
//   errors    { [dayOffset]: message }             main's own words for the last failed read of that day
//   loaded    some answer (good or not) has arrived       revision  bumped when a model lands (render memo key)
// A failed read never blanks a model already on screen: it keeps the previous copy and records the message. There is no push channel:
// the ribbon is read once per arrival on Home, on a step to another day, and every 10 minutes while Home is open (logic/today.js).
//
// refreshToday(dayOffset = 0) feature-detects hq.today.read: with it absent it resolves { error: OFFLINE } and nothing throws.
export const OFFLINE = 'The day ribbon needs the desktop app';
export const MAX_OFFSET = 6;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const msg = (e) => String((e && e.message) || e || 'unknown problem').slice(0, 300);

/** A fresh LIVE.today. */
export function emptyToday() { return { loaded: false, days: {}, errors: {}, revision: 0 }; }

/** A model main gave, or null when it is not usable: arrays where arrays belong, a caption, a day. Nothing is invented. */
export function takeModel(r) {
  if (!isObj(r) || r.ok !== true || typeof r.day !== 'string') return null;
  if (!Array.isArray(r.lanes) || !Array.isArray(r.spans) || !Array.isArray(r.ticks)) return null;
  return {
    ...r,
    caption: typeof r.caption === 'string' ? r.caption : '',
    notes: Array.isArray(r.notes) ? r.notes.filter((n) => typeof n === 'string') : [],
    counts: isObj(r.counts) ? r.counts : {},
  };
}

/**
 * @param {{hq:object|null, live:object, emit:()=>void, pull?:(p:any, fn:(r:any)=>any)=>Promise<any>, now?:()=>number}} deps
 *   pull is the store's pull (a read that records failures and emits); without it a plain promise chain is used.
 */
export function createTodaySlice({ hq, live, emit, pull, now = Date.now } = {}) {
  const fire = typeof emit === 'function' ? emit : () => {};
  const T = () => (live.today || (live.today = emptyToday()));
  const has = () => !!(hq && hq.today && typeof hq.today.read === 'function');
  const seq = {};   // per day: only the newest answer lands
  const inflight = {};

  function take(offset, r) {
    const t = T();
    t.loaded = true;
    const m = takeModel(r);
    if (m) {
      t.days[offset] = { model: m, at: now() };
      delete t.errors[offset];
      t.revision += 1;
    } else {
      t.errors[offset] = isObj(r) && typeof r.error === 'string' && r.error ? r.error.slice(0, 300) : 'The day ribbon gave no usable answer';
    }
    return r;
  }

  /** Read one day from main. Concurrent asks for the same day share one read; the newest answer is the one that lands. */
  function refreshToday(dayOffset = 0, { force = false } = {}) {
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > MAX_OFFSET) return Promise.resolve({ error: 'dayOffset must be a whole number from 0 to 6' });
    if (!has()) return Promise.resolve({ error: OFFLINE });
    if (inflight[dayOffset] && !force) return inflight[dayOffset];
    const my = (seq[dayOffset] = (seq[dayOffset] || 0) + 1);
    const ask = () => { try { return Promise.resolve(hq.today.read({ dayOffset })).catch((e) => ({ error: msg(e) })); } catch (e) { return Promise.resolve({ error: msg(e) }); } };
    const land = (r) => { if (my === seq[dayOffset]) take(dayOffset, r); return r; };
    const p = Promise.resolve(typeof pull === 'function' ? pull(ask, land) : ask().then(land).finally(fire))
      .finally(() => { if (inflight[dayOffset] === p) delete inflight[dayOffset]; });
    inflight[dayOffset] = p;
    return p;
  }

  return { refreshToday };
}
