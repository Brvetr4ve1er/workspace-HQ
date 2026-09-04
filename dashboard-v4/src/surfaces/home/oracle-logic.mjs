// oracle-logic.mjs — PURE adapter from a derive.oracle() result to v4's ONE
// audited dispatch path, plus the copy rules the design constitution makes
// testable. No DOM, no imports — runs under `node --test`, mirroring the
// intel/ purity firewall. Ported from dashboard-v3/src/realms/roundtable/
// oracle-logic.mjs and ADAPTED, not copied: see SURFACE_OF.

// derive.oracle() still speaks the v3 realm vocabulary in `target.realmId`
// ('forge' = the project shelf, 'hunts' = the task board). v4 registers exactly
// one `go:<id>` action per rail surface (core/boot.js SURFACES), so the adapter
// translates. Keeping the translation HERE — not in derive.mjs — leaves the
// intel layer's golden fixtures untouched and keeps each rail change a one-line
// edit in this map.
//
// v4.3 retargets two of the three. 'hunts' WAS the queue rail inside AGENT,
// because that is where the board lived; the board is now its own surface, so
// task-scoped advice goes to TASKS. 'roundtable' was parked on the queue with a
// note saying HOME was not registered yet — it is (v4.2 Phase A), and HOME is
// exactly v3's roundtable reborn, so it points there now.
const SURFACE_OF = {
  forge: 'projects',      // project-scoped advice lands on the product shelf
  hunts: 'tasks',         // task-scoped advice lands on the task board
  roundtable: 'home',     // v3's decision surface, reborn as HOME
};

// Any realm the intel layer grows before this map does still resolves to a REAL
// registered surface, so the primary button can never dispatch into nothing.
const FALLBACK_SURFACE = 'work';

// Rail labels, as the user reads them, keyed by surface id. The button copy is
// built from this so the label can never name a different room than the one the
// dispatch id opens (asserted in oracle-logic.test.mjs).
const SURFACE_LABEL = { home: 'Home', tasks: 'Tasks', work: 'Agent', projects: 'Projects', system: 'System', mind: 'Notes', automate: 'Automations', lookback: 'History' };

export function oracleSurfaceId(oracle) {
  return SURFACE_OF[oracle?.target?.realmId] || FALLBACK_SURFACE;
}

// The registered dispatch id that enacts the recommendation. capture/scan hit
// their own verbs; every navigational action routes through `go:<surface>` so
// the side-effect still passes through core/actions.dispatch (the audited seam).
export function oracleActionId(oracle) {
  if (!oracle) return null;
  switch (oracle.action) {
    case 'capture': return 'capture:idea';
    case 'scan':    return 'scan:now';
    default:        return 'go:' + oracleSurfaceId(oracle);
  }
}

// Primary-button copy. HONESTY RULE: in v4.2 a `go:*` action NAVIGATES to a
// surface — it does not open the specific project or task — so the label names
// the destination the user will actually land on. v3's "Review & commit" /
// "Open task" wording promised an action this button does not yet perform; when
// the AGENT seam lands and the button can seed a session, THAT is the moment the
// verb comes back, and this function (with its test) is the one place to change.
export function oracleButtonMeta(oracle) {
  if (!oracle) return { label: `Open ${SURFACE_LABEL[FALLBACK_SURFACE]}`, icon: '▸', destination: FALLBACK_SURFACE };
  if (oracle.action === 'capture') return { label: 'Capture idea', icon: '✎', destination: null };
  if (oracle.action === 'scan')    return { label: 'Scan now',     icon: '⟳', destination: null };
  const id = oracleSurfaceId(oracle);
  return { label: `Open ${SURFACE_LABEL[id] || id}`, icon: '▸', destination: id };
}

// Intel copy arrives as a lowercase fragment ("exposed secrets are a live breach
// risk"). The constitution wants prose, so lift the first letter and terminate
// it — and touch nothing else, because project names and counts inside the
// string carry their own casing.
export function sentence(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const head = t[0].toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(head) ? head : head + '.';
}

// The calm state: derive.oracle() found nothing actionable. Night-aware, and a
// single sentence rather than a styled panel (constitution §Hierarchy).
export function restCopy(nowIso) {
  const h = new Date(nowIso).getHours();
  const night = Number.isFinite(h) && (h >= 22 || h < 6);
  return night
    ? { eyebrow: 'ALL QUIET', line: 'Late, and nothing is at risk. Rest — this can wait for morning.' }
    : { eyebrow: 'ALL CLEAR', line: 'Nothing is on fire. Pick one of today’s cards, or take the win.' };
}
