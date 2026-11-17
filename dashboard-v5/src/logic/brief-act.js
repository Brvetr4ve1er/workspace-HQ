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
//   dirty (a SECOND button)        -> Open workspace   offered only when main put 'open-workspace' in the item's secondary list (it checks the project's dev
//                                                      command is allowed); main calls the Launcher, which writes its own act mark; the answer is its one result line
// Never push, never any outbound action, never a verb for a rule that is not in this table.
export const RULE_VERB = Object.freeze({
  'quest-red': 'quest-done',
  'money-stale': 'confirm-balance',
  dirty: 'commit',
  'session-left-dirty': 'commit',
  'session-waiting': 'open-folder',
});
export const VERB_LABEL = Object.freeze({ 'quest-done': 'Mark done', 'confirm-balance': 'Confirm balance', commit: 'Commit…', 'open-folder': 'Open its folder', 'open-workspace': 'Open workspace' });
// The second button a rule may carry (renderer copy of brief-act-core.mjs SECONDARY; a parity test pins both). Shown only when main offers it on the item.
export const RULE_SECONDARY = Object.freeze({ dirty: 'open-workspace' });
export const CONFIRM_TEXT = Object.freeze({
  'quest-done': 'Mark this quest done? It updates the quest list on this PC only; nothing is sent anywhere.',
  'confirm-balance': 'Type the balance you see in the account today. It re-anchors the account at now with that balance; the app never invents one.',
});
// Which verbs change a fact and so count as an act (renderer copy of brief-act-core.mjs VERBS[verb].marks; a parity test pins both). MAIN writes the
// use mark (dashboard/brief-act.js: 'act' for these, 'handover' for commit, nothing for open-folder); this file sends none, so one click is one mark.
export const VERB_MARKS = Object.freeze({ 'quest-done': true, 'confirm-balance': true, commit: false, 'open-folder': false, 'open-workspace': false });   // open-workspace: the Launcher writes its own 'launcher-workspace' act
export const BAT_SURFACE = 'brief-act';
export const ACTED_TAIL = 'clears when the next scan confirms';
export const ACTED_TTL_MS = 24 * 3600e3;

/** The verb a row offers for its rule, or null (an unknown or future rule gets no verb). */
export const verbFor = (item) => (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(RULE_VERB, item.rule) ? RULE_VERB[item.rule] : null);
/** The second verb a row offers, or null: only when main listed it on the item (item.secondary) AND the table allows it for the rule. Main re-checks at click time. */
export const secondaryFor = (item) => {
  if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(RULE_SECONDARY, item.rule)) return null;
  const v = RULE_SECONDARY[item.rule];
  return Array.isArray(item.secondary) && item.secondary.includes(v) ? v : null;
};
export const LINE_TTL_MS = 10 * 60e3;
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
  /** The row's second button (Open workspace): straight to main, no confirm; main refuses a project whose command is no longer allowed. */
  batStartSecondary(item) {
    const verb = secondaryFor(item);
    if (!verb || typeof item.key !== 'string' || this._batBusy) return false;
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
      if (r.workspace && typeof r.workspace === 'object') {   // the Launcher's one result line, shown in the row (no toast, no mark: main wrote the act)
        const text = String(r.workspace.line || '').slice(0, 400) || (r.workspace.ok === true ? 'Opened.' : 'Open workspace did not work. Nothing was changed.');
        this.setState((s) => ({ batOpen: null, batBal: '', batLine: Object.assign({}, s.batLine || {}, { [item.key]: { text, bad: r.workspace.ok !== true, at: Date.now() } }) }));
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
