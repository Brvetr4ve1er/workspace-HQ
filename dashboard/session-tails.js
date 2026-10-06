// v4.1 D2 — the PARSED tail for sessions this app dispatched.
//
// WHY THIS EXISTS. `claude-sessions.js` buffers RAW process output and is
// READ-ONLY by program constraint, so for a session started with
// `-p --output-format stream-json --verbose` its `tail` is line-delimited JSON.
// That tail is not an internal detail: THREE renderer surfaces display it
// verbatim — legacy/dashboard-v4 work/agent-pane.js, legacy/dashboard-v4
// automate/sessions.js and legacy/dashboard-v3 summoning/view.js (rollback-only renderers).
//
// It gets read constantly, because the app's most common events reload the
// window: `hq:capture-save` and `hq:scan` both spawnSync then `win.reload()`,
// which wipes the renderer's live output buffer (state/live.js) while the
// session is still lingering ~60s in the registry. The very next look at that
// session falls back to `tail` — so without this module the user's reward for
// pressing capture is a wall of `{"type":"assistant",…}` where the agent's
// words were.
//
// WHAT IT IS. A tiny main-process side table: jobId -> the same parsed text
// that `session-api.js` already pushes on `hq:session-output` (one parse, two
// consumers). `main.js` swaps it into the `tail` field on the way out of
// `hq:sessions-list` and the `hq:claude-sessions` push (IPC-CONTRACT.md,
// "Registry tail for sessionStart sessions"). Pure Node, no Electron requires,
// no I/O — unit-tested under plain `node --test`.
//
// SCOPE, deliberately narrow: only jobs `hq:session-start` launched are
// recorded, and only those have their tail substituted. Sessions started
// elsewhere (`hq:claude-quest`, `draft-commit`) never get stream-json args, so
// their raw tail is already plain readable text — touching it would be a
// regression, not a fix.
//
// v5 clean pass: a second side table, jobId -> the contained cwd that
// hq:session-start launched in (setCwd, one line in session-api.js). withTails
// adds it as `cwd` so the renderer can map a session to its project
// (IPC-CONTRACT "Pending — v5 clean pass", additive field). Same scope, same
// FIFO cap and eviction rule as the tails; jobs without a recorded cwd get no
// `cwd` key at all (not null — absent means "not ours").
const TAIL = 800;          // mirrors claude-sessions.js TAIL, so the panes' "last ~800 chars" copy stays true
const MAX_JOBS = 100;      // FIFO cap; presence-sized (the registry drops a job ~60s after it ends), never persisted
const TIMEOUT_MARK = '[timeout]';

const tails = new Map();   // jobId -> parsed text, rolling last TAIL chars
const cwds = new Map();    // jobId -> absolute cwd the session was started in

// Append parsed text for a job. Called with '' at dispatch to CLAIM the jobId:
// a session-api job's raw tail is never useful, so an empty parsed tail (which
// renders the panes' honest "nothing reached this window" state) beats it from
// the first tick, before any line has completed.
function record(jobId, text) {
  const id = typeof jobId === 'string' ? jobId : '';
  if (!id) return;
  const add = text == null ? '' : String(text);
  const prev = tails.get(id);
  tails.set(id, ((prev == null ? '' : prev) + add).slice(-TAIL));
  // Map preserves FIRST-insertion order across re-sets, so this evicts the
  // oldest job, not the least recently written one — matching the registry's
  // own lifetime, which is what these entries shadow.
  while (tails.size > MAX_JOBS) tails.delete(tails.keys().next().value);
}

function has(jobId) { return typeof jobId === 'string' && tails.has(jobId); }

// Record the directory a session-api job runs in. Called once, at dispatch,
// with the containment-checked dir; junk in is ignored, never stored.
function setCwd(jobId, dir) {
  const id = typeof jobId === 'string' ? jobId : '';
  if (!id || typeof dir !== 'string' || !dir) return;
  cwds.set(id, dir);
  while (cwds.size > MAX_JOBS) cwds.delete(cwds.keys().next().value);   // FIFO by first insertion, like record()
}

// Decorate a claude-sessions list: substitute `tail` for the jobs we parsed,
// add `cwd` for the jobs we know the directory of, leave every other entry
// untouched (same object reference). Never throws and never drops entries — a
// failure here would blank a presence list that has nothing to do with
// parsing, so any oddity returns the input unchanged.
function withTails(list) {
  try {
    if (!Array.isArray(list) || (tails.size === 0 && cwds.size === 0)) return list;
    return list.map((s) => {
      if (!s || typeof s !== 'object' || typeof s.jobId !== 'string') return s;
      const hasTail = tails.has(s.jobId), hasCwd = cwds.has(s.jobId);
      if (!hasTail && !hasCwd) return s;              // not ours: raw tail, unchanged
      const out = { ...s };
      if (hasCwd) out.cwd = cwds.get(s.jobId);
      if (!hasTail) return out;
      let tail = tails.get(s.jobId) || '';
      // The registry appends '\n[timeout]' straight into its own buffer when
      // the main-side timeout fires — it bypasses onOutput, so the parser never
      // sees it. Carry it across or the parsed tail silently loses the one line
      // that explains why the run stopped.
      const raw = typeof s.tail === 'string' ? s.tail : '';
      if (raw.trimEnd().endsWith(TIMEOUT_MARK) && !tail.trimEnd().endsWith(TIMEOUT_MARK)) {
        tail = (tail + '\n' + TIMEOUT_MARK).slice(-TAIL);
      }
      out.tail = tail;
      return out;
    });
  } catch { return list; }
}

// test hook (house style — live.js / actions.mjs export _reset the same way)
function _reset() { tails.clear(); cwds.clear(); }

module.exports = { record, has, setCwd, withTails, _reset, TAIL, MAX_JOBS };
