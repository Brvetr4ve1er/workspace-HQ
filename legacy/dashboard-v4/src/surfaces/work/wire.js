// wire — one-time app wiring the WORK surface needs before it can act:
// the audited action registry and the live-state subscriber.
//
// Both are module-global singletons, so this runs exactly once per app run
// (WORK is the default surface, so "once at first mount" is "once at boot" in
// practice, and re-mounting on every surface switch must NOT re-subscribe).
//
// WHY THE ACTION REGISTRY: core/actions.mjs is the ONE audited path for app
// side-effects. The WORK surface's two new effects — starting and killing an
// agent session — are registered here as `session:start` / `session:kill` and
// dispatched through dispatch(), so there is still exactly one place that logs
// and guards every effect the renderer can cause.
//
// NOTE on dispatch() semantics (read actions.mjs before relying on this):
// dispatch() does NOT consult enabled(); it runs the action and wraps throws.
// So enabled() here is the palette/projection answer, and the VIEW is what
// renders a control disabled. Both read the same fact (`hq.sessionStart` is a
// function), so they cannot disagree.
import { initActions, register } from '../../core/actions.mjs';
import { initLive } from '../../state/live.js';

let wired = false;

export function ensureWired(hq) {
  if (wired) return;
  wired = true;

  // Registers the shared defaults (capture:note, quest:done, claude:dispatch,
  // scan:now, cast). `switchRealm`/`ordered` are v3 concepts with no v4
  // equivalent — initActions optional-chains both, so omitting them simply
  // registers no `go:*` actions.
  initActions({ hq });

  // The renderer supplies ONLY {cwd, task, label}; session-api.js chooses the
  // executable and argv and containment-checks cwd. Nothing here can widen that.
  register({
    id: 'session:start',
    label: 'Dispatch agent',
    run: (ctx) => hq?.sessionStart?.({ cwd: ctx?.cwd, task: ctx?.task, label: ctx?.label }),
    enabled: (ctx) => typeof hq?.sessionStart === 'function' && !!ctx?.cwd && !!ctx?.task,
  });
  register({
    id: 'session:kill',
    label: 'Kill session',
    run: (ctx) => hq?.sessionKill?.(ctx?.jobId),
    enabled: (ctx) => typeof hq?.sessionKill === 'function' && !!ctx?.jobId,
  });

  // One boot-time subscriber for hq:claude-sessions / hq:machine /
  // hq:browser-tab / hq:session-output. Guards a missing/partial hq itself.
  initLive(hq);
}
