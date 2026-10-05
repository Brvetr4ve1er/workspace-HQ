// tools/fake-preload.js must stay a drop-in for dashboard/preload.js: the same
// method paths, the same push channels, invoke-vs-send return shapes, and
// callbacks that fire and unsubscribe. (cdp-gate --scenario fake-parity checks
// the method list in a live harness; this runs in plain Node, so a new preload
// method without a SPEC row fails `node --test` too.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const { createFake } = createRequire(import.meta.url)('./fake-preload.js');

// dashboard/preload.js run against a stub electron that records what each method does
function realPreload() {
  const exposed = {}, last = {};
  const ipcRenderer = {
    invoke: (ch) => { last.kind = 'invoke'; last.channel = ch; return Promise.resolve(); },
    send: (ch) => { last.kind = 'send'; last.channel = ch; },
    on: (ch) => { last.kind = 'on'; last.channel = ch; },
    removeListener: (ch) => { last.removed = ch; },
  };
  const electron = { contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } }, ipcRenderer };
  const src = readFileSync(new URL('../../dashboard/preload.js', import.meta.url), 'utf8');
  vm.runInNewContext(src, { require: (m) => { if (m !== 'electron') throw new Error('preload requires ' + m); return electron; } });
  const out = new Map();
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === 'function') {
        for (const key of Object.keys(last)) delete last[key];
        const ret = v(() => {}, 'x', 'y');   // a callback first, for the on* methods
        if (last.kind === 'on') { ret(); out.set(p + k, { kind: 'on', channel: last.channel, unsubscribes: last.removed === last.channel }); }
        else out.set(p + k, { kind: last.kind });
      } else if (v && typeof v === 'object') walk(v, p + k + '.');
    }
  };
  walk(exposed.hq, '');
  return out;
}
const pick = (o, path) => path.split('.').reduce((x, k) => (x ? x[k] : undefined), o);

test('the fake exposes exactly the real preload method paths', () => {
  const real = [...realPreload().keys()].sort(), fake = createFake().methods.slice().sort();
  assert.ok(real.length > 50, 'read the real preload (' + real.length + ' methods)');
  assert.deepEqual(fake.filter((m) => !real.includes(m)), [], 'fake has extra');
  assert.deepEqual(real.filter((m) => !fake.includes(m)), [], 'fake lacks');
});

test('every real push subscription has a fake one on the same channel; callbacks fire and unsubscribe', () => {
  const real = realPreload(), { hq, control } = createFake();
  for (const [method, r] of real) {
    if (r.kind !== 'on') continue;
    assert.ok(r.unsubscribes, method + ': real disposer removes its own channel');
    const got = [];
    const off = pick(hq, method)((d) => got.push(d));
    assert.equal(typeof off, 'function', method + ' returns a disposer');
    assert.equal(control.emit(r.channel, { n: 1 }), 1, method + ' listens on ' + r.channel);
    assert.equal(control.emit(method, { n: 2 }), 1, method + ' also reachable by method path');
    assert.deepEqual(got, [{ n: 1 }, { n: 2 }]);
    off();
    assert.equal(control.emit(r.channel, { n: 3 }), 0, method + ' unsubscribed');
  }
});

test('invoke methods return promises and send methods return nothing, like the real ones', async () => {
  const real = realPreload(), { hq, control } = createFake();
  for (const [method, r] of real) {
    if (r.kind === 'on') continue;
    if (method === 'llm.chat') continue;   // streams on timers; covered below
    const ret = pick(hq, method)('x');
    if (r.kind === 'send') assert.equal(ret, undefined, method + ' is a send');
    else { assert.ok(ret && typeof ret.then === 'function', method + ' is an invoke'); await ret; }
  }
  assert.ok(control.calls().length > 50, 'every call is recorded');
});

test('llm.chat streams accumulated deltas to llm.onDelta, then resolves; cancel stops it', async () => {
  const { hq, control } = createFake();
  const seen = [];
  const off = hq.llm.onDelta((d) => seen.push(d.text));
  const r = await hq.llm.chat({ jobId: 'j1' });
  assert.deepEqual(seen, ['Fake', 'Fake answer', 'Fake answer from the fake model.']);
  assert.equal(r.status, 'done');
  const p = hq.llm.chat({ jobId: 'j2' });
  await hq.llm.cancel('j2');
  assert.equal((await p).status, 'cancelled');
  // like main: a stop after some text streamed answers with that partial text, and
  // cancel says whether the job was running
  const q = hq.llm.chat({ jobId: 'j3' });
  await new Promise((r) => setTimeout(r, 150));   // the first delta ('Fake') went out at 100 ms
  assert.equal(await hq.llm.cancel('j3'), true);
  const rq = await q;
  assert.equal(rq.status, 'cancelled');
  assert.equal(rq.output, 'Fake', 'the partial answer comes back, as main sends it');
  assert.equal(await hq.llm.cancel('j3'), false, 'no such job any more');
  assert.deepEqual(await hq.llm.warm(), { status: 'warm', model: 'fake-model' }, 'warm answers main’s shape');
  off();
  control.reset(true);
});

test('set(…, {persist:true}) answers on the next load of the tab; reset(true) forgets it', async () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  const first = createFake({ storage });
  const boot = { dev: [{ id: 'proj-a', since: '2026-10-05T09:30:00.000Z' }], casts: [], scan: { state: 'failed', code: 1 } };
  first.control.set('liveState', boot, { persist: true });
  assert.deepEqual(await first.hq.liveState(), boot);
  assert.throws(() => first.control.set('liveState', () => boot, { persist: true }), /JSON/);
  assert.throws(() => createFake().control.set('liveState', boot, { persist: true }), /storage/);

  const reloaded = createFake({ storage });   // the preload runs again on reload
  assert.deepEqual(await reloaded.hq.liveState(), boot);
  assert.deepEqual(await reloaded.hq.uiPrefs.get(), { theme: 'dark', resolved: 'dark', reduceMotion: false }, 'only the persisted method changed');

  reloaded.control.reset(true);
  assert.equal(m.size, 0, 'reset(true) clears the persisted values');
  assert.deepEqual(await createFake({ storage }).hq.liveState(), { dev: [], casts: [], scan: { state: 'idle' } });
  // a plain set() never outlives the page
  const plain = createFake({ storage });
  plain.control.set('liveState', boot);
  assert.deepEqual(await createFake({ storage }).hq.liveState(), { dev: [], casts: [], scan: { state: 'idle' } });
});
