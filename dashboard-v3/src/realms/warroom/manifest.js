// WAR ROOM (SITROOM) — realm #15. The "what's on fire" triage board: renders
// derive.triage() as blast-radius-sorted threats. Badge = active-threat count.
// Sits immediately after HUNTS (order 3) in the rail; hunts/grimoire are
// consecutive integers (3/4) so a fractional order slots this in without
// renumbering either existing realm.
import { triage } from '../../intel/derive.mjs';
import { deriveScanContext } from '../../ui/components.js';

export const manifest = {
  id: 'warroom',
  sigil: '⌖',
  lexKey: 'tab_warroom',
  order: 3.5,
  enabled: () => true,
  badge: (data) => {
    try { return triage(deriveScanContext(data).S).length || 0; } catch { return 0; }
  },
};
