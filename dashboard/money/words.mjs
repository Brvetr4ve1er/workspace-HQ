// money space — what a Claude session may know about Money: WORDS and counts, never amounts. Pure.
//   node --test dashboard/money/words.test.mjs
//
//   words(view, { generatedAt? }) → {
//       enabled: true, setUp: boolean,
//       room: 'ok' | 'tight' | 'unknown', roomWhy: 'needs a DA rate' | 'needs a payday day' | null,
//       daysToPayday: number | null, billsLate: n, billsDueSoon: n, slipsWaiting: n, generatedAt? }
//
// `view` is the finished money view (./view.mjs buildView). The answer is built key by key from five fields of it:
// hasAccounts, settings.hasFx, settings.payday, room.tight, daysToPayday, obligations[].isLate / isSoon, slips.length.
// Nothing else is read, so no amount, account, payee, note, bill name or jar can reach the answer, and dueBefore (a
// formatted amount) is never touched. It is a forecast, never a verdict.
//
//  - Not set up (no account yet): setUp:false and NO other claim: room 'unknown' with no reason, and null for the
//    day count and the three counts (0 would claim "no late bills", which nobody has checked).
//  - 'unknown' beats 'ok' and 'tight' whenever the DA rate or the payday day is missing (the rate first, matching the
//    Today view's "set your DA rate" state). The view still reports a payday (end of month) without a payday day, so the
//    day count is only given when the owner set a payday day.
export const ROOM_WHY = Object.freeze({ fx: 'needs a DA rate', payday: 'needs a payday day' });

const count = (xs, flag) => (Array.isArray(xs) ? xs.reduce((n, o) => (o && o[flag] === true ? n + 1 : n), 0) : 0);

export function words(view, opts = {}) {
  const v = view && typeof view === 'object' ? view : {};
  const settings = v.settings && typeof v.settings === 'object' ? v.settings : {};
  const out = { enabled: true, setUp: v.hasAccounts === true };
  if (!out.setUp) {
    Object.assign(out, { room: 'unknown', roomWhy: null, daysToPayday: null, billsLate: null, billsDueSoon: null, slipsWaiting: null });
  } else {
    const hasPayday = typeof settings.payday === 'string' && settings.payday.trim() !== '';
    let room, why = null;
    if (settings.hasFx !== true) { room = 'unknown'; why = ROOM_WHY.fx; }
    else if (!hasPayday) { room = 'unknown'; why = ROOM_WHY.payday; }
    else room = v.room && v.room.tight === true ? 'tight' : 'ok';
    const d = v.daysToPayday;
    Object.assign(out, {
      room, roomWhy: why,
      daysToPayday: hasPayday && Number.isInteger(d) && d >= 0 ? d : null,
      billsLate: count(v.obligations, 'isLate'),
      billsDueSoon: count(v.obligations, 'isSoon'),
      slipsWaiting: Array.isArray(v.slips) ? v.slips.length : 0,
    });
  }
  if (opts.generatedAt) out.generatedAt = String(opts.generatedAt);
  return out;
}
