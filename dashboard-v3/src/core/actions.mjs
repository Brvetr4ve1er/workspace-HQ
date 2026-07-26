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
