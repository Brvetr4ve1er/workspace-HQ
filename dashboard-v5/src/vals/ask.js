// Ask panel render values.
import * as AS from '../logic/ask-store.mjs';
import { createRef } from '../dc/runtime.js';

const llmDown = (l) => !!l && (!l.available || !l.chatModel);
const btn = (off, extra) => Object.assign({ height: 30, padding: '0 10px', background: 'var(--ink)', border: '1px solid var(--frame)', borderRadius: 8, color: 'var(--muted)', fontFamily: 'var(--term)', fontSize: 12, cursor: off ? 'default' : 'pointer', opacity: off ? 0.5 : 1 }, extra || {});

// v3's offline box copy (view.js:174-200), "the ORACLE" read as "Ask"
function offlineBox(bridge, l) {
  if (!bridge) return { title: 'Ask needs the live app.', pre: 'The model bridge isn’t available in this preview.', cmd: '', post: '', retry: false };
  if (!llmDown(l)) return null;
  if (l.available) return { title: 'No local chat model installed.', pre: 'Ollama is running but has no local chat model (cloud models are refused — Ask is local-only). Run ', cmd: 'ollama pull qwen2.5:7b', post: ', then retry.', retry: true };
  return { title: 'The local model isn’t running.', pre: 'Open the ', cmd: 'Ollama', post: ' app — it is set to start at login — then retry.', retry: true };
}

export function askVals(ctx) {
  const { S, live } = ctx;
  const H = S.askHistory || [];
  const busy = H.some((h) => h && h.a && h.a.status === 'thinking');
  const bridge = this.askBridge();
  const llm = this.hq && this.hq.llm, canStop = busy && !!(llm && llm.cancel);
  // ----- ask (model text renders as plain text; never outside this panel) -----
  // `stream` while the answer is still arriving: <hq-type stream> shows streamed text at once
  // instead of typing behind it; false once done, so the settled answer finishes normally
  const asks = H.map((h) => {
    const a = (h && h.a) || {}, st = a.status, thinking = st === 'thinking';
    const text = a.text || (thinking ? '…' : st === 'cancelled' ? '(stopped before the answer started)' : st === 'done' ? '(empty answer)' : 'The local model didn’t answer.');
    // one line under each answer: stopped / error, what it was grounded in, notes, seconds (v3)
    const meta = thinking || h.local ? '' : AS.metaLine(a.meta);
    const warn = !thinking && !!a.meta && st !== 'done';
    return {
      q: h.q, text, stream: thinking, meta, hasMeta: !!meta,
      metaStyle: { fontSize: 12, padding: '1px 6px', border: '1px solid ' + (warn ? 'var(--orange)' : 'var(--frame)'), color: warn ? 'var(--orange)' : 'var(--muted)' },
      est: !!a.est, refusal: !!a.refusal,
      // v5 addition: re-ask a stopped, failed or refused question
      canRetry: live && bridge && !busy && !thinking && st !== 'done', retry: () => this.retryAsk(h.id),
    };
  });
  const inc = this.askIncl();
  const askSources = AS.SOURCES.map((s) => {
    const on = !!inc[s.id];
    return { label: s.label, tip: s.tip, on, toggle: () => this.toggleAskSource(s.id),
      style: btn(false, { height: 26, padding: '0 8px', background: on ? 'color-mix(in oklab, var(--purple) 16%, transparent)' : 'transparent', border: '1px solid ' + (on ? 'var(--purple)' : 'var(--frame)'), color: on ? 'var(--text)' : 'var(--muted)' }) };
  });
  const promptsOff = !live || !bridge;
  const off = offlineBox(bridge, this.LIVE.llm), checking = !!S.askChecking;
  const empty = H.length === 0;
  if (!this._askInput) this._askInput = createRef();
  return {
    // RECONSTRUCTED (see the note in vals/overlays.js): from here to the end of this object.
    // ask
    askOpen: S.askOpen, closeAsk: () => this.setState({ askOpen: false }), askPastNote: !live, asks, askDraft: S.askDraft,
    onAskInput: (e) => this.setState({ askDraft: e.target.value }),
    // Enter sends; while an answer streams it does nothing (the button is Stop then)
    askKey: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!this.askBusy()) this.submitAsk(this.state.askDraft); } },
    askSubmit: () => (this.askBusy() ? this.stopAsk() : this.submitAsk(this.state.askDraft)),
    askBtnLabel: busy ? (canStop ? 'Stop' : 'Answering…') : 'Ask', askInputRef: this._askInput,
    // v3 parity: source chips, New chat, starter prompts, the offline box
    askSources, askBusy: busy,
    askNew: () => this.newAsk(), askNewOff: empty, askNewStyle: btn(empty, { height: 34 }),
    askEmpty: empty, askPrompts: AS.PROMPTS.map((q) => ({ q, go: () => this.submitAsk(q, { keepDraft: true }), off: promptsOff, style: btn(promptsOff, { height: 'auto', minHeight: 32, padding: '6px 10px', textAlign: 'left', color: 'var(--text)' }) })),
    askOffline: !!off, askOffTitle: off ? off.title : '', askOffPre: off ? off.pre : '', askOffCmd: off ? off.cmd : '', askOffPost: off ? off.post : '',
    askOffRetry: !!(off && off.retry), askRetryLlm: () => this.askRetryLlm(), askRetryOff: checking, askRetryLabel: checking ? 'Checking…' : 'Retry', askRetryStyle: btn(checking, { color: 'var(--text)' }),
  };
}
