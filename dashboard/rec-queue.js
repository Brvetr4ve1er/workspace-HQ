// Ordered chunk queue for screen recordings (pure, no fs/Electron), used by
// screen-capture.js. Fixes the "recordings save empty" class of bugs:
//   - sequence numbers start at 0 and chunks are written strictly in order;
//   - out-of-order chunks park until their turn;
//   - stop() drains every parked chunk in order and reports gaps instead of
//     silently dropping the tail;
//   - paused time is tracked so elapsed time excludes it.
//
//   const q = createQueue({ write(buf) })      // write is called in seq order
//   q.push(seq, buf)        → number of chunks written now (0 = parked or ignored)
//   q.pause(at) / q.resume(at); q.elapsed(now, startedAt) → ms excluding pauses
//   q.paused                → true between pause() and resume() (for rec-status)
//   q.stop()                → { written, gaps:[seq], parked:0 }
//
// Rules, each pinned by rec-queue.test.mjs:
//   - push ignores (returns 0) a seq that is not a non-negative integer, one
//     already written, one already parked (duplicate), one more than MAX_AHEAD
//     past the next expected seq, and anything after stop(). seq comes from the
//     renderer: without the MAX_AHEAD window one junk seq (2^31) made stop() walk
//     ~2 billion gap entries — a frozen main process, then a RangeError, on every
//     retry. 1e6 chunks at the panel's 500 ms timeslice is ~5.8 days of hole.
//   - stop() writes the parked chunks in ascending seq even across gaps (a WebM
//     with a hole still plays; a dropped tail is the bug), lists every missing
//     seq up to the HIGHEST seq ever pushed (not just the highest parked — a
//     final chunk whose write threw is a gap too), and is idempotent. `written`
//     is the total number of chunks written over the queue's life.
//   - pause/resume take a ms timestamp (default Date.now(); anything that is not
//     a finite number also means "now" — never epoch 0). A second pause while
//     paused, or a resume while running, is a no-op. elapsed() subtracts closed
//     paused spans plus the open one, never goes below 0, and is 0 (not NaN)
//     for a non-numeric startedAt.
//   - write(buf) throwing propagates to the caller; that chunk counts as NOT
//     written (an in-order chunk is not parked — re-push the same seq to retry,
//     else stop() reports it as a gap; a parked one stays parked and stop()
//     retries it).
//   - MEMORY: while seq `next` is missing, every later chunk parks in RAM until
//     it arrives or stop(). Electron IPC keeps one sender's messages in order, so
//     a hole only appears when the sender skips a seq (the numbered-from-1 bug)
//     or a write threw and was not retried — the caller must stop the recording
//     on a write error rather than keep pushing.
const MAX_AHEAD = 1_000_000;    // bounds parked junk AND the gap list stop() builds

function createQueue({ write } = {}) {
  if (typeof write !== 'function') throw new TypeError('createQueue: write(buf) is required');
  let next = 0;                 // the seq that must be written next
  let highest = -1;             // highest seq ever accepted — set BEFORE write(), so a throw still counts
  const parked = new Map();     // seq -> buf, waiting for its turn
  let written = 0;
  let stopped = null;           // the stop() result once stopped
  let pausedAt = null;          // timestamp of the open pause, or null
  let pausedTotal = 0;          // ms of closed paused spans
  const gaps = [];              // missing seqs found by stop(); kept here so a retried stop() still reports them

  const validSeq = (seq) => Number.isInteger(seq) && seq >= 0;
  const ts = (t) => (Number.isFinite(t) ? t : Date.now());   // null/'x'/NaN → now, never epoch 0

  // Write `next` from the park while it is there; returns how many went out.
  function drain() {
    let n = 0;
    while (parked.has(next)) {
      write(parked.get(next));
      parked.delete(next); next++; written++; n++;
    }
    return n;
  }

  function push(seq, buf) {
    if (stopped || !validSeq(seq) || seq < next || seq - next > MAX_AHEAD || parked.has(seq)) return 0;
    if (seq > highest) highest = seq;
    if (seq !== next) { parked.set(seq, buf); return 0; }
    write(buf);
    next++; written++;
    return 1 + drain();
  }

  function pause(at) {
    if (pausedAt != null) return;
    pausedAt = ts(at);
  }
  function resume(at) {
    if (pausedAt == null) return;
    pausedTotal += Math.max(0, ts(at) - pausedAt);
    pausedAt = null;
  }
  function elapsed(now, startedAt = 0) {
    const t = ts(now);
    const open = pausedAt != null ? Math.max(0, t - pausedAt) : 0;
    const ms = t - startedAt - pausedTotal - open;
    return Number.isFinite(ms) ? Math.max(0, ms) : 0;   // a non-numeric startedAt reads 0, not NaN
  }

  function stop() {
    if (stopped) return stopped;
    const seqs = [...parked.keys()].sort((a, b) => a - b);
    for (const seq of seqs) {
      for (let s = next; s < seq; s++) gaps.push(s);
      next = seq;               // hole recorded once: a retry after a throwing write starts here
      write(parked.get(seq));
      parked.delete(seq); next = seq + 1; written++;
    }
    // Everything accepted is now written or was never written: seqs in
    // [next, highest] are holes — incl. a final in-order chunk whose write threw.
    for (let s = next; s <= highest; s++) gaps.push(s);
    if (highest >= next) next = highest + 1;
    stopped = { written, gaps: gaps.slice(), parked: parked.size };
    return stopped;
  }

  return {
    push, pause, resume, elapsed, stop,
    get paused() { return pausedAt != null; },
  };
}

module.exports = { createQueue, MAX_AHEAD };
