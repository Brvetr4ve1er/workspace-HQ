// Money actions (space "money", ported from Ember). Component.prototype mixin (src/app.js):
// same `this` as the class methods.
//
//  - Every write is one INTENT to main (hq.money.apply via store.applyMoney): the renderer never
//    builds entities, ids or timestamps — main validates and refuses with owner-facing copy.
//  - One write at a time: S.mny.busy is the double-submit guard; a failed write releases it and
//    toasts main's real error; success toasts only after main answered with a fresh view.
//  - Drafts (half-typed forms) live in S.mny only — a main-side window reload drops them, which is
//    fine: nothing is saved until the owner presses the button, and saved data comes back from main.
//  - Writes are NOT gated on the time machine: money is live data, not a scan (scrub.js exception line).
import { FX } from './shared.js';

// XP for finished money actions only — never for opening a form (game layer is optional, two-track:
// it rewards keeping the books, not spending or balances)
const XP = { log: 3, 'obligation-pay': 5, 'inbox-confirm': 3, 'payday-run': 5, 'account-save': 2 };

export const moneyLogic = {
  mnySet(patch) { this.setState((s) => ({ mny: Object.assign({}, s.mny, patch) })); },
  mnyField(form, key, value) { this.setState((s) => { const m = Object.assign({}, s.mny); m[form] = Object.assign({}, m[form], { [key]: value }); return { mny: m }; }); },
  // one inline form open per kind; opening replaces its draft
  mnyOpen(form, draft) { this.mnySet({ [form]: Object.assign({}, draft), ask: null }); },
  mnyClose(form) { this.mnySet({ [form]: null }); },
  mnySlip(id, patch) { this.setState((s) => { const m = Object.assign({}, s.mny); m.slip = Object.assign({}, m.slip, { [id]: Object.assign({}, (m.slip || {})[id], patch) }); return { mny: m }; }); },
  mnySplit(jarId, value) { this.setState((s) => { const m = Object.assign({}, s.mny); m.split = Object.assign({}, m.split, { [jarId]: value }); return { mny: m }; }); },
  // archive = an inline "are you sure" bar, not the run-confirm overlay
  mnyAsk(type, payload, question) { this.mnySet({ ask: { type, payload, question } }); },
  mnyAskYes() { const a = (this.state.mny || {}).ask; if (!a) return; return this.mnyApply(Object.assign({ type: a.type }, a.payload), (n) => { n.ask = null; }); },
  mnyAskNo() { this.mnySet({ ask: null }); },

  // the one write path. Resolves true when main saved it, false otherwise (already toasted).
  async mnyApply(intent, after) {
    const m = this.hq && this.hq.money;
    if (!m) { this.denied('Unavailable — money needs the desktop bridge'); return false; }
    if ((this.state.mny || {}).busy) { this.toast('info', 'Still saving the last one — try again in a moment'); return false; }   // never a silent drop
    this.mnySet({ busy: true });
    let r;
    try { r = await this.store.applyMoney(intent); }
    catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (!r || r.error) {
      this.mnySet({ busy: false });
      this.toast('error', (r && r.error) || 'That didn’t save');
      FX().sfx('error');
      return false;
    }
    this.setState((s) => { const n = Object.assign({}, s.mny, { busy: false, note: r.note || '' }); if (after) after(n); return { mny: n }; });
    if (r.note) this.toast('success', r.note);
    if (XP[intent.type] && this.hq.actedOn) { try { this.hq.actedOn({ kind: 'money', action: intent.type, xp: XP[intent.type] }); } catch (e) { /* xp is a bonus, never a failure */ } }
    FX().sfx('done');
    return true;
  },

  mnySaveAccount() {
    const f = (this.state.mny || {}).acct; if (!f) return;
    this.mnyApply({ type: 'account-save', id: f.id, name: f.name, currency: f.currency || 'DA', balance: f.balance }, (n) => { n.acct = null; });
  },
  mnySaveSettings() {
    const d = this.state.mny || {}, f = d.set || {}, V = (this.LIVE.money || {}).view;
    const fx = f.fx != null ? f.fx : V ? V.settings.fx : '', pd = f.payday != null ? f.payday : V ? V.settings.payday : '';
    this.mnyApply({ type: 'settings', fxDaPerUsd: fx, paydayDay: pd }, (n) => { n.set = null; });
  },
  mnyLog() {
    const f = (this.state.mny || {}).log || {}, V = (this.LIVE.money || {}).view;
    const accountId = f.accountId != null ? f.accountId : V && V.accounts[0] ? V.accounts[0].id : '';
    // keep currency/category/account for the next entry (the daily coffee is two taps), clear amount + note
    this.mnyApply({ type: 'log', amount: f.amount || '', currency: f.currency || 'DA', category: f.category || 'Food', accountId, note: f.note || '' }, (n) => { const cur = n.log || {}, sent = (k) => (cur[k] == null || cur[k] === f[k]); n.log = Object.assign({}, cur, { amount: sent('amount') ? '' : cur.amount, note: sent('note') ? '' : cur.note, accountId: cur.accountId != null ? cur.accountId : accountId }); });
  },
  mnySaveBill() {
    const f = (this.state.mny || {}).bill; if (!f) return;
    this.mnyApply(Object.assign({ type: 'obligation-save' }, f), (n) => { n.bill = null; });
  },
  mnyPay() {
    const f = (this.state.mny || {}).pay; if (!f) return;
    this.mnyApply({ type: 'obligation-pay', id: f.id, amount: f.amount || '', accountId: f.accountId || '' }, (n) => { n.pay = null; });
  },
  mnySaveJar() {
    const f = (this.state.mny || {}).jar; if (!f) return;
    this.mnyApply({ type: 'jar-save', id: f.id, name: f.name, target: f.target, targetDate: f.targetDate }, (n) => { n.jar = null; });
  },
  mnyMove() {
    const f = (this.state.mny || {}).move; if (!f) return;
    this.mnyApply({ type: 'jar-move', jarId: f.jarId, kind: f.kind, amount: f.amount }, (n) => { n.move = null; });
  },
  mnyCover() {
    const f = (this.state.mny || {}).cover; if (!f) return;
    if (!f.fromJarId) { this.toast('error', 'Pick a jar to cover from'); return; }
    this.mnyApply({ type: 'jar-cover', fromJarId: f.fromJarId, toJarId: f.toJarId, amount: f.amount }, (n) => { n.cover = null; });
  },
  mnySaveSplit() {
    const V = (this.LIVE.money || {}).view; if (!V) return;
    const d = (this.state.mny || {}).split || {};
    const rows = V.jars.map((j) => ({ jarId: j.id, amount: d[j.id] != null ? d[j.id] : j.split ? String(j.split) : '' }));
    this.mnyApply({ type: 'split-save', rows }, (n) => { n.split = null; });
  },
  mnyPaydayRun() {
    const f = (this.state.mny || {}).payday; if (!f) return;
    this.mnyApply({ type: 'payday-run', accountId: f.accountId, amount: f.amount }, (n) => { n.payday = null; });
  },
  mnyPaste() {
    const f = (this.state.mny || {}).paste || {};
    this.mnyApply({ type: 'inbox-paste', text: f.text || '', from: f.from || '' }, (n) => { n.paste = { text: '', from: f.from || '' }; });
  },
  // promos / renewal notices / already-logged need a second, deliberate tap (main enforces it too)
  mnyConfirmSlip(c, category, accountId) {
    const d = this.state.mny || {};
    if (c.warn && !(d.armed && d.armed[c.id])) { this.mnySet({ armed: Object.assign({}, d.armed, { [c.id]: true }) }); return; }
    this.mnyApply({ type: 'inbox-confirm', id: c.id, category, accountId, anyway: !!c.warn }, (n) => { if (n.armed) delete n.armed[c.id]; if (n.slip) delete n.slip[c.id]; });
  },

  async mnyImport() {
    const m = this.hq && this.hq.money;
    if (!m || !m.importFile) return this.denied('Unavailable — money needs the desktop bridge');
    const r = await this.call(() => this.store.importMoney(), 'Import failed');
    if (r && !r.canceled && r.note) { this.toast('success', r.note); FX().sfx('done'); }
  },
  async mnyExport() {
    const m = this.hq && this.hq.money;
    if (!m || !m.exportFile) return this.denied('Unavailable — money needs the desktop bridge');
    const r = await this.call(() => m.exportFile(), 'Export failed');
    if (r && !r.canceled && r.note) this.toast('success', r.note);
  },
};
