// Today ribbon live slice (src/live/today-slice.mjs), driven with a fake hq.today. Invented lane ids only (public repo).
//   node --test dashboard-v5/src/live/today-slice.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodaySlice, emptyToday, takeModel, OFFLINE } from './today-slice.mjs';

const model = (day, over = {}) => ({ ok: true, day, lanes: [{ id: 'claude', kind: 'claude', state: 'empty' }], spans: [], ticks: [], caption: '0 five-minute blocks with Claude, 0 commits, no PC sleep seen', counts: { claudeBlocks: 0 }, notes: [], ...over });
function rig(o = {}) {
  const calls = [], live = { today: emptyToday() };
  let emits = 0;
  const hq = o.noHq ? null : { today: o.noRead ? {} : { read: (a) => { calls.push(a); return o.read ? o.read(a) : Promise.resolve(model('2026-11-10')); } } };
  const slice = createTodaySlice({ hq, live, emit: () => { emits++; }, now: () => 1000, ...(o.pull ? { pull: o.pull } : {}) });
  return { slice, live, calls, emits: () => emits };
}

test('nothing has arrived: loaded is false, no day, no error', () => {
  const t = emptyToday();
  assert.deepEqual(t, { loaded: false, days: {}, errors: {}, revision: 0 });
});

test('a good answer lands with its time, bumps the revision and emits once', async () => {
  const { slice, live, calls, emits } = rig();
  const r = await slice.refreshToday(0);
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [{ dayOffset: 0 }]);
  assert.equal(live.today.loaded, true);
  assert.equal(live.today.days[0].model.day, '2026-11-10');
  assert.equal(live.today.days[0].at, 1000);
  assert.equal(live.today.revision, 1);
  assert.deepEqual(live.today.errors, {});
  assert.equal(emits(), 1);
});

test('the default day is today; days 0..6 are asked, anything else is refused and nothing is sent', async () => {
  const { slice, calls } = rig();
  await slice.refreshToday();
  assert.deepEqual(calls, [{ dayOffset: 0 }]);
  for (const bad of [7, -1, 'x', 1.5, null, NaN]) assert.match((await slice.refreshToday(bad)).error, /0 to 6/, String(bad));
  assert.equal(calls.length, 1);
  await slice.refreshToday(6);
  assert.deepEqual(calls.at(-1), { dayOffset: 6 });
});

test('a failed read keeps the last good model and records main’s own words; a later good read clears the error', async () => {
  let fail = false;
  const { slice, live } = rig({ read: () => Promise.resolve(fail ? { error: 'the day could not be built: disk' } : model('2026-11-10')) });
  await slice.refreshToday(0);
  fail = true;
  await slice.refreshToday(0);
  assert.equal(live.today.days[0].model.day, '2026-11-10', 'the previous copy stays on screen');
  assert.equal(live.today.errors[0], 'the day could not be built: disk');
  assert.equal(live.today.revision, 1);
  fail = false;
  await slice.refreshToday(0);
  assert.equal(live.today.errors[0], undefined);
  assert.equal(live.today.revision, 2);
});

test('an unusable answer is an error, never a half-made model: missing arrays, not ok, no day, junk, a throw', async () => {
  for (const bad of [{ ok: true, day: '2026-11-10', lanes: 'x', spans: [], ticks: [] }, { ok: true, lanes: [], spans: [], ticks: [] }, { ok: false, error: 'nope' }, null, 'text', 7, {}]) {
    const { slice, live } = rig({ read: () => Promise.resolve(bad) });
    await slice.refreshToday(1);
    assert.equal(live.today.days[1], undefined, JSON.stringify(bad));
    assert.ok(live.today.errors[1], JSON.stringify(bad));
    assert.equal(live.today.loaded, true, 'the answer arrived even though it was not usable');
  }
  const t = rig({ read: () => { throw new Error('ipc closed'); } });
  assert.match((await t.slice.refreshToday(0)).error, /ipc closed/);
  assert.match(t.live.today.errors[0], /ipc closed/);
  const rej = rig({ read: () => Promise.reject(new Error('no handler')) });
  await rej.slice.refreshToday(0);
  assert.match(rej.live.today.errors[0], /no handler/);
});

test('each day is its own entry: stepping back keeps today’s model, and an error on one day does not touch another', async () => {
  const { slice, live } = rig({ read: (a) => Promise.resolve(a.dayOffset === 2 ? { error: 'x' } : model('2026-11-' + String(10 - a.dayOffset).padStart(2, '0'))) });
  await slice.refreshToday(0); await slice.refreshToday(1); await slice.refreshToday(2);
  assert.deepEqual([live.today.days[0].model.day, live.today.days[1].model.day, live.today.days[2]], ['2026-11-10', '2026-11-09', undefined]);
  assert.deepEqual(Object.keys(live.today.errors), ['2']);
});

test('ten asks for one day at once are one read; a forced ask reads again; the newest answer lands', async () => {
  let n = 0; const gates = [];
  const { slice, live, calls } = rig({ read: () => new Promise((res) => { const k = ++n; gates.push(() => res(model('2026-11-10', { caption: 'answer ' + k }))); }) });
  const first = Array.from({ length: 10 }, () => slice.refreshToday(0));
  assert.equal(calls.length, 1);
  const forced = slice.refreshToday(0, { force: true });
  assert.equal(calls.length, 2);
  gates[1]();            // the forced (newer) one answers first
  await forced;
  gates[0]();            // the older answer must not roll it back
  await Promise.all(first);
  assert.equal(live.today.days[0].model.caption, 'answer 2');
  const third = slice.refreshToday(0);   // inflight is cleared: a new ask goes out
  assert.equal(calls.length, 3);
  gates[2]();
  await third;
});

test('with hq.today absent every call resolves the offline answer and nothing throws or changes', async () => {
  for (const o of [{ noHq: true }, { noRead: true }]) {
    const { slice, live, calls, emits } = rig(o);
    assert.deepEqual(await slice.refreshToday(0), { error: OFFLINE });
    assert.deepEqual([live.today, calls, emits()], [emptyToday(), [], 0]);
  }
});

test('the store’s pull is used when given: a failed pull never blanks the model, and its landing function is the slice’s own', async () => {
  const seen = [];
  const pull = (p, fn) => { seen.push(typeof p); return Promise.resolve(p()).then(fn); };
  const { slice, live } = rig({ pull });
  await slice.refreshToday(0);
  assert.deepEqual(seen, ['function']);
  assert.equal(live.today.days[0].model.day, '2026-11-10');
});

test('takeModel keeps what main gave and fills only the safe defaults; a stray field is passed through, a bad caption is not', () => {
  const m = takeModel(model('2026-11-10', { caption: 5, notes: ['a', 3, null], counts: 'x' }));
  assert.deepEqual([m.caption, m.notes, m.counts], ['', ['a'], {}]);
  assert.equal(takeModel(null), null);
  assert.equal(takeModel(model('2026-11-10')).day, '2026-11-10');
});
