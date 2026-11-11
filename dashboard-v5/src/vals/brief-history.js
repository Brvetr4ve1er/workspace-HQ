// Brief history render values (dish brief-history, batch 3). Keys are bhs-prefixed: one shared namespace with every other surface.
// Three surfaces, all fed by one answer main gives (dashboard/brief-ledger.js → hq:brief-history:read):
//   bhsOp*    the Operator section at the top of History > Timeline (one row per closed entry and per still-open fact, last 14 days)
//   bhsFoot*  the "N cleared this week · M dismissed" footer line of the Brief panel on Home
//   bhsCard*  the one-time all-clear card on the Brief panel (shown only while the panel itself is empty; the ack is the only write)
// Honest states: no bridge · still loading · read failed · nothing noticed · rows. The card is double-checked here: whatever main said, it is hidden
// the moment the brief on screen has an item, an overflow or standing row, a hidden row or a source error.
import { BHS_HEADING, BHS_OFFLINE, BHS_LOADING, BHS_EMPTY, BHS_CLEAR_TITLE, BHS_CLEAR_LEAD, BHS_CLEAR_ACK, BHS_DAYS, HOW_GLYPH, HOW_COLOR, SEV_COLOR, entryLine, clearedLine, clearLine, clearSince } from '../logic/brief-history.js';

function bhsFlat(ctx) {
  const { S, LIVE, live } = ctx;
  const api = this.hq && this.hq.briefHistory;
  const can = !!(api && typeof api.read === 'function');
  const onHome = S.tab === 'home' && !!live;
  const onTimeline = S.tab === 'history' && !!(S.sub && S.sub.history === 'timeline');
  const B = (LIVE && LIVE.brief) || {};
  const brief = B.loaded && !B.error && B.brief && typeof B.brief === 'object' ? B.brief : null;
  if (can && (onHome || onTimeline)) this.bhsEnsure((onHome ? 'home' : 'timeline') + '|' + String((brief && brief.generatedAt) || ''));   // deferred: one read per arrival and per new brief
  const loaded = !!S.bhsLoaded;
  const err = S.bhsErr || '';
  const D = loaded && !err && S.bhsData && typeof S.bhsData === 'object' ? S.bhsData : null;
  const entries = D && Array.isArray(D.entries) ? D.entries : [];
  if (can && D && onTimeline) this.useMark('brief-history');   // usage counter: once per arrival, only while the section can be seen (logic/use-log.js)

  const arr = (x) => (Array.isArray(x) ? x : []);
  // the brief on screen is empty in the strict sense the card needs; main checked too, this is the second look
  const clearNow = !!brief && !arr(brief.items).length && !arr(brief.overflow).length && !arr(brief.standing).length && !(Number(brief.more) > 0) && !arr(brief.errors).length;
  const card = onHome && can && D && clearNow && D.allClear ? D.allClear : null;
  const footer = onHome && can && D && brief ? clearedLine(D.clearedThisWeek || 0, D.dismissedThisWeek || 0) : '';
  const summary = D ? clearedLine(D.clearedThisWeek || 0, D.dismissedThisWeek || 0) : '';

  return {
    // ---- the Operator section (History > Timeline)
    bhsOpShow: onTimeline,
    bhsOpHeading: BHS_HEADING + ' · last ' + BHS_DAYS + ' days',
    bhsOpOffline: onTimeline && !can, bhsOpOfflineText: BHS_OFFLINE,
    bhsOpLoading: onTimeline && can && !loaded, bhsOpLoadingText: BHS_LOADING,
    bhsOpError: onTimeline && can && loaded && !!err, bhsOpErrorText: 'Couldn’t read the Brief history · ' + err,
    bhsOpHasNotice: onTimeline && !!(D && D.notice), bhsOpNoticeText: D && D.notice ? D.notice : '',
    bhsOpEmpty: onTimeline && !!D && entries.length === 0, bhsOpEmptyText: BHS_EMPTY,
    bhsOpHas: onTimeline && entries.length > 0,
    bhsOpRows: entries.map((e, n) => ({
      key: 'e' + n, line: entryLine(e), glyph: HOW_GLYPH[e.how] || '?', glyphColor: HOW_COLOR[e.how] || 'var(--muted)', sevColor: SEV_COLOR[e.severity] || 'var(--muted)',
    })),
    bhsOpHasSummary: onTimeline && !!summary, bhsOpSummary: summary,
    // ---- the Brief panel footer (Home)
    bhsFootShow: !!footer, bhsFootText: footer,
    // ---- the all-clear card (Home)
    bhsCardShow: !!card,
    bhsCardTitle: BHS_CLEAR_TITLE,
    bhsCardLead: card ? BHS_CLEAR_LEAD + (clearSince(card.since) ? ' ' + clearSince(card.since) : '') : '',
    bhsCardLines: card ? card.resolved.map((x, n) => ({ key: 'c' + n, text: clearLine(x) })) : [],
    bhsCardAck: () => this.bhsAck(), bhsCardAckLabel: BHS_CLEAR_ACK, bhsCardBusy: !!S.bhsBusy,
  };
}

// ONE key in the renderVals object: the template reads `bhs.bhsOpShow` and so on. WHY NOT 25 FLAT KEYS: renderVals() is at ~1007 keys, and the dc runtime's sc-for
// copies the whole object per item ({ ...vals, [as]: item }); past about 1020 properties V8 turns that object into a slow dictionary and every render on Home
// took ~90 ms instead of ~17 ms (the ask-stream and cosmos-render-budget scenarios failed). Keep new surfaces to ONE nested key each; see HANDOFF.
export function briefHistoryVals(ctx) {
  return { bhs: bhsFlat.call(this, ctx) };
}
