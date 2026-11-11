// The app door's pure rules (dashboard/intent-core.mjs). No IO; placeholder rows only — the repo is public.
//   node --test dashboard/intent-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from './intent-core.mjs';
import { refOf } from './brief-project.mjs';

const NOW = Date.parse('2026-11-11T10:00:00Z');
const MIN = 60e3;
const iso = (ms) => new Date(ms).toISOString();
const ID = 'a1'.repeat(16);
const row = (key, rule = 'dirty', severity = 'low') => ({ key, rule, severity, text: 'Placeholder text for ' + key, why: 'why', source: 'scan', age: 'live', action: null, count: 0 });
const brief = (o = {}) => ({ items: [row('dirty:p1:12'), row('unpushed:p2:3', 'unpushed', 'med')], overflow: [row('ci-red:p3:1', 'ci-red', 'med')], standing: [row('dirty:p9:40')], ...o });
const body = (o = {}) => JSON.stringify({ v: 1, verb: 'brief.dismiss', ref: refOf('dirty:p1:12'), at: iso(NOW - 30e3), by: 'mcp', ...o });
const applied = (i, extra = {}) => ({ v: 1, at: iso(NOW - i * MIN), door: 'mcp', tool: 'intent.applied', tier: 'note', ok: true, ms: 3, pid: 9, ...extra });

test('ids, refs and the three file names', () => {
  assert.equal(C.validId(ID), true);
  for (const bad of ['', 'a1'.repeat(15), 'A1'.repeat(16), 'g1'.repeat(16), ID + '0', '../' + ID, null, 5]) assert.equal(C.validId(bad), false, String(bad));
  assert.equal(C.validRef('0123456789ab'), true);
  for (const bad of ['0123456789a', '0123456789abc', '0123456789AB', 'dirty:p1:12', '', null, 12]) assert.equal(C.validRef(bad), false, String(bad));
  assert.equal(C.inboxName(ID), ID + '.json');
  assert.equal(C.takenName(ID), ID + '.taken');
  assert.equal(C.answerName(ID), ID + '.answer.json');
  assert.deepEqual(C.parseName(ID + '.json'), { kind: 'request', id: ID });
  assert.deepEqual(C.parseName(ID + '.taken'), { kind: 'taken', id: ID });
  assert.deepEqual(C.parseName(ID + '.json.tmp'), { kind: 'tmp', id: ID });
  for (const bad of ['notes.txt', 'x.json', ID.toUpperCase() + '.json', ID + '.json.bak', '.' + ID + '.json', ID + '.answer.json']) assert.equal(C.parseName(bad), null, bad);
});

test('checkFileMeta: regular file, size, age by mtime (9 min ok, 11 min refused, future refused)', () => {
  const ok = (o) => C.checkFileMeta({ isFile: true, size: 200, mtimeMs: NOW - 5e3, ...o }, NOW);
  assert.equal(ok({}).ok, true);
  assert.equal(ok({ isFile: false }).code, 'not-file');
  assert.equal(ok({ size: 0 }).code, 'size');
  assert.equal(ok({ size: 8 * 1024 }).ok, true);
  assert.equal(ok({ size: 8 * 1024 + 1 }).code, 'size');
  assert.equal(ok({ mtimeMs: NOW - 9 * MIN }).ok, true);
  assert.equal(ok({ mtimeMs: NOW - 11 * MIN }).code, 'stale');
  assert.equal(ok({ mtimeMs: NOW + 30e3 }).ok, true);
  assert.equal(ok({ mtimeMs: NOW + 2 * MIN }).code, 'future');
  assert.equal(C.checkFileMeta(null, NOW).ok, false);
});

test('validateRequest: shape, version, verb allowlist, ref, age window, and the mtime must agree', () => {
  const v = (text, mtime = NOW - 30e3) => C.validateRequest(text, mtime, NOW);
  const good = v(body());
  assert.equal(good.ok, true);
  assert.deepEqual(Object.keys(good.req).sort(), ['at', 'by', 'ref', 'v', 'verb']);
  assert.equal(v(body({ at: iso(NOW - 9 * MIN) }), NOW - 9 * MIN).ok, true, '9 minutes old is fine');
  assert.equal(v(body({ at: iso(NOW - 11 * MIN) }), NOW - 11 * MIN).code, 'stale');
  assert.equal(v(body({ at: iso(NOW + 2 * MIN) }), NOW + 2 * MIN).code, 'future');
  assert.equal(v(body({ at: iso(NOW + 30e3) }), NOW + 30e3).ok, true, 'a few seconds of clock drift is fine');
  assert.equal(v(body({ verb: 'brief.clear' })).code, 'verb');
  assert.equal(v(body({ verb: 'quest.done' })).error, C.WORDS.unknownVerb);
  assert.equal(v(body({ v: 2 })).code, 'version');
  assert.equal(v(body({ by: 'browser' })).code, 'by');
  for (const ref of ['dirty:p1:12', '0123456789A', 12, null, '0123456789abcd']) assert.equal(v(body({ ref })).code, 'ref', String(ref));
  assert.equal(v(body({ at: 'yesterday' })).code, 'at');
  assert.equal(v(body({ at: 12345 })).code, 'at');
  assert.equal(v(body({ key: 'dirty:p1:12' })).code, 'extra-key', 'an unknown field is never carried along');
  assert.equal(v('{not json').code, 'json');
  assert.equal(v('[]').code, 'shape');
  assert.equal(v('').code, 'empty');
  assert.equal(v(body(), NOW - 20 * MIN).code, 'mtime', 'the file is far older than the date it claims');
  assert.equal(v(body(), NaN).code, 'mtime');
  assert.equal(v(body({ pad: 'x'.repeat(9000) })).code, 'size');
});

test('buildRequest writes exactly what validateRequest accepts', () => {
  const r = C.buildRequest({ ref: refOf('dirty:p1:12'), now: NOW, id: ID });
  assert.equal(r.name, ID + '.json');
  assert.ok(Buffer.byteLength(r.text) < 300);
  assert.equal(C.validateRequest(r.text, NOW, NOW).ok, true);
  assert.deepEqual(JSON.parse(r.text), { v: 1, verb: 'brief.dismiss', ref: refOf('dirty:p1:12'), at: iso(NOW), by: 'mcp' });
});

test('validateArgs: only a 12-hex ref, nothing else', () => {
  assert.deepEqual(C.validateArgs({ ref: '0123456789ab' }), { ok: true, ref: '0123456789ab' });
  const refused = [undefined, null, 'ref', 5, [], {}, { ref: 3 }, { ref: '' }, { ref: 'dirty:p1:12' }, { ref: '0123456789ABCDEF' }, { key: 'dirty:p1:12' },
    { index: 0 }, { rule: 'dirty' }, { text: 'dismiss the dirty one' }, { ref: '0123456789ab', key: 'dirty:p1:12' }, { ref: '0123456789ab', extra: 1 }, { ref: ['0123456789ab'] }];
  for (const a of refused) { const r = C.validateArgs(a); assert.equal(r.ok, false, JSON.stringify(a)); assert.equal(r.error, C.WORDS.badArg); }
});

test('resolveRef: exactly one row of the top three; zero, two, overflow and standing each refused in their own words', () => {
  const b = brief();
  const one = C.resolveRef(refOf('dirty:p1:12'), b);
  assert.equal(one.ok, true);
  assert.equal(one.key, 'dirty:p1:12');
  const none = C.resolveRef(refOf('dirty:gone:1'), b);
  assert.deepEqual([none.ok, none.code, none.error], [false, 'none', 'the Brief moved on']);
  const dup = C.resolveRef(refOf('dirty:p1:12'), brief({ items: [row('dirty:p1:12'), row('dirty:p1:12'), row('unpushed:p2:3', 'unpushed', 'med')] }));
  assert.deepEqual([dup.ok, dup.code, dup.error], [false, 'ambiguous', 'the Brief moved on']);
  const over = C.resolveRef(refOf('ci-red:p3:1'), b);
  assert.deepEqual([over.ok, over.code, over.error], [false, 'overflow', 'that row is not in the top three, dismiss it in the app']);
  const stand = C.resolveRef(refOf('dirty:p9:40'), b);
  assert.deepEqual([stand.ok, stand.code], [false, 'standing']);
  assert.notEqual(stand.error, over.error, 'a standing row has its own words');
  assert.match(stand.error, /standing/);
  assert.equal(C.resolveRef(refOf('dirty:p1:12'), null).code, 'no-brief');
  assert.equal(C.resolveRef(refOf('dirty:p1:12'), { items: 'x' }).code, 'no-brief');
  assert.equal(C.resolveRef('not-a-ref', b).code, 'ref');
  // a row listed in items that is also (oddly) in overflow still resolves from items
  assert.equal(C.resolveRef(refOf('dirty:p1:12'), brief({ overflow: [row('dirty:p1:12')] })).ok, true);
});

test('policy: never a high row, never the secrets rule', () => {
  assert.equal(C.policy(row('dirty:p1:12')).ok, true);
  assert.equal(C.policy(row('unpushed:p2:3', 'unpushed', 'med')).ok, true);
  const high = C.policy(row('scan-failed:x', 'scan-failed', 'high'));
  assert.deepEqual([high.ok, high.code, high.error], [false, 'urgent', C.WORDS.urgent]);
  assert.equal(C.policy(row('secrets:p1:2', 'secrets', 'high')).ok, false);
  assert.equal(C.policy(row('secrets:p1:2', 'secrets', 'low')).ok, false, 'the rule alone is enough');
  assert.equal(C.policy(null).ok, false);
});

test('capState: 10 an hour counted from the lines the app wrote, and only those', () => {
  const nine = Array.from({ length: 9 }, (_, i) => applied(i + 1));
  assert.deepEqual(C.capState(nine, NOW), { used: 9, allow: true });
  const ten = nine.concat([applied(10)]);
  assert.deepEqual(C.capState(ten, NOW), { used: 10, allow: false });
  assert.equal(C.capState(ten.concat([applied(70)]), NOW).used, 10, 'a line past the hour is not counted');
  assert.equal(C.capState([applied(59)], NOW).used, 1);
  // the guard's own line for the call, other tools, other doors, failures and malformed lines never count
  const noise = [applied(1, { tool: 'hq_brief_dismiss' }), applied(1, { tool: 'hq_capture' }), applied(1, { door: 'browser' }), applied(1, { tier: 'read' }), applied(1, { ok: false, reason: 'declined' }),
    { at: 'nope', tool: 'intent.applied' }, null, 'x', applied(-30)];
  assert.equal(C.capState(noise, NOW).used, 0);
  assert.equal(C.capState([applied(1, { ok: false, reason: C.MAY_HAVE_RUN })], NOW).used, 1, 'a request that may have run counts');
  assert.equal(C.capState(null, NOW).used, 0);
});

test('decide: the table in order - cap, one row, not urgent - and the words of each refusal', () => {
  const req = { v: 1, verb: 'brief.dismiss', ref: refOf('dirty:p1:12'), at: iso(NOW), by: 'mcp' };
  const d = (o) => C.decide({ req, brief: brief(), entries: [], now: NOW, ...o });
  assert.deepEqual(d({}), { apply: true, key: 'dirty:p1:12' });
  assert.deepEqual([d({ req: { ...req, ref: refOf('ci-red:p3:1') } }).apply, d({ req: { ...req, ref: refOf('ci-red:p3:1') } }).error], [false, C.WORDS.notTop]);
  assert.equal(d({ req: { ...req, ref: refOf('dirty:p9:40') } }).code, 'standing');
  assert.equal(d({ req: { ...req, ref: refOf('nothing:here') } }).error, C.WORDS.movedOn);
  const urgent = brief({ items: [row('scan-failed:x', 'scan-failed', 'high')] });
  assert.equal(d({ brief: urgent, req: { ...req, ref: refOf('scan-failed:x') } }).error, C.WORDS.urgent);
  const sec = brief({ items: [row('secrets:p1:2', 'secrets', 'high'), row('dirty:p1:12')] });
  assert.equal(d({ brief: sec, req: { ...req, ref: refOf('secrets:p1:2') } }).code, 'urgent');
  assert.equal(d({ brief: sec }).apply, true, 'a row next to a secrets row is still dismissable');
  const full = Array.from({ length: 10 }, (_, i) => applied(i + 1));
  const capped = d({ entries: full });
  assert.deepEqual([capped.apply, capped.code, capped.error], [false, 'cap', C.WORDS.cap]);
  assert.equal(d({ entries: full, req: { ...req, ref: refOf('nothing:here') } }).code, 'cap', 'the cap is asked first');
  assert.equal(d({ req: { ...req, verb: 'quest.done' } }).code, 'verb');
  assert.equal(d({ req: null }).apply, false);
});

test('answer: words only, and ok:true only ever says dismissed', () => {
  assert.deepEqual(C.answer(true, 'anything', NOW), { v: 1, ok: true, outcome: 'dismissed', at: iso(NOW) });
  assert.deepEqual(C.answer(false, C.WORDS.movedOn, NOW), { v: 1, ok: false, error: 'the Brief moved on', at: iso(NOW) });
  assert.equal(C.answer(false, '', NOW).error, C.WORDS.failed);
  assert.equal(C.answer(false, 'line one\nline two\u0007', NOW).error, 'line one line two');
  assert.ok(C.answer(false, 'x'.repeat(500), NOW).error.length <= C.LIMITS.errorMax);
  assert.equal(C.answer('yes', 'x', NOW).ok, false, 'only a strict true is ok');
  // the door's read of an answer file
  assert.deepEqual(C.readAnswer(JSON.stringify(C.answer(true, '', NOW))), { ok: true, outcome: 'dismissed' });
  assert.deepEqual(C.readAnswer(JSON.stringify(C.answer(false, C.WORDS.cap, NOW))), { ok: false, error: C.WORDS.cap });
  for (const bad of ['', '{', '[]', '{"v":2,"ok":true,"outcome":"dismissed"}', '{"v":1,"ok":true,"outcome":"nuked everything"}', '{"v":1,"ok":"yes"}', 'x'.repeat(5000)]) assert.equal(C.readAnswer(bad), null, bad.slice(0, 30));
});

test('heartbeat: absent, stale, unreadable and a dead pid all say closed; a fresh live one says open', () => {
  const hb = (o = {}) => JSON.stringify({ v: 1, pid: 4242, at: iso(NOW - 5e3), ...o });
  const alive = (p) => p === 4242;
  assert.deepEqual(C.heartbeat(hb(), NOW, alive), { open: true, pid: 4242 });
  assert.deepEqual(C.heartbeat(null, NOW, alive), { open: false, why: 'absent' });
  assert.equal(C.heartbeat('{', NOW, alive).why, 'unreadable');
  assert.equal(C.heartbeat(hb({ at: iso(NOW - 61e3) }), NOW, alive).why, 'stale');
  assert.equal(C.heartbeat(hb({ at: iso(NOW - 59e3) }), NOW, alive).open, true);
  assert.equal(C.heartbeat(hb({ at: iso(NOW + 5 * MIN) }), NOW, alive).open, false, 'a heartbeat from the future is not trusted');
  assert.equal(C.heartbeat(hb({ pid: 9999 }), NOW, alive).why, 'dead');
  assert.equal(C.heartbeat(hb(), NOW, () => { throw new Error('x'); }).open, false);
  assert.equal(C.heartbeat(hb(), NOW, undefined).open, false);
  for (const bad of [{ pid: 0 }, { pid: -3 }, { pid: '4242' }, { v: 2 }, { at: 'x' }]) assert.equal(C.heartbeat(hb(bad), NOW, alive).open, false, JSON.stringify(bad));
  assert.deepEqual(C.heartbeatBody(4242, NOW), { v: 1, pid: 4242, at: iso(NOW) });
});

test('sweep age rules', () => {
  assert.equal(C.isOldAnswer(NOW - 59 * MIN, NOW), false);
  assert.equal(C.isOldAnswer(NOW - 61 * MIN, NOW), true);
  assert.equal(C.isOldTmp(NOW - 9 * MIN, NOW), false);
  assert.equal(C.isOldTmp(NOW - 11 * MIN, NOW), true);
  assert.equal(C.isOldAnswer(NaN, NOW), false);
});

test('no answer word names a row, a key or a ref', () => {
  for (const [k, w] of Object.entries(C.WORDS)) {
    assert.doesNotMatch(w, /[0-9a-f]{12}/, k);
    assert.doesNotMatch(w, /:p\d|secrets:/, k);
  }
});
