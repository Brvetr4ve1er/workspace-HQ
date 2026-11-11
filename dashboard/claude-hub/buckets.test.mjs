// Hub op activityBuckets (the Today ribbon's Claude lane): 5-minute grouping per project, forgotten and people rows excluded,
// sidechain handling stated, UTC edges, an empty index. Placeholder projects only (public repo).
//   node --test dashboard/claude-hub/buckets.test.mjs
// The query lives in buckets.mjs and runs on the store's own handle (store.db), exactly as the store method will call it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './store.mjs';
import { activityBuckets, MAX_WINDOW_MS } from './buckets.mjs';

const T = (s) => Date.parse(s);
const msg = (id, at, role = 'user', extra = {}) => ({ id: 'code:m' + id, nativeId: 'm' + id, parentId: null, role, at, text: 'x', toolName: null, isSidechain: false, ...extra });
function seed(s) {
  s.upsertProject({ id: 'code:alpha', source: 'code', key: 'alpha', name: 'alpha-site', path: null });
  s.upsertProject({ id: 'code:beta', source: 'code', key: 'beta', name: 'beta-app', path: null });
  s.ensureConversation({ id: 'code:a1', source: 'code', projectId: 'code:alpha', nativeId: 'a1' });
  s.ensureConversation({ id: 'code:b1', source: 'code', projectId: 'code:beta', nativeId: 'b1' });
}
const win = { fromMs: T('2026-11-10T00:00:00.000Z'), toMs: T('2026-11-11T00:00:00.000Z') };

test('turns group into 5-minute blocks per project; the answer carries counts and ids, never names or text', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:a1', [msg(1, '2026-11-10T10:00:30.000Z'), msg(2, '2026-11-10T10:04:59.999Z', 'assistant'), msg(3, '2026-11-10T10:05:00.000Z'), msg(4, '2026-11-10T10:07:00.000Z', 'assistant')]);
  s.addMessages('code:b1', [msg(5, '2026-11-10T10:01:00.000Z')]);
  const r = activityBuckets(s.db, win);
  assert.deepEqual([r.fromMs, r.toMs, r.bucketMin], [win.fromMs, win.toMs, 5]);
  assert.deepEqual(r.buckets, [
    { project_id: 'code:alpha', start_ms: T('2026-11-10T10:00:00.000Z'), messages: 2 },
    { project_id: 'code:beta', start_ms: T('2026-11-10T10:00:00.000Z'), messages: 1 },
    { project_id: 'code:alpha', start_ms: T('2026-11-10T10:05:00.000Z'), messages: 2 },
  ]);
  const text = JSON.stringify(r);
  assert.ok(!text.includes('alpha-site') && !text.includes('beta-app'), 'no project name in the answer');
  assert.deepEqual(Object.keys(r.buckets[0]).sort(), ['messages', 'project_id', 'start_ms']);
  s.close();
});

test('another bucket size groups the same turns differently', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:a1', [msg(1, '2026-11-10T10:00:00.000Z'), msg(2, '2026-11-10T10:12:00.000Z'), msg(3, '2026-11-10T10:29:00.000Z')]);
  assert.deepEqual(activityBuckets(s.db, { ...win, bucketMin: 15 }).buckets.map((b) => [b.start_ms, b.messages]),
    [[T('2026-11-10T10:00:00.000Z'), 2], [T('2026-11-10T10:15:00.000Z'), 1]]);
  assert.equal(activityBuckets(s.db, { ...win, bucketMin: 60 }).buckets.length, 1);
  s.close();
});

test('forgotten chats and Instagram / Facebook rows never count', () => {
  const s = openStore(':memory:'); seed(s);
  s.ensureConversation({ id: 'ig:1', source: 'instagram', projectId: null, nativeId: '1' });
  s.ensureConversation({ id: 'fb:1', source: 'facebook', projectId: null, nativeId: '1' });
  s.ensureConversation({ id: 'code:gone', source: 'code', projectId: 'code:beta', nativeId: 'gone' });
  s.addMessages('code:a1', [msg(1, '2026-11-10T09:00:00.000Z')]);
  s.addMessages('ig:1', [msg(2, '2026-11-10T09:00:00.000Z')]);
  s.addMessages('fb:1', [msg(3, '2026-11-10T09:00:00.000Z')]);
  s.addMessages('code:gone', [msg(4, '2026-11-10T09:00:00.000Z')]);
  s.db.prepare("UPDATE conversation SET forgotten = 1 WHERE id = 'code:gone'").run();   // the flag alone must exclude it, not only a row delete
  assert.deepEqual(activityBuckets(s.db, win).buckets.map((b) => b.project_id), ['code:alpha']);
  s.close();
});

test('only user and assistant rows are turns; a tool-call assistant row and a sidechain turn both count (stated), system and tool rows do not', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:a1', [
    msg(1, '2026-11-10T08:00:00.000Z', 'system'),
    msg(2, '2026-11-10T08:05:00.000Z', 'tool'),
    msg(3, '2026-11-10T08:10:00.000Z', 'assistant', { toolName: 'Bash' }),
    msg(4, '2026-11-10T08:15:00.000Z', 'assistant', { isSidechain: true }),
    msg(5, '2026-11-10T08:20:00.000Z', 'user'),
  ]);
  assert.deepEqual(activityBuckets(s.db, win).buckets.map((b) => b.start_ms), [T('2026-11-10T08:10:00.000Z'), T('2026-11-10T08:15:00.000Z'), T('2026-11-10T08:20:00.000Z')]);
  s.close();
});

test('UTC edges: fromMs is included, toMs is not; a turn at 23:59:59.999 stays in the window; one a millisecond before from stays out', () => {
  const s = openStore(':memory:'); seed(s);
  s.addMessages('code:a1', [
    msg(1, '2026-11-09T23:59:59.999Z'), msg(2, '2026-11-10T00:00:00.000Z'), msg(3, '2026-11-10T23:59:59.999Z'), msg(4, '2026-11-11T00:00:00.000Z'),
  ]);
  assert.deepEqual(activityBuckets(s.db, win).buckets.map((b) => b.start_ms), [T('2026-11-10T00:00:00.000Z'), T('2026-11-10T23:55:00.000Z')]);
  // a local day east of UTC (UTC+2): [Nov 9 22:00Z, Nov 10 22:00Z) picks the Nov 9 23:59 turn up, and the 22:00 edge turn goes to the next day
  const east = { fromMs: T('2026-11-09T22:00:00.000Z'), toMs: T('2026-11-10T22:00:00.000Z') };
  const got = activityBuckets(s.db, east).buckets.map((b) => b.start_ms);
  assert.equal(got[0], T('2026-11-09T23:55:00.000Z'));
  assert.ok(got.includes(T('2026-11-10T23:55:00.000Z')) === false, 'after 22:00Z is the next local day');
  s.close();
});

test('an empty index answers an empty list, not an error; a chat with no project keeps a null project id', () => {
  const s = openStore(':memory:');
  assert.deepEqual(activityBuckets(s.db, win).buckets, []);
  s.ensureConversation({ id: 'code:loose', source: 'code', projectId: null, nativeId: 'loose' });
  s.addMessages('code:loose', [msg(1, '2026-11-10T12:00:00.000Z')]);
  assert.deepEqual(activityBuckets(s.db, win).buckets, [{ project_id: null, start_ms: T('2026-11-10T12:00:00.000Z'), messages: 1 }]);
  s.close();
});

test('bad arguments are errors: non-integers, an empty or inverted window, more than 8 days, a bucket size outside 1..60', () => {
  const s = openStore(':memory:');
  const bad = [{}, { fromMs: 'x', toMs: 5 }, { fromMs: 5, toMs: 5 }, { fromMs: 9, toMs: 5 }, { fromMs: 0.5, toMs: 10 },
    { fromMs: 0, toMs: MAX_WINDOW_MS + 1 }, { ...win, bucketMin: 0 }, { ...win, bucketMin: 61 }, { ...win, bucketMin: 2.5 }];
  for (const a of bad) assert.throws(() => activityBuckets(s.db, a), /activityBuckets:/, JSON.stringify(a));
  assert.doesNotThrow(() => activityBuckets(s.db, { fromMs: 0, toMs: MAX_WINDOW_MS }));
  s.close();
});

test('the query reads the message_at index range and never the text column', () => {
  const s = openStore(':memory:'); seed(s);
  const plan = s.db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE m.at >= ? AND m.at < ?").all('a', 'b').map((r) => r.detail).join(' | ');
  assert.match(plan, /message_at|conversation/, plan);
  s.addMessages('code:a1', [msg(1, '2026-11-10T09:00:00.000Z', 'user', { text: 'a secret sentence' })]);
  assert.ok(!JSON.stringify(activityBuckets(s.db, win)).includes('secret'));
  s.close();
});
