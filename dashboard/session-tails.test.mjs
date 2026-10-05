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

// ---------------------------------------------------------------- cwd (v5 clean pass)
// hq:session-start records the contained cwd so the renderer can map a session
// to its project; withTails adds it as `cwd` on the way out.
const CWD_A = 'C:\Users\someone\Documents\project-a';
const CWD_B = 'C:\Users\someone\Documents\project-b';

test('a job with a recorded cwd gains a cwd field next to its parsed tail', () => {
  tails.record('cs-1', 'parsed\n');
  tails.setCwd('cs-1', CWD_A);
  const out = tails.withTails([sess('cs-1')]);
  assert.equal(out[0].cwd, CWD_A);
  assert.equal(out[0].tail, 'parsed\n', 'tail substitution unchanged');
});

test('cwd alone (no tail recorded) still decorates — the empty-tails short-circuit does not hide it', () => {
  tails.setCwd('cs-1', CWD_A);
  const input = [sess('cs-1')];
  const out = tails.withTails(input);
  assert.equal(out[0].cwd, CWD_A);
  assert.equal(out[0].tail, RAW_JSON_TAIL, 'no parsed tail recorded: the raw tail is not touched');
  assert.notEqual(out[0], input[0], 'fresh object');
  assert.equal(input[0].cwd, undefined, 'registry entry not mutated');
});

test('jobs without a recorded cwd get no cwd key and keep their object reference', () => {
  tails.record('cs-1', 'ours\n');
  tails.setCwd('cs-1', CWD_A);
  const quest = sess('cs-quest');
  const out = tails.withTails([quest, sess('cs-1')]);
  assert.equal(out[0], quest, 'foreign job untouched');
  assert.equal('cwd' in out[0], false);
  assert.equal(out[1].cwd, CWD_A);
});

test('a parsed-tail job without a recorded cwd has no cwd key (absent, not null)', () => {
  tails.record('cs-1', 'parsed\n');
  const out = tails.withTails([sess('cs-1')]);
  assert.equal('cwd' in out[0], false);
});

test('setCwd ignores junk instead of poisoning the table', () => {
  assert.doesNotThrow(() => tails.setCwd(null, CWD_A));
  assert.doesNotThrow(() => tails.setCwd('', CWD_A));
  assert.doesNotThrow(() => tails.setCwd('cs-1', null));
  assert.doesNotThrow(() => tails.setCwd('cs-1', ''));
  assert.doesNotThrow(() => tails.setCwd('cs-1', 42));
  const input = [sess('cs-1')];
  assert.equal(tails.withTails(input), input, 'nothing was recorded');
});

test('the latest setCwd for a job wins', () => {
  tails.setCwd('cs-1', CWD_A);
  tails.setCwd('cs-1', CWD_B);
  assert.equal(tails.withTails([sess('cs-1')])[0].cwd, CWD_B);
});

test('the cwd table is FIFO-capped like the tails and evicts the OLDEST job', () => {
  for (let i = 0; i < tails.MAX_JOBS + 5; i++) tails.setCwd('cs-' + i, CWD_A);
  const out = tails.withTails([sess('cs-0'), sess('cs-4'), sess('cs-5'), sess('cs-' + (tails.MAX_JOBS + 4))]);
  assert.equal('cwd' in out[0], false, 'oldest evicted');
  assert.equal('cwd' in out[1], false);
  assert.equal(out[2].cwd, CWD_A, 'newest kept');
  assert.equal(out[3].cwd, CWD_A);
});

test('_reset clears the cwd table too', () => {
  tails.setCwd('cs-1', CWD_A);
  tails._reset();
  const input = [sess('cs-1')];
  assert.equal(tails.withTails(input), input);
});

test('a cwd keyed by an Object prototype name is a Map entry, not a property hit', () => {
  tails.setCwd('cs-1', CWD_A);
  const out = tails.withTails([sess('constructor'), sess('__proto__')]);
  assert.equal('cwd' in out[0], false);
  assert.equal('cwd' in out[1], false);
});
