// node --test dashboard-v5/tools/cdp-settle.test.mjs
// The in-page settle expression is evaluated in a vm with a fake MutationObserver, a fake clock and fake counters:
// no page, no Electron. Placeholder data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DEFAULTS, normalizeOptions, settleExpr, inPageWaitExpr, readStatsExpr, resetStatsExpr, createSettleStats, makeWaiter, settleSummaryLine, parseSettleLine } from './cdp-settle.mjs';

const flush = () => new Promise((r) => setImmediate(r));

// a page stand-in with a manual clock: advance(ms) fires due timers in time order
function makeEnv(o = {}) {
  let now = 1000, seq = 0;
  const timers = [], observers = [];
  class FakeMO {
    constructor(cb) { if (o.moThrows) throw new Error('no observers here'); this.cb = cb; this.watching = false; observers.push(this); }
    observe() { this.watching = true; }
    disconnect() { this.watching = false; }
  }
  const ctx = {
    Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i >= 0) timers.splice(i, 1); },
    MutationObserver: FakeMO,
    document: { querySelector: (s) => (o.noRoot || s !== '#app' ? null : { id: 'app' }) },
    Promise, JSON,
  };
  if (o.fetch !== false) ctx.fetch = o.fetch || (() => Promise.resolve({ ok: true }));
  ctx.window = ctx;
  vm.createContext(ctx);
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift(); now = next.at; next.fn();
    }
    now = end; await flush();
  }
  const mutate = () => { for (const ob of observers) if (ob.watching) ob.cb([]); };
  const run = (expr) => { let result; let settled = false; const p = vm.runInContext(expr, ctx); p.then((r) => { result = r; settled = true; }); return { get result() { return result; }, get done() { return settled; } }; };
  return { ctx, advance, mutate, run, observers, now: () => now, timers };
}

test('normalizeOptions: defaults, clamps, and never throws on junk', () => {
  assert.deepEqual(normalizeOptions(), { quietMs: DEFAULTS.quietMs, capMs: DEFAULTS.capMs, busyExpr: '' });
  assert.equal(DEFAULTS.capMs, 800);
  assert.equal(normalizeOptions({ capMs: 5 }).capMs, 50);
  assert.equal(normalizeOptions({ capMs: 1e9 }).capMs, 60000);
  assert.equal(normalizeOptions({ quietMs: 5000, capMs: 300 }).quietMs, 300, 'quiet never exceeds the cap');
  assert.equal(normalizeOptions({ quietMs: -4 }).quietMs, 0);
  assert.equal(normalizeOptions({ quietMs: 'x', capMs: NaN }).capMs, 800);
  assert.equal(normalizeOptions({ busyExpr: '  window.__b  ' }).busyExpr, 'window.__b');
  assert.equal(normalizeOptions({ busyExpr: 7 }).busyExpr, '');
  assert.deepEqual(normalizeOptions(null), normalizeOptions({}));
});

test('settleExpr is valid JavaScript and carries the clamped options', () => {
  const e = settleExpr({ quietMs: 90, capMs: 500 });
  assert.doesNotThrow(() => new vm.Script(e));
  assert.match(e, /"quietMs":90,"capMs":500/);
  assert.doesNotThrow(() => new vm.Script(settleExpr()));
});

test('resolves after quietMs without any mutation', async () => {
  const env = makeEnv();
  const r = env.run(settleExpr({ quietMs: 100, capMs: 800 }));
  await env.advance(60); assert.equal(r.done, false, 'not yet at 60 ms');
  await env.advance(60); await env.advance(1);
  assert.equal(r.done, true);
  assert.equal(r.result.settled, true);
  assert.equal(r.result.capHit, false);
  assert.ok(r.result.waitedMs >= 100 && r.result.waitedMs <= 130, 'waited ' + r.result.waitedMs);
  assert.equal(r.result.pending, 0);
  assert.equal(env.observers[0].watching, false, 'the observer is disconnected afterwards');
  assert.deepEqual({ ...env.ctx.__settleStats }, { waits: 1, capHits: 0, waitedMs: r.result.waitedMs });
});

test('keeps waiting while mutations continue, then resolves once the page is quiet', async () => {
  const env = makeEnv();
  const r = env.run(settleExpr({ quietMs: 100, capMs: 800 }));
  for (let i = 0; i < 6; i++) { await env.advance(50); env.mutate(); }   // mutations until 300 ms
  assert.equal(r.done, false, 'still waiting while the DOM changes');
  await env.advance(90); assert.equal(r.done, false, '90 ms of quiet is not enough');
  await env.advance(40);
  assert.equal(r.done, true);
  assert.equal(r.result.capHit, false);
  assert.ok(r.result.waitedMs >= 400 && r.result.waitedMs < 800, 'waited ' + r.result.waitedMs);
});

test('resolves at capMs with capHit true when the page never goes quiet, and counts it', async () => {
  const env = makeEnv();
  const r = env.run(settleExpr({ quietMs: 100, capMs: 800 }));
  for (let i = 0; i < 60; i++) { await env.advance(20); env.mutate(); if (r.done) break; }
  assert.equal(r.done, true);
  assert.equal(r.result.capHit, true);
  assert.equal(r.result.settled, false);
  assert.ok(r.result.waitedMs >= 800 && r.result.waitedMs <= 830, 'waited ' + r.result.waitedMs);
  assert.equal(env.ctx.__settleStats.capHits, 1);
  // a second settle adds to the same counters
  const r2 = env.run(settleExpr({ quietMs: 50, capMs: 400 }));
  await env.advance(120);
  assert.equal(r2.done, true);
  assert.equal(env.ctx.__settleStats.waits, 2);
  assert.equal(env.ctx.__settleStats.capHits, 1);
});

test('waits for a fetch the page started, then settles', async () => {
  let release;
  const slow = new Promise((res) => { release = res; });
  const env = makeEnv({ fetch: () => slow });
  const r = env.run(settleExpr({ quietMs: 100, capMs: 800 }));
  await env.advance(1);
  vm.runInContext('fetch()', env.ctx);   // the hook installed by the settle counts it
  assert.equal(env.ctx.__settlePending.fetch, 1);
  await env.advance(400); assert.equal(r.done, false, 'a pending fetch holds the settle past quietMs');
  release({ ok: true }); await env.advance(60);
  assert.equal(r.done, true);
  assert.equal(r.result.capHit, false);
  assert.equal(env.ctx.__settlePending.fetch, 0);
  assert.ok(r.result.waitedMs >= 400 && r.result.waitedMs < 800, 'waited ' + r.result.waitedMs);
});

test('a rejected fetch is counted down too, and the caller still sees the rejection', async () => {
  const env = makeEnv({ fetch: () => Promise.reject(new Error('offline')) });
  env.run(settleExpr({ quietMs: 50, capMs: 400 }));
  await env.advance(1);
  let caught = null;
  await vm.runInContext('fetch()', env.ctx).catch((e) => { caught = e; });
  await env.advance(5);
  assert.ok(caught && /offline/.test(caught.message));
  assert.equal(env.ctx.__settlePending.fetch, 0);
});

test('waits for a pending hqFake call (count as a function) and for a numeric one', async () => {
  let pending = 2;
  const env = makeEnv();
  env.ctx.hqFake = { pending: () => pending };
  const r = env.run(settleExpr({ quietMs: 100, capMs: 800 }));
  await env.advance(300); assert.equal(r.done, false);
  pending = 0; await env.advance(60);
  assert.equal(r.done, true);
  assert.equal(r.result.capHit, false);

  const env2 = makeEnv();
  env2.ctx.hqFake = { pending: 1 };
  const r2 = env2.run(settleExpr({ quietMs: 100, capMs: 300 }));
  await env2.advance(340);
  assert.equal(r2.done, true);
  assert.equal(r2.result.capHit, true, 'a call that never clears ends at the cap');
  assert.equal(r2.result.pending, 1);
});

test('a throwing pending counter counts as idle; a busy hook holds the settle until it clears', async () => {
  const env = makeEnv();
  env.ctx.hqFake = { pending: () => { throw new Error('unreadable'); } };
  const r = env.run(settleExpr({ quietMs: 50, capMs: 400 }));
  await env.advance(80);
  assert.equal(r.done, true);
  assert.equal(r.result.capHit, false);

  const env2 = makeEnv();
  env2.ctx.__flag = true;
  const r2 = env2.run(settleExpr({ quietMs: 50, capMs: 800, busyExpr: 'window.__flag === true' }));
  await env2.advance(300); assert.equal(r2.done, false);
  env2.ctx.__flag = false; await env2.advance(60);
  assert.equal(r2.done, true);
});

test('never throws when #app is missing, or when the MutationObserver cannot be built', async () => {
  const env = makeEnv({ noRoot: true });
  const r = env.run(settleExpr({ quietMs: 80, capMs: 800 }));
  await env.advance(120);
  assert.equal(r.done, true);
  assert.equal(r.result.rootMissing, true);
  assert.equal(r.result.capHit, false);
  assert.equal(env.observers.length, 0);

  const env2 = makeEnv({ moThrows: true });
  const r2 = env2.run(settleExpr({ quietMs: 80, capMs: 800 }));
  await env2.advance(120);
  assert.equal(r2.done, true);
  assert.equal(r2.result.capHit, false);

  const env3 = makeEnv({ fetch: false });   // a page with no fetch at all
  const r3 = env3.run(settleExpr({ quietMs: 60, capMs: 400 }));
  await env3.advance(100);
  assert.equal(r3.done, true);
});

test('inPageWaitExpr: settle=false is the old fixed sleep, settle=true ignores ms and settles', async () => {
  const old = inPageWaitExpr({ settle: false });
  assert.equal(old, '(ms) => new Promise((r) => setTimeout(r, ms))');
  assert.equal(inPageWaitExpr(), old);
  assert.ok(!/MutationObserver/.test(old));
  const env = makeEnv();
  const sleeper = vm.runInContext(old, env.ctx);
  let slept = false; sleeper(250).then(() => { slept = true; });
  await env.advance(240); assert.equal(slept, false);
  await env.advance(20); assert.equal(slept, true);

  const env2 = makeEnv();
  const e = inPageWaitExpr({ settle: true, quietMs: 60, capMs: 500 });
  assert.doesNotThrow(() => new vm.Script(e));
  const waiter = vm.runInContext(e, env2.ctx);
  let res = null; waiter(9999).then((r) => { res = r; });
  await env2.advance(100);
  assert.ok(res && res.settled === true, 'the 9999 ms argument was ignored');
  assert.ok(res.waitedMs < 200);
});

test('stats expressions run, and createSettleStats adds counters across page reloads', async () => {
  const env = makeEnv();
  assert.deepEqual({ ...vm.runInContext(readStatsExpr(), env.ctx) }, { waits: 0, capHits: 0, waitedMs: 0 });
  env.ctx.__settleStats = { waits: 3, capHits: 1, waitedMs: 700 };
  const evalIn = async (e) => vm.runInContext(e, env.ctx);
  const stats = createSettleStats();
  assert.deepEqual(await stats.collect(evalIn), { waits: 3, capHits: 1, waitedMs: 700 });
  assert.equal(env.ctx.__settleStats.waits, 0, 'the page counter is zeroed after a collect');
  env.ctx.__settleStats = { waits: 2, capHits: 0, waitedMs: 90 };
  assert.deepEqual(await stats.collect(evalIn), { waits: 5, capHits: 1, waitedMs: 790 });
  assert.deepEqual(await stats.collect(async () => { throw new Error('page gone'); }), { waits: 5, capHits: 1, waitedMs: 790 }, 'a dead page loses its counts but is not an error');
  vm.runInContext(resetStatsExpr(), env.ctx);
});

test('makeWaiter: sleeps when settle is off, settles when on, and falls back to sleeping if the page cannot answer', async () => {
  const calls = [];
  const t = { sleep: async (ms) => { calls.push('sleep ' + ms); }, evaluate: async (e) => { calls.push('eval'); return { settled: true, capHit: false, waitedMs: 110 }; } };
  await makeWaiter(t, { settle: false })(220);
  assert.deepEqual(calls, ['sleep 220']);
  calls.length = 0;
  const stats = createSettleStats();
  const wait = makeWaiter(t, { settle: true, stats });
  await wait(220); await wait(30);
  assert.deepEqual(calls, ['eval', 'eval']);
  assert.deepEqual(stats.snapshot(), { waits: 2, capHits: 0, waitedMs: 220 });
  const hit = makeWaiter({ sleep: t.sleep, evaluate: async () => ({ capHit: true, waitedMs: 800 }) }, { settle: true, stats });
  await hit(1);
  assert.equal(stats.snapshot().capHits, 1, 'a cap hit is counted, never thrown');
  calls.length = 0;
  await makeWaiter({ sleep: t.sleep, evaluate: async () => { throw new Error('closed'); } }, { settle: true })(77);
  assert.deepEqual(calls, ['sleep 77']);
});

test('settleSummaryLine and parseSettleLine round-trip; junk parses to null', () => {
  const line = settleSummaryLine({ waits: 1234, capHits: 7 }, { quietMs: 100, capMs: 800 });
  assert.equal(line, '[settle] waits=1234 cap-hits=7 quiet=100ms cap=800ms');
  assert.deepEqual(parseSettleLine('noise\n' + line + '\nmore'), { waits: 1234, capHits: 7, quietMs: 100, capMs: 800 });
  assert.deepEqual(parseSettleLine('[settle] waits=3 cap-hits=0'), { waits: 3, capHits: 0, quietMs: null, capMs: null });
  assert.equal(parseSettleLine('nothing here'), null);
  assert.equal(parseSettleLine(undefined), null);
  assert.equal(settleSummaryLine(null), '[settle] waits=0 cap-hits=0 quiet=100ms cap=800ms');
});

// A source test (recorded 2026-11-14, before --settle was wired into cdp-gate.mjs): the sweeps' assertion texts, finding classes and
// KNOWN_CUTS stay exactly as they were. Wiring --settle may change only WAITS, never an assertion. Add to this list, never remove.
import fs from 'node:fs';
test('the button sweeps keep every original assertion text, finding class and KNOWN_CUTS entry', () => {
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const gate = read('./cdp-gate.mjs'), cosmos = read('./cdp-cosmos.mjs'), dck = read('./cdp-delivery-check.mjs');
  const RECORDED = {
    gate: [
      "const KNOWN_CUTS = [];   // none left",
      "cls === 'not-wired'", "'vanished'", "? (wasSelected ? 'ok' : 'dead') : 'ok'",
      "errs.length ? 'error' : toasts.some((x) => /isn.t wired/.test(x)) ? 'not-wired'",
      "s1.calls === s0.calls && s1.state === s0.state && s1.dom === s0.dom && !toasts.length",
      "findings.filter((f) => !cut(f)).map(line)",
      "'click threw: '", "'rejected: '", "'uncaught: '",
      "async 'money-button-sweep'(t)", "async 'button-sweep'(t)",
      "'delivery-check-button-sweep': 120000", "'cosmos-button-sweep': 180000", "'button-sweep': 900000",
    ],
    cosmos: ["async 'cosmos-button-sweep'(t)", "the sweep reached hq.cosmos.trash ", "the dropped-in file offers no \"Move to Recycle Bin\" button", "arming then No still called hq.cosmos.trash", "a file from the pictures folder offers \"Move to Recycle Bin\"", "the button vanished (", "the scope never rendered (", ": no buttons found"],
    dck: ["async 'delivery-check-button-sweep'(t)", "did nothing: no hq.deliveryCheck call and no toast", "'button #' + i + ' has no label'", "'button #' + i + ' vanished'", "expected at least Look / Check / Forget in the block, found "],
  };
  for (const [name, src] of [['cdp-gate.mjs', gate], ['cdp-cosmos.mjs', cosmos], ['cdp-delivery-check.mjs', dck]]) {
    const list = RECORDED[name === 'cdp-gate.mjs' ? 'gate' : name === 'cdp-cosmos.mjs' ? 'cosmos' : 'dck'];
    for (const s of list) assert.ok(src.includes(s), name + ' lost the recorded text: ' + s);
  }
});
