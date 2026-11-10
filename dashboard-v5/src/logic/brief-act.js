// Act in place from a Brief row, renderer side (dish brief-act-waiting; main side: dashboard/brief-act.js + brief-act-core.mjs).
// Component.prototype mixin (src/app.js), beside briefLogic: same `this`. State (flat, bat-prefixed):
//   batOpen   the key of the row showing its inline confirm (one at a time) or null        batBal   the typed balance text (money-stale only)
//   batBusy   an act is in flight (a mirror of the this._batBusy guard, so the buttons grey out)
//   batDone   { [key]: { verb, at } } the answers main gave, so the row reads "done" at once; main's own item.acted replaces it on the next push
//
// What a row may do is main's table (dashboard/brief-act-core.mjs VERBS). This file only maps a rule to the verb to OFFER and shapes the
// words; main re-checks everything (the key must be on the live brief and rebuild from a live record, the verb must belong to the rule).
//   quest-red                      -> Mark done        inline confirm, then hq.brief.act(key, 'quest-done')
//   money-stale                    -> Confirm balance  inline field (the owner's own typed balance) + confirm
//   dirty, session-left-dirty      -> Commit...        main answers { open:'commit', projectId }; the EXISTING commit overlay opens (.env guard and Commit confirm unchanged)
//   session-waiting                -> Open its folder  main opens the folder (shell.openPath only)
// Never push, never any outbound action, never a verb for a rule that is not in this table.
export const RULE_VERB = Object.freeze({
  'quest-red': 'quest-done',
  'money-stale': 'confirm-balance',
  dirty: 'commit',
  'session-left-dirty': 'commit',
  'session-waiting': 'open-folder',
});
export const VERB_LABEL = Object.freeze({ 'quest-done': 'Mark done', 'confirm-balance': 'Confirm balance', commit: 'Commit…', 'open-folder': 'Open its folder' });
export const CONFIRM_TEXT = Object.freeze({
  'quest-done': 'Mark this quest done? It updates the quest list on this PC only; nothing is sent anywhere.',
  'confirm-balance': 'Type the balance you see in the account today. It re-anchors the account at now with that balance; the app never invents one.',
});
export const ACTED_TAIL = 'clears when the next scan confirms';
export const ACTED_TTL_MS = 24 * 3600e3;

/** The verb a row offers for its rule, or null (an unknown or future rule gets no verb). */
export const verbFor = (item) => (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(RULE_VERB, item.rule) ? RULE_VERB[item.rule] : null);
/** Verbs that ask first, inline in the row. Commit has its own overlay; opening a folder changes nothing. */
export const needsConfirm = (verb) => verb === 'quest-done' || verb === 'confirm-balance';

/** A light local pre-check on the typed balance (main's checkBalance and the money engine stay the authority): digits and separators only. */
export function balanceOk(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { error: 'Type the balance you see in the account.' };
  if (t.length > 40 || !/^[0-9\s., ]+$/.test(t) || !/[0-9]/.test(t)) return { error: 'Type the balance as a number.' };
  if (t.replace(/[^0-9]/g, '').length > 12) return { error: 'That balance is too large.' };   // parity with brief-act-core BALANCE_MAX_DIGITS
  return { ok: true, value: t };
}

/** "Done 2 min ago · clears when the next scan confirms" (a future time is "just now"; '' when unreadable or older than 24 h). */
export function actedText(acted, nowMs = Date.now()) {
  if (!acted || typeof acted !== 'object') return '';
  const t = Date.parse(acted.at);
  if (!Number.isFinite(t) || nowMs - t >= ACTED_TTL_MS) return '';
  const min = Math.max(0, Math.floor((nowMs - t) / 60000));
  const ago = min < 1 ? 'just now' : min < 60 ? min + ' min ago' : Math.floor(min / 60) + ' h ago';
  return 'Done ' + ago + ' · ' + ACTED_TAIL;
}

export const briefActLogic = {
  /** The row's verb button: ask first where the verb changes something, otherwise go straight to main. */
  batStart(item) {
    const verb = verbFor(item);
    if (!verb || !item || typeof item.key !== 'string') return false;
    if (this._batBusy) return false;
    if (needsConfirm(verb)) { this.setState({ batOpen: item.key, batBal: '' }); return true; }
    return this.batRun(item, verb);
  },
  batCancel() { this.setState({ batOpen: null, batBal: '' }); },
  batType(text) { this.setState({ batBal: String(text == null ? '' : text) }); },
  batYes(item) {
    const verb = verbFor(item);
    if (!verb || !needsConfirm(verb)) return false;
    if (verb === 'confirm-balance') {
      const b = balanceOk((this.state || {}).batBal);
      if (b.error) { this.toast('error', 'Not saved · ' + b.error); return false; }
      return this.batRun(item, verb, b.value);
    }
    return this.batRun(item, verb);
  },
  async batRun(item, verb, value) {
    const api = this.hq && this.hq.brief;
    if (!api || typeof api.act !== 'function') { this.toast('error', 'Not done · this needs the desktop app’s brief module'); return false; }
    if (this._batBusy) return false;   // a double click while main is working: one call, not two
    this._batBusy = true;
    this.setState({ batBusy: true });
    try {
      const r = value === undefined ? await api.act(item.key, verb) : await api.act(item.key, verb, value);
      if (!r || r.error) { this.toast('error', 'Not done · ' + ((r && r.error) || 'no answer from the app')); return false; }
      if (r.open === 'commit') {
        this.setState({ batOpen: null, batBal: '' });
        if (typeof r.projectId === 'string' && r.projectId) await this.openCommit(r.projectId);   // the existing overlay, guards and confirm untouched
        return true;
      }
      if (r.acted && typeof r.acted === 'object') {
        this.setState((s) => ({ batOpen: null, batBal: '', batDone: Object.assign({}, s.batDone || {}, { [item.key]: { verb: String(r.acted.verb || verb), at: String(r.acted.at || '') } }) }));
        return true;
      }
      this.setState({ batOpen: null, batBal: '' });
      if (verb === 'open-folder') this.toast('info', 'Opened its folder');
      return true;
    } catch (e) {
      this.toast('error', 'Not done · ' + String((e && e.message) || e).slice(0, 200));
      return false;
    } finally { this._batBusy = false; this.setState({ batBusy: false }); }
  },
};
