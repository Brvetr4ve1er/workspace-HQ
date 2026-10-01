// The Local Model adapter — L3 seam for the PC-Brain plan.
// Talks to a locally-running LLM runtime: Ollama (:11434) first, then LM Studio
// (:1234). Clean-fail: every public function resolves to a {status, ...} object
// and NEVER throws — callers (draft-commit, the ORACLE realm) fall back to their
// own paths on anything but {status:'done'}.
//
// Public surface:
//   probe({force?})  -> {available, runtime?, endpoint?, models?, reason?}
//   run({system?, prompt, model?, timeoutMs?, options?})
//                    -> {status, output?, reason?, runtime?, model?}
//   stream({messages, model?, timeoutMs?, signal?, onText?, options?})
//                    -> {status: 'done'|'cancelled'|'error'|'unavailable', output, reason?, runtime?, model?}
//                       onText(fullTextSoFar) fires as tokens arrive.
//   warm()           -> {status: 'warm'|'skipped'|'unavailable'|'error', model?}
//   listModels()     -> probe({force:true})
//   invalidateProbe()
//
// Ollama goes through its NATIVE /api/chat, not the OpenAI-compatible /v1
// endpoint: only the native API honours per-request num_ctx and keep_alive.
// Without them the model runs with a 4k context (too small for the ORACLE's
// grounding block) and unloads after ~5 idle minutes (a cold reload measured
// 51 s on this machine). LM Studio stays on /v1 with SSE.
'use strict';

const RUNTIMES = [
  {
    name: 'ollama',
    base: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    // remote_host / remote_model mark an Ollama *cloud* model: a local stub
    // whose requests Ollama proxies to ollama.com. Kept so they can be refused.
    parseModels: (j) => (j?.models || []).map((m) => ({
      id: m.name || m.model,
      size: m.size || null,
      remote: !!(m.remote_host || m.remote_model),
      caps: Array.isArray(m.capabilities) ? m.capabilities : null,
    })),
  },
  {
    name: 'lmstudio',
    base: 'http://127.0.0.1:1234',
    modelsPath: '/v1/models',
    parseModels: (j) => (j?.data || []).map((m) => ({ id: m.id, size: null, remote: false, caps: null })),
  },
];

const PROBE_TTL_MS = 30_000;
// num_ctx must be identical on the warm-up call and every chat call — Ollama
// reloads the model whenever a request asks for a different context size.
const NUM_CTX = 8192;
const KEEP_ALIVE = '30m';
const DEFAULT_OPTIONS = { temperature: 0.3, num_predict: 700 };

let probeCache = null;   // { at, result }

// Model choice is explicit, never "whatever is listed first": /api/tags lists
// the most recently modified model first, so position changes with every pull.
// LOCAL-ONLY: cloud models are refused outright — the ORACLE promises that
// nothing leaves this PC, and draft-commit sends source diffs.
const PREFERRED = process.env.HQ_LLM_MODEL || 'qwen2.5:7b-instruct-q4_K_M';
const NON_CHAT = /embed|^bge|minilm|^e5[-:]/i;
const isRemote = (m) => !!m && (m.remote === true || /[-:]cloud$/i.test(String(m.id || '')));
const canChat = (m) => !!m && !!m.id && !isRemote(m)
  && (Array.isArray(m.caps) ? m.caps.includes('completion') : !NON_CHAT.test(m.id));
function pickChatModel(models) {
  const list = Array.isArray(models) ? models : [];
  const pinned = list.find((m) => m && m.id === PREFERRED);
  if (pinned && canChat(pinned)) return pinned.id;
  const hit = list.find(canChat);
  return hit ? hit.id : null;
}
function noModelReason(p) {
  return (p.models || []).some(isRemote)
    ? `${p.runtime} only has cloud models — the ORACLE is local-only (pull one, e.g. \`ollama pull qwen2.5:7b\`)`
    : `${p.runtime} has no chat model installed — pull one first (e.g. \`ollama pull qwen2.5:7b\`)`;
}

async function fetchJson(url, { timeoutMs = 2000, method = 'GET', body = null } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
  try {
    const opts = { method, signal: ac.signal, headers: { Accept: 'application/json' } };
    if (body != null) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function probe(opts = {}) {
  const now = Date.now();
  if (!opts.force && probeCache && now - probeCache.at < PROBE_TTL_MS) return probeCache.result;
  for (const r of RUNTIMES) {
    try {
      const j = await fetchJson(r.base + r.modelsPath, { timeoutMs: 1500 });
      const models = r.parseModels(j) || [];
      // chatModel is THE model every caller uses — the UI shows this, not its own guess.
      const result = { available: true, runtime: r.name, endpoint: r.base, models, chatModel: pickChatModel(models) };
      probeCache = { at: now, result };
      return result;
    } catch { /* try next runtime */ }
  }
  const result = { available: false, reason: 'no local LLM runtime up on :11434 or :1234' };
  probeCache = { at: now, result };
  return result;
}

function invalidateProbe() { probeCache = null; }

// One streamed line -> text piece | null. Throws on a runtime-reported error.
function ollamaPiece(line) {
  const j = JSON.parse(line);
  if (j.error) throw new Error(String(j.error));
  return j.message?.content || null;
}
function ssePiece(line) {
  if (!line.startsWith('data:')) return null;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  const j = JSON.parse(data);
  if (j.error) throw new Error(String(j.error.message || j.error));
  return j.choices?.[0]?.delta?.content || null;
}

async function stream({ messages, model, timeoutMs = 150_000, signal, onText, options } = {}) {
  if (!Array.isArray(messages) || !messages.length) return { status: 'error', reason: 'messages required', output: '' };
  const p = await probe();
  if (!p.available) return { status: 'unavailable', reason: p.reason, output: '' };
  const chosen = model || p.chatModel;
  if (!chosen) return { status: 'unavailable', reason: noModelReason(p), output: '' };
  if (isRemote((p.models || []).find((m) => m.id === chosen) || { id: chosen })) {
    return { status: 'error', reason: `refused cloud model ${chosen} — local models only`, output: '' };
  }
  if (signal?.aborted) return { status: 'cancelled', output: '', runtime: p.runtime, model: chosen };

  const opt = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const isOllama = p.runtime === 'ollama';
  const url = isOllama ? `${p.endpoint}/api/chat` : `${p.endpoint}/v1/chat/completions`;
  const body = isOllama
    ? { model: chosen, messages, stream: true, keep_alive: KEEP_ALIVE, options: { ...opt, num_ctx: NUM_CTX } }
    : { model: chosen, messages, stream: true, temperature: opt.temperature, max_tokens: opt.num_predict };

  const ac = new AbortController();
  const onAbort = () => ac.abort(new Error('cancelled'));
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
  let text = '';
  try {
    const res = await fetch(url, {
      method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = '';
    const eat = (line) => {
      if (!line) return;
      const piece = isOllama ? ollamaPiece(line) : ssePiece(line);
      if (piece) { text += piece; if (onText) try { onText(text); } catch { /* listener's problem */ } }
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, nl).trim()); buf = buf.slice(nl + 1); }
    }
    eat((buf + decoder.decode()).trim());
    if (!text.trim()) return { status: 'error', reason: 'empty response from model', output: '', runtime: p.runtime, model: chosen };
    return { status: 'done', output: text, runtime: p.runtime, model: chosen };
  } catch (e) {
    if (signal?.aborted) return { status: 'cancelled', output: text, runtime: p.runtime, model: chosen };
    // A failed call means the runtime may be gone — re-detect on the next call
    // instead of trusting a stale positive.
    invalidateProbe();
    return { status: 'error', reason: String(e?.message || e), output: text, runtime: p.runtime, model: chosen };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

// Single-shot face over stream() — same contract draft-commit has always used.
async function run({ system, prompt, model, timeoutMs = 30_000, options } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) return { status: 'error', reason: 'prompt required' };
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const r = await stream({ messages, model, timeoutMs, options: { temperature: 0.2, ...(options || {}) } });
  return r.status === 'cancelled' ? { ...r, status: 'error', reason: 'cancelled' } : r;
}

// Load the chat model into VRAM ahead of the first question. An empty-prompt
// /api/generate loads the model and returns immediately once it is resident;
// on an already-loaded model it only refreshes keep_alive. Coalesced: one
// in-flight load at a time, and at most one call a minute — the realm selftest
// mounts ORACLE once per theme.
let warming = null, warmedAt = 0;
async function warm() {
  if (warming) return warming;
  warming = (async () => {
    const p = await probe();
    if (!p.available) return { status: 'unavailable', reason: p.reason };
    const chosen = p.chatModel;
    if (!chosen) return { status: 'unavailable', reason: noModelReason(p), noChatModel: true };
    if (p.runtime !== 'ollama') return { status: 'skipped', model: chosen };   // LM Studio manages its own residency
    if (Date.now() - warmedAt < 60_000) return { status: 'warm', model: chosen };
    try {
      await fetchJson(`${p.endpoint}/api/generate`, {
        method: 'POST', timeoutMs: 150_000,
        body: { model: chosen, keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } },
      });
      warmedAt = Date.now();
      return { status: 'warm', model: chosen };
    } catch (e) {
      invalidateProbe();
      return { status: 'error', reason: String(e?.message || e) };
    }
  })();
  try { return await warming; } finally { warming = null; }
}

function listModels() { return probe({ force: true }); }

module.exports = { probe, run, stream, warm, listModels, invalidateProbe, pickChatModel, isRemote };
