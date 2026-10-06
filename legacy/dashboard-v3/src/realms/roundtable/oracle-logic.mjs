// oracle-logic.mjs — PURE adapter from a derive.oracle() result to the one
// audited dispatch path. No DOM, no imports — unit-testable under node --test,
// mirroring the intel/ purity firewall.

// action → primary-button copy. Kept here (not in the DOM builder) so the
// wording is asserted by a headless test.
const BTN = {
  commit:  { label: 'Review & commit', icon: '◆' },
  quest:   { label: 'Open task',       icon: '▸' },
  capture: { label: 'Capture',         icon: '✎' },
  scan:    { label: 'Scan now',        icon: '⟳' },
  rest:    { label: 'Open',            icon: '▸' },
};

// The registered dispatch id that enacts the recommendation. capture/scan hit
// their own verbs; every navigational action routes through go:<realm> so the
// side-effect still passes through core/actions.dispatch (the audited seam).
export function oracleActionId(oracle) {
  if (!oracle) return null;
  switch (oracle.action) {
    case 'capture': return 'capture:note';
    case 'scan':    return 'scan:now';
    default:        return 'go:' + (oracle.target?.realmId || 'roundtable');
  }
}

export function oracleButtonMeta(oracle) {
  return (oracle && BTN[oracle.action]) || { label: 'Open', icon: '▸' };
}
