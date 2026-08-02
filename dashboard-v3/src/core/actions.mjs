// core/actions.mjs — the ONE audited path for every app side-effect. Buttons,
// the command palette, the Oracle, and the Familiar all dispatch through here,
// so there is exactly one place to guard, log, and reason about actions.
// PURE registry: effect functions are injected at seed time (initActions),
// never imported here — which keeps it unit-testable under node --test.
const REG = new Map();

// action: { id, label, icon?, run(ctx), enabled?(ctx) }
export function register(action) {
  REG.set(action.id, { icon: '', enabled: () => true, ...action });
}

export function resolve(id) { return REG.get(id) || null; }

// Enabled actions projected for a menu/palette. An enabled() that throws is
// treated as "unavailable" rather than crashing the list build.
export function all(ctx) {
  const out = [];
  for (const a of REG.values()) {
    let ok = false;
    try { ok = a.enabled(ctx); } catch { ok = false; }
    if (ok) out.push({ id: a.id, label: a.label, icon: a.icon });
  }
  return out;
}

// Single guarded invocation — a malformed/throwing action can never escape a
// keystroke; it returns {ok:false} and logs, mirroring the palette's activate().
export function dispatch(id, ctx) {
  const a = REG.get(id);
  if (!a) return { ok: false, error: 'unknown-action' };
  try { return { ok: true, result: a.run(ctx) }; }
  catch (err) { console.warn('[actions] dispatch', id, err); return { ok: false, error: err?.message || String(err) }; }
}

// test-only: clear the module-global registry between unit tests.
export function _reset() { REG.clear(); }

// Register the default app actions, wiring real effects passed in as deps so
// this module stays import-pure. Every effect is optional-chain-guarded — a
// missing preload method (old build / headless) degrades to a silent no-op.
// deps: { switchRealm, ordered, hq }
//
// preload.js method names checked against dashboard/preload.js: the scan
// verb is exposed as `runScan()` (not `snapshot`, which is a per-project git
// snapshot with a different signature) — used here. `markQuestDone(id)` and
// `castSpell(id, ...)` match exactly. There is no renderer-invokable
// argument-less "open capture" method (capture.html's own `captureSave(text)`
// is called from inside that window, not from the main renderer) — left as
// `hq?.capture?.()` per the brief; the guard makes the mismatch a no-op
// rather than a crash until that seam is wired.
export function initActions(deps) {
  const { switchRealm, ordered, hq } = deps || {};
  for (const { manifest: m } of (ordered?.() || [])) {
    register({ id: `go:${m.id}`, label: `Go: ${m.id}`, icon: m.sigil, run: () => switchRealm?.(m.id) });
  }
  register({ id: 'scan:now',     label: 'Scan now',       run: () => hq?.runScan?.() });
  register({ id: 'capture:idea', label: 'Capture idea',   run: () => hq?.capture?.() });
  // Real capture seam: preload exposes captureSave(text) (capture:idea's
  // hq.capture() does not exist — see the note above). Text-carrying callers
  // (the Med-Bay cleanup panel) dispatch through here so the write stays on the
  // one audited path.
  register({ id: 'capture:note', label: 'Capture note', run: (ctx) => hq?.captureSave?.(ctx?.text), enabled: (ctx) => !!ctx?.text });
  // Hands a task to Claude INSIDE the target project: hq:claude-quest resolves
  // the project dir and opens a terminal running `claude "<prompt>"` there. The
  // channel already exists (IPC-CONTRACT.md) — this is only the audited wrapper.
  register({ id: 'claude:dispatch', label: 'Send Claude', run: (ctx) => hq?.claudeQuest?.(ctx?.projectPath, ctx?.prompt), enabled: (ctx) => !!ctx?.projectPath && !!ctx?.prompt });
  register({ id: 'quest:done',   label: 'Complete quest', run: (ctx) => hq?.markQuestDone?.(ctx?.questId), enabled: (ctx) => !!ctx?.questId });
  register({ id: 'cast',         label: 'Cast spell',     run: (ctx) => hq?.castSpell?.(ctx?.spellId),      enabled: (ctx) => !!ctx?.spellId });
}
