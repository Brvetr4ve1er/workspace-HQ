// The Local Model adapter — L3 seam for the PC-Brain plan (Phase 1).
// HTTP OpenAI-compatible client for locally-running LLM runtimes. Probes Ollama
// (:11434) and LM Studio (:1234) with a short timeout; uses whichever answers.
// Clean-fail: on unavailable/error, returns {status:'unavailable'|'error', reason}
// — NEVER throws. Callers (draft-commit, AI Guide realm, guide-bake) fall back
// to their existing paths on anything but {status:'done'}.
//
// Public surface (mirrors claude-sessions.run's promise-face so callers migrate
// one seam at a time):
//   probe({force?}) -> {available, runtime?, endpoint?, models?}
//   run({system?, prompt, model?, timeoutMs?}) -> {status, output?, reason?, runtime?, model?}
//   listModels()   -> alias for probe({force:true})
//   invalidateProbe() -> drop the cache (called on any HTTP error inside run)
//
// The probe result is cached for 30 s so the medbay status row + a subsequent
// draft-commit share one detection; a runtime coming up mid-session is picked
// up on the next call after the cache lapses (or on an explicit force).
'use strict';

const RUNTIMES = [
  {
    name: 'ollama',
    base: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    parseModels: (j) => (j?.models || []).map((m) => ({ id: m.name || m.model, size: m.size || null })),
  },
  {
    name: 'lmstudio',
    base: 'http://127.0.0.1:1234',
    modelsPath: '/v1/models',
    parseModels: (j) => (j?.data || []).map((m) => ({ id: m.id, size: null })),
  },
];

const PROBE_TTL_MS = 30_000;
let probeCache = null;   // { at: number, result: object }

async function fetchJson(url, { timeoutMs = 2000, method = 'GET', body = null, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
  try {
    const opts = { method, signal: ac.signal, headers: { Accept: 'application/json', ...headers } };
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
      const result = { available: true, runtime: r.name, endpoint: r.base, models };
      probeCache = { at: now, result };
      return result;
    } catch { /* try next runtime */ }
  }
  const result = { available: false, reason: 'no local LLM runtime up on :11434 or :1234' };
  probeCache = { at: now, result };
  return result;
}

function invalidateProbe() { probeCache = null; }

async function run({ system, prompt, model, timeoutMs = 30_000 } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) return { status: 'error', reason: 'prompt required' };
  const p = await probe();
  if (!p.available) return { status: 'unavailable', reason: p.reason };
  const chosen = model || p.models?.[0]?.id || null;
  if (!chosen) return { status: 'unavailable', reason: `${p.runtime} has no models installed — pull one first (e.g. \`ollama pull qwen2.5:7b\`)` };
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  try {
    const body = { model: chosen, messages, stream: false, temperature: 0.2 };
    const j = await fetchJson(`${p.endpoint}/v1/chat/completions`, { method: 'POST', body, timeoutMs });
    const output = j?.choices?.[0]?.message?.content || '';
    if (!output.trim()) return { status: 'error', reason: 'empty response from model' };
    return { status: 'done', output, runtime: p.runtime, model: chosen };
  } catch (e) {
    // A failed HTTP call means the runtime is unreachable NOW — drop the cache
    // so the next probe re-detects instead of trusting a stale positive.
    invalidateProbe();
    return { status: 'error', reason: String(e?.message || e) };
  }
}

function listModels() { return probe({ force: true }); }

module.exports = { probe, run, listModels, invalidateProbe };
