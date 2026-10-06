// live-core — the PURE reducer behind src/state/live.js (v4 SPINE Phase B2).
// No imports, no DOM, no clocks: `applyEvent(state, evt)` folds the main-
// process live pushes into one immutable snapshot
//   { sessions: [],        ← hq:claude-sessions payload, replaced wholesale
//     machine:  null|{cpu,ram,servers},
//     browser:  null|{...live tab...},
//     outputs:  { [jobId]: string } }  ← per-job ring buffer, last 64 000 chars
// Contract: a recognized event returns a NEW state object with the input left
// untouched; a malformed/unknown event returns the SAME reference so the
// wiring layer can skip notifying listeners. Tested in live-core.test.mjs.

export const OUTPUT_CAP = 64000; // chars per job — matches claude-sessions.js BUF_MAX

export function initialState() {
  return { sessions: [], machine: null, browser: null, outputs: {} };
}

function ownOutputs(state) {
  return (state.outputs && typeof state.outputs === 'object') ? state.outputs : {};
}

export function applyEvent(state, evt) {
  const s = (state && typeof state === 'object') ? state : initialState();
  if (!evt || typeof evt !== 'object' || typeof evt.type !== 'string') return s;

  switch (evt.type) {
    case 'sessions': {
      const sessions = Array.isArray(evt.sessions) ? evt.sessions : [];
      // The registry is presence, not history (claude-sessions.js lingers a
      // finished job ~60s, then drops it) — mirror that here: prune output
      // buffers whose job left the list, so long-running apps don't hoard
      // 64KB per dead session. While a job is listed (incl. linger), its
      // output stays readable for the Phase-C CHANGES/output panes.
      const keep = new Set();
      for (const item of sessions) if (item && typeof item.jobId === 'string') keep.add(item.jobId);
      const outputs = {};
      for (const [id, buf] of Object.entries(ownOutputs(s))) if (keep.has(id)) outputs[id] = buf;
      return { ...s, sessions, outputs };
    }
    case 'machine':
      return { ...s, machine: evt.machine ?? null };
    case 'browser':
      return { ...s, browser: evt.browser ?? null };
    case 'session-output': {
      const { jobId } = evt;
      if (typeof jobId !== 'string' || jobId === '' || evt.chunk == null) return s;
      const chunk = String(evt.chunk);
      if (chunk === '') return s;
      const outs = ownOutputs(s);
      // Object.hasOwn: a jobId like "constructor" must not walk the prototype
      const prev = (Object.hasOwn(outs, jobId) && typeof outs[jobId] === 'string') ? outs[jobId] : '';
      return { ...s, outputs: { ...outs, [jobId]: (prev + chunk).slice(-OUTPUT_CAP) } };
    }
    default:
      return s;
  }
}
