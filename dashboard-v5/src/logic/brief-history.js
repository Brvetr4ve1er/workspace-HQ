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
  }));
  let allClear = null;
  if (isObj(r.allClear) && Array.isArray(r.allClear.resolved)) {
    const resolved = r.allClear.resolved.filter((x) => isObj(x) && str(x.text, 120)).slice(0, 12).map((x) => ({
      text: str(x.text, 120), after: str(x.after, 24), how: x.how === 'acted' ? 'acted' : 'resolved', ended: iso(x.ended),
    }));
    if (resolved.length) allClear = { since: iso(r.allClear.since), resolved };
  }
  return { entries, clearedThisWeek: nat(r.clearedThisWeek), dismissedThisWeek: nat(r.dismissedThisWeek), allClear, notice: str(r.notice, 240) };
}

/** One Operator row: "Work not pushed: noticed Tue 09:12, resolved Thu after 2 d". A close that was silence or a change never says resolved. */
export function entryLine(e) {
  const noticed = dayClock(e.first);
  const head = e.text + ': ' + (noticed ? 'noticed ' + noticed + ', ' : '');
  if (e.how === 'open') return head + 'still open' + (e.after ? ' after ' + e.after : '');
  const day = dayName(e.ended);
  const tail = HOW_NOTE[e.how] ? ': ' + HOW_NOTE[e.how] : '';
  return head + HOW_WORD[e.how] + (day ? ' ' + day : '') + (e.after ? ' after ' + e.after : '') + tail;
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
