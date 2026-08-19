// node --test dashboard/session-tails.test.mjs — the parsed-tail side table
// (v4.1 D2). What matters here is the DEFECT it exists to prevent: after a
// window reload the renderer's live buffer is gone and the panes fall back to
// the registry `tail`, which for a stream-json session is raw JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tails = require('./session-tails.js');

const RAW_JSON_TAIL = '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n';
const sess = (jobId, extra = {}) => ({ jobId, label: 'l', status: 'done', tail: RAW_JSON_TAIL, ...extra });

test.beforeEach(() => tails._reset());

test('a recorded job has its raw tail replaced by the parsed text', () => {
  tails.record('cs-1', 'Looking at the file.\n[tool: Read a.js]\n');
  const out = tails.withTails([sess('cs-1')]);
  assert.equal(out[0].tail, 'Looking at the file.\n[tool: Read a.js]\n');
  assert.ok(!out[0].tail.includes('{"type"'), 'no raw stream-json survives');
});

test('an UNrecorded job keeps its raw tail, same object reference', () => {
  tails.record('cs-1', 'ours\n');
  const other = sess('cs-quest');
  const out = tails.withTails([other]);
  assert.equal(out[0], other, 'foreign jobs (claude-quest, draft-commit) are untouched');
  assert.equal(out[0].tail, RAW_JSON_TAIL);
});

test('a claimed-but-silent job returns an EMPTY tail, never the raw JSON', () => {
  // record(id, '') is the dispatch-time claim: the pane must show its honest
  // "nothing reached this window" state, not a wall of protocol envelopes.
  tails.record('cs-1', '');
  const out = tails.withTails([sess('cs-1')]);
  assert.equal(out[0].tail, '');
});

test('chunks accumulate in order and roll at the 800-char window', () => {
  tails.record('cs-1', 'a'.repeat(500));
  tails.record('cs-1', 'b'.repeat(500));
  const out = tails.withTails([sess('cs-1')]);
  assert.equal(out[0].tail.length, tails.TAIL);
  assert.equal(out[0].tail, 'a'.repeat(300) + 'b'.repeat(500));   // oldest dropped, order kept
});

test('the input list is never mutated (decoration returns fresh objects)', () => {
  tails.record('cs-1', 'parsed\n');
  const input = [sess('cs-1')];
  const out = tails.withTails(input);
  assert.equal(input[0].tail, RAW_JSON_TAIL, 'registry entry untouched');
  assert.notEqual(out[0], input[0]);
  assert.equal(out[0].status, 'done', 'every other field carries over');
  assert.equal(out[0].jobId, 'cs-1');
});

test("the registry's [timeout] marker survives the swap", () => {
  // claude-sessions.js writes '\n[timeout]' straight into its buffer, bypassing
  // onOutput — the parser never sees it, so withTails has to carry it.
  tails.record('cs-1', 'partial answer\n');
  const out = tails.withTails([sess('cs-1', { tail: RAW_JSON_TAIL + '\n[timeout]' })]);
  assert.equal(out[0].tail, 'partial answer\n\n[timeout]');
  assert.ok(!out[0].tail.includes('{"type"'));
});

test('[timeout] is not duplicated when the parsed text already ends with it', () => {
  tails.record('cs-1', 'done\n[timeout]');
  const out = tails.withTails([sess('cs-1', { tail: '[timeout]' })]);
  assert.equal(out[0].tail, 'done\n[timeout]');
});

test('the job map is FIFO-capped and evicts the OLDEST job', () => {
  for (let i = 0; i < tails.MAX_JOBS + 5; i++) tails.record('cs-' + i, 'x');
  assert.equal(tails.has('cs-0'), false, 'oldest evicted');
  assert.equal(tails.has('cs-4'), false);
  assert.equal(tails.has('cs-5'), true, 'newest kept');
  assert.equal(tails.has('cs-' + (tails.MAX_JOBS + 4)), true);
});

test('re-recording an existing job does not refresh its FIFO position', () => {
  tails.record('cs-old', 'a');
  for (let i = 0; i < tails.MAX_JOBS - 1; i++) tails.record('cs-' + i, 'x');
  tails.record('cs-old', 'more');                 // touch it, then overflow by one
  tails.record('cs-overflow', 'x');
  assert.equal(tails.has('cs-old'), false, 'insertion order governs, matching the registry lifetime');
});

test('never throws, never drops entries, on hostile or empty input', () => {
  tails.record('cs-1', 'ok\n');
  assert.doesNotThrow(() => tails.withTails(null));
  assert.equal(tails.withTails(null), null);
  assert.equal(tails.withTails('nope'), 'nope');
  const weird = [null, 42, { noJobId: true }, sess('cs-1')];
  const out = tails.withTails(weird);
  assert.equal(out.length, 4, 'nothing is dropped');
  assert.equal(out[0], null);
  assert.equal(out[1], 42);
  assert.equal(out[2], weird[2]);
  assert.equal(out[3].tail, 'ok\n');
});

test('record ignores a missing/non-string jobId instead of poisoning the map', () => {
  assert.doesNotThrow(() => tails.record(null, 'x'));
  assert.doesNotThrow(() => tails.record('', 'x'));
  assert.doesNotThrow(() => tails.record('cs-1', null));
  assert.equal(tails.has('cs-1'), true);
  assert.equal(tails.withTails([sess('cs-1')])[0].tail, '');
});

test('an empty table returns the list untouched (no allocation, no substitution)', () => {
  const input = [sess('cs-1')];
  assert.equal(tails.withTails(input), input);
});

test("a jobId named like an Object prototype key is not treated as present", () => {
  const out = tails.withTails([sess('constructor'), sess('__proto__')]);
  assert.equal(out[0].tail, RAW_JSON_TAIL, 'Map lookup, not property lookup');
  assert.equal(out[1].tail, RAW_JSON_TAIL);
});
