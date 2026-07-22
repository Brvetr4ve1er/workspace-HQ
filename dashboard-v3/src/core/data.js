// Read-only view over v2's data bundle + Memory-of-Grace selection state.
// build-data.mjs is never touched pre-swap (program invariant 1); realms get
// this object via ctx and re-render on 'data:select'.
import { bus } from './bus.js';

const D = window.DATA || { scans: [], latest: null, built_at: null };
const SCANS = D.scans || [];
let idx = SCANS.length - 1;

export const data = {
  get bundle() { return D; },          // .latest .scans .spellbook .telemetry .weeklyRecap .browser
  get scans() { return SCANS; },
  get latest() { return D.latest; },
  get selected() { return SCANS[idx] || null; },
  get selectedIndex() { return idx; },
  get isLatest() { return idx === SCANS.length - 1; },
  select(i) {
    const next = Math.max(0, Math.min(SCANS.length - 1, i));
    if (next === idx) return;
    idx = next;
    bus.emit('data:select', { index: idx, scan: SCANS[idx], isLatest: this.isLatest });
  },
};
