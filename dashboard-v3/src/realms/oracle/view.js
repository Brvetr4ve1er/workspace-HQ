// ORACLE realm — chat with the local model (PC-Brain Phase 2).
//
// The renderer owns only the conversation and which sources to include. The
// grounding CONTEXT is built in the main process from the app's own data files
// (dashboard/llm-context.js) — the renderer never sends or sees it — and the
// reply streams back as the accumulated text (hq:llm:delta), so a user who
// leaves mid-answer and comes back re-attaches without a garbled bubble.
//
// Layout is built ONCE per mount (header, source chips, log, offline slot,
// composer); every later update is a targeted paint, so the model finishing
// its warm-up never rebuilds the textarea out from under someone typing.
//
// XSS: user text goes in via textContent; model text only via mdLite(), which
// escapes everything before rebuilding bullets/bold/headings.
import { el, esc, mdLite } from '../../ui/util.js';
import { icon } from '../../ui/icons.js';

const SOURCES = [
  { id: 'scan',     label: 'Scan',      tip: "Level, XP, health index and today's suggested picks" },
  { id: 'tasks',    label: 'Tasks',     tip: 'Open tasks and flagged risks' },
  { id: 'projects', label: 'Projects',  tip: 'Git, build, tests and activity for each project' },
  { id: 'health',   label: 'PC health', tip: "The SYSTEM tab's vitals" },
  { id: 'browser',  label: 'Browser',   tip: 'Focus time by site, from the Bridge extension' },
  { id: 'vault',    label: 'Vault',     tip: 'Keyword search of your VEEMO CORTEX notes (read-only)' },
];
const DEFAULT_INCLUDE = { scan: true, tasks: true, projects: true, health: false, browser: false, vault: false };
const PROMPTS = [
  'What should I actually work on today?',
  "What's the biggest risk in my projects right now?",
  'Which project has gone quiet, and does it matter?',
  'Explain my health score.',
];
const LS_INCLUDE = 'hq-oracle-include';
const LS_CHAT = 'hq-oracle-chat';
const KEEP = 40;                                   // messages kept per day

const today = () => new Date().toLocaleDateString('en-CA');
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked/full */ } }

function loadInclude() {
  const s = lsGet(LS_INCLUDE) || {};
  const out = {};
  for (const src of SOURCES) out[src.id] = typeof s[src.id] === 'boolean' ? s[src.id] : DEFAULT_INCLUDE[src.id];
  return out;
}
// A chat is kept for the day it was started. A message still marked pending
// here means the window reloaded mid-answer (main reloads after scans).
function loadChat() {
  const s = lsGet(LS_CHAT);
  if (!s || s.day !== today() || !Array.isArray(s.messages)) return { day: today(), messages: [] };
  const messages = s.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => (m.meta?.pending ? { ...m, meta: { status: 'error', reason: 'interrupted — the window reloaded' } } : m));
  return { day: s.day, messages };
}

// ---- module state (survives unmount; the conversation outlives the tab) ----
let CTX = null, root = null, offDelta = null, raf = 0;
let include = loadInclude();
let chat = loadChat();
let runtime = null;        // probe result; null = still checking
let warm = 'idle';         // 'idle' | 'warming' | 'ready' | 'error'
let active = null;         // { jobId, msg } while a reply streams
let draft = '';

const hq = () => (CTX && CTX.hq) || null;
function bridge() {
  const h = hq();
  return !!(h && typeof h.probeLlm === 'function' && h.llm && typeof h.llm.chat === 'function');
}
// chatModel is picked main-side (llm-local pickChatModel: pinned, local-only)
// — the UI shows exactly the model every request will use, never its own guess.
const noChatModel = () => runtime?.available === true && !runtime.chatModel;
const canChat = () => bridge() && runtime?.available === true && !!runtime.chatModel;
const modelName = (rt) => rt?.chatModel || 'no local chat model';

function saveChat() {
  if (chat.messages.length > KEEP) chat.messages = chat.messages.slice(-KEEP);
  lsSet(LS_CHAT, { day: chat.day, messages: chat.messages.map(({ role, content, meta }) => ({ role, content, meta })) });
}

// ---------------------------------------------------------------- painting
function paintStatus() {
  const s = root?.querySelector('.or-status');
  if (!s) return;
  let cls = 'probing', t = 'checking for a local model…';
  if (!bridge()) { cls = 'off'; t = 'preview — no model bridge'; }
  else if (runtime && !runtime.available) { cls = 'off'; t = 'model offline'; }
  else if (noChatModel()) { cls = 'warn'; t = `${runtime.runtime} · no local chat model`; }
  else if (runtime?.available) {
    const m = modelName(runtime);
    if (warm === 'warming') t = `loading ${m} into GPU memory…`;
    else if (warm === 'error') { cls = 'warn'; t = `${runtime.runtime} · ${m} · warm-up failed, first reply may be slow`; }
    else { cls = 'ok'; t = `${runtime.runtime} · ${m}`; }
  }
  s.className = 'or-status ' + cls;
  s.querySelector('.or-status-t').textContent = t;
}

// Chips are created once in mount() and only toggled here, so a click (or a
// warm-up repaint) never destroys the button that holds keyboard focus.
function paintSources() {
  root?.querySelectorAll('.or-src').forEach((b) => {
    const on = !!include[b.dataset.src];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function metaNode(meta) {
  const secs = Array.isArray(meta.sections) ? meta.sections : [];
  const used = secs.filter((s) => s.chars > 0).map((s) => s.label + (s.clipped ? ' (trimmed)' : ''));
  const notes = secs.filter((s) => s.note).map((s) => `${s.label}: ${s.note}`);
  const parts = [];
  if (meta.status === 'cancelled') parts.push('stopped');
  else if (meta.status === 'unavailable') parts.push(`model offline — ${meta.reason || 'no runtime'}`);
  else if (meta.status === 'error') parts.push(`error — ${meta.reason || 'unknown'}`);
  if (meta.status !== 'unavailable') parts.push(used.length ? `grounded in ${used.join(' · ')}` : 'no sources ticked');
  if (notes.length) parts.push(notes.join('; '));
  if (Number.isFinite(meta.ms)) parts.push(`${(meta.ms / 1000).toFixed(1)}s`);
  const d = el('div', 'or-meta' + (meta.status && meta.status !== 'done' ? ' warn' : ''));
  d.textContent = parts.join(' · ');
  return d;
}

function msgNode(m) {
  const n = el('div', 'or-msg ' + (m.role === 'user' ? 'or-user' : 'or-bot'));
  const body = el('div', 'or-body');
  const streaming = active && m === active.msg;
  if (m.role === 'user') body.textContent = m.content;
  else if (m.content) body.innerHTML = mdLite(m.content);
  else if (streaming) body.innerHTML = '<span class="or-think">thinking…</span>';
  else body.innerHTML = '<span class="or-think">(no reply)</span>';
  n.appendChild(body);
  if (streaming) n.classList.add('streaming');
  else if (m.role === 'assistant' && m.meta) n.appendChild(metaNode(m.meta));
  return n;
}

function emptyState() {
  const box = el('div', 'or-empty');
  box.appendChild(el('div', 'or-empty-t', 'Ask about your projects, tasks, or this PC.'));
  box.appendChild(el('div', 'or-empty-s',
    'Answers come only from the sources ticked above, read from your latest data on this machine. If the answer isn\'t in them, the ORACLE says so instead of guessing.'));
  if (warm === 'warming') box.appendChild(el('div', 'or-empty-s', 'The model is loading into GPU memory — the first reply can take up to a minute.'));
  const row = el('div', 'or-prompts');
  for (const p of PROMPTS) {
    const b = el('button', 'or-prompt', esc(p));
    b.type = 'button';
    b.disabled = !canChat();
    b.onclick = () => send(p);
    row.appendChild(b);
  }
  box.appendChild(row);
  return box;
}

function scrollEnd(force) {
  const log = root?.querySelector('.or-log');
  if (!log) return;
  if (force || log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
}

function paintLog() {
  const log = root?.querySelector('.or-log');
  if (!log) return;
  log.innerHTML = '';
  if (!chat.messages.length) { log.appendChild(emptyState()); return; }
  for (const m of chat.messages) log.appendChild(msgNode(m));
  scrollEnd(true);
}

function paintOffline() {
  const box = root?.querySelector('.or-offline');
  if (!box) return;
  box.innerHTML = '';
  if (!bridge()) {
    box.hidden = false;
    box.appendChild(el('div', 'or-off-t', 'The ORACLE needs the live app.'));
    box.appendChild(el('div', 'or-off-s', "The model bridge isn't available in this preview."));
    return;
  }
  if (runtime && (!runtime.available || noChatModel())) {
    box.hidden = false;
    if (noChatModel()) {
      box.appendChild(el('div', 'or-off-t', 'No local chat model installed.'));
      box.appendChild(el('div', 'or-off-s', 'Ollama is running but has no local chat model (cloud models are refused — the ORACLE is local-only). Run <b>ollama pull qwen2.5:7b</b>, then retry.'));
    } else {
      box.appendChild(el('div', 'or-off-t', "The local model isn't running."));
      box.appendChild(el('div', 'or-off-s', 'Open the <b>Ollama</b> app — it is set to start at login — then retry.'));
    }
    const b = el('button', 'or-retry', 'Retry');
    b.type = 'button';
    b.onclick = () => refresh(true);
    box.appendChild(b);
    return;
  }
  box.hidden = true;
}

function paintComposer() {
  if (!root) return;
  const ta = root.querySelector('.or-input'), btn = root.querySelector('.or-send'), nw = root.querySelector('.or-new');
  ta.disabled = !bridge();
  btn.disabled = !active && !canChat();
  btn.textContent = active ? 'Stop' : 'Send';
  btn.classList.toggle('stop', !!active);
  nw.disabled = !chat.messages.length;
}

function paintAll() { paintStatus(); paintSources(); paintLog(); paintOffline(); paintComposer(); }

// ------------------------------------------------------------- behaviour
async function refresh(force) {
  const h = hq();
  if (!bridge()) return;
  runtime = null; warm = 'idle';
  paintStatus();
  try { runtime = await h.probeLlm({ force: !!force }); }
  catch (err) { runtime = { available: false, reason: String(err?.message || err) }; }
  paintAll();
  if (!runtime?.available || !runtime.chatModel || typeof h.llm.warm !== 'function') return;
  warm = 'warming';
  paintStatus(); paintLog();
  let r;
  try { r = await h.llm.warm(); } catch (err) { r = { status: 'error', reason: String(err?.message || err) }; }
  if (r.status === 'unavailable') {
    runtime = r.noChatModel ? { ...runtime, chatModel: null, reason: r.reason } : { available: false, reason: r.reason };
    warm = 'idle';
  } else warm = (r.status === 'warm' || r.status === 'skipped') ? 'ready' : 'error';
  paintAll();
}

function onDelta(d) {
  if (!active || !d || d.jobId !== active.jobId || typeof d.text !== 'string') return;
  active.msg.content = d.text;
  if (raf || !root) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const body = root?.querySelector('.or-msg.streaming .or-body');
    if (body && active) { body.innerHTML = mdLite(active.msg.content); scrollEnd(false); }
  });
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

// fromComposer: only text typed in the box clears the box — a suggested-prompt
// click sends its own text and leaves whatever the user was typing alone.
async function send(text, fromComposer = false) {
  const q = String(text || '').trim();
  const h = hq();
  if (!q || active || !canChat()) return;
  if (chat.day !== today()) chat = { day: today(), messages: [] };
  // History is replayed as complete question→answer PAIRS. A question whose
  // reply was stopped, failed or interrupted is dropped with it — otherwise the
  // model sees two user turns in a row and answers the abandoned one again.
  const history = [];
  const prior = chat.messages;
  for (let i = 0; i < prior.length; i++) {
    const m = prior[i], next = prior[i + 1];
    if (m.role === 'user' && next?.role === 'assistant' && next.content && next.meta?.status === 'done') {
      history.push({ role: 'user', content: m.content }, { role: 'assistant', content: next.content });
      i++;
    }
  }
  history.push({ role: 'user', content: q });
  chat.messages.push({ role: 'user', content: q });
  const msg = { role: 'assistant', content: '', meta: { pending: true } };
  chat.messages.push(msg);
  const jobId = `or-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  active = { jobId, msg };
  if (fromComposer) {
    draft = '';
    const ta = root?.querySelector('.or-input');
    if (ta) { ta.value = ''; autosize(ta); }
  }
  saveChat(); paintLog(); paintComposer();

  let r;
  try { r = await h.llm.chat({ jobId, messages: history, include: { ...include } }); }
  catch (err) { r = { status: 'error', reason: String(err?.message || err), output: '' }; }
  if (r && typeof r.output === 'string' && r.output) msg.content = r.output;
  msg.meta = { status: r?.status || 'error', reason: r?.reason, sections: r?.sections, ms: r?.ms, model: r?.model };
  if (r?.status === 'unavailable') { runtime = { available: false, reason: r.reason }; warm = 'idle'; }
  if (active && active.msg === msg) active = null;
  saveChat();
  paintAll();
}

function stop() {
  const h = hq();
  if (active && h?.llm?.cancel) h.llm.cancel(active.jobId).catch(() => {});
}

function newChat() {
  if (active) stop();
  active = null;
  chat = { day: today(), messages: [] };
  saveChat();
  paintLog(); paintComposer();
  root?.querySelector('.or-input')?.focus();
}

// -------------------------------------------------------------- lifecycle
export const view = {
  mount(stage, ctx) {
    CTX = ctx;
    root = el('section', 'realm-oracle');
    const name = esc(typeof ctx.LX === 'function' ? ctx.LX('tab_oracle') : 'ORACLE');
    root.innerHTML = `
      <header class="or-head">
        <div class="or-title">
          <span class="or-mark">${icon('realm-oracle', { size: 22 })}</span>
          <div>
            <div class="or-name">${name}</div>
            <div class="or-sub">Local model · answers only from your own data · nothing leaves this PC</div>
          </div>
        </div>
        <div class="or-status probing" role="status"><span class="or-dot"></span><span class="or-status-t"></span></div>
        <button class="or-new" type="button">New chat</button>
      </header>
      <div class="or-sources" role="group" aria-label="Context sources"><span class="or-src-lbl">Answer from</span></div>
      <div class="or-log" aria-live="polite"></div>
      <div class="or-offline" hidden></div>
      <form class="or-compose">
        <textarea class="or-input" rows="1" placeholder="Ask about your projects, tasks, or this PC…" title="Enter to send · Shift+Enter for a new line" aria-label="Message the ORACLE"></textarea>
        <button class="or-send" type="submit">Send</button>
      </form>`;
    stage.appendChild(root);

    const ta = root.querySelector('.or-input');
    ta.value = draft;
    autosize(ta);
    ta.oninput = () => { draft = ta.value; autosize(ta); };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!active) send(ta.value, true); }
    };
    root.querySelector('.or-compose').onsubmit = (e) => { e.preventDefault(); if (active) stop(); else send(ta.value, true); };
    root.querySelector('.or-new').onclick = newChat;
    const srcRow = root.querySelector('.or-sources');
    for (const s of SOURCES) {
      const b = el('button', 'or-src', esc(s.label));
      b.type = 'button';
      b.title = s.tip;
      b.dataset.src = s.id;
      b.onclick = () => { include[s.id] = !include[s.id]; lsSet(LS_INCLUDE, include); paintSources(); };
      srcRow.appendChild(b);
    }

    paintAll();
    const h = hq();
    if (bridge()) {
      if (typeof h.llm.onDelta === 'function') offDelta = h.llm.onDelta(onDelta);
      // Re-probe each visit, unless a reply is mid-stream (the model is plainly up).
      if (active) paintAll(); else refresh(false);
    }
  },
  unmount() {
    if (offDelta) { try { offDelta(); } catch { /* already gone */ } offDelta = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    root = null; CTX = null;
  },
};
