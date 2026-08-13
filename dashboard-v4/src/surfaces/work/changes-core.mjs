// changes-core — the PURE attribution logic behind the AGENT pane's CHANGES
// panel. No imports, no DOM, no clocks. Tested in changes-core.test.mjs.
//
// THE PROBLEM IT EXISTS FOR: `git status --porcelain` run after a session ends
// describes the WHOLE working tree. Rendering that list under the session's
// name claims an outcome nobody verified — the repo can already be dirty when
// the agent is dispatched, and then a session that did nothing at all appears
// to have "touched" a file. session-api.js snapshots the dirty set at dispatch
// (IPC-CONTRACT.md: `hq:session-diff` → `baseline`); this splits by it.
//
// WHAT THE SPLIT CAN AND CANNOT SAY:
// - `since`      — the path was NOT dirty at dispatch and is dirty now. That
//                  window belongs to the session AND to anything else that
//                  wrote to the tree meanwhile (the user's editor, another
//                  agent, a probe clicked an hour later). Label it as a window,
//                  never as authorship.
// - `preexisting`— the path was ALREADY dirty at dispatch. The session may have
//                  edited it further; a status-code change is not evidence
//                  either way, so we do not pretend to know.
// Matching is by path string, exactly as git printed it on both ends (same
// parser, same cwd, same quoting), so no normalization is invented here.

export const BASELINE_UNKNOWN = 'unknown';   // no baseline: split is not claimable
export const BASELINE_KNOWN = 'known';

// baseline: {state:'captured', paths} | {state:'unavailable', error} |
//           {state:'none'} | undefined  (an older main omits the field)
export function splitChanges(files, baseline) {
  const list = Array.isArray(files) ? files.filter((f) => f && typeof f === 'object') : [];
  const state = (baseline && typeof baseline === 'object' && typeof baseline.state === 'string')
    ? baseline.state : 'none';

  if (state !== 'captured' || !Array.isArray(baseline.paths)) {
    return {
      mode: BASELINE_UNKNOWN,
      reason: state === 'unavailable'
        ? String(baseline.error || 'the dispatch-time probe failed')
        : 'no dispatch-time snapshot was recorded for this session',
      all: list,
      since: [],
      preexisting: [],
    };
  }

  const was = new Set(baseline.paths.filter((p) => typeof p === 'string'));
  const since = [];
  const preexisting = [];
  for (const f of list) (was.has(f.path) ? preexisting : since).push(f);
  return { mode: BASELINE_KNOWN, reason: '', all: list, since, preexisting };
}

// English that never over-claims. Callers render these verbatim.
export function summarize(split, cwd) {
  const where = cwd ? ` in ${cwd}` : '';
  if (split.mode === BASELINE_UNKNOWN) {
    return `${count(split.all.length)} dirty in the working tree${where} — includes changes not made by this session (${split.reason}).`;
  }
  const p = split.preexisting.length;
  const pre = p ? ` ${count(p)} ${was(p)} already dirty at dispatch.` : '';
  if (!split.since.length) {
    return `Nothing changed${where} since this session was dispatched.${pre}`;
  }
  return `${count(split.since.length)} changed${where} since this session was dispatched.${p ? pre : ' The tree was clean at dispatch.'}`;
}

function count(n) {
  return `${n} file${n === 1 ? '' : 's'}`;
}

function was(n) {
  return n === 1 ? 'was' : 'were';
}
