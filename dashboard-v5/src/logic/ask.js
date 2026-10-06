// Ask: questions to the local model, streamed into the Ask panel (v3's ORACLE, in the design's panel).
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
//
// Today's chat and the ticked sources live in v3's localStorage keys (logic/ask-store.mjs),
// saved here on every change that settles: a question sent (pending), an answer
// settled, New chat, a Retry, a source toggled. Not on stream deltas (~25/s; v3 doesn't either).
// One answer streams at a time; Stop cancels it in main (hq.llm.cancel) and keeps what arrived.
import { FX } from './shared.js';
import * as AS from './ask-store.mjs';

// the probe said no: the runtime isn't up, or it has no chat model
const llmDown = (l) => !!l && (!l.available || !l.chatModel);
// (the probe tries Ollama on :11434, then LM Studio on :1234: the down text names both)
const downText = (l) => (l.available ? (l.runtime === 'lmstudio' ? 'No local chat model is loaded. Load one in LM Studio, then retry.' : 'No local chat model is installed. Pull one with Ollama, then retry.') : 'No local model answered (Ollama on :11434, LM Studio on :1234). Start one, then ask again.');
const MAX_ENTRIES = AS.KEEP / 2;   // one entry = a question + its answer
// The Ask button turns into Stop as soon as a question is sent, so the second click of a
// double-click on Ask lands on Stop: a click this soon after sending is not a Stop.
export const STOP_GRACE_MS = 500;
const NO_STORAGE = { getItem: () => null, setItem() {} };
const LS = () => { try { return globalThis.localStorage || NO_STORAGE; } catch { return NO_STORAGE; } };

export const askLogic = {
  // K-1: app.js initState spreads this. Today's chat from v3's hq-oracle-chat, the chips from hq-oracle-include.
  askInitState() {
    const day = AS.today();
    this._askDay = day;
    return { askHistory: AS.load(LS(), day), askInclude: AS.loadInclude(LS()) };
  },
  askIncl() { return this.state.askInclude || AS.loadInclude(LS()); },
  askBusy() { return (this.state.askHistory || []).some((h) => h && h.a && h.a.status === 'thinking'); },
  askBridge() { const l = this.hq && this.hq.llm; return !!(l && l.chat) && this.ps() !== 'nobridge'; },
  saveAsk() { AS.save(LS(), this.state.askHistory || [], this._askDay || AS.today()); },

  toggleAskSource(id) {
    if (!AS.SOURCES.some((s) => s.id === id)) return;
    const inc = Object.assign({}, this.askIncl(), { [id]: !this.askIncl()[id] });
    this.setState({ askInclude: AS.saveInclude(LS(), inc) });
    FX().sfx('tab');
  },
  // the panel without a new question (today's chat, or the starter prompts)
  openAskPanel() { this.setState({ askOpen: true, paletteOpen: false, runsOpen: false }); this.warmModel(); },

  // ---- Ask: the local model only; answers stay in this panel ----------------
  // The entry shows up at once (thinking); a model that looked unavailable is
  // probed once more before refusing — it may have started since the last probe.
  // o.keepDraft: a starter prompt or a Retry leaves what is being typed alone (v3).
  async submitAsk(q, o) {
    q = (q || '').trim();
    if (!q) { if (!this.state.askOpen) this.openAskPanel(); return; }
    const S = this.state;
    if (this.askBusy()) {
      this.setState({ askOpen: true, paletteOpen: false, askDraft: q, paletteQuery: '' });
      this.toast('info', 'One question at a time — stop the current answer or wait for it');
      return;
    }
    // v3: a chat belongs to the day it was started; the first question of a new day starts a new one
    const day = AS.today();
    if (this._askDay == null) this._askDay = day;
    const fresh = this._askDay !== day;
    this._askDay = day;
    const entry = { q, id: AS.jobId(), a: { text: '', status: 'thinking', meta: null, est: false } };
    if (S.snapOffset > 0) Object.assign(entry, { local: true, a: this.askRefusal('Ask only reads today’s data. Go back to live to ask about it.') });
    else if (!this.askBridge()) Object.assign(entry, { local: true, a: this.askRefusal('Ask runs on the local model inside the app; this window has no app bridge.') });
    const keep = o && o.keepDraft;
    if (entry.a.status === 'thinking') this._askSentAt = Date.now();   // askButton's double-click grace
    this.setState((s) => Object.assign({ askHistory: (fresh ? [] : s.askHistory || []).concat([entry]).slice(-MAX_ENTRIES), askOpen: true, paletteOpen: false, paletteQuery: '', runsOpen: false }, keep ? {} : { askDraft: '' }));
    FX().sfx('open');
    this.saveAsk();   // pending: a reload before the answer lands shows "interrupted" (v3); a new day drops the old chat
    if (entry.a.status !== 'thinking') return;
    if (llmDown(this.LIVE.llm)) {
      try { if (this.store && this.store.refreshLlm) await this.store.refreshLlm(true); } catch (e) { /* the old answer stands */ }
      const l = this.LIVE.llm;
      if (llmDown(l)) return this.askLocal(entry.id, downText(l));
    }
    if (this._askStop === entry.id) return this.settleAsk(entry.id, { status: 'cancelled', output: '' });   // stopped while probing
    return this.runAsk(entry);
  },
  askRefusal(text) { return { text, status: 'unavailable', meta: null, est: false, refusal: true }; },
  // a refusal made here, not by the model: shown, never stored (v3 has no such message)
  askLocal(id, text) {
    this.setState((s) => ({ askHistory: (s.askHistory || []).map((h) => (h.id === id ? Object.assign({}, h, { local: true, a: this.askRefusal(text) }) : h)) }));
    this.saveAsk();
  },
  async runAsk(entry) {
    const prior = (this.state.askHistory || []).filter((h) => h.id !== entry.id);
    const messages = AS.modelHistory(prior, entry.q);   // v3: only finished pairs, all of today's
    let r;
    try { r = await this.hq.llm.chat({ jobId: entry.id, messages, include: Object.assign({}, this.askIncl()) }); }
    catch (e) { r = { status: 'error', reason: String(e && e.message || e), output: '' }; }
    this.settleAsk(entry.id, r);
    // main found no runtime: re-probe so the offline box shows what to do
    if (r && r.status === 'unavailable' && this.store && this.store.refreshLlm) this.store.refreshLlm(true);
  },
  // v3 (view.js:286-287): main's output wins when it has any, else what streamed in stays
  // (a stop lands with the partial answer; a stop before the context was built has none)
  settleAsk(id, r) {
    if (this._askStop === id) this._askStop = null;
    const meta = { status: (r && r.status) || 'error', reason: r && r.reason, sections: r && r.sections, ms: r && r.ms, model: r && r.model };
    const status = AS.STATUSES.includes(meta.status) ? meta.status : 'error';
    const out = r && typeof r.output === 'string' ? r.output.trim() : '';
    let found = false;
    this.setState((s) => ({ askHistory: (s.askHistory || []).map((h) => {
      if (h.id !== id) return h;
      found = true;
      const text = out || String((h.a && h.a.text) || '').trim();
      return Object.assign({}, h, { a: { text, status, meta, est: !!text } });
    }) }));
    if (found) this.saveAsk();   // gone = New chat cleared it while it streamed
  },
  // main sends the whole answer so far; its start is trimmed like the final answer
  // (.trim()), so settling on the final text continues what is shown instead of retyping it
  onAskDelta(d) { if (d && d.jobId) this.patchAsk(d.jobId, { text: String(d.text || '').replace(/^\s+/, ''), status: 'thinking' }, true); },
  patchAsk(id, a, partial) {
    this.setState((s) => ({ askHistory: (s.askHistory || []).map((h) => (h.id === id && (!partial || (h.a && h.a.status === 'thinking')) ? Object.assign({}, h, { a: Object.assign({}, h.a, a) }) : h)) }));
  },

  // The panel's one Ask / Stop button (vals/ask.js askSubmit). While an answer streams it is
  // Stop, except for a click within STOP_GRACE_MS of sending or the 2nd click of a double-click
  // (e.detail > 1): that is the same press that sent the question, and is ignored. Enter has
  // its own guard (askKey); New chat calls stopAsk directly and is not delayed.
  askButton(e) {
    if (!this.askBusy()) return this.submitAsk(this.state.askDraft);
    if (e && e.detail > 1) return;
    if (this._askSentAt && Date.now() - this._askSentAt < STOP_GRACE_MS) return;
    return this.stopAsk();
  },
  // Stop: main aborts the job and answers chat() with {status:'cancelled', output:<partial>}
  stopAsk() {
    const h = (this.state.askHistory || []).find((x) => x && x.a && x.a.status === 'thinking');
    if (!h) return;
    this._askStop = h.id;
    const llm = this.hq && this.hq.llm;
    if (llm && llm.cancel) Promise.resolve().then(() => llm.cancel(h.id)).catch((e) => console.warn('[ask] cancel failed', e));
  },
  // New chat (v3): stops a running answer, empties today's chat, focuses the box. No confirm.
  newAsk() {
    if (this.askBusy()) this.stopAsk();
    this._askDay = AS.today();
    this.setState({ askHistory: [] }, () => { const el = this._askInput && this._askInput.current; if (el && el.focus) el.focus(); });
    this.saveAsk();
  },
  // v5 addition: Retry on a stopped, failed or refused answer asks the same question again (the old pair goes)
  retryAsk(id) {
    const h = (this.state.askHistory || []).find((x) => x && x.id === id);
    if (!h || !h.a || h.a.status === 'thinking' || h.a.status === 'done' || this.askBusy()) return;
    this.setState((s) => ({ askHistory: (s.askHistory || []).filter((x) => x.id !== id) }));
    this.saveAsk();
    return this.submitAsk(h.q, { keepDraft: true });
  },
  // the offline box's Retry (v3 refresh(true)): probe again, bypassing the cache, then load the model
  async askRetryLlm() {
    if (this.state.askChecking || !this.store || !this.store.refreshLlm) return;
    this.setState({ askChecking: true });
    try {
      await this.store.refreshLlm(true);
      const l = this.LIVE.llm, llm = this.hq && this.hq.llm;
      if (!l || llmDown(l)) { this.toast('info', 'Still no local model'); return; }
      if (!llm || !llm.warm) return;
      let r;
      try { r = await llm.warm(); } catch (e) { r = { status: 'error', reason: String(e && e.message || e) }; }
      if (r && r.status === 'unavailable') await this.store.refreshLlm(true);   // it went away again, or has no chat model
      else if (r && r.status === 'error') this.toast('info', 'The model is up, but loading it failed — the first answer may be slow');
    } finally { this.setState({ askChecking: false }); }
  },
  // load the local model into VRAM before the first question (a cold load takes ~50s); main coalesces to once a minute
  warmModel() {
    const l = this.LIVE.llm, llm = this.hq && this.hq.llm;
    if (llm && llm.warm && (!l || (l.available && l.chatModel))) Promise.resolve().then(() => llm.warm()).catch((e) => console.warn('[ask] warm failed', e));
  },
};
