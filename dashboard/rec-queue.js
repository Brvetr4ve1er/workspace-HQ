// Ordered chunk queue for screen recordings (pure, no fs/Electron), used by
// screen-capture.js. Fixes the "recordings save empty" class of bugs:
//   - sequence numbers start at 0 and chunks are written strictly in order;
//   - out-of-order chunks park until their turn;
//   - stop() drains every parked chunk in order and reports gaps instead of
//     silently dropping the tail;
//   - paused time is tracked so elapsed time excludes it.
//
//   const q = createQueue({ write(buf) })      // write is called in seq order
//   q.push(seq, buf)        → number of chunks written now
//   q.pause(at) / q.resume(at); q.elapsed(now, startedAt) → ms excluding pauses
//   q.stop()                → { written, gaps:[seq], parked:0 }
//
// SKELETON (F1): F6 implements it with rec-queue.test.mjs; S1 (Phase 4) wires it in.
function createQueue() {
  return {
    push: () => 0,
    pause: () => {},
    resume: () => {},
    elapsed: (now, startedAt) => Math.max(0, now - startedAt),
    stop: () => ({ written: 0, gaps: [], parked: 0 }),
  };
}

module.exports = { createQueue };
