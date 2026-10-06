// core/notify.mjs — the app's event surface. Phase-1+ features (Oracle, streak
// warnings, the proactive Familiar) call emit() to surface a message: an OS
// Notification when the window is hidden+permitted, else an injected in-app
// toaster. PURE routing; every effect is injected, so it's unit-testable and
// can never crash a caller.
// NOTE: the scan celebration takeover is OWNED by fx.js (its own
// changes_since_prev replay + 'hq-celebrated' dedup). notify does NOT replay
// changes, to avoid a double-fire.
let deps = null;   // { isHidden(), canNotify(), notify(evt), toast?(evt) }

export function initNotify(d) { deps = d; }

export function route(evt, env) {
  if (!evt || !evt.type) return { os: false, toast: false };
  const hidden = !!env?.hidden;
  return { os: !!env?.canNotify && hidden, toast: !hidden };
}

export function emit(evt) {
  if (!deps) return { os: false, toast: false };
  const env = { hidden: deps.isHidden?.(), canNotify: deps.canNotify?.() };
  const r = route(evt, env);
  if (r.os)    { try { deps.notify?.(evt); } catch (e) { console.warn('[notify] os', e); } }
  if (r.toast) { try { deps.toast?.(evt);  } catch (e) { console.warn('[notify] toast', e); } }
  return r;
}
