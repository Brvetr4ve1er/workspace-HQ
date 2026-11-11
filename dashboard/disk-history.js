// disk history — main side. The ONE writer of <dataDir>/disk-history.json (gitignored, pinned in tools/gitignore-owner-data.test.mjs):
//   { v:1, rows:[ { day:"YYYY-MM-DD", at:<ISO of the snapshot>, partial:boolean, items:[ { label, gb } ] } ] }
// "What filled the disk": the collector's data/pc-health-disk.json is a latest snapshot overwritten at most every 6 hours and holds
// no history. This keeps ONE copy per local day so System › Machine can say which folder grew. It reads only pc-health-disk.json,
// writes only disk-history.json, labels and GB only — never a path.
//
//   create({ dataDir, now?, fsMod?, maxDays? }) → { tick, file, source }
//     tick() → { wrote:true, day, rows } | { wrote:false, reason }      never throws
//       reasons: 'no-source' (pc-health-disk.json absent: nothing is written, not even an empty file) · 'source-too-big' ·
//                'source-unreadable' · 'source-shape' · 'unchanged' · 'newer-version' · 'store-too-big' · 'error'
//   init({ dataDir, now?, fsMod?, timers?, sixHoursMs? }) → { tick, stop, file }   ticks once at startup (soon, off the boot path), every 6 h,
//     and shortly after pc-health-disk.json changes (a debounced directory watch). Nothing else reads or writes.
//   readStoreFile(fsMod, file, { quarantine }) → { rows, state }   state: 'ok'|'absent'|'corrupt'|'too-big'|'newer'
//   diskLines(rows, opts?) → { lines:[{ label, deltaGB, days }], note }   pure — what grew between two COMPLETE readings
//
// Rules (tests pin each):
//  - one row per local day; the same day's row is replaced by a later snapshot, but never by an OLDER snapshot and never has a complete
//    row replaced by a partial one (a partial reading is a worse reading of the same day); at most 120 days kept.
//  - a folder label that looks like a path is cut to its last segment; a folder with no label, or a label that repeats inside one
//    snapshot, is left out and the row is marked partial (it could not be compared honestly).
//  - a delta is computed only from folders measured in BOTH readings and only when both readings are complete (partial:false);
//    otherwise the answer is a note in words ("needs two days of readings"), never a guess.
//  - writes are tmp + rename; a corrupt store is MOVED ASIDE (disk-history.json.corrupt, -2, -3 …), never emptied in place;
//    a store written by a newer version (v > 1) is left alone and not overwritten.
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const FILE = 'disk-history.json';
const SOURCE = 'pc-health-disk.json';
const MAX_DAYS = 120;
const MAX_ITEMS = 60;
const SOURCE_MAX_BYTES = 1024 * 1024;
const STORE_MAX_BYTES = 2 * 1024 * 1024;
const SIX_HOURS = 6 * 3600e3;
const DEBOUNCE_MS = 1500;
const STARTUP_MS = 5000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROW_MIN_GB = 0.1;
const LINES_MAX = 5;
const TARGET_DAYS = 7;

// ---------------------------------------------------------------------------------------------------------------- pure
const pad = (n) => String(n).padStart(2, '0');
/** The LOCAL calendar day of an instant: "2026-11-11". */
function dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const dayNum = (day) => { const m = DAY_RE.test(day) ? day.split('-').map(Number) : null; return m ? Date.UTC(m[0], m[1] - 1, m[2]) / 86400000 : NaN; };

/** A label that is only a folder's name: a path is cut to its last segment; a bare drive or empty text is '' (not usable). */
function cleanLabel(label) {
  if (typeof label !== 'string') return '';
  let s = label.replace(/[\u0000-\u001f]/g, '').trim();
  if (/[\\/]/.test(s)) s = s.split(/[\\/]+/).filter(Boolean).pop() || '';
  if (/^[A-Za-z]:$/.test(s)) return '';
  return s.slice(0, 80).trim();
}
const cleanGB = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 100) / 100 : null);

/** One snapshot of pc-health-disk.json → a row, or null when it is not a snapshot. Labels and GB only. */
function rowFromSnapshot(snap, nowMs) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap) || !Array.isArray(snap.items)) return null;
  const t = typeof snap.at === 'string' ? Date.parse(snap.at) : NaN;
  const atMs = Number.isFinite(t) ? t : nowMs;
  const seen = new Set(), dupes = new Set(), items = [];
  let left = 0;
  for (const it of snap.items) {
    const label = it && typeof it === 'object' ? cleanLabel(it.label) : '';
    const gb = it && typeof it === 'object' ? cleanGB(it.gb) : null;
    if (!label || gb === null) { left++; continue; }
    if (seen.has(label)) { dupes.add(label); continue; }
    seen.add(label);
    items.push({ label, gb });
  }
  const kept = items.filter((i) => !dupes.has(i.label)).slice(0, MAX_ITEMS);
  left += items.length - kept.length;
  return { day: dayKey(atMs), at: new Date(atMs).toISOString(), partial: snap.partial === true || left > 0, items: kept };
}

/** A stored row made safe (a hand-edited file never smuggles a path or junk through). null when it has no valid day. */
function cleanStoredRow(r) {
  if (!r || typeof r !== 'object' || typeof r.day !== 'string' || !DAY_RE.test(r.day) || !Array.isArray(r.items)) return null;
  const seen = new Set(), items = [];
  for (const it of r.items) {
    const label = it && typeof it === 'object' ? cleanLabel(it.label) : '', gb = it && typeof it === 'object' ? cleanGB(it.gb) : null;
    if (!label || gb === null || seen.has(label)) continue;
    seen.add(label); items.push({ label, gb });
  }
  return { day: r.day, at: typeof r.at === 'string' ? r.at : '', partial: r.partial === true || items.length !== r.items.length, items: items.slice(0, MAX_ITEMS) };
}

/** rows + one new row → { rows, changed }. See the rules in the header. */
function mergeRow(rows, row, maxDays = MAX_DAYS) {
  const list = rows.slice();
  const i = list.findIndex((r) => r.day === row.day);
  if (i < 0) list.push(row);
  else {
    const cur = list[i];
    const older = Date.parse(row.at) < Date.parse(cur.at);
    if (older || (!cur.partial && row.partial)) return { rows, changed: false };
    list[i] = row;
  }
  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const next = list.slice(-Math.max(1, maxDays));
  return { rows: next, changed: JSON.stringify(next) !== JSON.stringify(rows) };
}

/**
 * What grew: the newest COMPLETE reading against the complete reading nearest TARGET_DAYS earlier (at least one day earlier).
 * @returns {{ lines: {label:string, deltaGB:number, days:number}[], note: string }}
 *   lines  folders measured in both that grew by GROW_MIN_GB or more, biggest first, at most LINES_MAX; `days` is the real gap between the two readings
 *   note   '' when there are lines; otherwise why not, in words
 */
function diskLines(rows, opts = {}) {
  const target = Number.isFinite(opts.days) && opts.days > 0 ? opts.days : TARGET_DAYS;
  const all = (Array.isArray(rows) ? rows : []).map(cleanStoredRow).filter(Boolean).sort((a, b) => (a.day < b.day ? -1 : 1));
  const complete = all.filter((r) => !r.partial);
  const needTwo = 'needs two days of readings';
  if (complete.length < 2) {
    if (all.some((r) => r.partial)) return { lines: [], note: 'the readings so far are partial (some folders could not be measured), so nothing is compared yet · ' + needTwo };
    return { lines: [], note: needTwo };
  }
  const cur = complete[complete.length - 1];
  const earlier = complete.slice(0, -1).map((r) => ({ r, d: dayNum(cur.day) - dayNum(r.day) })).filter((x) => x.d >= 1);
  if (!earlier.length) return { lines: [], note: needTwo };
  earlier.sort((a, b) => Math.abs(a.d - target) - Math.abs(b.d - target) || a.d - b.d);
  const { r: prev, d: days } = earlier[0];
  const before = new Map(prev.items.map((i) => [i.label, i.gb]));
  const lines = [];
  for (const it of cur.items) {
    if (!before.has(it.label)) continue;
    const deltaGB = Math.round((it.gb - before.get(it.label)) * 100) / 100;
    if (deltaGB >= GROW_MIN_GB) lines.push({ label: it.label, deltaGB, days });
  }
  lines.sort((a, b) => b.deltaGB - a.deltaGB || (a.label < b.label ? -1 : 1));
  if (!lines.length) return { lines: [], note: 'no folder grew by ' + GROW_MIN_GB + ' GB or more in ' + days + (days === 1 ? ' day' : ' days') };
  return { lines: lines.slice(0, LINES_MAX), note: '' };
}

// ------------------------------------------------------------------------------------------------------------------ IO
/** Read the store without writing. quarantine:true moves a corrupt file aside (only this module's writer ever asks for it). */
function readStoreFile(fsMod, file, { quarantine = false } = {}) {
  let size;
  try { size = fsMod.statSync(file).size; } catch (e) { return { rows: [], state: e && e.code === 'ENOENT' ? 'absent' : 'corrupt' }; }
  if (size > STORE_MAX_BYTES) return { rows: [], state: 'too-big' };
  let v;
  try {
    const raw = fsMod.readFileSync(file, 'utf8');
    v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.rows)) throw new Error('not a disk-history object');
    if (typeof v.v === 'number' && v.v > VERSION) return { rows: [], state: 'newer' };
    if (v.v !== VERSION) throw new Error('unknown version');
  } catch (e) {
    if (quarantine) {
      let to = file + '.corrupt';
      for (let i = 2; fsMod.existsSync(to) && i < 1000; i++) to = file + '.corrupt-' + i;
      try { fsMod.renameSync(file, to); } catch { /* best effort: a read never throws */ }
      console.error('[disk-history] corrupt disk-history.json moved aside to ' + path.basename(to) + ' — ' + e.message);
    }
    return { rows: [], state: 'corrupt' };
  }
  return { rows: v.rows.map(cleanStoredRow).filter(Boolean).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)), state: 'ok' };
}

function create({ dataDir, now = () => Date.now(), fsMod = fs, maxDays = MAX_DAYS } = {}) {
  const file = path.join(dataDir, FILE), source = path.join(dataDir, SOURCE);
  const nowMs = () => { const n = now(); return n instanceof Date ? n.getTime() : n; };

  function readSource() {
    let size;
    try { size = fsMod.statSync(source).size; } catch (e) { return { reason: e && e.code === 'ENOENT' ? 'no-source' : 'source-unreadable' }; }
    if (size > SOURCE_MAX_BYTES) return { reason: 'source-too-big' };
    try { return { snap: JSON.parse(fsMod.readFileSync(source, 'utf8')) }; } catch { return { reason: 'source-unreadable' }; }
  }

  function tick() {
    try {
      const s = readSource();
      if (!s.snap) return { wrote: false, reason: s.reason };
      const row = rowFromSnapshot(s.snap, nowMs());
      if (!row) return { wrote: false, reason: 'source-shape' };
      const store = readStoreFile(fsMod, file, { quarantine: true });
      if (store.state === 'newer' || store.state === 'too-big') return { wrote: false, reason: store.state === 'newer' ? 'newer-version' : 'store-too-big' };
      const merged = mergeRow(store.rows, row, maxDays);
      if (!merged.changed && store.state === 'ok') return { wrote: false, reason: 'unchanged' };
      fsMod.mkdirSync(dataDir, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      try {
        fsMod.writeFileSync(tmp, JSON.stringify({ v: VERSION, rows: merged.rows }, null, 1));
        fsMod.renameSync(tmp, file);
      } catch (e) { try { fsMod.unlinkSync(tmp); } catch { /* nothing to clean */ } throw e; }
      return { wrote: true, day: row.day, rows: merged.rows.length };
    } catch (e) { return { wrote: false, reason: 'error', error: (e && e.message) || String(e) }; }
  }

  return { tick, file, source };
}

function init({ dataDir, now, fsMod = fs, timers = {}, sixHoursMs = SIX_HOURS } = {}) {
  const d = create({ dataDir, now, fsMod });
  const T = {
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
    setInterval: timers.setInterval || setInterval, clearInterval: timers.clearInterval || clearInterval,
  };
  const quiet = (h) => { try { if (h && typeof h.unref === 'function') h.unref(); } catch { /* a timer handle without unref */ } return h; };
  let pending = null, watcher = null, every = null, startup = null, stopped = false;
  const run = () => { if (!stopped) d.tick(); };
  startup = quiet(T.setTimeout(run, STARTUP_MS));
  every = quiet(T.setInterval(run, sixHoursMs));
  try {
    watcher = fsMod.watch(dataDir, { persistent: false }, (_ev, name) => {
      if (stopped || String(name || '') !== SOURCE) return;
      if (pending) T.clearTimeout(pending);
      pending = quiet(T.setTimeout(() => { pending = null; run(); }, DEBOUNCE_MS));
    });
    if (watcher && typeof watcher.on === 'function') watcher.on('error', () => { /* the 6-hourly tick still runs */ });
  } catch { watcher = null; }
  function stop() {
    stopped = true;
    for (const [h, c] of [[startup, T.clearTimeout], [pending, T.clearTimeout], [every, T.clearInterval]]) { try { if (h) c(h); } catch { /* already gone */ } }
    try { if (watcher && typeof watcher.close === 'function') watcher.close(); } catch { /* already closed */ }
  }
  return { tick: d.tick, stop, file: d.file };
}

module.exports = {
  create, init, readStoreFile, diskLines, mergeRow, rowFromSnapshot, cleanLabel, cleanStoredRow, dayKey,
  VERSION, FILE, SOURCE, MAX_DAYS, MAX_ITEMS, SOURCE_MAX_BYTES, STORE_MAX_BYTES, SIX_HOURS, DEBOUNCE_MS, STARTUP_MS,
};
