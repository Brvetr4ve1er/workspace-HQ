// The Brief's session-waiting rule (dashboard/brief-session-waiting.mjs). Placeholder data only (public repo).
//   node --test dashboard/brief-session-waiting.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_WAITING_FN, waitingCards, WAIT_MIN_MS, WAITING_MAX_MS } from './brief-session-waiting.mjs';
import { KEYS } from './brief-act-core.mjs';
import { projectBrief, WORDING } from './brief-project.mjs';

const MIN = 60e3, H = 3600e3;
const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const TITLE = 'PLANTED CHAT TITLE zebra';
const TOOL = 'PLANTED_TOOL_NAME';
const PROJ = 'Placeholder Site';

const card = (id, waitedMin, o = {}) => ({
  id, title: TITLE, project: { id: 'p1', name: PROJ, matched: 'confirmed' }, state: 'waiting-tool', lastAt: iso(NOW - waitedMin * MIN),
  lastTool: TOOL, sentence: 'asked to run ' + TOOL + ' — no result since (a permission prompt, or a long tool)', ...o,
});
const board = (sessions, o = {}) => ({ v: 1, generatedAt: iso(NOW), state: 'ok', sessions, ...o });
const fn = SESSION_WAITING_FN['session-waiting'];
const run = (sessionBoard, now = NOW) => fn({ now, sessionBoard });

test('the rule is registered under its id, as a function', () => {
  assert.deepEqual(Object.keys(SESSION_WAITING_FN), ['session-waiting']);
  assert.equal(typeof fn, 'function');
  assert.equal(WAIT_MIN_MS, 15 * MIN);
  assert.equal(WAITING_MAX_MS, 2 * H);   // sessions-core.mjs turns older waiting cards into 'stopped-mid-tool'
});

test('fires at 15 min and at 119 min; silent at 14 min and at 121 min', () => {
  assert.ok(run(board([card('s1', 15)])), '15 min');
  assert.ok(run(board([card('s1', 119)])), '119 min');
  assert.ok(run(board([card('s1', 120)])), 'exactly 2 h is "at most 2 h"');
  assert.equal(run(board([card('s1', 14)])), null, '14 min');
  assert.equal(run(board([card('s1', 14.9)])), null, '14 min 54 s');
  assert.equal(run(board([card('s1', 121)])), null, '121 min');
});

test('the item: med severity, honest wording, the sessions action, the shape brief-core expects', () => {
  const it = run(board([card('s1', 40)]));
  assert.equal(it.severity, 'med');
  assert.equal(it.text, PROJ + ': a Claude session has waited on a tool for 40 min');
  assert.equal(it.why, 'It may be a long-running tool or a permission prompt. Check its own terminal window.');
  assert.equal(it.source, 'claude-code');
  assert.deepEqual(it.action, { kind: 'go', tab: 'claude', sub: 'sessions' });
  assert.equal(it.others, 0);
  assert.equal(it.key, KEYS.sessionWaiting('s1', iso(NOW - 40 * MIN)));
  assert.equal(it.key, 'session-waiting:s1:' + iso(NOW - 40 * MIN));
  for (const f of ['key', 'severity', 'text', 'why', 'source', 'age', 'action', 'others']) assert.ok(f in it, f);
});

test('long waits read in hours and minutes', () => {
  assert.match(run(board([card('s1', 60)])).text, /for 1 h$/);
  assert.match(run(board([card('s1', 65)])).text, /for 1 h 5 min$/);
  assert.match(run(board([card('s1', 119)])).text, /for 1 h 59 min$/);
});

test('silent for an Esc stop, any other state, an error-state board, a board with an error, and an absent board', () => {
  for (const state of ['no-reply', 'stopped-mid-tool', 'running', 'finished', 'quiet', 'limit', 'api-error']) assert.equal(run(board([card('s1', 40, { state })])), null, state);
  assert.equal(run(board([card('s1', 40)], { state: 'hub-down', error: 'Claude Hub is not running' })), null);
  assert.equal(run(board([card('s1', 40)], { state: 'starting' })), null);
  assert.equal(run(board([card('s1', 40)], { error: 'x' })), null);
  for (const absent of [undefined, null, 'x', 7, [], {}, { state: 'ok' }, { state: 'ok', sessions: 'no' }]) assert.equal(run(absent), null, JSON.stringify(absent));
  assert.equal(fn({ now: NOW }), null);
  assert.equal(fn(undefined), null);
});

test('bad cards are skipped: no id, no usable lastAt, a lastAt in the future', () => {
  assert.equal(run(board([card('', 40)])), null);
  assert.equal(run(board([{ ...card('s1', 40), id: 7 }])), null);
  assert.equal(run(board([card('s1', 40, { lastAt: 'not a date' })])), null);
  assert.equal(run(board([card('s1', 40, { lastAt: undefined })])), null);
  assert.equal(run(board([card('s1', -30)])), null, 'a card from the future has waited for nothing');
  assert.equal(run(board([null, 5, 'x', card('s2', 30)])).key, 'session-waiting:s2:' + iso(NOW - 30 * MIN));
});

test('the key re-keys on a new lastAt (a session that moved on and stalled again is a new fact)', () => {
  const a = run(board([card('s1', 30)])), b = run(board([card('s1', 45)]));
  assert.notEqual(a.key, b.key);
  assert.equal(run(board([card('s1', 30)])).key, a.key, 'the same card is the same key');
});

test("'and N more' through count: the longest wait is named, the rest are folded", () => {
  const it = run(board([card('s1', 20), card('s2', 90, { project: { name: 'Second Place' } }), card('s3', 50)]));
  assert.equal(it.others, 2);
  assert.match(it.text, /^Second Place: a Claude session has waited on a tool for 1 h 30 min and 2 more sessions$/);
  const one = run(board([card('s1', 20), card('s2', 30)]));
  assert.match(one.text, / and 1 more session$/);
  // a card outside the window is not counted in the "more"
  assert.equal(run(board([card('s1', 20), card('s2', 200)])).others, 0);
});

test('waitingCards: longest wait first, ties by id, the window and the board state applied', () => {
  const cs = waitingCards(board([card('b', 30), card('a', 30), card('c', 100), card('d', 5), card('e', 500), card('f', 40, { state: 'running' })]), NOW);
  assert.deepEqual(cs.map((c) => c.id), ['c', 'a', 'b']);
  assert.deepEqual(waitingCards(board([card('a', 30)], { state: 'hub-down' }), NOW), []);
  assert.deepEqual(waitingCards(null, NOW), []);
});

test('no chat title and no tool name reaches the text, the why or the age (planted in the fixture)', () => {
  const it = run(board([card('s1', 40), card('s2', 50)]));
  const said = [it.text, it.why, it.age, it.source, JSON.stringify(it.action)].join(' | ');
  assert.doesNotMatch(said, /PLANTED|zebra|TOOL_NAME/i);
  assert.match(said, new RegExp(PROJ));   // the project is named: it is the main window, like every other item
});

test('an owner-typed project name is one line and at most 60 characters; no project gives a plain lead', () => {
  const long = 'N'.repeat(80) + '\nsecond line';
  const it = run(board([card('s1', 40, { project: { name: long } })]));
  assert.ok(it.text.startsWith('N'.repeat(60) + ': a Claude session'), it.text);
  assert.doesNotMatch(it.text, /\n/);
  assert.match(run(board([card('s1', 40, { project: { name: '   ' } })])).text, /^A Claude session has waited on a tool for 40 min$/);
  assert.match(run(board([card('s1', 40, { project: undefined })])).text, /^A Claude session has waited/);
});

test('the screen-safe projection leaks no project name, chat title, tool name or session id', () => {
  const it = run(board([card('sess-private-1', 40)]));
  const brief = { v: 1, generatedAt: iso(NOW), items: [{ ...it, rule: 'session-waiting', count: it.others }], more: 0, overflow: [], standing: [], errors: [] };
  const p = projectBrief(brief, { now: new Date(NOW), firstSeen: {} });
  const dump = JSON.stringify(p);
  assert.doesNotMatch(dump, /Placeholder Site|PLANTED|zebra|TOOL_NAME|sess-private/i);
  assert.equal(p.items.length, 1);
  assert.ok(['session-waiting', 'unknown'].includes(p.items[0].rule), 'unknown only until the WORDING row lands');
});

// the wording row lives in brief-project.mjs (a shared edit). Until it lands the projection says the generic "Something needs you";
// this test turns on by itself the moment the row exists, so the gap is visible (skipped) and not silent.
const hasRow = Object.prototype.hasOwnProperty.call(WORDING, 'session-waiting');
test('the projection has a wording row for session-waiting, honest and without names', { skip: hasRow ? false : 'waits for the brief-project.mjs WORDING row (shared edit)' }, () => {
  const w = WORDING['session-waiting'];
  assert.match(w.one, /^A Claude session has waited on a tool for a while$/);
  assert.ok(w.short && w.many && w.shortMany);
  const it = run(board([card('s1', 40), card('s2', 50)]));
  const p = projectBrief({ v: 1, generatedAt: iso(NOW), items: [{ ...it, rule: 'session-waiting', count: it.others }], more: 0, overflow: [], standing: [], errors: [] }, { now: new Date(NOW), firstSeen: {} });
  assert.match(p.items[0].text, /Claude session/);
});
