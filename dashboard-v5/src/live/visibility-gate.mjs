// Visibility gate for the periodic machine push (batch 6, dish quiet-light). Pure logic with the document injected: no timers, no globals
// touched at import.
//
// main sends hq:machine every sampler tick; the store used to answer each with emit(), re-rendering the whole app every 2.5 s even with the
// window hidden. live.machine holds only the LATEST sample (nothing accumulates in the renderer) and the history file is written main-side
// (dashboard/machine-history.js reads data/pc-health-history.json on its own), so a skipped render loses no sample.
//
//   createVisibilityGate({ emit, doc? }) → { tick(), visible(), pending(), dispose() }
//     emit   the store's emit (called with no arguments)
//     doc    the document (default globalThis.document); a missing document, or one without a string visibilityState, counts as VISIBLE (test rigs)
//     tick() the caller has ALREADY stored the sample. Visible: emit now. Hidden: remember that one render is owed.
//     one visibilitychange listener is added at creation (when doc.addEventListener exists) and removed by dispose(); on show it emits ONCE if a
//     render is owed, however many samples arrived while hidden. After dispose() nothing emits.
//
// Only the periodic machine push goes through this. Scan, brief and cast pushes keep emitting as before.
export function createVisibilityGate({ emit, doc } = {}) {
  const d = doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc;
  let owed = false, gone = false;
  const visible = () => {
    if (!d || typeof d.visibilityState !== 'string') return true;
    return d.visibilityState === 'visible';
  };
  const fire = () => { try { if (typeof emit === 'function') emit(); } catch (e) { console.error(e); } };
  const onChange = () => {
    if (gone || !owed || !visible()) return;
    owed = false;
    fire();
  };
  const canListen = !!d && typeof d.addEventListener === 'function' && typeof d.removeEventListener === 'function';
  if (canListen) d.addEventListener('visibilitychange', onChange);
  return {
    tick() {
      if (gone) return;
      if (visible()) { owed = false; fire(); } else owed = true;
    },
    visible,
    pending: () => owed,
    dispose() {
      if (gone) return;
      gone = true; owed = false;
      if (canListen) d.removeEventListener('visibilitychange', onChange);
    },
  };
}
