// cdp-settle: wait for the page to settle instead of sleeping a fixed time (batch 6, "faster gates").
//
// The button sweeps in cdp-gate.mjs pause a fixed 30 / 220 / 260 ms around every click. Most of those pauses are far longer than
// the page needs, and a sweep clicks a thousand buttons. A settle waits only until:
//   - the DOM under #app has had no mutation for `quietMs`, AND
//   - nothing is outstanding: no fetch the page started, no pending hqFake call (when the fake exposes a count), no `busy` hook,
// or until `capMs` (a hard cap, default 800 ms). A cap hit is COUNTED and printed by the caller, never an error and never a
// failed assertion: a settle only ever shortens a wait, it does not assert anything.
//
// Pure module: nothing here touches a page. `settleExpr()` returns text for Runtime.evaluate; the in-page function itself is
// ordinary code (tested in cdp-settle.test.mjs inside a vm with a fake MutationObserver and fake timers).
//
// How cdp-gate.mjs uses it (the shared edit, see the pass notes):
//   import { inPageWaitExpr, createSettleStats, settleSummaryLine } from './cdp-settle.mjs';
//   const settle = process.argv.includes('--settle');
//   in the button-sweep's sweepView template:  sleep = ${inPageWaitExpr({ settle })}     (old text when settle is false)
//   money / cosmos / delivery sweeps:  await wait(ms)  where  const wait = makeWaiter(t, { settle, stats })
//   after the run:  console.log(settleSummaryLine(stats.snapshot(), { settle }))

export const DEFAULTS = Object.freeze({ quietMs: 100, capMs: 800 });
const LIMITS = Object.freeze({ quietMin: 0, capMin: 50, capMax: 60000 });

// Clamp the options to something the in-page function can trust. Never throws.
export function normalizeOptions(o) {
  const src = o && typeof o === 'object' ? o : {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const capMs = Math.min(LIMITS.capMax, Math.max(LIMITS.capMin, Math.round(num(src.capMs, DEFAULTS.capMs))));
  const quietMs = Math.min(capMs, Math.max(LIMITS.quietMin, Math.round(num(src.quietMs, DEFAULTS.quietMs))));
  const busyExpr = typeof src.busyExpr === 'string' && src.busyExpr.trim() ? src.busyExpr.trim().slice(0, 500) : '';
  return { quietMs, capMs, busyExpr };
}

// The function that runs INSIDE the page. It is stringified into an expression, so it may only use page globals
// (window, document, MutationObserver, setTimeout, clearTimeout, Date) and its argument. Resolves, never rejects.
// Result: { settled, capHit, waitedMs, pending, rootMissing }; running totals live on window.__settleStats.
function settleInPage(o) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  const stats = w.__settleStats || (w.__settleStats = { waits: 0, capHits: 0, waitedMs: 0 });
  // count the page's own fetches (idempotent; survives a second install, lost on a reload and put back by the next settle)
  const P = w.__settlePending || (w.__settlePending = { fetch: 0 });
  try {
    if (!w.__settleFetchHooked && typeof w.fetch === 'function') {
      const real = w.fetch.bind(w);
      w.fetch = function () {
        P.fetch++;
        let p;
        try { p = real.apply(null, arguments); } catch (e) { P.fetch--; throw e; }
        Promise.resolve(p).then(() => { P.fetch--; }, () => { P.fetch--; });
        return p;
      };
      w.__settleFetchHooked = true;
    }
  } catch (e) { /* a page that forbids it is simply not counted */ }
  return new Promise((resolve) => {
    const start = Date.now();
    let last = start, obs = null, timer = null, done = false, rootMissing = false;
    let root = null;
    try { root = document.querySelector('#app'); } catch (e) { root = null; }
    if (root && typeof MutationObserver === 'function') {
      try {
        obs = new MutationObserver(() => { last = Date.now(); });
        obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      } catch (e) { obs = null; }
    }
    if (!root) rootMissing = true;
    const pendingNow = () => {
      let n = 0;
      try {
        if (P && typeof P.fetch === 'number' && P.fetch > 0) n += P.fetch;
        const fake = w.hqFake;
        const hp = fake && fake.pending;
        if (typeof hp === 'function') n += Math.max(0, Number(hp()) || 0);
        else if (typeof hp === 'number' && hp > 0) n += hp;
        if (o.busyExpr && w.eval(o.busyExpr)) n += 1;
      } catch (e) { /* an unreadable counter counts as idle */ }
      return n;
    };
    const finish = (capHit, pending) => {
      if (done) return;
      done = true;
      if (timer !== null) { try { clearTimeout(timer); } catch (e) { /* nothing to clear */ } }
      if (obs) { try { obs.disconnect(); } catch (e) { /* already gone */ } }
      const waitedMs = Date.now() - start;
      stats.waits++; stats.waitedMs += waitedMs; if (capHit) stats.capHits++;
      resolve({ settled: !capHit, capHit, waitedMs, pending, rootMissing });
    };
    const step = Math.max(5, Math.min(25, Math.floor(o.quietMs / 4)));
    const tick = () => {
      if (done) return;
      const now = Date.now(), p = pendingNow();
      if (now - start >= o.capMs) return finish(true, p);
      if (p === 0 && now - last >= o.quietMs) return finish(false, 0);
      timer = setTimeout(tick, step);
    };
    tick();
  });
}

const FN_SRC = settleInPage.toString();

// An expression for Runtime.evaluate (awaitPromise) that settles once and resolves the result object.
export function settleExpr(opts) {
  return `(${FN_SRC})(${JSON.stringify(normalizeOptions(opts))})`;
}

// An in-page function EXPRESSION `(ms) => Promise` for code that already runs inside the page (the button sweep's sweepView):
// with settle=false it is the old fixed sleep (same behaviour as before); with settle=true the `ms` argument is ignored
// and the wait is a settle. Embed it where `sleep = (ms) => new Promise(...)` stood.
export function inPageWaitExpr(o) {
  if (!(o && o.settle)) return '(ms) => new Promise((r) => setTimeout(r, ms))';
  return `((opts) => (ms) => (${FN_SRC})(opts))(${JSON.stringify(normalizeOptions(o))})`;
}

export function readStatsExpr() { return `(window.__settleStats ? { waits: window.__settleStats.waits, capHits: window.__settleStats.capHits, waitedMs: window.__settleStats.waitedMs } : { waits: 0, capHits: 0, waitedMs: 0 })`; }
export function resetStatsExpr() { return `(() => { window.__settleStats = { waits: 0, capHits: 0, waitedMs: 0 }; return true; })()`; }

// Totals across page reloads (the in-page counter dies with the page): collect() reads and zeroes the page's counter.
export function createSettleStats() {
  const total = { waits: 0, capHits: 0, waitedMs: 0 };
  return {
    async collect(evaluate) {
      try {
        const s = await evaluate(readStatsExpr());
        if (s && typeof s === 'object') {
          total.waits += Number(s.waits) || 0; total.capHits += Number(s.capHits) || 0; total.waitedMs += Number(s.waitedMs) || 0;
          await evaluate(resetStatsExpr());
        }
      } catch (e) { /* the page went away: its counts are lost, not an error */ }
      return this.snapshot();
    },
    add(s) { if (s) { total.waits += Number(s.waits) || 0; total.capHits += Number(s.capHits) || 0; total.waitedMs += Number(s.waitedMs) || 0; } },
    snapshot() { return { waits: total.waits, capHits: total.capHits, waitedMs: total.waitedMs }; },
  };
}

// Host-side waiter for scenarios that sleep from Node (money, cosmos, delivery sweeps): `await wait(60)` sleeps 60 ms by default
// and settles when o.settle is true. `sleep` is injectable. A settle that cannot be evaluated falls back to the old sleep.
export function makeWaiter(t, o) {
  const settle = !!(o && o.settle);
  const stats = (o && o.stats) || createSettleStats();
  const opts = normalizeOptions(o);
  return async function wait(ms) {
    if (!settle) return t.sleep(ms);
    try {
      const r = await t.evaluate(settleExpr(opts));
      if (r && typeof r === 'object') stats.add({ waits: 1, capHits: r.capHit ? 1 : 0, waitedMs: Number(r.waitedMs) || 0 });
      return r;
    } catch (e) { return t.sleep(ms); }
  };
}

// The line cdp-gate prints after a settled run and tools/gates-core.mjs parses: "[settle] waits=N cap-hits=M quiet=Qms cap=Cms".
export function settleSummaryLine(stats, o) {
  const n = normalizeOptions(o);
  const s = stats || { waits: 0, capHits: 0 };
  return `[settle] waits=${s.waits | 0} cap-hits=${s.capHits | 0} quiet=${n.quietMs}ms cap=${n.capMs}ms`;
}

export function parseSettleLine(text) {
  const m = /^\[settle\] waits=(\d+) cap-hits=(\d+)(?: quiet=(\d+)ms cap=(\d+)ms)?/m.exec(String(text || ''));
  return m ? { waits: Number(m[1]), capHits: Number(m[2]), quietMs: m[3] === undefined ? null : Number(m[3]), capMs: m[4] === undefined ? null : Number(m[4]) } : null;
}
