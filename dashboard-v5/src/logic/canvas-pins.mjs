// Claude › Canvas "Pin to Home" (IPC-CONTRACT 2026-10-27 Canvas Remove + stat card): pure helpers.
// A pin is '<board>/<node id>' in whq3-prefs.canvasPins: per-PC, like the automations shelf.
// Board names can't hold '/' (hq:canvas-add rule), so the first '/' splits the key.

export const CANVAS_PIN_MAX = 6;

// the pin key of a canvas widget, or '' when it can't be pinned (no board or no node id)
export function pinKey(w) {
  const board = w && typeof w.board === 'string' ? w.board : '', id = w && typeof w.id === 'string' ? w.id : '';
  return board && id ? board + '/' + id : '';
}

// pin or unpin one key: { pins, full } (full = it wanted a new pin and the cap is reached; pins unchanged)
export function togglePin(pins, key, max = CANVAS_PIN_MAX) {
  const cur = Array.isArray(pins) ? pins.filter((k) => typeof k === 'string') : [];
  if (!key) return { pins: cur, full: false };
  if (cur.includes(key)) return { pins: cur.filter((k) => k !== key), full: false };
  if (cur.length >= max) return { pins: cur, full: true };
  return { pins: cur.concat([key]), full: false };
}

// the pinned widgets in pin order; a pin whose node is gone (removed, board renamed) just drops
export function pinnedWidgets(pins, widgets) {
  const byKey = new Map((Array.isArray(widgets) ? widgets : []).map((w) => [pinKey(w), w]));
  return (Array.isArray(pins) ? pins : []).map((k) => byKey.get(k)).filter(Boolean);
}
