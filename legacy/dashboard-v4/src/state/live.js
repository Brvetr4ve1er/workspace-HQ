// live — thin wiring over the pure reducer in live-core.mjs (v4 SPINE B2).
// One boot-time subscriber for the main-process live pushes; views read via
// get()/getOutput() and re-render via on(fn). Mounted once for the app's
// lifetime (like v3's ambient.js), so the hq subscriptions themselves need no
// teardown — per-view consumers MUST hold the off() returned by on() and call
// it on unmount.
//
// Every hq method is feature-detected: the dev harness exposes no window.hq
// (or a partial one), and hq.onSessionOutput only lands with Phase B3 —
// absence of any method is a silent no-op, never an error.
import { applyEvent, initialState } from './live-core.mjs';

let state = initialState();
let inited = false;
let gotSessionsPush = false; // a live push beats a slower seed reply
let gotBrowserPush = false;
const listeners = new Set();

function emit() {
  for (const fn of [...listeners]) {
    try { fn(state); } catch { /* one broken listener must not starve the rest */ }
  }
}

function dispatch(evt) {
  const next = applyEvent(state, evt);
  if (next === state) return; // reducer ignored it — nothing to announce
  state = next;
  emit();
}

function seed(fn, apply) {
  if (typeof fn !== 'function') return;
  try {
    Promise.resolve(fn()).then(apply).catch(() => { /* seed is best-effort */ });
  } catch { /* a throwing bridge method is still a no-op */ }
}

// Subscribe ONCE to the live pushes, then pull the seeds — the window may
// open after several pushes already landed (mirrors v3 ambient.js).
export function initLive(hq) {
  if (inited) return;
  inited = true;
  if (!hq || typeof hq !== 'object') return;

  if (typeof hq.onClaudeSessions === 'function') {
    hq.onClaudeSessions((sessions) => { gotSessionsPush = true; dispatch({ type: 'sessions', sessions }); });
  }
  if (typeof hq.onMachine === 'function') {
    hq.onMachine((machine) => dispatch({ type: 'machine', machine }));
  }
  if (typeof hq.onBrowserTab === 'function') {
    hq.onBrowserTab((browser) => { gotBrowserPush = true; dispatch({ type: 'browser', browser }); });
  }
  if (typeof hq.onSessionOutput === 'function') {
    hq.onSessionOutput((d) => dispatch({ type: 'session-output', jobId: d?.jobId, chunk: d?.chunk }));
  }

  seed(hq.getSessions, (s) => {
    if (!gotSessionsPush && Array.isArray(s)) dispatch({ type: 'sessions', sessions: s });
  });
  seed(hq.getBrowserLive, (b) => {
    if (!gotBrowserPush && b != null) dispatch({ type: 'browser', browser: b });
  });
}

export function get() { return state; }

export function getOutput(jobId) {
  const outs = state.outputs;
  // Object.hasOwn: a jobId like "constructor" must return '', not a function
  return (typeof jobId === 'string' && outs && Object.hasOwn(outs, jobId)) ? outs[jobId] : '';
}

export function on(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// test hook (house style — actions.mjs exports _reset the same way)
export function _reset() {
  state = initialState();
  inited = false;
  gotSessionsPush = false;
  gotBrowserPush = false;
  listeners.clear();
}
