// Brief history, renderer side (dish brief-history, batch 3; main side: dashboard/brief-ledger.js + brief-ledger.mjs).
// What the Brief noticed and how each thing ended, in History > Timeline (the Operator section), plus the "N cleared this week" footer and the
// one-time all-clear card on the Brief panel. The ledger is main's: this file only words and shows what main answered.
// Component.prototype mixin (src/app.js, beside briefLogic): same `this` as the class methods. State (flat, bhs-prefixed):
//   bhsLoaded  main has answered once           bhsData  the normalized answer (see normalizeAnswer) or null      bhsErr  main's own words for a failed read
//   bhsBusy    an ack is in flight (a mirror of the this._bhsAcking guard, so the button greys out)
//   _bhsHold   (instance field, test rigs only) true = bhsEnsure never reads, so a selftest row's own state is not replaced by the fake's answer
//
//  - One read per arrival on a surface that shows it (Home, History > Timeline), and one more whenever a new brief arrives (its generatedAt is part of the signature).
//  - The ack is the only write the renderer can cause (hq.briefHistory.ack): it records "the all-clear card was shown", and the card goes away only when main says ok.
//  - Honest words: a close that was silence or a change is NEVER worded as resolved or fixed; a dismissal is worded as dismissed and counted apart from "cleared".
export const BHS_HEADING = 'operator · what the Brief noticed';
export const BHS_DAYS = 14;
export const BHS_OFFLINE = 'The Operator history needs the desktop app’s brief module (hq.briefHistory): nothing is remembered without it.';
export const BHS_LOADING = 'Reading what the Brief noticed…';
export const BHS_EMPTY = 'Nothing noticed in the last 14 days.';
export const BHS_CLEAR_TITLE = 'All clear';
export const BHS_CLEAR_LEAD = 'Nothing needs you, nothing is hidden, and every source answered.';
export const BHS_CLEAR_ACK = 'Got it';

const HOWS = ['open', 'resolved', 'acted', 'dismissed', 'changed', 'silent'];
// batch 8 (additive): how a clear was labelled and how its 72 hour hold stands. HOWS keeps its six values; these ride in separate fields.
const LABELS = ['in-place', 'marked-done', 'scan-confirmed', 'unknown'];
const HOLDS = ['pending', 'held', 'came-back', 'never'];
export const LABEL_WORD = Object.freeze({ 'in-place': 'in place', 'marked-done': 'marked done', 'scan-confirmed': 'confirmed by a scan', unknown: 'the source cannot confirm it' });
export const HOLD_WORD = Object.freeze({ pending: 'waiting out the 72 hour hold', held: 'stayed gone', 'came-back': 'came back', never: '' });
export const HELD_NOTE = 'Held means still gone after 72 hours of the app watching. Plain counts, no score.';
// rules that never step aside and so never make a "board clean" line (mirrors STANDING_EXEMPT in dashboard/brief-core.mjs)
export const CLEAN_EXEMPT = Object.freeze(['secrets', 'plain-export-found', 'vault-conflict']);
const SEVS = ['high', 'med', 'low'];
export const HOW_WORD = Object.freeze({ open: 'still open', resolved: 'resolved', acted: 'acted on', dismissed: 'dismissed', changed: 'changed', silent: 'went quiet' });
// the sentence tail for the two endings that must never read as fixed
export const HOW_NOTE = Object.freeze({ changed: 'a newer version of it took its place', silent: 'a source was not readable, so it is not counted as done' });
export const HOW_GLYPH = Object.freeze({ open: '●', resolved: '✓', acted: '✓', dismissed: '–', changed: '↻', silent: '?' });
export const HOW_COLOR = Object.freeze({ open: 'var(--orange)', resolved: 'var(--green)', acted: 'var(--green)', dismissed: 'var(--muted)', changed: 'var(--muted)', silent: 'var(--muted)' });
export const SEV_COLOR = Object.freeze({ high: 'var(--red)', med: 'var(--orange)', low: 'var(--muted)' });

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const iso = (x) => { const t = typeof x === 'string' ? Date.parse(x) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : ''; };
const nat = (x) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1e6 ? x : 0);

/** "Thu" (local time) | '' */
export const dayName = (at) => { const t = Date.parse(at); return Number.isFinite(t) ? DAYS[new Date(t).getDay()] : ''; };
/** "Tue 09:12" (local time) | '' */
export const dayClock = (at) => { const t = Date.parse(at); if (!Number.isFinite(t)) return ''; const d = new Date(t); return DAYS[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

/** The shape the renderer trusts, from whatever main sent: { error } | { entries, clearedThisWeek, dismissedThisWeek, allClear, notice }. */
export function normalizeAnswer(r) {
  if (!isObj(r)) return { error: 'no answer' };
  if (typeof r.error === 'string' && r.error) return { error: str(r.error, 200) };
  const entries = (Array.isArray(r.entries) ? r.entries : []).filter((e) => isObj(e) && str(e.text, 120)).slice(0, 60).map((e) => ({
    text: str(e.text, 120), rule: str(e.rule, 32), severity: SEVS.includes(e.severity) ? e.severity : 'low',
    first: iso(e.first), ended: e.ended == null ? null : iso(e.ended) || null, how: HOWS.includes(e.how) ? e.how : 'open', after: str(e.after, 24),
    ...(LABELS.includes(e.label) ? { label: e.label } : {}), ...(HOLDS.includes(e.hold) ? { hold: e.hold } : {}), ...(e.setAside === true ? { setAside: true } : {}),
  }));
  let allClear = null;
  if (isObj(r.allClear) && Array.isArray(r.allClear.resolved)) {
    const resolved = r.allClear.resolved.filter((x) => isObj(x) && str(x.text, 120)).slice(0, 12).map((x) => ({
      text: str(x.text, 120), after: str(x.after, 24), how: x.how === 'acted' ? 'acted' : 'resolved', ended: iso(x.ended),
    }));
    if (resolved.length) allClear = { since: iso(r.allClear.since), resolved };
  }
  const strip = normalizeStrip(r);
  return { entries, clearedThisWeek: nat(r.clearedThisWeek), dismissedThisWeek: nat(r.dismissedThisWeek), allClear, notice: str(r.notice, 240), ...(strip ? { strip } : {}) };
}

const age = (x) => (isObj(x) && str(x.after, 24) ? { since: iso(x.since), after: str(x.after, 24) } : null);
/** Batch 8 counts from main, or null when main is older and sent none (the old footer line then stands in). Plain numbers only: no total, no score. */
export function normalizeStrip(r) {
  if (!isObj(r) || !isObj(r.clears)) return null;
  const c = r.clears, out = isObj(r.outside) ? r.outside : {}, sa = isObj(r.setAside) ? r.setAside : {};
  return {
    clears: { inPlace: nat(c.inPlace), markedDone: nat(c.markedDone), scanConfirmed: nat(c.scanConfirmed), unknown: nat(c.unknown) },
    held: nat(r.heldThisWeek), pending: nat(r.pendingNow), cameBack: nat(r.cameBackThisWeek), open: nat(r.openCount), oldestOpen: age(r.oldestOpen),
    outside: { count: nat(out.count), rules: (Array.isArray(out.rules) ? out.rules : []).map((x) => str(x, 32)).filter(Boolean).slice(0, 12) },
    setAside: {
      count: nat(sa.count), oldest: age(sa.oldest),
      items: (Array.isArray(sa.items) ? sa.items : []).filter((x) => isObj(x) && str(x.text, 120)).slice(0, 12).map((x) => ({
        text: str(x.text, 120), rule: str(x.rule, 32), severity: SEVS.includes(x.severity) ? x.severity : 'low', first: iso(x.first), after: str(x.after, 24),
      })),
    },
  };
}

/** One Operator row: "Work not pushed: noticed Tue 09:12, resolved Thu after 2 d". A close that was silence or a change never says resolved. */
export function entryLine(e) {
  const noticed = dayClock(e.first);
  const head = e.text + ': ' + (noticed ? 'noticed ' + noticed + ', ' : '');
  if (e.how === 'open') return head + 'still open' + (e.after ? ' after ' + e.after : '');
  const day = dayName(e.ended);
  const tail = HOW_NOTE[e.how] ? ': ' + HOW_NOTE[e.how] : '';
  // batch 8: a clear says how it was cleared and where its 72 hour hold stands; a dismissal says it was set aside, never that it was cleared
  const clear = e.how === 'resolved' || e.how === 'acted';
  const more = [e.setAside && e.how === 'dismissed' ? 'set aside' : '', clear && LABEL_WORD[e.label] ? LABEL_WORD[e.label] : '', clear && HOLD_WORD[e.hold] ? HOLD_WORD[e.hold] : ''].filter(Boolean);
  return head + HOW_WORD[e.how] + (day ? ' ' + day : '') + (e.after ? ' after ' + e.after : '') + tail + (more.length ? ' · ' + more.join(' · ') : '');
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** The strip's lines, plain counts only (never a score or a total). Week one reads "0 held". Needs a normalized answer with a strip; [] otherwise. */
export function stripLines(D) {
  const S = D && D.strip;
  if (!S) return [];
  const lines = [];
  lines.push((D.clearedThisWeek || 0) + ' cleared this week · ' + S.held + ' held' + (S.pending > 0 ? ' · ' + S.pending + ' waiting out the hold' : '') + (S.cameBack > 0 ? ' · ' + S.cameBack + ' came back' : ''));
  const kinds = [[S.clears.inPlace, 'in place'], [S.clears.markedDone, 'marked done'], [S.clears.scanConfirmed, 'confirmed by a scan'], [S.clears.unknown, 'source cannot confirm']].filter(([n]) => n > 0).map(([n, w]) => n + ' ' + w);
  if (kinds.length) lines.push('Of those: ' + kinds.join(' · '));
  lines.push(S.open > 0 && S.oldestOpen ? S.open + ' open · oldest ' + S.oldestOpen.after + ' (since the app first noticed it)' : S.open > 0 ? S.open + ' open' : 'Nothing open');
  if (S.setAside.count > 0) lines.push(S.setAside.count + ' set aside' + (S.setAside.oldest ? ', the oldest ' + S.setAside.oldest.after : ''));
  if (S.outside.count > 0) lines.push(plural(S.outside.count, 'row is', 'rows are') + ' waiting on something outside the app');
  return lines;
}

/** The numbers block in Settings: [label, value] rows, nothing computed that main did not count. */
export function settingsRows(D) {
  const S = D && D.strip;
  if (!S) return [];
  return [
    ['Cleared this week', String(D.clearedThisWeek || 0)], ['Held (still gone after 72 hours)', String(S.held)], ['Waiting out the hold', String(S.pending)], ['Came back inside the hold', String(S.cameBack)],
    ['Cleared in place', String(S.clears.inPlace)], ['Marked done', String(S.clears.markedDone)], ['Confirmed by a scan', String(S.clears.scanConfirmed)], ['Source cannot confirm', String(S.clears.unknown)],
    ['Open now', String(S.open)], ['Oldest open', S.oldestOpen ? S.oldestOpen.after + ' (since the app first noticed it)' : 'none'],
    ['Set aside', String(S.setAside.count) + (S.setAside.oldest ? ', the oldest ' + S.setAside.oldest.after : '')], ['Waiting on something outside the app', String(S.outside.count)],
  ];
}

/** "Secrets in plain sight · set aside 9 d", one per set-aside row (History and Settings). */
export const asideLines = (D) => (D && D.strip ? D.strip.setAside.items.map((x) => x.text + ' · set aside' + (x.after ? ' ' + x.after : '')) : []);

/**
 * The clean-board card, or null. `clearNow` is the strict check on the Brief on screen (no row, no overflow, no standing, nothing hidden, no source error).
 * "Board clean since Tue 14:10" only when open, outside and set-aside rows are all zero and no set-aside row is a rule that never steps aside;
 * otherwise "Nothing new needs you, N set aside", naming the set-aside high-severity rows. A board with open rows main did not show gets no card.
 */
export function cleanCardOf(D, clearNow) {
  const S = D && D.strip;
  if (!S || !clearNow || S.open > 0) return null;
  const exempt = S.setAside.items.some((x) => CLEAN_EXEMPT.includes(x.rule));
  if (S.outside.count === 0 && S.setAside.count === 0 && !exempt) {
    let latest = 0;
    for (const e of D.entries || []) if (e.how !== 'open' && e.how !== 'dismissed' && e.ended) latest = Math.max(latest, Date.parse(e.ended) || 0);
    const when = latest ? dayClock(new Date(latest).toISOString()) : '';
    return { title: when ? 'Board clean since ' + when : 'Board clean', lines: [] };
  }
  const high = S.setAside.items.filter((x) => x.severity === 'high').map((x) => x.text + ' · set aside' + (x.after ? ' ' + x.after : ''));
  return { title: 'Nothing new needs you' + (S.setAside.count > 0 ? ', ' + S.setAside.count + ' set aside' : ''), lines: high };
}

/** "3 cleared this week · 1 dismissed" ('' when both are zero: no claim). Dismissed is never folded into cleared. */
export function clearedLine(cleared, dismissed) {
  const parts = [];
  if (cleared > 0) parts.push(cleared + ' cleared this week');
  if (dismissed > 0) parts.push(dismissed + ' dismissed');
  return parts.join(' · ');
}

/** One all-clear line: "Work not pushed · resolved Thu after 2 d". */
export function clearLine(x) {
  const day = dayName(x.ended);
  return x.text + ' · ' + (x.how === 'acted' ? 'acted on' : 'resolved') + (day ? ' ' + day : '') + (x.after ? ' after ' + x.after : '');
}

/** "Clear since Thu 14:20." | '' */
export const clearSince = (since) => (dayClock(since) ? 'Clear since ' + dayClock(since) + '.' : '');

export const briefHistoryLogic = {
  // one read per arrival and per new brief: `sig` identifies the screen and the brief the read answers for
  bhsEnsure(sig) {
    if (this._bhsHold || this._bhsSig === sig) return;
    this._bhsSig = sig;
    setTimeout(() => this.bhsLoad(), 0);   // never set state while rendering
  },
  async bhsLoad() {
    const api = this.hq && this.hq.briefHistory;
    if (!api || typeof api.read !== 'function') return false;
    if (this._bhsReading) { this._bhsAgain = true; return false; }
    this._bhsReading = true;
    try {
      do {
        this._bhsAgain = false;
        let r;
        try { r = normalizeAnswer(await api.read()); } catch (e) { r = { error: str((e && e.message) || e, 200) || 'the read failed' }; }
        if (r.error) this.setState({ bhsErr: r.error, bhsLoaded: true });
        else this.setState({ bhsData: r, bhsErr: '', bhsLoaded: true });
      } while (this._bhsAgain);
      return true;
    } finally { this._bhsReading = false; }
  },
  async bhsAck() {
    const api = this.hq && this.hq.briefHistory;
    if (!api || typeof api.ack !== 'function') return false;
    if (this._bhsAcking) return false;   // a double click is one write
    this._bhsAcking = true;
    this.setState({ bhsBusy: true });
    try {
      const r = await api.ack();
      if (!r || r.error || r.ok !== true) { if (this.toast) this.toast('error', 'Not saved · ' + str((r && r.error) || 'no answer', 160)); return false; }
      const D = (this.state || {}).bhsData;
      if (D) this.setState({ bhsData: { ...D, allClear: null } });
      return true;
    } catch (e) {
      if (this.toast) this.toast('error', 'Not saved · ' + str((e && e.message) || e, 160));
      return false;
    } finally { this._bhsAcking = false; this.setState({ bhsBusy: false }); }
  },
};
