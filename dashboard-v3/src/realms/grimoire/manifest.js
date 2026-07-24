// AUTOMATIONS — the command catalog (charter realm 4).
import { spellCount } from '../../ui/components.js';

export const manifest = {
  id: 'grimoire',
  sigil: '⚙️',
  lexKey: 'tab_spellbook',
  order: 4,
  // #spell-count: counts.total when the catalog exists. spellCount's
  // no-catalog '' maps to null so the shell hides the pill entirely.
  badge: (data) => { const v = spellCount(data); return v === '' ? null : v; },
  enabled: () => true,
};
