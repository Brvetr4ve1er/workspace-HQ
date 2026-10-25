// Phase 3 P1 (Ask parity with v3's ORACLE) and P8 (palette capture verb, What's new item).
//
// Built like actions.test.mjs: a store over synthetic DATA, a Component that is never
// mounted (setState is synchronous then), and a FAKE window.hq that records every call.
// llm.chat answers only when the test says so, so a stream can be stopped mid-way.
//
//   node --test dashboard-v5/src/logic/ask.test.mjs
// Synthetic fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Component } from '../app.js';
import { createStore } from '../live/store.js';
import * as AS from './ask-store.mjs';
import { STOP_GRACE_MS } from './ask.js';
import askTpl from '../tpl/ov-ask.tpl.js';
import { proj, scan, spellbook, telemetry } from '../live/__fixtures__/synthetic.mjs';

process.env.TZ = 'UTC';

// ---- browser globals the Component touches (same approach as actions.test.mjs) ----
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); }, removeItem: (k) => { m.delete(String(k)); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true, enumerable: true });
const mediaQuery = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
define('window', { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, matchMedia: mediaQuery, addEventListener() {}, removeEventListener() {} });
define('document', { documentElement: { clientWidth: 1440, dataset: {} }, addEventListener() {}, activeElement: null });
define('localStorage', memStorage());
define('sessionStorage', memStorage());
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
define('matchMedia', mediaQuery);
define('innerWidth', 1440);
define('innerHeight', 900);

const tick = () => new Promise((res) => setImmediate(res));
const DATA = () => ({ scans: [scan('2026-10-05', [proj('a', { dirty: 3 }), proj('b')])], spellbook: spellbook([]), telemetry: telemetry([]) });
const stored = () => JSON.parse(localStorage.getItem(AS.LS_CHAT) || 'null');

// A recording fake of window.hq. llm.chat stays pending until answer(r) (or cancel) settles it.
function fakeHq(over = {}) {
  const calls = [], jobs = new Map();
  const rec = (name, dflt) => (...args) => { calls.push([name, ...args]); return (over[name] || dflt || (() => true))(...args); };
  const hq = {
    probeLlm: rec('probeLlm', () => ({ available: true, runtime: 'fake', chatModel: 'fake-model' })),
    captureSave: rec('captureSave', () => true),
    llm: {
      chat: rec('llm.chat', (req) => new Promise((resolve) => jobs.set(req.jobId, resolve))),
      cancel: rec('llm.cancel', (id) => { const r = jobs.get(id); if (!r) return false; jobs.delete(id); r({ status: 'cancelled', output: '', sections: [{ id: 'scan', label: 'Scan', chars: 10 }], ms: 900, model: 'fake-model' }); return true; }),
      warm: rec('llm.warm', () => ({ status: 'warm' })),
      onDelta: rec('llm.onDelta', () => () => {}),
    },
  };
  const answer = (r, id) => { const k = id || [...jobs.keys()].at(-1); const f = jobs.get(k); jobs.delete(k); f(r); };
  return { hq, calls, answer, called: (n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1)) };
}

function make(over, state) {
  localStorage.clear(); sessionStorage.clear();
  const f = fakeHq(over);
  const store = createStore(DATA(), f.hq);
  store.live.llm = { available: true, runtime: 'fake', chatModel: 'fake-model' };
  const c = new Component({ store, previewState: 'live', startTab: 'home', theme: 'dark', pet: false });
  c.setState(Object.assign(c.askInitState(), state || {}));
  const toasts = [];
  c.toast = (kind, text) => { toasts.push({ kind, text }); f.calls.push(['toast', kind, text]); return 'k' + toasts.length; };
  return { c, store, f, toasts, last: () => toasts[toasts.length - 1] || {} };
}
const DONE = (output, extra) => Object.assign({ status: 'done', output, sections: [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }], ms: 1200, model: 'fake-model' }, extra || {});

// ---- K-1 · history and sources from v3's keys ----------------------------------------------
test('askInitState reads today’s v3 chat and the v3 sources; another day’s chat is not shown', () => {
  const { c } = make();
  const day = AS.today();
  localStorage.setItem(AS.LS_CHAT, JSON.stringify({ day, messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1', meta: { status: 'done', sections: [], ms: 100 } }] }));
  localStorage.setItem(AS.LS_INCLUDE, JSON.stringify({ scan: false, tasks: true, projects: true, health: true, browser: false, vault: false }));
  const s = c.askInitState();
  assert.deepEqual(Object.keys(s).sort(), ['askHistory', 'askInclude']);
  assert.deepEqual(s.askHistory.map((h) => [h.q, h.a.text, h.a.status]), [['q1', 'a1', 'done']]);
  assert.deepEqual(s.askInclude, { scan: false, tasks: true, projects: true, health: true, browser: false, vault: false, claude: false });
  localStorage.setItem(AS.LS_CHAT, JSON.stringify({ day: '2001-01-01', messages: [{ role: 'user', content: 'old' }] }));
  assert.deepEqual(c.askInitState().askHistory, []);
});

test('source chips toggle, persist in v3’s format and go with the question', async () => {
  const { c, f } = make();
  const v = c.renderVals();
  assert.deepEqual(v.askSources.map((s) => [s.label, s.on]), [['Scan', true], ['Tasks', true], ['Projects', true], ['PC health', false], ['Browser', false], ['Vault', false], ['Claude history', false]]);
  assert.deepEqual(v.askSources.map((s) => s.tip), AS.SOURCES.map((s) => s.tip), 'v3’s tooltips');
  v.askSources[5].toggle();
  v.askSources[0].toggle();
  assert.equal(localStorage.getItem(AS.LS_INCLUDE), '{"scan":false,"tasks":true,"projects":true,"health":false,"browser":false,"vault":true}');
  assert.equal(c.renderVals().askSources[5].on, true);
  c.submitAsk('what changed?');
  await tick();
  assert.deepEqual(f.called('llm.chat')[0][0].include, { scan: false, tasks: true, projects: true, health: false, browser: false, vault: true, claude: false });
});

test('a sent question is stored as v3 pending; the settled answer replaces it with v3 meta', async () => {
  const { c, f } = make();
  const p = c.submitAsk('What is uncommitted?');
  await tick();
  const req = f.called('llm.chat')[0][0];
  assert.match(req.jobId, /^or-[a-z0-9]+-[a-z0-9]+$/);
  assert.deepEqual(req.messages, [{ role: 'user', content: 'What is uncommitted?' }]);
  assert.deepEqual(stored().messages, [{ role: 'user', content: 'What is uncommitted?' }, { role: 'assistant', content: '', meta: { pending: true } }]);
  f.answer(DONE('  Project A has 3 files.  '));
  await p;
  const h = c.state.askHistory.at(-1);
  assert.equal(h.a.status, 'done');
  assert.equal(h.a.text, 'Project A has 3 files.');
  assert.deepEqual(stored().messages[1], { role: 'assistant', content: 'Project A has 3 files.', meta: { status: 'done', sections: [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }], ms: 1200, model: 'fake-model' } });
  const a = c.renderVals().asks.at(-1);
  assert.equal(a.meta, 'grounded in Scan · 1.2s');
  assert.equal(a.est, true);
  assert.equal(a.canRetry, false);
});

// ---- Stop / Retry / New chat --------------------------------------------------------------
test('Stop cancels in main, keeps the partial answer (“stopped”), and that pair is never sent back', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { c, f } = make();
  const p = c.submitAsk('Long question');
  await tick();
  const id = f.called('llm.chat')[0][0].jobId;
  c.onAskDelta({ jobId: id, text: '\n Partial ans' });
  let v = c.renderVals();
  assert.equal(v.askBtnLabel, 'Stop');
  t.mock.timers.tick(STOP_GRACE_MS);              // past the double-click grace (see the next test)
  v.askSubmit({ detail: 1 });                      // the Ask button is Stop while streaming
  await p;
  assert.deepEqual(f.called('llm.cancel'), [[id]]);
  const h = c.state.askHistory.at(-1);
  assert.equal(h.a.status, 'cancelled');
  assert.equal(h.a.text, 'Partial ans', 'the fake (like main before any text) answers output:"" — what streamed in stays');
  v = c.renderVals();
  assert.equal(v.asks.at(-1).meta, 'stopped · grounded in Scan · 0.9s');
  assert.equal(v.asks.at(-1).canRetry, true);
  assert.equal(v.askBtnLabel, 'Ask');
  assert.deepEqual(stored().messages[1], { role: 'assistant', content: 'Partial ans', meta: { status: 'cancelled', sections: [{ id: 'scan', label: 'Scan', chars: 10 }], ms: 900, model: 'fake-model' } });

  const p2 = c.submitAsk('Next question');
  await tick();
  assert.deepEqual(f.called('llm.chat')[1][0].messages, [{ role: 'user', content: 'Next question' }]);
  f.answer(DONE('ok'));
  await p2;
});

// state-3: one button is Ask and then Stop. The second click of a double-click on Ask (~150 ms
// later, e.detail 2) used to land on Stop and cancel the question it had just sent.
test('double-clicking Ask sends once and does not stop it; a later click on Stop does', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { c, f } = make({}, { askDraft: 'Why is the build slow?' });
  const p = c.renderVals().askSubmit({ detail: 1 });          // 1st click: sends
  await tick();
  assert.equal(f.called('llm.chat').length, 1);
  assert.equal(c.renderVals().askBtnLabel, 'Stop');
  t.mock.timers.tick(150);
  c.renderVals().askSubmit({ detail: 2 });                    // 2nd click of the double-click
  c.renderVals().askSubmit({ detail: 1 });                    // a stray click inside the grace
  await tick();
  assert.deepEqual(f.called('llm.cancel'), [], 'the double-click must not cancel the job');
  assert.equal(c.state.askHistory.at(-1).a.status, 'thinking');
  assert.equal(f.called('llm.chat').length, 1, 'nothing is sent twice either');
  t.mock.timers.tick(STOP_GRACE_MS);
  c.renderVals().askSubmit({ detail: 1 });                    // a real Stop, later
  await p;
  assert.equal(f.called('llm.cancel').length, 1);
  assert.equal(c.state.askHistory.at(-1).a.status, 'cancelled');
});

test('New chat still stops a running answer at once (the grace is only on the Ask / Stop button)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { c, f } = make();
  const p = c.submitAsk('Quick one');
  await tick();
  c.renderVals().askNew();
  await p;
  assert.equal(f.called('llm.cancel').length, 1);
});

test('main’s partial output wins over the streamed text when it has one', async () => {
  const { c, f } = make();
  const p = c.submitAsk('q');
  await tick();
  const id = f.called('llm.chat')[0][0].jobId;
  c.onAskDelta({ jobId: id, text: 'Part' });
  c.stopAsk();
  f.answer({ status: 'cancelled', output: 'Partial answer from main', sections: [], ms: 400 }, id);
  await p;
  assert.equal(c.state.askHistory.at(-1).a.text, 'Partial answer from main');
});

test('Stop pressed while the model is still being probed: no request is sent', async () => {
  let release;
  const { c, f, store } = make({ probeLlm: () => new Promise((r) => { release = r; }) });
  store.live.llm = { available: false };
  const p = c.submitAsk('q');
  c.stopAsk();
  release({ available: true, chatModel: 'fake-model' });
  await p;
  assert.deepEqual(f.called('llm.chat'), []);
  assert.equal(c.state.askHistory.at(-1).a.status, 'cancelled');
});

test('Retry on a stopped answer asks the same question again and leaves the draft alone', async () => {
  const { c, f } = make();
  const p = c.submitAsk('Retry me');
  await tick();
  c.stopAsk();
  await p;
  c.setState({ askDraft: 'half-typed' });
  const p2 = c.renderVals().asks.at(-1).retry();
  await tick();
  assert.equal(f.called('llm.chat').length, 2);
  assert.equal(f.called('llm.chat')[1][0].messages.at(-1).content, 'Retry me');
  assert.deepEqual(c.state.askHistory.map((h) => h.q), ['Retry me'], 'the stopped pair is replaced, not duplicated');
  assert.equal(c.state.askDraft, 'half-typed');
  f.answer(DONE('Answer'));
  await p2;
  assert.deepEqual(stored().messages.map((m) => m.content), ['Retry me', 'Answer']);
});

test('New chat stops a running answer, empties today’s chat (stored too) and is disabled when empty', async () => {
  const { c, f } = make();
  assert.equal(c.renderVals().askNewOff, true);
  assert.equal(c.renderVals().askEmpty, true);
  assert.deepEqual(c.renderVals().askPrompts.map((p) => p.q), AS.PROMPTS);
  const p = c.submitAsk('q');
  await tick();
  assert.equal(c.renderVals().askNewOff, false);
  c.renderVals().askNew();
  assert.deepEqual(c.state.askHistory, []);
  await p;
  assert.equal(f.called('llm.cancel').length, 1);
  assert.deepEqual(c.state.askHistory, [], 'the cancelled answer does not come back');
  assert.deepEqual(stored(), { day: AS.today(), messages: [] });
  assert.equal(c.renderVals().askNewOff, true);
});

test('history sent to the model is every finished pair of today, not the last four', async () => {
  const { c, f } = make();
  const done = (i) => ({ id: 'h' + i, q: 'q' + i, a: { text: 'a' + i, status: 'done', meta: { status: 'done', sections: [] }, est: true } });
  c.setState({ askHistory: [0, 1, 2, 3, 4, 5].map(done).concat([{ id: 'x', q: 'failed', a: { text: '', status: 'error', meta: { status: 'error', reason: 'boom' } } }]) });
  c.submitAsk('q6');
  await tick();
  const m = f.called('llm.chat')[0][0].messages;
  assert.equal(m.length, 13);
  assert.ok(!m.some((x) => x.content === 'failed'));
});

test('one answer at a time: a second question while one streams is kept in the box, not sent', async () => {
  const { c, f, last } = make();
  c.submitAsk('first');
  await tick();
  await c.submitAsk('second');
  assert.equal(f.called('llm.chat').length, 1);
  assert.equal(c.state.askDraft, 'second');
  assert.match(last().text, /One question at a time/);
});

test('a question on a new day starts a new chat (v3 checks the day when sending)', async () => {
  const { c, f } = make();
  c.setState({ askHistory: [{ id: 'h0', q: 'yesterday', a: { text: 'old', status: 'done', meta: { status: 'done', sections: [] } } }] });
  c._askDay = '2001-01-01';
  c.submitAsk('today');
  await tick();
  assert.deepEqual(c.state.askHistory.map((h) => h.q), ['today']);
  assert.deepEqual(f.called('llm.chat')[0][0].messages, [{ role: 'user', content: 'today' }]);
  assert.equal(stored().day, AS.today());
});

test('an empty question opens the panel (today’s chat / starter prompts) without sending', async () => {
  const { c, f } = make({}, { paletteOpen: true });
  await c.submitAsk('   ');
  assert.equal(c.state.askOpen, true);
  assert.equal(c.state.paletteOpen, false);
  assert.deepEqual(f.called('llm.chat'), []);
});

// ---- offline box ------------------------------------------------------------------------------
test('offline box: v3 copy for no chat model / runtime down; Retry probes with force, then warms', async () => {
  const { c, f, store, last } = make({ probeLlm: () => ({ available: true, runtime: 'fake', chatModel: null }) });
  store.live.llm = { available: true, chatModel: null };
  let v = c.renderVals();
  assert.equal(v.askOffline, true);
  assert.equal(v.askOffTitle, 'No local chat model installed.');
  assert.equal(v.askOffCmd, 'ollama pull qwen2.5:7b');
  assert.equal(v.askOffRetry, true);
  await v.askRetryLlm();
  assert.deepEqual(f.called('probeLlm'), [[{ force: true }]]);
  assert.deepEqual(f.called('llm.warm'), [], 'still no chat model: nothing to load');
  assert.equal(last().text, 'Still no local model');
  assert.equal(c.state.askChecking, false);

  // honesty-8: the runtime-down box names both runtimes the probe tries and claims nothing
  // about the user's machine (v3 said Ollama "is set to start at login")
  store.live.llm = { available: false, reason: 'no local LLM runtime up on :11434 or :1234' };
  v = c.renderVals();
  assert.equal(v.askOffTitle, 'The local model isn’t running.');
  assert.equal(v.askOffPre + v.askOffCmd + v.askOffPost, 'No local model answered on :11434 (Ollama) or :1234 (LM Studio). Start Ollama or LM Studio, then retry.');
  store.live.llm = { available: false, reason: 'connect ECONNREFUSED' };
  v = c.renderVals();
  assert.equal(v.askOffPost, ', then retry. The probe said: connect ECONNREFUSED.');
  for (const llm of [{ available: false }, { available: true, chatModel: null }, { available: true, runtime: 'lmstudio', chatModel: null }]) {
    store.live.llm = llm;
    v = c.renderVals();
    assert.doesNotMatch(v.askOffPre + v.askOffCmd + v.askOffPost, /start at login/);
  }
  store.live.llm = { available: true, runtime: 'lmstudio', chatModel: null };
  v = c.renderVals();
  assert.equal(v.askOffTitle, 'No local chat model installed.');
  assert.equal(v.askOffPre + v.askOffCmd + v.askOffPost, 'LM Studio is running but has no local chat model (cloud models are refused — Ask is local-only). Load one in LM Studio, then retry.');

  const up = make();
  up.store.live.llm = { available: false };
  await up.c.renderVals().askRetryLlm();
  assert.deepEqual(up.f.called('probeLlm'), [[{ force: true }]]);
  assert.equal(up.f.called('llm.warm').length, 1);
  assert.equal(up.c.renderVals().askOffline, false);
});

test('the in-chat refusal when no runtime answers names both runtimes the probe tries', async () => {
  const { c, f, store } = make({ probeLlm: () => ({ available: false, reason: 'no local LLM runtime up on :11434 or :1234' }) });
  store.live.llm = { available: false };
  await c.submitAsk('what changed?');
  assert.deepEqual(f.called('llm.chat'), []);
  assert.equal(c.state.askHistory.at(-1).a.text, 'No local model answered (Ollama on :11434, LM Studio on :1234). Start one, then ask again.');
});

test('offline box without a bridge says so and offers no Retry; nothing is sent', async () => {
  const { c, f } = make({}, {});
  delete c.props.store.hq.llm;
  const v = c.renderVals();
  assert.equal(v.askOffTitle, 'Ask needs the live app.');
  assert.equal(v.askOffRetry, false);
  await c.submitAsk('q');
  assert.deepEqual(f.called('llm.chat'), []);
  assert.equal(c.state.askHistory.at(-1).a.refusal, true);
  assert.equal(stored().messages.length, 0, 'a refusal made here is not written to v3’s chat');
});

test('main answering “unavailable” re-probes so the offline box shows', async () => {
  const { c, f } = make();
  const p = c.submitAsk('q');
  await tick();
  f.answer({ status: 'unavailable', reason: 'connect ECONNREFUSED', output: '' });
  await p;
  await tick();
  assert.deepEqual(f.called('probeLlm'), [[{ force: true }]]);
  const a = c.renderVals().asks.at(-1);
  assert.equal(a.text, 'The local model didn’t answer.');
  assert.equal(a.meta, 'model offline — connect ECONNREFUSED');
  assert.equal(a.canRetry, true);
});

// ---- P8 palette ---------------------------------------------------------------------------
test('palette “capture <text>” keeps the text’s case, toasts before the reloading call, says when it failed', async () => {
  const { c, f } = make({ captureSave: () => false }, { paletteOpen: true, paletteMode: 'go', paletteQuery: 'Capture  Buy MORE milk ' });
  const P = c.paletteItems();
  assert.equal(P.groups[0].name, 'Do');
  const it = P.groups[0].items[0];
  assert.equal(it.label, 'Capture to Ideas · Buy MORE milk');
  await it.run();
  const order = f.calls.filter((x) => x[0] === 'toast' || x[0] === 'captureSave');
  assert.deepEqual(order, [['toast', 'info', 'Saving to Ideas — the window reloads to show it'], ['captureSave', 'Buy MORE milk'], ['toast', 'error', 'Not saved']]);
});

test('palette capture is refused while viewing a past scan; “Capture an idea…” fills the verb in', async () => {
  const { c, f } = make({}, { paletteOpen: true, paletteQuery: 'capture idea', snapOffset: 1 });
  let denied = 0;
  c.denied = () => { denied++; };
  await c.paletteCapture('idea');
  assert.equal(denied, 1);
  assert.deepEqual(f.called('captureSave'), []);
  c.setState({ snapOffset: 0, paletteQuery: 'capture' });
  const item = c.paletteItems().flat.find((x) => x.label === 'Capture an idea…');
  assert.ok(item);
  item.run();
  assert.equal(c.state.paletteQuery, 'capture ');
  assert.equal(c.state.paletteOpen, true);
});

test('palette: “Ask panel” opens it; “What’s new · trailers” appears only once openWhatsNew exists (K-3)', () => {
  const { c } = make({}, { paletteOpen: true, paletteQuery: 'ask panel' });
  c.paletteItems().flat.find((x) => x.label === 'Ask panel').run();
  assert.equal(c.state.askOpen, true);
  c.setState({ paletteQuery: 'trailers' });
  assert.equal(c.paletteItems().flat.some((x) => /What’s new/.test(x.label)), typeof Component.prototype.openWhatsNew === 'function');
  let opened = 0;
  c.openWhatsNew = () => { opened++; };
  const it = c.paletteItems().flat.find((x) => x.label === 'What’s new · trailers');
  assert.ok(it);
  it.run();
  assert.equal(opened, 1);
});

// ---- template --------------------------------------------------------------------------
test('every element the Ask panel gained or changed has a <!-- v5: … --> marker right before it', () => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const MARK = '<!-- v5:(?:(?!-->)[\\s\\S])*-->\\s*';
  for (const el of [
    '<button type="button" onClick="{{ askNew }}"',
    '<div role="group" aria-label="Context sources"',
    '<sc-if value="{{ askEmpty }}"',
    '<sc-if value="{{ a.hasMeta }}"',
    '<sc-if value="{{ a.canRetry }}"',
    '<sc-if value="{{ askOffline }}"',
    '<input ref="{{ askInputRef }}"',
    '<button type="button" onClick="{{ askSubmit }}"',
  ]) assert.match(askTpl, new RegExp(MARK + esc(el)), el);
  for (const b of ['askSources', 'askPrompts', 'askBtnLabel', 'askOffTitle', 'askRetryLlm']) assert.ok(askTpl.includes('{{ ' + b + ' }}'), b + ' is bound');
  assert.ok(!askTpl.includes('{{ a.src }}'), 'the per-source chips gave way to the meta line');
});
