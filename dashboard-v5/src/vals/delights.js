// Small delights render values (batch 7, dish small-delights): ONE top-level renderVals key, dlxv (the 1015-key ceiling; see vals/brief-history.js).
// Three surfaces, all behind the Console layer's master switch (consoleLayer.on) - with the layer off every value here is the frozen OFF object:
//   dlxSeason*   the 28 px seasonal ornament beside the Home greeting (logic/seasons.mjs; static, no animation, no switch of its own)
//   dlxAttract*  the idle attract slot on the empty Brief: a zero-size ANCHOR while the card is eligible (so the controller can check it is on screen),
//                the SVG scene only while it plays; nothing is read from the owner's data
//   dlxRoom*     the hidden back room overlay (opened from the Memory card's empty slot or the typed code 'backroom'; Escape closes it)
// The controller (logic/delights.mjs) is told what this render knows through this.dlxSync (deferred: never state or layer work while rendering).
import { seasonFor, seasonLabel, monthName, artLists } from '../logic/seasons.mjs';
import { ATTRACT_LOOP_MS, ATTRACT_MAX_LOOPS, ROOM_TITLE, ROOM_NOTE, reducedNow } from '../logic/delights.mjs';

const EMPTY = Object.freeze([]);
const BOX = '0 0 32 32';

// The back room's blank cartridges: two shelves, three each. Pure geometry in the room's 320 x 200 box.
export const ROOM_CARTRIDGES = Object.freeze([
  [34, 62], [96, 62], [158, 62], [34, 118], [96, 118], [158, 118],
].map(([x, y], n) => Object.freeze({ key: 'c' + n, x, y, w: 46, h: 40, labelX: x + 8, labelY: y + 8, labelW: 30, labelH: 16, notchX: x + 14, notchY: y + 32, notchW: 18 })));

const OFF = Object.freeze({
  dlxLayerOn: false,
  dlxSeasonOn: false, dlxSeasonName: '', dlxSeasonTitle: '', dlxSeasonLabel: '', dlxSeasonBox: BOX,
  dlxSeasonCircles: EMPTY, dlxSeasonRects: EMPTY, dlxSeasonLines: EMPTY, dlxSeasonPolys: EMPTY, dlxSeasonPaths: EMPTY,
  dlxAttractSlot: false, dlxAttractRun: false, dlxAttractStyle: '',
  dlxRoomOpen: false, dlxRoomTitle: ROOM_TITLE, dlxRoomNote: ROOM_NOTE, dlxRoomCartridges: ROOM_CARTRIDGES,
  dlxRoomClose: null, dlxRoomRef: null, dlxRoomStop: null,
});

/** Is the empty-Brief card showing? Parity with vals/brief.js brfEmpty (ready, no items, no overflow count, no source error). Exported for the test. */
export function briefEmptyNow(LIVE, canBrief) {
  const B = (LIVE && LIVE.brief) || {};
  if (!canBrief || B.error || !B.loaded) return false;
  const brief = B.brief && typeof B.brief === 'object' ? B.brief : null;
  const items = brief && Array.isArray(brief.items) ? brief.items : [];
  const errors = brief && Array.isArray(brief.errors) ? brief.errors : [];
  const more = brief ? Number(brief.more) || 0 : 0;
  return items.length === 0 && more === 0 && errors.length === 0;
}

export function delightsVals(ctx) { return { dlxv: delightsGroup.call(this, ctx) }; }

function delightsGroup(ctx) {
  const { S, LIVE, live } = ctx;
  const layerOn = !!(S.consoleLayer && S.consoleLayer.on === true);
  const onHome = S.tab === 'home' && !S.route;
  const allClear = layerOn && onHome && !!live && briefEmptyNow(LIVE, !!(this.hq && this.hq.brief));
  if (typeof this.dlxSync === 'function') this.dlxSync({ layerOn, allClearVisible: allClear });   // deferred inside; also closes the room and disarms when the layer is off
  if (!layerOn) return OFF;

  const win = typeof window !== 'undefined' ? window : null;
  const motion = !reducedNow(S, win);
  const run = allClear && motion && !!S.dlxRun;
  const loops = Number.isInteger(S.dlxLoops) && S.dlxLoops >= 1 && S.dlxLoops <= ATTRACT_MAX_LOOPS ? S.dlxLoops : ATTRACT_MAX_LOOPS;

  const entry = onHome ? seasonFor(typeof this.dlxNowDate === 'function' ? this.dlxNowDate() : new Date()) : null;
  const art = entry ? artLists(entry.art) : null;

  const close = this._dlxCloseFn || (this._dlxCloseFn = () => this.dlxCloseRoom());
  const stop = this._dlxStopFn || (this._dlxStopFn = (e) => { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); });
  const ref = this._dlxRefFn || (this._dlxRefFn = (el) => { if (el && typeof el.focus === 'function') el.focus(); });

  return {
    dlxLayerOn: true,
    dlxSeasonOn: !!entry, dlxSeasonName: entry ? entry.name : '',
    dlxSeasonTitle: entry ? entry.name + ' · ' + monthName(entry.month) : '', dlxSeasonLabel: entry ? seasonLabel(entry) : '', dlxSeasonBox: art ? '0 0 ' + art.box + ' ' + art.box : BOX,
    dlxSeasonCircles: art ? art.circles : EMPTY, dlxSeasonRects: art ? art.rects : EMPTY, dlxSeasonLines: art ? art.lines : EMPTY,
    dlxSeasonPolys: art ? art.polys : EMPTY, dlxSeasonPaths: art ? art.paths : EMPTY,
    dlxAttractSlot: allClear && motion, dlxAttractRun: run,
    dlxAttractStyle: run ? '--dlx-loop:' + ATTRACT_LOOP_MS / 1000 + 's;--dlx-loops:' + loops : '',
    dlxRoomOpen: !!S.dlxRoom, dlxRoomTitle: ROOM_TITLE, dlxRoomNote: ROOM_NOTE, dlxRoomCartridges: ROOM_CARTRIDGES,
    dlxRoomClose: close, dlxRoomRef: ref, dlxRoomStop: stop,
  };
}
