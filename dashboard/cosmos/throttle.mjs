/* Cosmos space — the progress throttle: at most 4 events in ANY sliding second, the last one never lost.

   The indexer reports progress as often as it likes; the channel `hq:cosmos:index-progress` may carry at
   most 4 events a second. makeThrottle sits between them.

   Rules:
     - Coalescing: while an event waits for its slot, a newer one replaces it (the latest value wins).
       A payload with done_all: true is the exception — it is never replaced and never dropped, and a newer
       payload after it (a new run) queues BEHIND it instead of overwriting it.
     - Slots: an event is delivered when (a) at least minGapMs passed since the previous one and (b) fewer
       than 4 were delivered in the last 1000 ms (the fifth is allowed only when the first of the previous
       four is strictly more than 1000 ms old, so any closed 1000 ms window holds at most 4 — the final
       done_all included). A quiet gap means the next push is delivered immediately.
     - No timers here. The caller passes now() and calls push() on its own progress ticks; a pending event is
       delivered by a later push(), by flush(), or by `await drain()`, which waits for the free slot with an
       injected sleep(ms). After the final done_all, call `await drain()` (or flush() until it returns 0).

   Pure apart from the injected now / emit / sleep. */

const WINDOW_MS = 1000;
const WINDOW_MAX = 4;
const EPS = 0.001;

/**
 * @param {{ now: ()=>number, emit: (p:any)=>void, minGapMs?: number, sleep?: (ms:number)=>Promise<void> }} args
 */
export function makeThrottle({ now, emit, minGapMs = 250, sleep }) {
  if (typeof now !== 'function' || typeof emit !== 'function') throw new TypeError('makeThrottle needs now() and emit()');
  let times = [];                  // delivery times of the last <= 4 events
  let queue = [];                  // events waiting for a slot (coalesced)

  function nextSlotAt() {
    if (times.length === 0) return -Infinity;
    let t = times[times.length - 1] + minGapMs;
    if (times.length >= WINDOW_MAX) t = Math.max(t, times[times.length - WINDOW_MAX] + WINDOW_MS + EPS);
    return t;
  }

  function tick() {
    const t = now();
    if (times.length && t < times[times.length - 1]) times = [];       // the clock went backwards: forget history
    if (queue.length && t >= nextSlotAt()) {
      const p = queue.shift();
      times.push(t);
      if (times.length > WINDOW_MAX) times.shift();
      emit(p);
    }
  }

  function push(p) {
    const last = queue[queue.length - 1];
    if (last && last.done_all !== true) queue[queue.length - 1] = p;
    else queue.push(p);
    tick();
  }

  function flush() {
    tick();
    return queue.length;
  }

  async function drain(sleepFn = sleep) {
    if (typeof sleepFn !== 'function') throw new TypeError('drain needs a sleep(ms) function');
    while (queue.length) {
      const wait = nextSlotAt() - now();
      if (wait > 0) await sleepFn(Math.ceil(wait));
      tick();
    }
  }

  return {
    push,
    flush,
    drain,
    pending: () => queue.length,
    nextSlotAt,
    reset() { times = []; queue = []; },
  };
}
