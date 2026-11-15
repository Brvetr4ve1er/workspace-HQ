// Settings > Memory card: render values. Every value is mcd-prefixed and nested under ONE top-level key, mcdv (the renderVals key ceiling).
// Numbers arrive finished from main (dashboard/memory-card.js -> hq:memory:read, held by logic/memory-card.js in state.mcd); this module only
// words them: a size, a file count and an age per kind, a bar scaled to the largest kind, and the chat-index snapshot's age. Nothing is a name.
//
// Honest states: Console layer off (frozen constant: nothing is read) · no bridge (one sentence, nothing else) · loading · read failed (nothing
// held) · ready (and, when a refresh failed, the last answer with the reason). A kind main could not look at says "could not look", never a zero;
// a kind cut off by a cap says "at least"; ages are measured from the moment of the read (the answer's own `at`), so nothing ticks and nothing animates.
// The only control is Refresh (a read). There is no forget, delete, clear or export anywhere in this section.
import { MCD_OFFLINE, MCD_TITLE, MCD_NOTE, MCD_COULD_NOT, mcdLayerOn } from '../logic/memory-card.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** '0 B', '1.5 KB', '12 MB', '4.7 GB' - the same words as dashboard/memory-card-core.mjs (a test pins both). */
export function humanBytes(n) {
  if (!isNum(n)) return MCD_COULD_NOT;
  let v = n, i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; }
  if (i === 0) return Math.round(v) + ' B';
  let r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  if (r >= 1024 && i < UNITS.length - 1) { r = Math.round((v / 1024) * 10) / 10; i += 1; }
  return String(r) + ' ' + UNITS[i];
}

/** 'just now', '20 min ago', '3 h ago', '5 d ago'; 'unknown' with no time. */
export function humanAge(thenMs, nowMs) {
  if (!isNum(thenMs) || !isNum(nowMs)) return 'unknown';
  const s = Math.floor((nowMs - thenMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}

export const BAR_W = 140;            // the track's width in the block's own units (the SVG scales)
export const EMPTY_SLOT_TEXT = 'Empty slot';
export const SNAPSHOT_LABEL = 'Chat-index snapshots';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const filesWord = (s) => (s.partial ? s.files + '+ files' : s.files === 1 ? '1 file' : s.files + ' files');

const OFF = Object.freeze({
  mcdShow: false, mcdOffline: false, mcdOfflineText: MCD_OFFLINE, mcdHasBody: false, mcdTitle: MCD_TITLE, mcdSummary: '',
  mcdRefresh: () => false, mcdRefreshOff: true, mcdRefreshLabel: 'Refresh', mcdRefreshAria: 'Refresh the memory card',
  mcdLoading: false, mcdLoadingText: '', mcdHasErr: false, mcdErrText: '', mcdReady: false, mcdBlocks: [], mcdCapped: false, mcdCappedText: '',
  mcdEmptySlotText: EMPTY_SLOT_TEXT, mcdNote: MCD_NOTE,
  mcdEmptyOpen: () => false,   // small delights: the Empty slot is a door to the back room (live group only)
});

/** One kind of data as a block: big line (size), small line (files and age), the bar, and the sentence a screen reader gets. */
export function slotBlock(s, atMs, maxBytes) {
  const unknown = s.files === null || s.bytes === null;
  const base = { kind: s.kind, label: s.label, hasBar: true, fillW: 0, fillPct: 0, bigFill: 'var(--text)', barFill: s.partial ? 'var(--orange)' : 'var(--gold)' };
  if (unknown) return { ...base, big: MCD_COULD_NOT, small: '', bigFill: 'var(--muted)', twin: s.label + ': ' + MCD_COULD_NOT + '.' };
  const size = (s.partial ? 'at least ' : '') + humanBytes(s.bytes);
  const frac = maxBytes > 0 ? Math.min(1, s.bytes / maxBytes) : 0;
  const fill = { fillW: Math.round(frac * BAR_W * 100) / 100, fillPct: Math.round(frac * 100) };
  if (s.files === 0) {
    const small = s.partial ? 'not fully looked into' : 'empty';
    return { ...base, ...fill, big: size, small, twin: s.label + ': ' + small + '.' };
  }
  const age = s.newestMs === null ? '' : humanAge(s.newestMs, atMs);
  const small = filesWord(s) + (age ? ' · ' + age : '');
  const pre = s.partial ? 'at least ' : '';
  const twin = s.label + ': ' + pre + (s.files === 1 && !s.partial ? '1 file' : s.files + ' files') + ', ' + pre + humanBytes(s.bytes) + (age ? ', newest write ' + age : '') + (s.partial ? ' (not everything was looked into)' : '') + '.';
  return { ...base, ...fill, big: size, small, twin };
}

/** The extra slot: how fresh the daily chat-index snapshot is, and how many are kept. No bar: kept is a count of days, not a size. */
export function snapshotBlock(sn, atMs) {
  const base = { kind: 'snapshot', label: SNAPSHOT_LABEL, hasBar: false, fillW: 0, fillPct: 0, bigFill: 'var(--text)', barFill: 'var(--gold)' };
  if (!sn || sn.ok === false) return { ...base, big: MCD_COULD_NOT, small: '', bigFill: 'var(--muted)', twin: SNAPSHOT_LABEL + ': ' + MCD_COULD_NOT + '.' };
  const max = isNum(sn.max) && sn.max > 0 ? sn.max : 7;
  if (!isNum(sn.kept) || sn.kept === 0) return { ...base, big: 'none yet', small: '0 of ' + max + ' kept', bigFill: 'var(--muted)', twin: SNAPSHOT_LABEL + ': none yet.' };
  const age = sn.newestMs === null ? 'unknown' : humanAge(sn.newestMs, atMs);
  return { ...base, big: age, small: sn.kept + ' of ' + max + ' kept', twin: SNAPSHOT_LABEL + ': newest ' + age + ', ' + sn.kept + ' of ' + max + ' kept.' };
}

export function buildBlocks(slots, snapshot, atMs) {
  const known = slots.filter((s) => s.files !== null && s.bytes !== null);
  const maxBytes = known.reduce((m, s) => (s.bytes > m ? s.bytes : m), 0);
  return slots.map((s) => slotBlock(s, atMs, maxBytes)).concat([snapshotBlock(snapshot, atMs)]);
}

function memoryFlat(ctx) {
  const S = (ctx && ctx.S) || this.state || {};
  const show = !!S.settingsOpen && mcdLayerOn(S);
  if (!show) { if (typeof this.mcdRearm === 'function') this.mcdRearm(); return OFF; }   // layer off or Settings closed: nothing is read, nothing is built
  const can = typeof this.mcdCan === 'function' ? this.mcdCan() : !!(this.hq && this.hq.memory && typeof this.hq.memory.read === 'function');
  if (!can) return { ...OFF, mcdShow: true, mcdOffline: true };
  if (typeof this.mcdEnsure === 'function') this.mcdEnsure();

  const D = S.mcd || {};
  const held = Array.isArray(D.slots) ? D.slots : null;
  const err = D.error || '';
  const busy = !!D.busy;
  let blocks = [];
  if (held) {
    const memo = this._mcdMemo;
    if (memo && memo.slots === held && memo.snapshot === D.snapshot && memo.at === D.at) blocks = memo.blocks;
    else {
      blocks = buildBlocks(held, D.snapshot || null, D.at === undefined ? null : D.at);
      this._mcdMemo = { slots: held, snapshot: D.snapshot, at: D.at, blocks };
    }
  }
  const capped = !!held && D.capped === true;
  const at = typeof D.at === 'number' && Number.isFinite(D.at) ? D.at : null;
  return {
    ...OFF,
    mcdShow: true, mcdHasBody: true,
    mcdSummary: held ? held.length + (held.length === 1 ? ' kind' : ' kinds') + (at !== null ? ' · read ' + hhmm(at) : '') : '',
    mcdEmptyOpen: () => (typeof this.dlxOpenRoom === 'function' ? this.dlxOpenRoom() : false),
    mcdRefresh: () => this.mcdLoad(), mcdRefreshOff: busy, mcdRefreshLabel: busy ? 'Reading…' : 'Refresh',
    mcdLoading: !held && !err, mcdLoadingText: 'Looking at what the app keeps…',
    mcdHasErr: !!err, mcdErrText: held ? 'Couldn’t refresh the memory card · ' + err + ' · the last answer stays on screen' : 'Couldn’t look at what the app keeps · ' + err,
    mcdReady: !!held, mcdBlocks: blocks,
    mcdCapped: capped, mcdCappedText: 'This folder is large, so some kinds are “at least” figures: part of it was not looked into.',
  };
}

/** ONE top-level key (mcdv): renderVals sits near V8's property limit, so a new surface nests; the template reads {{ mcdv.mcdShow }} etc. */
export function memoryCardVals(ctx) {
  return { mcdv: memoryFlat.call(this, ctx) };
}
