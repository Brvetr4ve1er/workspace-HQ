// WAR ROOM (SITROOM) — realm #15. The "what's on fire" triage board: renders
// derive.triage() as blast-radius-sorted threats. Badge = active-threat count.
// Sits immediately after HUNTS (order 3) in the rail; hunts/grimoire are
// consecutive integers (3/4) so a fractional order slots this in without
// renumbering either existing realm.
import { triage } from '../../intel/derive.mjs';

export const manifest = {
  id: 'warroom',
  sigil: '⌖',
  lexKey: 'tab_warroom',
  order: 3.5,
  enabled: () => true,
  // `|| null`, not `|| 0`: null is how every other realm hides the rail pill,
  // and a permanent "0" chip on a clean board is chrome that never means
  // anything. Reads data.selected directly rather than via deriveScanContext()
  // — that builds two full project maps just to hand back .S, and
  // refreshBadges() runs every realm's badge on every data:select.
  badge: (data) => {
    try { return triage(data?.selected).length || null; } catch { return null; }
  },
};
