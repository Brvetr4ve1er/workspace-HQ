// Ask: questions to the local model, streamed into the Ask panel.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

// the probe said no: the runtime isn't up, or it has no chat model
const llmDown = (l) => !!l && (!l.available || !l.chatModel);
const downText = (l) => (l.available ? 'No local chat model is installed. Pull one with Ollama, then retry.' : 'The local model runtime isn’t running. Start Ollama, then ask again.');

export const askLogic = {
  // ---- Ask: the local model only; answers stay in this panel ----------------
  // The entry shows up at once (thinking); a model that looked unavailable is
  // probed once more before refusing — it may have started since the last probe.
  async submitAsk(q) {
    q = (q || '').trim(); if (!q) return;
    const S = this.state;
    const entry = { q, id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), a: { text: '', src: [], est: false, status: 'thinking' } };
    const refusal = (text) => ({ text, src: [], est: false, refusal: true, status: 'done' });
    if (S.snapOffset > 0) entry.a = refusal('Ask only reads today’s data. Go back to live to ask about it.');
    else if (!this.hq || !this.hq.llm) entry.a = refusal('Ask runs on the local model inside the app; this window has no app bridge.');
    this.setState((s) => ({ askHistory: s.askHistory.concat([entry]).slice(-20), askOpen: true, paletteOpen: false, askDraft: '', paletteQuery: '', runsOpen: false }));
    FX().sfx('open');
    if (entry.a.status !== 'thinking') return;
    if (llmDown(this.LIVE.llm)) {
      try { if (this.store && this.store.refreshLlm) await this.store.refreshLlm(true); } catch (e) { /* the old answer stands */ }
      const l = this.LIVE.llm;
      if (llmDown(l)) return this.patchAsk(entry.id, refusal(downText(l)));
    }
    return this.runAsk(entry);
  },
  async runAsk(entry) {
    const prior = this.state.askHistory.filter((h) => h.id !== entry.id && h.a && h.a.status === 'done' && !h.a.refusal).slice(-4);
    const messages = prior.flatMap((h) => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a.text }]).concat([{ role: 'user', content: entry.q }]);
    let r;
    try { r = await this.hq.llm.chat({ jobId: entry.id, messages, include: { scan: true, tasks: true, projects: true } }); }
    catch (e) { r = { status: 'error', reason: String(e && e.message || e) }; }
    const src = (r && r.sections || []).filter((x) => x.chars > 0).map((x) => x.label + (x.clipped ? ' (clipped)' : ''));
    this.patchAsk(entry.id, r && r.status === 'done'
      ? { text: String(r.output || '').trim() || '(empty answer)', src: src.concat([(r.model || 'local model') + ' · ' + Math.round((r.ms || 0) / 100) / 10 + 's']), est: true, status: 'done' }
      : { text: r && r.status === 'cancelled' ? 'Stopped.' : 'The local model didn’t answer · ' + ((r && (r.reason || r.output)) || 'unknown error'), src: [], refusal: true, status: 'done' });
  },
  // main sends the whole answer so far; its start is trimmed like the final answer
  // (.trim()), so settling on the final text continues what is shown instead of retyping it
  onAskDelta(d) { if (d && d.jobId) this.patchAsk(d.jobId, { text: String(d.text || '').replace(/^\s+/, ''), status: 'thinking' }, true); },
  patchAsk(id, a, partial) {
    this.setState((s) => ({ askHistory: s.askHistory.map((h) => (h.id === id && (!partial || h.a.status === 'thinking') ? Object.assign({}, h, { a: Object.assign({}, h.a, a) }) : h)) }));
  },
  // load the local model into VRAM before the first question (a cold load takes ~50s); main coalesces to once a minute
  warmModel() { const l = this.LIVE.llm; if (this.hq && this.hq.llm && this.hq.llm.warm && (!l || (l.available && l.chatModel))) this.hq.llm.warm(); },
};
