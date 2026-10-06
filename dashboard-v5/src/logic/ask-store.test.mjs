// logic/ask-store.mjs: Ask history + sources in v3's ORACLE localStorage format.
// The v3 shapes below are what legacy/dashboard-v3/src/realms/oracle/view.js writes (saveChat /
// lsSet(LS_INCLUDE)); a load → save round trip must give v3 back the same JSON.
//
//   node --test dashboard-v5/src/logic/ask-store.test.mjs
// Synthetic content only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as AS from './ask-store.mjs';

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, raw: m };
}
const DAY = '2026-10-05';

// What v3's send() + saveChat() store for a finished exchange, a stopped one and an error
// (saveChat maps ({role, content, meta}) so a user message carries meta: undefined → dropped by JSON).
const v3Messages = () => [
  { role: 'user', content: 'What should I actually work on today?', meta: undefined },
  { role: 'assistant', content: 'Project A: commit the 3 changed files.', meta: { status: 'done', reason: undefined, sections: [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }, { id: 'tasks', label: 'Tasks', chars: 4000, clipped: true }, { id: 'vault', label: 'Vault', chars: 0, clipped: false, note: 'no notes matched: foo' }], ms: 1432, model: 'local-model:7b' } },
  { role: 'user', content: 'And after that?' },
  { role: 'assistant', content: 'Then Project B', meta: { status: 'cancelled', sections: [{ id: 'scan', label: 'Scan', chars: 900, clipped: false }], ms: 800, model: 'local-model:7b' } },
  { role: 'user', content: 'Explain my health score.' },
  { role: 'assistant', content: '', meta: { status: 'error', reason: 'bad job id', output: '' } },
  { role: 'user', content: 'Is the model up?' },
  { role: 'assistant', content: '', meta: { status: 'unavailable', reason: 'connect ECONNREFUSED', sections: undefined, ms: undefined, model: undefined } },
];
const v3Json = (messages, day = DAY) => JSON.stringify({ day, messages: messages.map(({ role, content, meta }) => ({ role, content, meta })) });

test('a v3 chat loads into v5 entries and saves back byte-identical', () => {
  const st = memStorage({ [AS.LS_CHAT]: v3Json(v3Messages()) });
  const before = st.getItem(AS.LS_CHAT);
  const entries = AS.load(st, DAY);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((e) => [e.q, e.a.status, e.a.text, e.a.est]), [
    ['What should I actually work on today?', 'done', 'Project A: commit the 3 changed files.', true],
    ['And after that?', 'cancelled', 'Then Project B', true],
    ['Explain my health score.', 'error', '', false],
    ['Is the model up?', 'unavailable', '', false],
  ]);
  assert.equal(new Set(entries.map((e) => e.id)).size, 4, 'every entry has its own id');
  AS.save(st, entries, DAY);
  assert.equal(st.getItem(AS.LS_CHAT), before);
});

test('a message still pending loads as "interrupted — the window reloaded", exactly as v3 loadChat does', () => {
  const msgs = [{ role: 'user', content: 'q1' }, { role: 'assistant', content: '', meta: { pending: true } }];
  const st = memStorage({ [AS.LS_CHAT]: v3Json(msgs) });
  const e = AS.load(st, DAY);
  assert.equal(e[0].a.status, 'error');
  assert.deepEqual(e[0].a.meta, { status: 'error', reason: 'interrupted — the window reloaded' });
  assert.equal(AS.metaLine(e[0].a.meta), 'error — interrupted — the window reloaded');
  // v3: loadChat maps pending → error, the next saveChat writes that
  AS.save(st, e, DAY);
  assert.deepEqual(JSON.parse(st.getItem(AS.LS_CHAT)).messages, [{ role: 'user', content: 'q1' }, { role: 'assistant', content: '', meta: { status: 'error', reason: 'interrupted — the window reloaded' } }]);
});

test('a v5 entry still streaming is written as v3 pending; local refusals are not written', () => {
  const st = memStorage();
  AS.save(st, [
    { id: 'or-x-1', q: 'live question', a: { text: 'partial so far', status: 'thinking', meta: null, est: false } },
    { id: 'or-x-2', q: 'refused here', local: true, a: { text: 'No bridge.', status: 'unavailable', meta: null, refusal: true } },
  ], DAY);
  assert.equal(st.getItem(AS.LS_CHAT), JSON.stringify({ day: DAY, messages: [{ role: 'user', content: 'live question' }, { role: 'assistant', content: 'partial so far', meta: { pending: true } }] }));
});

test('another day, a broken record or no record start an empty chat', () => {
  assert.deepEqual(AS.load(memStorage({ [AS.LS_CHAT]: v3Json(v3Messages(), '2026-10-04') }), DAY), []);
  assert.deepEqual(AS.load(memStorage({ [AS.LS_CHAT]: '{not json' }), DAY), []);
  assert.deepEqual(AS.load(memStorage({ [AS.LS_CHAT]: JSON.stringify({ day: DAY, messages: 'nope' }) }), DAY), []);
  assert.deepEqual(AS.load(memStorage(), DAY), []);
  assert.deepEqual(AS.load(null, DAY), [], 'no storage at all');
});

test('malformed messages are dropped; an answer without a question goes, a question without one stays', () => {
  const msgs = [
    { role: 'assistant', content: 'orphan answer', meta: { status: 'done' } },
    { role: 'system', content: 'never' }, null, { role: 'user', content: 42 },
    { role: 'user', content: 'lone question' },
    { role: 'user', content: 'paired' }, { role: 'assistant', content: 'answer', meta: { status: 'done', sections: [] } },
  ];
  const e = AS.load(memStorage({ [AS.LS_CHAT]: JSON.stringify({ day: DAY, messages: msgs }) }), DAY);
  assert.deepEqual(e.map((x) => [x.q, x.a.text, !!x.a.orphan]), [['lone question', '', true], ['paired', 'answer', false]]);
  assert.deepEqual(AS.toV3(e), [{ role: 'user', content: 'lone question' }, { role: 'user', content: 'paired' }, { role: 'assistant', content: 'answer', meta: { status: 'done', sections: [] } }]);
});

test('an answer without meta round-trips without one, and is never sent back to the model', () => {
  const msgs = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }];
  const st = memStorage({ [AS.LS_CHAT]: v3Json(msgs) });
  const e = AS.load(st, DAY);
  assert.equal(e[0].a.meta, undefined);
  AS.save(st, e, DAY);
  assert.deepEqual(JSON.parse(st.getItem(AS.LS_CHAT)).messages, msgs);
  assert.deepEqual(AS.modelHistory(e, 'next'), [{ role: 'user', content: 'next' }]);
});

test('save keeps the last 40 messages (v3 KEEP)', () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({ id: 'e' + i, q: 'q' + i, a: { text: 'a' + i, status: 'done', meta: { status: 'done' } } }));
  const st = memStorage();
  AS.save(st, entries, DAY);
  const m = JSON.parse(st.getItem(AS.LS_CHAT)).messages;
  assert.equal(m.length, 40);
  assert.equal(m[0].content, 'q5');
  assert.equal(m[39].content, 'a24');
});

test('model history: only finished pairs with text, then the new question (v3 send())', () => {
  const e = AS.fromV3(v3Messages());
  e.push({ id: 'l', q: 'refused', local: true, a: { text: 'No bridge.', status: 'unavailable', refusal: true, meta: null } });
  assert.deepEqual(AS.modelHistory(e, 'What next?'), [
    { role: 'user', content: 'What should I actually work on today?' },
    { role: 'assistant', content: 'Project A: commit the 3 changed files.' },
    { role: 'user', content: 'What next?' },
  ]);
});

test('sources: v3 format, defaults for anything that is not a boolean', () => {
  assert.deepEqual(AS.loadInclude(memStorage()), AS.DEFAULT_INCLUDE);
  const st = memStorage({ [AS.LS_INCLUDE]: JSON.stringify({ scan: false, tasks: 'yes', vault: true, extra: true }) });
  assert.deepEqual(AS.loadInclude(st), { scan: false, tasks: true, projects: true, health: false, browser: false, vault: true });
  assert.deepEqual(AS.loadInclude(memStorage({ [AS.LS_INCLUDE]: '[1,2]' })), AS.DEFAULT_INCLUDE);
  AS.saveInclude(st, { scan: true, health: true });
  // v3 writes the object loadInclude built: every source, in SOURCES order
  assert.equal(st.getItem(AS.LS_INCLUDE), '{"scan":true,"tasks":true,"projects":true,"health":true,"browser":false,"vault":false}');
  assert.deepEqual(AS.SOURCES.map((s) => s.id), ['scan', 'tasks', 'projects', 'health', 'browser', 'vault']);
  assert.equal(AS.SOURCES.find((s) => s.id === 'health').tip, 'The SYSTEM tab\'s vitals');
});

test('meta line follows v3 metaNode', () => {
  const [, done, , stopped, , err, , unav] = v3Messages();
  assert.equal(AS.metaLine(done.meta), 'grounded in Scan · Tasks (trimmed) · Vault: no notes matched: foo · 1.4s');
  assert.equal(AS.metaLine(stopped.meta), 'stopped · grounded in Scan · 0.8s');
  assert.equal(AS.metaLine(err.meta), 'error — bad job id');
  assert.equal(AS.metaLine(unav.meta), 'model offline — connect ECONNREFUSED');
  assert.equal(AS.metaLine({ status: 'done', sections: [{ label: 'Scan', chars: 0 }], ms: 50 }), 'no sources ticked · 0.1s');
  assert.equal(AS.metaLine({ status: 'unavailable' }), 'model offline — no runtime');
  assert.equal(AS.metaLine({ pending: true }), '');
  assert.equal(AS.metaLine(undefined), '');
});

test('job ids are v3-shaped and pass main\'s check', () => {
  for (let i = 0; i < 50; i++) assert.match(AS.jobId(), /^or-[a-z0-9]+-[a-z0-9]{1,5}$/);
  assert.match(AS.jobId(), /^[a-z0-9-]{4,40}$/i);
  assert.match(AS.today(new Date(2026, 0, 2, 23, 59)), /^2026-01-02$/);
});
