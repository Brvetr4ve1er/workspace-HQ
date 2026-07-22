// GRIMOIRE — automations / spellbook (charter realm 4).
import { spellCount } from '../../ui/components.js';

export const manifest = {
  id: 'grimoire',
  sigil: '📖',
  lexKey: 'tab_spellbook',
  order: 4,
  // v2 #spell-count: counts.total when the spellbook exists. spellCount's
  // no-spellbook '' maps to null so the shell hides the pill entirely.
  badge: (data) => { const v = spellCount(data); return v === '' ? null : v; },
  enabled: () => true,
};
