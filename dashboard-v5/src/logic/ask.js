// Ask: questions to the local model, streamed into the Ask panel.
// Component.prototype mixin (src/app.js): same `this` as the class methods they were.
import { FX } from './shared.js';

export const askLogic = {
  // ---- Ask: the local model only; answers stay in this panel ----------------
  submitAsk(q) {
    q = (q || '').trim(); if (!q) return;
    const S = this.state, live = this.LIVE.llm;
    const entry = { q, id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), a: { text: '', src: [], est: false, status: 'thinking' } };
    const refuse = (text) => { entry.a = { text, src: [], est: false, refusal: true, status: 'done' }; };
    if (S.snapOffset > 0) refuse('Ask only reads today’s data. Go back to live to ask about it.');
    else if (!this.hq || !this.hq.llm) refuse('Ask runs on the local model inside the app; this window has no app bridge.');
    else if (live && (!live.available || !live.chatModel)) refuse(live.available ? 'No local chat model is installed. Pull one with Ollama, then retry.' : 'The local model runtime isn’t running. Start Ollama, then ask again.');
    this.setState((s) => ({ askHistory: s.askHistory.concat([entry]).slice(-20), askOpen: true, paletteOpen: false, askDraft: '', paletteQuery: '', runsOpen: false }));
    FX().sfx('open');
    if (entry.a.status === 'thinking') this.runAsk(entry);
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
  onAskDelta(d) { if (d && d.jobId) this.patchAsk(d.jobId, { text: String(d.text || ''), status: 'thinking' }, true); },
  patchAsk(id, a, partial) {
    this.setState((s) => ({ askHistory: s.askHistory.map((h) => (h.id === id && (!partial || h.a.status === 'thinking') ? Object.assign({}, h, { a: Object.assign({}, h.a, a) }) : h)) }));
  },
  // load the local model into VRAM before the first question (a cold load takes ~50s); main coalesces to once a minute
  warmModel() { const l = this.LIVE.llm; if (this.hq && this.hq.llm && this.hq.llm.warm && (!l || (l.available && l.chatModel))) this.hq.llm.warm(); },
};
